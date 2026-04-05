import { schema } from "@owostack/db";
import { eq, and, or, sql } from "drizzle-orm";
import {
  calculateAlignedPeriodEnd,
  provisionEntitlements,
} from "../../plan-switch";
import { topUpScopedBalance } from "../../addon-credits";
import { upsertPaymentMethod } from "../../payment-methods";
import {
  buildRenewalSetupFailureMetadata,
  buildRenewalSetupRecoveryUpdate,
  RENEWAL_SETUP_RETRY_DELAYS_MS,
} from "../../renewal-setup";
import { clearCustomerOverageBlockForInvoice } from "../../overage-blocks";
import {
  isCustomerResolutionConflictError,
  resolveCustomerByEmail,
  resolveCustomerByProviderReference,
} from "../../customer-resolution";
import type { WebhookContext } from "../types";
import { safeParseDate, intervalToMs } from "../types";

export type ChargeSuccessDependencies = {
  provisionEntitlements: typeof provisionEntitlements;
  topUpScopedBalance: typeof topUpScopedBalance;
  upsertPaymentMethod: typeof upsertPaymentMethod;
};

export const chargeSuccessDependencies: ChargeSuccessDependencies = {
  provisionEntitlements,
  topUpScopedBalance,
  upsertPaymentMethod,
};

async function resolveChargeSuccessCustomer(
  ctx: WebhookContext,
): Promise<any | null> {
  const { db, organizationId, event } = ctx;
  const providerCustomerId = event.customer.providerCustomerId || null;
  const email = event.customer.email?.toLowerCase() || null;
  const metadataCustomerId =
    typeof event.metadata.customer_id === "string"
      ? event.metadata.customer_id
      : null;
  const metadataInvoiceId =
    typeof event.metadata.invoice_id === "string"
      ? event.metadata.invoice_id
      : null;

  if (metadataCustomerId) {
    const customerById = await db.query.customers.findFirst({
      where: and(
        eq(schema.customers.id, metadataCustomerId),
        eq(schema.customers.organizationId, organizationId),
      ),
    });
    if (customerById) return customerById;
  }

  if (metadataInvoiceId) {
    const invoice = await db.query.invoices.findFirst({
      where: and(
        eq(schema.invoices.id, metadataInvoiceId),
        eq(schema.invoices.organizationId, organizationId),
      ),
    });
    if (invoice?.customerId) {
      const customerByInvoice = await db.query.customers.findFirst({
        where: and(
          eq(schema.customers.id, invoice.customerId),
          eq(schema.customers.organizationId, organizationId),
        ),
      });
      if (customerByInvoice) return customerByInvoice;
    }
  }

  if (providerCustomerId) {
    try {
      const customerByProvider = await resolveCustomerByProviderReference({
        db,
        organizationId,
        providerCustomerId,
      });
      if (customerByProvider) return customerByProvider.customer;
    } catch (error) {
      if (isCustomerResolutionConflictError(error)) {
        console.warn(
          `[WEBHOOK] charge.success customer resolution conflict: ${error.message}`,
        );
        return null;
      }
      throw error;
    }
  }

  if (!email) return null;

  try {
    const customerByEmail = await resolveCustomerByEmail({
      db,
      organizationId,
      email,
    });
    if (customerByEmail) return customerByEmail.customer;
  } catch (error) {
    if (isCustomerResolutionConflictError(error)) {
      console.warn(
        `[WEBHOOK] charge.success customer resolution conflict: ${error.message}`,
      );
      return null;
    }
    throw error;
  }

  const [newCustomer] = await db
    .insert(schema.customers)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      email,
      providerId: event.provider,
      providerCustomerId,
      providerAuthorizationCode: event.authorization?.reusable
        ? event.authorization.code
        : null,
      paystackCustomerId:
        event.provider === "paystack" ? providerCustomerId : null,
      paystackAuthorizationCode:
        event.provider === "paystack" && event.authorization?.reusable
          ? event.authorization.code
          : null,
    })
    .returning();

  return newCustomer;
}

export async function handleChargeSuccess(ctx: WebhookContext): Promise<void> {
  const { db, organizationId, event } = ctx;
  const { metadata } = event;
  const reference = event.payment?.reference || "";
  console.log(`[WEBHOOK] handleChargeSuccess called, reference=${reference}`);

  let dbCustomer = await resolveChargeSuccessCustomer(ctx);
  if (!dbCustomer) {
    console.warn(
      `[WEBHOOK] charge.success could not resolve customer — skipping. ref=${reference}, provider=${event.provider}`,
    );
    return;
  }

  const shouldUpdateProviderDetails =
    !!event.customer.providerCustomerId ||
    (event.authorization?.reusable && !!event.authorization.code);
  if (shouldUpdateProviderDetails) {
    await db
      .update(schema.customers)
      .set({
        providerId: event.provider,
        providerCustomerId:
          event.customer.providerCustomerId || dbCustomer.providerCustomerId,
        providerAuthorizationCode:
          event.authorization?.reusable && event.authorization.code
            ? event.authorization.code
            : dbCustomer.providerAuthorizationCode,
        paystackAuthorizationCode:
          event.provider === "paystack" &&
          event.authorization?.reusable &&
          event.authorization.code
            ? event.authorization.code
            : dbCustomer.paystackAuthorizationCode,
        paystackCustomerId:
          event.provider === "paystack"
            ? event.customer.providerCustomerId || dbCustomer.paystackCustomerId
            : dbCustomer.paystackCustomerId,
        updatedAt: Date.now(),
      })
      .where(eq(schema.customers.id, dbCustomer.id));
  }

  if (ctx.cache) {
    try {
      const cacheAny = ctx.cache as any;
      const dashboardInvalidate =
        typeof cacheAny.invalidateDashboardCustomer === "function"
          ? cacheAny.invalidateDashboardCustomer(dbCustomer.id)
          : Promise.resolve();
      if (typeof cacheAny.invalidateCustomerAliases === "function") {
        await Promise.all([
          cacheAny.invalidateCustomerAliases(organizationId, {
            id: dbCustomer.id,
            email: dbCustomer.email,
            externalId: dbCustomer.externalId,
          }),
          dashboardInvalidate,
        ]);
      } else {
        await Promise.all([
          ctx.cache.invalidateCustomer(organizationId, dbCustomer.id),
          dbCustomer.email
            ? ctx.cache.invalidateCustomer(organizationId, dbCustomer.email)
            : Promise.resolve(),
          dashboardInvalidate,
        ]);
      }
    } catch (e) {
      console.warn(
        `[WEBHOOK] charge.success customer cache invalidation failed:`,
        e,
      );
    }
  }

  // 1b. Upsert payment method if we have a chargeable token.
  // Save rich "card" methods when card details are present. For Stripe card_setup
  // webhooks, PaymentIntent payloads often omit charge-expanded card details, so
  // fall back to a provider-managed token row to make the wallet usable.
  const authorization = event.authorization;
  const shouldStoreCardMethod =
    authorization?.reusable && authorization.code && !!authorization.last4;
  const shouldStoreProviderManagedMethod =
    event.provider === "stripe" &&
    metadata.type === "card_setup" &&
    authorization?.reusable &&
    !!authorization.code;

  if (
    (shouldStoreCardMethod || shouldStoreProviderManagedMethod) &&
    authorization
  ) {
    try {
      await chargeSuccessDependencies.upsertPaymentMethod(db, {
        customerId: dbCustomer.id,
        organizationId,
        providerId: event.provider,
        token: authorization.code,
        type: shouldStoreCardMethod ? "card" : "provider_managed",
        cardLast4: authorization.last4,
        cardBrand: authorization.cardType,
        cardExpMonth: authorization.expMonth,
        cardExpYear: authorization.expYear,
      });
    } catch (pmErr) {
      console.warn(`[WEBHOOK] Failed to upsert payment method: ${pmErr}`);
    }
  }

  // Parse trial flags once — reused by both auto-refund (1c) and trial handling (2).
  const isCardSetup = metadata.type === "card_setup";
  const isTrial = metadata.is_trial === true || metadata.is_trial === "true";
  const isNativeTrial =
    metadata.native_trial === true || metadata.native_trial === "true";
  const isAuthCaptureTrial = isTrial && !isNativeTrial;

  // 1c. Auto-refund auth capture charges (card_setup or non-native trial).
  // These are small verification charges — refund them so the customer isn't billed.
  // Fire-and-forget: refund failure should never block the main flow.
  const refundFn = ctx.adapter?.refundCharge?.bind(ctx.adapter);
  if (
    (isCardSetup || isAuthCaptureTrial) &&
    reference &&
    refundFn &&
    ctx.providerAccount
  ) {
    // Truly fire-and-forget — don't block the webhook response for a non-critical refund.
    const account = ctx.providerAccount;
    const refundType = isCardSetup ? "card_setup" : "trial";
    refundFn({
      reference,
      reason: isCardSetup
        ? "Card setup verification refund"
        : "Trial card verification refund",
      environment: account.environment as "test" | "live",
      account,
    })
      .then((result) => {
        if (result.isErr()) {
          console.warn(
            `[WEBHOOK] Auto-refund failed for ref=${reference}: ${result.error.message}`,
          );
        } else {
          console.log(
            `[WEBHOOK] Auto-refunded auth capture: ref=${reference}, type=${refundType}`,
          );
        }
      })
      .catch((err) => {
        console.warn(
          `[WEBHOOK] Auto-refund error for ref=${reference}: ${err}`,
        );
      });
  }

  // 2. Handle TRIAL subscriptions (is_trial in metadata)
  const trialDays = Number(metadata.trial_days) || 0;
  const trialUnitMeta = metadata.trial_unit as string | undefined;

  // For native trials (e.g. Dodo $0 payment) where our checkout metadata may not
  // survive the round-trip, resolve plan_id from the provider plan code on the event.
  if (isTrial && !metadata.plan_id && event.plan?.providerPlanCode) {
    const resolvedPlan = await db.query.plans.findFirst({
      where: and(
        or(
          eq(schema.plans.providerPlanId, event.plan.providerPlanCode),
          eq(schema.plans.paystackPlanId, event.plan.providerPlanCode),
        ),
        eq(schema.plans.organizationId, organizationId),
      ),
    });
    if (resolvedPlan) {
      metadata.plan_id = resolvedPlan.id;
      metadata.plan_slug = resolvedPlan.slug;
      if (!metadata.amount) metadata.amount = resolvedPlan.price;
      if (!metadata.currency) metadata.currency = resolvedPlan.currency;
    }
  }

  console.log(
    `[WEBHOOK] Trial check: is_trial=${JSON.stringify(metadata.is_trial)} (resolved=${isTrial}), native=${isNativeTrial}, plan_id=${metadata.plan_id}, trial_days=${metadata.trial_days} (resolved=${trialDays})`,
  );

  // For native trials, trialDays may be 0 (metadata lost). Allow entry if native_trial flag is set.
  if (isTrial && metadata.plan_id && (trialDays > 0 || isNativeTrial)) {
    await handleTrialCreation(ctx, dbCustomer, trialDays, trialUnitMeta);
    return;
  }

  // 2b. Trial conversion charges (from trial-end workflow's chargeAuthorization)
  // The workflow handles subscription activation — skip to avoid creating a duplicate.
  const isTrialConversion =
    metadata.trial_conversion === true || metadata.trial_conversion === "true";
  if (isTrialConversion) {
    console.log(
      `[WEBHOOK] Trial conversion charge for customer=${dbCustomer.id}, plan=${metadata.plan_id} — workflow handles activation`,
    );
    return;
  }

  // 2c. Handle INVOICE PAYMENT (from billing.pay() checkout or auto-charge webhook)
  if (metadata.type === "invoice_payment" && metadata.invoice_id) {
    const invoiceId = String(metadata.invoice_id);
    console.log(
      `[WEBHOOK] Invoice payment received: invoice=${invoiceId}, ref=${reference}`,
    );
    try {
      await db
        .update(schema.invoices)
        .set({
          status: "paid",
          amountPaid: event.payment?.amount || 0,
          amountDue: 0,
          paidAt: Date.now(),
          updatedAt: Date.now(),
        })
        .where(eq(schema.invoices.id, invoiceId));
      await clearCustomerOverageBlockForInvoice(db, invoiceId);
    } catch (e) {
      console.warn(`[WEBHOOK] Failed to mark invoice ${invoiceId} as paid:`, e);
    }
    return;
  }

  // 3. Handle PENDING SUBSCRIPTION ACTIVATION (from dashboard checkout flow)
  const isPendingActivation =
    metadata.pending_activation === true ||
    metadata.pending_activation === "true";
  if (isPendingActivation && metadata.subscription_id) {
    const pendingSubId = String(metadata.subscription_id);
    console.log(
      `[WEBHOOK] Pending subscription activation: sub=${pendingSubId}, customer=${dbCustomer.id}`,
    );
    try {
      const planId = metadata.plan_id ? String(metadata.plan_id) : null;
      let periodMs = 30 * 24 * 60 * 60 * 1000;

      if (planId) {
        const plan = await db.query.plans.findFirst({
          where: eq(schema.plans.id, planId),
        });
        if (plan) {
          periodMs = intervalToMs(plan.interval);
        }
      }

      const startMs = safeParseDate(event.payment?.paidAt) || Date.now();
      const endMs =
        safeParseDate(event.subscription?.nextPaymentDate) ||
        startMs + periodMs;

      await db
        .update(schema.subscriptions)
        .set({
          status: "active",
          currentPeriodStart: startMs,
          currentPeriodEnd: endMs,
          providerId: event.provider,
          providerSubscriptionId:
            event.subscription?.providerSubscriptionId ||
            event.subscription?.providerCode ||
            event.payment?.reference ||
            null,
          providerSubscriptionCode:
            event.subscription?.providerCode ||
            event.payment?.reference ||
            null,
          paystackSubscriptionId:
            event.provider === "paystack"
              ? event.subscription?.providerCode ||
                event.payment?.reference ||
                null
              : null,
          paystackSubscriptionCode:
            event.provider === "paystack"
              ? event.subscription?.providerCode ||
                event.payment?.reference ||
                null
              : null,
          updatedAt: Date.now(),
        })
        .where(eq(schema.subscriptions.id, pendingSubId));

      // Provision entitlements for newly activated subscription
      if (metadata.plan_id) {
        await chargeSuccessDependencies.provisionEntitlements(
          db,
          dbCustomer.id,
          String(metadata.plan_id),
        );
      }

      // Invalidate cache
      if (ctx.cache) {
        try {
          await ctx.cache.invalidateSubscriptions(
            ctx.organizationId,
            dbCustomer.id,
          );
        } catch (e) {
          console.warn(
            `[WEBHOOK] Cache invalidation failed for pending activation:`,
            e,
          );
        }
      }

      console.log(
        `[WEBHOOK] Pending subscription activated: sub=${pendingSubId}`,
      );
    } catch (e) {
      console.error(
        `[WEBHOOK] Failed to activate pending subscription ${pendingSubId}:`,
        e,
      );
    }
    return;
  }

  // 4. Handle PLAN UPGRADE (checkout-based upgrade flow)
  if (metadata.type === "plan_upgrade") {
    await handlePlanUpgrade(ctx, dbCustomer);
    return;
  }

  // 4. Handle CREDIT PACK PURCHASE (checkout-based add-on credits)
  if (metadata.type === "credit_purchase" && metadata.credits) {
    await handleCreditPurchase(ctx, dbCustomer, reference);
    return;
  }

  // 5. Handle ONE-TIME PURCHASE
  if (metadata.type === "one_time_purchase" && metadata.plan_id) {
    await handleOneTimePurchase(ctx, dbCustomer);
    return;
  }

  // 6. Handle regular Subscription / Plan Assignment
  if (metadata.plan_id) {
    await handleSubscriptionPayment(ctx, dbCustomer);
  }

  // 6b. Fallback for auto-renewals: provider fires charge.success with
  // subscription_code but NO metadata.plan_id. Look up the subscription by
  // provider code and advance its billing period so usage pools reset.
  if (!metadata.plan_id && event.subscription?.providerCode) {
    await handleAutoRenewal(ctx, dbCustomer);
  } else if (
    !metadata.plan_id &&
    metadata.invoice_action === "update" &&
    event.plan?.providerPlanCode
  ) {
    await handleAutoRenewalByCustomerPlan(ctx, dbCustomer);
  }

  // 7. Handle Credits (if applicable)
  // metadata.credits may be a number (Paystack) or string (Dodo/others)
  const creditsAmount = Number(metadata.credits);
  if (metadata.credits != null && !isNaN(creditsAmount) && creditsAmount > 0) {
    const existingCredits = await db.query.credits.findFirst({
      where: eq(schema.credits.customerId, dbCustomer.id),
    });

    if (existingCredits) {
      // Atomic increment to avoid read-then-write race under concurrent webhooks
      await db
        .update(schema.credits)
        .set({
          balance: sql`${schema.credits.balance} + ${creditsAmount}`,
          updatedAt: Date.now(),
        })
        .where(eq(schema.credits.id, existingCredits.id));
    } else {
      await db.insert(schema.credits).values({
        id: crypto.randomUUID(),
        customerId: dbCustomer.id,
        balance: creditsAmount,
      });
    }
  }
}

// =============================================================================
// Sub-handlers
// =============================================================================

async function handleTrialCreation(
  ctx: WebhookContext,
  dbCustomer: any,
  trialDays: number,
  trialUnitMeta: string | undefined,
): Promise<void> {
  const { db, organizationId, event, workflows } = ctx;
  const { metadata } = event;
  const planId = metadata.plan_id as string;
  const isNativeTrial =
    metadata.native_trial === true || metadata.native_trial === "true";
  const now = Date.now();

  // Compute trial end:
  // Priority:
  // 1. Pre-calculated trial_ends_at from checkout metadata (most reliable)
  // 2. Provider's trialEndDate (e.g., Polar's trial_end)
  // 3. Provider's nextPaymentDate for native trials
  // 4. Calculate from trialDays metadata
  // 5. Fallback: 30 days
  let trialEndMs: number;
  const preCalculatedTrialEnd = metadata.trial_ends_at as string | undefined;

  if (preCalculatedTrialEnd) {
    // Pre-calculated at checkout - most reliable
    const parsedDate = safeParseDate(preCalculatedTrialEnd);
    // Validate: must be between 1 minute from now and 2 years in the future
    const minValidDate = now + 60 * 1000; // 1 minute
    const maxValidDate = now + 730 * 24 * 60 * 60 * 1000; // 2 years
    if (
      parsedDate &&
      parsedDate >= minValidDate &&
      parsedDate <= maxValidDate
    ) {
      trialEndMs = parsedDate;
    } else {
      console.warn(
        `[TRIAL-WEBHOOK] Invalid pre-calculated trial_ends_at: ${preCalculatedTrialEnd}, using fallback`,
      );
      trialEndMs = now + 30 * 24 * 60 * 60 * 1000;
    }
  } else if (isNativeTrial && event.subscription?.trialEndDate) {
    // Provider sent actual trial end date (e.g., Polar's trial_end)
    trialEndMs =
      safeParseDate(event.subscription.trialEndDate) ||
      now + 30 * 24 * 60 * 60 * 1000;
  } else if (isNativeTrial && event.subscription?.nextPaymentDate) {
    // Fallback: use next billing date for native trials without explicit trial_end
    trialEndMs =
      safeParseDate(event.subscription.nextPaymentDate) ||
      now + 30 * 24 * 60 * 60 * 1000;
  } else if (trialDays > 0) {
    trialEndMs =
      trialUnitMeta === "minutes"
        ? now + trialDays * 60 * 1000
        : now + trialDays * 24 * 60 * 60 * 1000;
  } else {
    trialEndMs = now + 30 * 24 * 60 * 60 * 1000;
  }

  // Check if trial has already ended
  const hasTrialEnded = trialEndMs < now;

  console.log(
    `[TRIAL-WEBHOOK] Card captured for trial: plan=${planId}, customer=${dbCustomer.id}, native=${isNativeTrial}, duration=${trialDays} ${trialUnitMeta || "days"}, trialEnds=${new Date(trialEndMs).toISOString()}`,
  );

  // For native trials, use the provider's subscription code directly (not a synthetic trial-xxx code)
  // so subsequent subscription.active events can find and link to this subscription.
  const providerSubCode = event.subscription?.providerCode;
  const trialSubscriptionCode =
    isNativeTrial && providerSubCode
      ? providerSubCode
      : `trial-${crypto.randomUUID().slice(0, 8)}`;

  // Check if an active/trialing subscription already exists (skip canceled/refunded
  // so customers can re-trial a plan they previously had).
  // Also check by provider subscription code for native trials (idempotency).
  const existingSub = await db.query.subscriptions.findFirst({
    where: and(
      eq(schema.subscriptions.customerId, dbCustomer.id),
      eq(schema.subscriptions.planId, planId),
      or(
        eq(schema.subscriptions.status, "active"),
        eq(schema.subscriptions.status, "trialing"),
        eq(schema.subscriptions.status, "pending_cancel"),
      ),
    ),
  });

  // Additional check: for native trials, look up by provider subscription code
  // to prevent duplicates when subscription.active arrives before charge.success
  if (!existingSub && isNativeTrial && providerSubCode) {
    const existingByProviderCode = await db.query.subscriptions.findFirst({
      where: or(
        eq(schema.subscriptions.providerSubscriptionCode, providerSubCode),
        eq(schema.subscriptions.paystackSubscriptionCode, providerSubCode),
      ),
    });
    if (existingByProviderCode) {
      console.log(
        `[TRIAL-WEBHOOK] Found existing subscription by provider code ${providerSubCode}, skipping creation`,
      );
      return;
    }
  }

  let trialSubId: string;
  if (!existingSub) {
    trialSubId = crypto.randomUUID();
    // If trial has already ended, mark as "active" instead of "trialing"
    const subscriptionStatus = hasTrialEnded ? "active" : "trialing";
    console.log(
      `[TRIAL-WEBHOOK] Creating trial subscription: customer=${dbCustomer.id}, plan=${planId}, status=${subscriptionStatus}${hasTrialEnded ? " (trial already ended)" : ""}`,
    );
    await db.insert(schema.subscriptions).values([
      {
        id: trialSubId,
        customerId: dbCustomer.id,
        planId: planId,
        providerId: (metadata.provider_id as string) || event.provider,
        providerSubscriptionId: trialSubscriptionCode,
        providerSubscriptionCode: trialSubscriptionCode,
        paystackSubscriptionCode:
          event.provider === "paystack" ? trialSubscriptionCode : null,
        status: subscriptionStatus,
        currentPeriodStart: now,
        currentPeriodEnd: trialEndMs,
        metadata: {
          ...event.raw,
          trial: true,
          trial_ends_at: trialEndMs,
          authorization_code: event.authorization?.code,
        },
      },
    ]);

    // Dispatch trial-end workflow ONLY for non-native trials (e.g. Paystack).
    // For native trials (Dodo/Polar), the provider manages billing — subscription.renewed
    // fires when the trial ends and handleAutoRenewal transitions the sub to active.
    // Don't dispatch for already-ended trials.
    if (!hasTrialEnded && !isNativeTrial && workflows.trialEnd) {
      try {
        await workflows.trialEnd.create({
          params: {
            subscriptionId: trialSubId,
            customerId: dbCustomer.id,
            planId,
            organizationId,
            providerId: (metadata.provider_id as string) || event.provider,
            environment: (metadata.environment as string) || "test",
            trialEndMs,
            authorizationCode: event.authorization?.reusable
              ? event.authorization.code
              : undefined,
            email: event.customer.email,
            amount: Number(metadata.amount) || 0,
            currency:
              (metadata.currency as string) || event.payment?.currency || "USD",
            planSlug: metadata.plan_slug as string,
            nativeTrial: false,
          },
        });
        console.log(
          `[TRIAL-WEBHOOK] Trial end workflow dispatched: subscription=${trialSubId}, trialEnds=${new Date(trialEndMs).toISOString()}`,
        );
      } catch (wfErr) {
        console.error(
          `[TRIAL-WEBHOOK] Failed to dispatch trial end workflow for subscription=${trialSubId}:`,
          wfErr,
        );
      }
    } else if (hasTrialEnded) {
      console.log(
        `[TRIAL-WEBHOOK] Trial already ended, skipping workflow dispatch: subscription=${trialSubId}`,
      );
    } else if (isNativeTrial) {
      console.log(
        `[TRIAL-WEBHOOK] Native trial — skipping workflow dispatch (provider handles billing): subscription=${trialSubId}`,
      );
    }
  } else {
    // Existing sub found — it may have been created as "active" by a reordered
    // subscription.active event (arrived before this $0 payment). Update to
    // "trialing" with the correct trial period so /check reports the right status
    // and the trial guard works for subsequent subscription.active events.
    // If the trial has already ended, keep as "active" instead.
    trialSubId = existingSub.id;
    if (existingSub.status === "active") {
      const subscriptionStatus = hasTrialEnded ? "active" : "trialing";
      await db
        .update(schema.subscriptions)
        .set({
          status: subscriptionStatus,
          currentPeriodStart: now,
          currentPeriodEnd: trialEndMs,
          providerSubscriptionId: trialSubscriptionCode,
          providerSubscriptionCode: trialSubscriptionCode,
          metadata: {
            ...(typeof existingSub.metadata === "object" && existingSub.metadata
              ? (existingSub.metadata as Record<string, unknown>)
              : {}),
            trial: true,
            trial_ends_at: trialEndMs,
            authorization_code: event.authorization?.code,
          },
          updatedAt: now,
        })
        .where(eq(schema.subscriptions.id, existingSub.id));
      console.log(
        `[TRIAL-WEBHOOK] Updated existing active sub ${existingSub.id} to ${subscriptionStatus}${hasTrialEnded ? " (trial already ended)" : ""} (reordered events)`,
      );
    } else {
      console.log(
        `[TRIAL-WEBHOOK] Existing trialing sub ${existingSub.id} found, skipping creation`,
      );
    }
  }

  // Provision entitlements so trial users can access features
  await chargeSuccessDependencies.provisionEntitlements(
    db,
    dbCustomer.id,
    planId,
  );

  // Invalidate cache so /check sees the trial subscription immediately
  if (ctx.cache) {
    try {
      await ctx.cache.invalidateSubscriptions(organizationId, dbCustomer.id);
    } catch (e) {
      console.warn(`[TRIAL-WEBHOOK] Cache invalidation failed:`, e);
    }
  }

  console.log(
    `[TRIAL-WEBHOOK] Trial subscription flow complete for customer=${dbCustomer.id}`,
  );
}

async function handlePlanUpgrade(
  ctx: WebhookContext,
  dbCustomer: any,
): Promise<void> {
  const { db, organizationId, event, workflows } = ctx;
  const { metadata } = event;
  const newPlanId = metadata.new_plan_id as string;
  const oldSubId = metadata.old_subscription_id as string;
  const oldPlanId = metadata.old_plan_id as string | undefined;
  const upgradeProviderId = (metadata.provider_id as string) || event.provider;

  let oldProviderSubCode: string | undefined;
  if (oldSubId) {
    const oldSub = await db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.id, oldSubId),
    });
    if (oldSub) {
      oldProviderSubCode =
        oldSub.providerSubscriptionCode ||
        oldSub.paystackSubscriptionCode ||
        undefined;
    }
  }

  if (workflows.planUpgrade) {
    try {
      await workflows.planUpgrade.create({
        params: {
          customerId: dbCustomer.id,
          oldSubscriptionId: oldSubId,
          oldPlanId,
          newPlanId,
          organizationId,
          providerId: upgradeProviderId,
          environment: (metadata.environment as string) || "test",
          oldProviderSubscriptionCode: oldProviderSubCode,
          paidAt: event.payment?.paidAt,
          amount: event.payment?.amount,
          currency: event.payment?.currency || "USD",
        },
      });
      console.log(
        `[WEBHOOK] Plan upgrade workflow dispatched: customer=${dbCustomer.id}, newPlan=${newPlanId}`,
      );
    } catch (wfErr) {
      console.error(
        `[WEBHOOK] Failed to dispatch plan upgrade workflow:`,
        wfErr,
      );
      await handlePlanUpgradeInline(
        ctx,
        dbCustomer,
        oldSubId,
        oldPlanId,
        newPlanId,
        upgradeProviderId,
      );
    }
  } else {
    await handlePlanUpgradeInline(
      ctx,
      dbCustomer,
      oldSubId,
      oldPlanId,
      newPlanId,
      upgradeProviderId,
    );
  }
}

async function handleCreditPurchase(
  ctx: WebhookContext,
  dbCustomer: any,
  reference: string,
): Promise<void> {
  const { db, event } = ctx;
  const { metadata } = event;
  const creditPackId = metadata.credit_pack_id as string | undefined;

  // Quantity may have been adjusted by user on provider checkout page.
  const metaQuantity = Number(metadata.quantity) || 1;
  const creditsPerPack = Number(metadata.credits_per_pack) || 0;

  // If we have per-pack info, recalculate total from quantity
  const eventQuantity = event.checkout?.lineItems?.[0]?.quantity;
  const resolvedQuantity =
    typeof eventQuantity === "number" && eventQuantity > 0
      ? eventQuantity
      : metaQuantity;

  const creditsAmount =
    creditsPerPack > 0
      ? creditsPerPack * resolvedQuantity
      : Number(metadata.credits);

  if (isNaN(creditsAmount) || creditsAmount <= 0) {
    console.error(
      `[WEBHOOK] Invalid credits amount: credits=${metadata.credits}, perPack=${creditsPerPack}, qty=${resolvedQuantity}`,
    );
    return;
  }

  // Every add-on must be attached to a credit system
  const creditSystemId = metadata.credit_system_id as string | undefined;
  if (!creditSystemId) {
    console.error(
      `[WEBHOOK] Credit purchase missing credit_system_id: pack=${creditPackId}`,
    );
    return;
  }

  // Dedup: if this payment reference was already processed, skip to avoid double credits
  if (reference) {
    const existingPurchase = await (
      db as any
    ).query.creditPurchases?.findFirst?.({
      where: eq((schema as any).creditPurchases.paymentReference, reference),
    });
    if (existingPurchase) {
      console.log(
        `[WEBHOOK] Credit purchase already processed: ref=${reference}, skipping`,
      );
      return;
    }
  }

  // Atomic upsert into credit_system_balances (uses UNIQUE index)
  await chargeSuccessDependencies.topUpScopedBalance(
    db,
    dbCustomer.id,
    creditSystemId,
    creditsAmount,
  );

  // Record the purchase in the ledger
  await (db as any).insert((schema as any).creditPurchases).values({
    id: crypto.randomUUID(),
    customerId: dbCustomer.id,
    creditPackId: creditPackId || null,
    creditSystemId,
    credits: creditsAmount,
    quantity: resolvedQuantity,
    price: event.payment?.amount || 0,
    currency: event.payment?.currency || "USD",
    paymentReference: reference || null,
    providerId: event.provider,
    metadata: event.raw,
  });

  console.log(
    `[WEBHOOK] Credit purchase: customer=${dbCustomer.id}, credits=${creditsAmount}, qty=${resolvedQuantity}, pack=${creditPackId || "manual"}, system=${creditSystemId}`,
  );
}

async function handleOneTimePurchase(
  ctx: WebhookContext,
  dbCustomer: any,
): Promise<void> {
  const { db, event } = ctx;
  const { metadata } = event;
  const planId = metadata.plan_id as string;
  const now = Date.now();

  const existingPurchase = await db.query.subscriptions.findFirst({
    where: and(
      eq(schema.subscriptions.customerId, dbCustomer.id),
      eq(schema.subscriptions.planId, planId),
      or(
        eq(schema.subscriptions.status, "active"),
        eq(schema.subscriptions.status, "trialing"),
      ),
    ),
  });

  if (!existingPurchase) {
    await db.insert(schema.subscriptions).values([
      {
        id: crypto.randomUUID(),
        customerId: dbCustomer.id,
        planId: planId,
        providerId: (metadata.provider_id as string) || event.provider,
        providerSubscriptionId: "one-time",
        providerSubscriptionCode: "one-time",
        paystackSubscriptionCode:
          event.provider === "paystack" ? "one-time" : null,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: now,
        metadata: { ...event.raw, billing_type: "one_time" },
      },
    ]);
  }

  await chargeSuccessDependencies.provisionEntitlements(
    db,
    dbCustomer.id,
    planId,
  );

  // Invalidate cache so /check sees the one-time purchase immediately
  if (ctx.cache) {
    try {
      await ctx.cache.invalidateSubscriptions(
        ctx.organizationId,
        dbCustomer.id,
      );
    } catch (e) {
      console.warn(`[WEBHOOK] One-time purchase cache invalidation failed:`, e);
    }
  }
}

/**
 * Clean up entities marked for removal at period end
 * Called when a subscription renews to finalize entity removals
 */
async function cleanupPendingRemovalEntities(
  db: any,
  customerId: string,
): Promise<void> {
  try {
    const removed = await db
      .delete(schema.entities)
      .where(
        and(
          eq(schema.entities.customerId, customerId),
          eq(schema.entities.status, "pending_removal"),
        ),
      )
      .returning();

    if (removed.length > 0) {
      console.log(
        `[WEBHOOK] Cleaned up ${removed.length} pending removal entities for customer ${customerId}`,
      );
    }
  } catch (error) {
    console.error(
      `[WEBHOOK] Failed to cleanup pending removal entities for customer ${customerId}:`,
      error,
    );
    // Don't throw - this is cleanup, shouldn't block the renewal
  }
}

async function handleSubscriptionPayment(
  ctx: WebhookContext,
  dbCustomer: any,
): Promise<void> {
  const { db, organizationId, event, cache } = ctx;
  const { metadata } = event;
  const metadataPlanId =
    typeof metadata.plan_id === "string" ? metadata.plan_id : null;
  const providerPlanCode = event.plan?.providerPlanCode;

  // Resolve a plan that belongs to this org before writing FK-backed rows.
  let resolvedPlan = metadataPlanId
    ? await db.query.plans.findFirst({
        where: and(
          eq(schema.plans.id, metadataPlanId),
          eq(schema.plans.organizationId, organizationId),
        ),
      })
    : null;

  if (!resolvedPlan && providerPlanCode) {
    resolvedPlan = await db.query.plans.findFirst({
      where: and(
        or(
          eq(schema.plans.providerPlanId, providerPlanCode),
          eq(schema.plans.paystackPlanId, providerPlanCode),
        ),
        eq(schema.plans.organizationId, organizationId),
      ),
    });
  }

  if (!resolvedPlan) {
    console.warn(
      `[WEBHOOK] charge.success subscription payment skipped: plan not found for org=${organizationId}, metadata.plan_id=${metadataPlanId}, providerPlanCode=${providerPlanCode}`,
    );
    return;
  }

  const planId = resolvedPlan.id;
  metadata.plan_id = planId;

  const existingSub = await db.query.subscriptions.findFirst({
    where: and(
      eq(schema.subscriptions.customerId, dbCustomer.id),
      eq(schema.subscriptions.planId, planId),
      or(
        eq(schema.subscriptions.status, "active"),
        eq(schema.subscriptions.status, "trialing"),
      ),
    ),
  });

  const periodMs = intervalToMs(resolvedPlan.interval);
  const startMs = safeParseDate(event.payment?.paidAt) || Date.now();

  if (!existingSub) {
    await db.insert(schema.subscriptions).values([
      {
        id: crypto.randomUUID(),
        customerId: dbCustomer.id,
        planId: planId,
        providerId: (metadata.provider_id as string) || event.provider,
        providerSubscriptionId: event.payment?.reference || "charge",
        providerSubscriptionCode: event.payment?.reference || "charge",
        paystackSubscriptionCode:
          event.provider === "paystack"
            ? event.payment?.reference || "charge"
            : null,
        status: "active",
        currentPeriodStart: startMs,
        currentPeriodEnd: startMs + periodMs,
        metadata: event.raw,
      },
    ]);
  } else {
    // Renewal: advance billing period so usage pools (credit systems, metered features) reset correctly
    await db
      .update(schema.subscriptions)
      .set({
        status: "active",
        currentPeriodStart: startMs,
        currentPeriodEnd: startMs + periodMs,
        providerId: (metadata.provider_id as string) || event.provider,
        updatedAt: Date.now(),
      })
      .where(eq(schema.subscriptions.id, existingSub.id));

    // Clean up entities marked for removal at period end
    await cleanupPendingRemovalEntities(db, dbCustomer.id);
  }

  await chargeSuccessDependencies.provisionEntitlements(
    db,
    dbCustomer.id,
    planId,
  );

  // Invalidate cached subscriptions so /check and /track see the updated period
  if (cache) {
    try {
      await cache.invalidateSubscriptions(organizationId, dbCustomer.id);
    } catch (e) {
      console.warn(
        `[WEBHOOK] Cache invalidation after subscription update failed:`,
        e,
      );
    }
  }
}

async function handleAutoRenewal(
  ctx: WebhookContext,
  _dbCustomer: any,
): Promise<void> {
  const { db, organizationId, event, cache } = ctx;
  const subCode = event.subscription?.providerCode;
  if (!subCode) return;

  const existingSub = await db.query.subscriptions.findFirst({
    where: or(
      eq(schema.subscriptions.providerSubscriptionCode, subCode),
      eq(schema.subscriptions.paystackSubscriptionCode, subCode),
    ),
    with: { plan: true },
  });

  if (existingSub && existingSub.plan) {
    const periodMs = intervalToMs(existingSub.plan.interval);
    const startMs =
      safeParseDate(event.subscription?.startDate) ||
      safeParseDate(event.payment?.paidAt) ||
      Date.now();
    // Prefer provider's next billing date over calculated period (more accurate for variable-length months)
    const endMs =
      safeParseDate(event.subscription?.nextPaymentDate) || startMs + periodMs;
    const now = Date.now();
    const renewalSetupRecovery = buildRenewalSetupRecoveryUpdate(
      existingSub.metadata,
      "auto_renewal",
      now,
    );

    await db
      .update(schema.subscriptions)
      .set({
        status: "active",
        currentPeriodStart: startMs,
        currentPeriodEnd: endMs,
        cancelAt: renewalSetupRecovery?.clearCancelAt ? null : undefined,
        metadata: renewalSetupRecovery?.metadata,
        updatedAt: now,
      })
      .where(eq(schema.subscriptions.id, existingSub.id));

    // Clean up entities marked for removal at period end
    await cleanupPendingRemovalEntities(db, existingSub.customerId);

    console.log(
      `[WEBHOOK] Auto-renewal: advanced period for sub ${existingSub.id} (code=${subCode}), newEnd=${new Date(endMs).toISOString()}`,
    );

    // Invalidate cache so /check and /track see updated period
    if (cache) {
      try {
        await cache.invalidateSubscriptions(
          organizationId,
          existingSub.customerId,
        );
      } catch (e) {
        console.warn(`[WEBHOOK] Auto-renewal cache invalidation failed:`, e);
      }
    }
  }
}

async function handleAutoRenewalByCustomerPlan(
  ctx: WebhookContext,
  dbCustomer: any,
): Promise<void> {
  const { db, organizationId, event, cache } = ctx;
  const providerPlanCode = event.plan?.providerPlanCode;
  if (!providerPlanCode) return;

  const dbPlan = await db.query.plans.findFirst({
    where: and(
      or(
        eq(schema.plans.providerPlanId, providerPlanCode),
        eq(schema.plans.paystackPlanId, providerPlanCode),
      ),
      eq(schema.plans.organizationId, organizationId),
    ),
  });
  if (!dbPlan) return;

  const existingSub = await db.query.subscriptions.findFirst({
    where: and(
      eq(schema.subscriptions.customerId, dbCustomer.id),
      eq(schema.subscriptions.planId, dbPlan.id),
      or(
        eq(schema.subscriptions.status, "active"),
        eq(schema.subscriptions.status, "pending_cancel"),
        eq(schema.subscriptions.status, "past_due"),
      ),
    ),
    with: { plan: true },
  });

  if (!existingSub || !existingSub.plan) {
    return;
  }

  const periodMs = intervalToMs(existingSub.plan.interval);
  const startMs =
    safeParseDate(event.subscription?.startDate) ||
    safeParseDate(event.payment?.paidAt) ||
    Date.now();
  const endMs =
    safeParseDate(event.subscription?.nextPaymentDate) || startMs + periodMs;
  const now = Date.now();
  const renewalSetupRecovery = buildRenewalSetupRecoveryUpdate(
    existingSub.metadata,
    "auto_renewal_fallback",
    now,
  );

  await db
    .update(schema.subscriptions)
    .set({
      status: "active",
      currentPeriodStart: startMs,
      currentPeriodEnd: endMs,
      providerId: event.provider,
      cancelAt: renewalSetupRecovery?.clearCancelAt ? null : undefined,
      metadata: renewalSetupRecovery?.metadata,
      updatedAt: now,
    })
    .where(eq(schema.subscriptions.id, existingSub.id));

  await cleanupPendingRemovalEntities(db, existingSub.customerId);

  console.log(
    `[WEBHOOK] Auto-renewal fallback: advanced sub ${existingSub.id} by customer+plan ${dbCustomer.id}/${dbPlan.id}, newEnd=${new Date(endMs).toISOString()}`,
  );

  if (cache) {
    try {
      await cache.invalidateSubscriptions(
        organizationId,
        existingSub.customerId,
      );
    } catch (e) {
      console.warn(
        `[WEBHOOK] Auto-renewal customer+plan cache invalidation failed:`,
        e,
      );
    }
  }
}

async function handlePlanUpgradeInline(
  ctx: WebhookContext,
  dbCustomer: any,
  oldSubId: string,
  oldPlanId: string | undefined,
  newPlanId: string,
  upgradeProviderId: string,
): Promise<void> {
  const { db, event, adapter, providerAccount, cache, organizationId } = ctx;
  const now = Date.now();

  // Cancel old subscription (fetch once, reuse for billing cycle below)
  let oldSub: any = null;
  if (oldSubId) {
    oldSub = await db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.id, oldSubId),
    });

    if (oldSub) {
      const subCode =
        oldSub.providerSubscriptionCode || oldSub.paystackSubscriptionCode;
      if (
        adapter &&
        providerAccount &&
        subCode &&
        subCode !== "one-time" &&
        !subCode.startsWith("trial-") &&
        !subCode.startsWith("charge")
      ) {
        try {
          await adapter.cancelSubscription({
            subscription: { id: subCode, status: oldSub.status || "active" },
            environment: providerAccount.environment,
            account: providerAccount,
          });
        } catch (e) {
          console.warn(
            `Webhook inline upgrade: provider cancel threw for ${subCode}:`,
            e,
          );
        }
      }

      await db
        .update(schema.subscriptions)
        .set({ status: "canceled", canceledAt: now, updatedAt: now })
        .where(eq(schema.subscriptions.id, oldSubId));
    }
  }

  // Create new subscription
  const newPlan = await db.query.plans.findFirst({
    where: eq(schema.plans.id, newPlanId),
  });
  const periodMs = newPlan
    ? intervalToMs(newPlan.interval)
    : 30 * 24 * 60 * 60 * 1000;
  const startMs = safeParseDate(event.payment?.paidAt) || now;

  // Idempotency: check for existing active/trialing sub before inserting
  const existingUpgradedSub = await db.query.subscriptions.findFirst({
    where: and(
      eq(schema.subscriptions.customerId, dbCustomer.id),
      eq(schema.subscriptions.planId, newPlanId),
      or(
        eq(schema.subscriptions.status, "active"),
        eq(schema.subscriptions.status, "trialing"),
      ),
    ),
  });

  // Preserve old billing cycle end (reuses oldSub fetched above)
  const endMs = calculateAlignedPeriodEnd(
    oldSub?.currentPeriodEnd,
    startMs,
    periodMs,
  );

  let newSubId: string | undefined;
  if (!existingUpgradedSub) {
    newSubId = crypto.randomUUID();
    await db.insert(schema.subscriptions).values([
      {
        id: newSubId,
        customerId: dbCustomer.id,
        planId: newPlanId,
        providerId: upgradeProviderId,
        providerSubscriptionId: "upgrade",
        providerSubscriptionCode: "upgrade",
        paystackSubscriptionCode:
          event.provider === "paystack" ? "upgrade" : null,
        status: "active",
        currentPeriodStart: startMs,
        currentPeriodEnd: endMs,
        metadata: { ...event.raw, switch_type: "upgrade" },
      },
    ]);
  } else {
    newSubId = existingUpgradedSub.id;
  }

  // Attempt to create provider subscription for recurring billing.
  // Skip for providers with native trials / checkout-based subscriptions —
  // createSubscription would create a checkout session, not a real subscription.
  const providerPlanCode = newPlan?.providerPlanId || newPlan?.paystackPlanId;
  const authCode =
    dbCustomer.providerAuthorizationCode ||
    dbCustomer.paystackAuthorizationCode;
  const customerRef =
    dbCustomer.providerCustomerId ||
    dbCustomer.paystackCustomerId ||
    dbCustomer.email;
  const skipProviderSub = adapter?.supportsNativeTrials === true;
  const requiresProviderSubscription =
    newPlan?.billingType === "recurring" && !skipProviderSub;
  const needsProviderSubscriptionLink =
    !existingUpgradedSub?.providerSubscriptionCode ||
    existingUpgradedSub.providerSubscriptionCode === "upgrade";
  let renewalSetupFailureReason: string | null = null;
  if (requiresProviderSubscription && !providerPlanCode) {
    renewalSetupFailureReason = "missing_provider_plan_code";
  } else if (requiresProviderSubscription && !authCode) {
    renewalSetupFailureReason = "missing_provider_payment_method";
  } else if (requiresProviderSubscription && !dbCustomer.email) {
    renewalSetupFailureReason = "missing_customer_email";
  }
  if (
    adapter &&
    providerAccount &&
    requiresProviderSubscription &&
    needsProviderSubscriptionLink &&
    providerPlanCode &&
    authCode &&
    dbCustomer.email
  ) {
    try {
      const result = await adapter.createSubscription({
        customer: { id: customerRef, email: dbCustomer.email },
        plan: { id: providerPlanCode },
        authorizationCode: authCode,
        startDate: new Date(endMs).toISOString(),
        environment: providerAccount.environment,
        account: providerAccount,
      });
      if (result.isOk() && newSubId) {
        await db
          .update(schema.subscriptions)
          .set({
            providerSubscriptionId: result.value.id,
            providerSubscriptionCode: result.value.id,
            paystackSubscriptionCode:
              event.provider === "paystack" ? result.value.id : null,
            cancelAt: null,
            updatedAt: Date.now(),
          })
          .where(eq(schema.subscriptions.id, newSubId));
      } else if (result.isErr()) {
        renewalSetupFailureReason = result.error.message;
      }
    } catch (e) {
      renewalSetupFailureReason =
        e instanceof Error ? e.message : String(e);
      console.warn(
        `[WEBHOOK] Inline upgrade: provider createSubscription failed:`,
        e,
      );
    }
  }

  if (
    newSubId &&
    requiresProviderSubscription &&
    needsProviderSubscriptionLink &&
    renewalSetupFailureReason
  ) {
    let retryScheduled = false;
    if (ctx.workflows.renewalSetup) {
      try {
        await ctx.workflows.renewalSetup.create({
          params: {
            subscriptionId: newSubId,
            customerId: dbCustomer.id,
            organizationId,
            providerId: upgradeProviderId,
            source: "plan_upgrade_inline",
            immediate: false,
          },
        });
        retryScheduled = true;
      } catch (retryErr) {
        console.warn(
          `[WEBHOOK] Inline upgrade: failed to schedule renewal setup retry:`,
          retryErr,
        );
      }
    }

    const existingMetadata = existingUpgradedSub?.metadata || {
      ...event.raw,
      switch_type: "upgrade",
    };
    await db
      .update(schema.subscriptions)
      .set({
        providerSubscriptionId: null,
        providerSubscriptionCode: null,
        paystackSubscriptionCode: null,
        cancelAt: endMs,
        metadata: buildRenewalSetupFailureMetadata(existingMetadata, {
          reason: renewalSetupFailureReason,
          source: "plan_upgrade_inline",
          retryScheduled,
          nextAttemptAt: retryScheduled
            ? Date.now() + RENEWAL_SETUP_RETRY_DELAYS_MS[0]
            : null,
          now: Date.now(),
        }),
        updatedAt: Date.now(),
      })
      .where(eq(schema.subscriptions.id, newSubId));
  }

  await chargeSuccessDependencies.provisionEntitlements(
    db,
    dbCustomer.id,
    newPlanId,
    oldPlanId,
  );

  // Invalidate cache so /check and /track see the new subscription
  if (cache) {
    try {
      await cache.invalidateSubscriptions(organizationId, dbCustomer.id);
    } catch (e) {
      console.warn(`[WEBHOOK] Inline upgrade cache invalidation failed:`, e);
    }
  }
}
