import { Result } from "better-result";
import type { createDb } from "@owostack/db";
import { schema } from "@owostack/db";
import { eq, and, or } from "drizzle-orm";
import { DatabaseError } from "./errors";
import type { ProviderAdapter, ProviderAccount, NormalizedWebhookEvent } from "@owostack/adapters";
import { EntitlementCache } from "./cache";
import { provisionEntitlements as provisionEntitlementsShared } from "./plan-switch";
import { topUpScopedBalance } from "./addon-credits";

// =============================================================================
// Types
// =============================================================================

type DB = ReturnType<typeof createDb>;

// =============================================================================
// Handler Implementation
// =============================================================================

export class WebhookHandler {
  private adapter: ProviderAdapter | null;
  private providerAccount: ProviderAccount | null;
  private trialEndWorkflow: any | null;
  private planUpgradeWorkflow: any | null;
  private cache: EntitlementCache | null;

  constructor(
    private db: DB,
    private organizationId: string,
    opts?: {
      adapter?: ProviderAdapter;
      account?: ProviderAccount;
      trialEndWorkflow?: any;
      planUpgradeWorkflow?: any;
      cache?: KVNamespace;
    },
  ) {
    this.adapter = opts?.adapter || null;
    this.providerAccount = opts?.account || null;
    this.trialEndWorkflow = opts?.trialEndWorkflow || null;
    this.planUpgradeWorkflow = opts?.planUpgradeWorkflow || null;
    this.cache = opts?.cache ? new EntitlementCache(opts.cache) : null;
  }

  /**
   * Handle a normalized webhook event — provider-agnostic.
   * Verification + parsing are done upstream via the adapter.
   */
  async handle(
    event: NormalizedWebhookEvent,
  ): Promise<Result<boolean, DatabaseError>> {
    return Result.tryPromise({
      try: async () => {
        // 1. Log event for audit trail
        await this.db.insert(schema.events).values({
          id: crypto.randomUUID(),
          organizationId: this.organizationId,
          type: event.type,
          data: event.raw,
          processed: false,
        });

        console.log(JSON.stringify(event, null, 2));

        // 2. Route to handler by normalized event type
        switch (event.type) {
          case "subscription.created":
            await this.handleSubscriptionCreated(event);
            break;
          case "subscription.canceled":
            await this.handleSubscriptionStatusChange(event, "canceled");
            break;
          case "subscription.active":
            await this.handleSubscriptionStatusChange(event, "active");
            break;
          case "subscription.not_renew":
            await this.handleSubscriptionStatusChange(event, "pending_cancel");
            break;
          case "subscription.past_due":
            await this.handleSubscriptionStatusChange(event, "past_due");
            break;
          case "charge.success":
            await this.handleChargeSuccess(event);
            break;
          case "charge.failed":
            await this.handlePaymentFailed(event);
            break;
          case "refund.success":
            await this.handleRefund(event);
            break;
          case "refund.failed":
            console.log(`[WEBHOOK] Refund failed for org=${this.organizationId}, ref=${event.refund?.reference}`);
            break;
          case "customer.identified":
            await this.handleCustomerIdentified(event);
            break;
        }

        return true;
      },
      catch: (e) => new DatabaseError({ operation: "handleWebhook", cause: e }),
    });
  }

  private async handleSubscriptionCreated(event: NormalizedWebhookEvent) {
    const providerCode = event.subscription?.providerCode;
    const planCode = event.plan?.providerPlanCode;

    // Find or create customer scoped to this organization
    let dbCustomer = await this.db.query.customers.findFirst({
      where: and(
        eq(schema.customers.email, event.customer.email),
        eq(schema.customers.organizationId, this.organizationId),
      ),
    });

    if (!dbCustomer) {
      const [newCustomer] = await this.db
        .insert(schema.customers)
        .values({
          id: crypto.randomUUID(),
          organizationId: this.organizationId,
          email: event.customer.email,
          providerId: event.provider,
          providerCustomerId: event.customer.providerCustomerId,
          paystackCustomerId: event.provider === "paystack" ? event.customer.providerCustomerId : null,
        })
        .returning();
      dbCustomer = newCustomer;
    }

    if (!planCode) {
      console.warn(`[WEBHOOK] subscription.created without plan code for org ${this.organizationId}`);
      // Try to link the subscription code to an existing active sub for this customer
      if (providerCode) {
        const existingSubForCustomer = await this.db.query.subscriptions.findFirst({
          where: and(
            eq(schema.subscriptions.customerId, dbCustomer.id),
            eq(schema.subscriptions.status, "active"),
          ),
        });
        if (existingSubForCustomer) {
          await this.db
            .update(schema.subscriptions)
            .set({
              providerSubscriptionId: providerCode,
              providerSubscriptionCode: providerCode,
              paystackSubscriptionId: event.provider === "paystack" ? providerCode : existingSubForCustomer.paystackSubscriptionId,
              paystackSubscriptionCode: event.provider === "paystack" ? providerCode : existingSubForCustomer.paystackSubscriptionCode,
              updatedAt: Date.now(),
            })
            .where(eq(schema.subscriptions.id, existingSubForCustomer.id));
        }
      }
      return;
    }

    const dbPlan = await this.db.query.plans.findFirst({
      where: and(
        or(
          eq(schema.plans.paystackPlanId, planCode),
          eq(schema.plans.providerPlanId, planCode),
        ),
        eq(schema.plans.organizationId, this.organizationId),
      ),
    });

    if (!dbPlan) {
      // Plan not found — try to link to existing active sub
      if (providerCode) {
        const existingSubForCustomer = await this.db.query.subscriptions.findFirst({
          where: and(
            eq(schema.subscriptions.customerId, dbCustomer.id),
            eq(schema.subscriptions.status, "active"),
          ),
        });
        if (existingSubForCustomer) {
          await this.db
            .update(schema.subscriptions)
            .set({
              providerSubscriptionId: providerCode,
              providerSubscriptionCode: providerCode,
              paystackSubscriptionId: event.provider === "paystack" ? providerCode : existingSubForCustomer.paystackSubscriptionId,
              paystackSubscriptionCode: event.provider === "paystack" ? providerCode : existingSubForCustomer.paystackSubscriptionCode,
              updatedAt: Date.now(),
            })
            .where(eq(schema.subscriptions.id, existingSubForCustomer.id));
        } else {
          console.warn(`Plan ${planCode} not found in org ${this.organizationId}, no existing sub to link`);
        }
      }
      return;
    }

    // Check for existing subscription by provider code (idempotency — same webhook twice)
    if (providerCode) {
      const existing = await this.db.query.subscriptions.findFirst({
        where: or(
          eq(schema.subscriptions.paystackSubscriptionCode, providerCode),
          eq(schema.subscriptions.providerSubscriptionCode, providerCode),
        ),
      });
      if (existing) return;
    }

    // Check for existing subscription by customer+plan (race condition guard).
    // When our code calls createSubscription on the provider, the webhook can
    // arrive before we've updated the local DB with the provider sub code.
    // If we find an existing trialing/active sub, update it instead of creating a duplicate.
    if (providerCode) {
      const existingByPlan = await this.db.query.subscriptions.findFirst({
        where: and(
          eq(schema.subscriptions.customerId, dbCustomer.id),
          eq(schema.subscriptions.planId, dbPlan.id),
          or(
            eq(schema.subscriptions.status, "trialing"),
            eq(schema.subscriptions.status, "active"),
          ),
        ),
      });

      if (existingByPlan) {
        await this.db
          .update(schema.subscriptions)
          .set({
            providerSubscriptionId: providerCode,
            providerSubscriptionCode: providerCode,
            paystackSubscriptionCode: event.provider === "paystack" ? providerCode : existingByPlan.paystackSubscriptionCode,
            updatedAt: Date.now(),
          })
          .where(eq(schema.subscriptions.id, existingByPlan.id));
        console.log(`[WEBHOOK] subscription.created linked to existing sub ${existingByPlan.id} (was ${existingByPlan.status})`);
        return;
      }
    }

    const now = Date.now();
    const periodStart = safeParseDate(event.subscription?.startDate) || now;
    const periodEnd = safeParseDate(event.subscription?.nextPaymentDate) ||
      periodStart + 30 * 24 * 60 * 60 * 1000;

    await this.db.insert(schema.subscriptions).values([
      {
        id: crypto.randomUUID(),
        customerId: dbCustomer.id,
        planId: dbPlan.id,
        providerId: event.provider,
        providerSubscriptionId: providerCode || crypto.randomUUID(),
        providerSubscriptionCode: providerCode || crypto.randomUUID(),
        paystackSubscriptionId: event.provider === "paystack" ? providerCode : null,
        paystackSubscriptionCode: event.provider === "paystack" ? providerCode : null,
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        providerMetadata: event.raw,
        metadata: event.raw,
      },
    ]);

    // Provision entitlements for the new subscription
    await this.provisionEntitlements(dbCustomer.id, dbPlan.id);
  }

  private async handleSubscriptionStatusChange(
    event: NormalizedWebhookEvent,
    status: string,
  ) {
    const subscriptionCode = event.subscription?.providerCode;
    if (!subscriptionCode) return;

    // Fetch sub once — needed for cancelAt (pending_cancel) and cache invalidation
    const sub = await this.db.query.subscriptions.findFirst({
      where: or(
        eq(schema.subscriptions.paystackSubscriptionCode, subscriptionCode),
        eq(schema.subscriptions.providerSubscriptionCode, subscriptionCode),
      ),
    });
    if (!sub) return;

    const now = Date.now();
    const updates: Record<string, unknown> = {
      status,
      updatedAt: now,
    };

    if (status === "canceled") {
      updates.canceledAt = now;
    }

    // For pending_cancel (not_renew): set cancelAt to period end so /check
    // lazy enforcement revokes access when the period expires.
    if (status === "pending_cancel" && sub.currentPeriodEnd) {
      updates.cancelAt = sub.currentPeriodEnd;
    }

    await this.db
      .update(schema.subscriptions)
      .set(updates)
      .where(eq(schema.subscriptions.id, sub.id));

    // Invalidate cache so /check sees the status change
    if (this.cache) {
      try {
        await this.cache.invalidateSubscriptions(this.organizationId, sub.customerId);
      } catch (e) {
        console.warn(`[WEBHOOK] Status change cache invalidation failed:`, e);
      }
    }
  }

  private async handleChargeSuccess(event: NormalizedWebhookEvent) {
    const { metadata } = event;
    const reference = event.payment?.reference || "";
    console.log(`[WEBHOOK] handleChargeSuccess called, reference=${reference}`);

    // 1. Find or Create Customer
    let dbCustomer = await this.db.query.customers.findFirst({
      where: and(
        eq(schema.customers.email, event.customer.email.toLowerCase()),
        eq(schema.customers.organizationId, this.organizationId),
      ),
    });

    if (!dbCustomer) {
      const [newCustomer] = await this.db
        .insert(schema.customers)
        .values({
          id: crypto.randomUUID(),
          organizationId: this.organizationId,
          email: event.customer.email.toLowerCase(),
          providerId: event.provider,
          providerCustomerId: event.customer.providerCustomerId,
          providerAuthorizationCode: event.authorization?.reusable
            ? event.authorization.code
            : null,
          paystackCustomerId: event.provider === "paystack" ? event.customer.providerCustomerId : null,
          paystackAuthorizationCode: event.provider === "paystack" && event.authorization?.reusable
            ? event.authorization.code
            : null,
        })
        .returning();
      dbCustomer = newCustomer;
    } else if (event.authorization?.reusable && event.authorization.code) {
      // Update authorization code if we got a new reusable one
      await this.db
        .update(schema.customers)
        .set({
          providerId: event.provider,
          providerCustomerId: event.customer.providerCustomerId,
          providerAuthorizationCode: event.authorization.code,
          paystackAuthorizationCode: event.provider === "paystack" ? event.authorization.code : dbCustomer.paystackAuthorizationCode,
          paystackCustomerId: event.provider === "paystack" ? event.customer.providerCustomerId : dbCustomer.paystackCustomerId,
          updatedAt: Date.now(),
        })
        .where(eq(schema.customers.id, dbCustomer.id));
    }

    // 2. Handle TRIAL subscriptions (is_trial in metadata)
    // Providers may stringify metadata values, so coerce to handle both boolean and string
    const isTrial = metadata.is_trial === true || metadata.is_trial === "true";
    const trialDays = Number(metadata.trial_days) || 0;
    const trialUnitMeta = metadata.trial_unit as string | undefined;
    console.log(`[WEBHOOK] Trial check: is_trial=${JSON.stringify(metadata.is_trial)} (resolved=${isTrial}), plan_id=${metadata.plan_id}, trial_days=${metadata.trial_days} (resolved=${trialDays})`);

    if (isTrial && metadata.plan_id && trialDays > 0) {
      const planId = metadata.plan_id as string;
      const now = Date.now();
      const trialEndMs = trialUnitMeta === "minutes"
        ? now + trialDays * 60 * 1000
        : now + trialDays * 24 * 60 * 60 * 1000;
      console.log(`[TRIAL-WEBHOOK] Card captured for trial: plan=${planId}, customer=${dbCustomer.id}, duration=${trialDays} ${trialUnitMeta || 'days'}, trialEnds=${new Date(trialEndMs).toISOString()}`);
      const trialSubscriptionCode = `trial-${crypto.randomUUID().slice(0, 8)}`;

      // Check if subscription already exists
      const existingSub = await this.db.query.subscriptions.findFirst({
        where: and(
          eq(schema.subscriptions.customerId, dbCustomer.id),
          eq(schema.subscriptions.planId, planId),
        ),
      });

      if (!existingSub) {
        const trialSubId = crypto.randomUUID();
        console.log(`[TRIAL-WEBHOOK] Creating trial subscription: customer=${dbCustomer.id}, plan=${planId}`);
        await this.db.insert(schema.subscriptions).values([
          {
            id: trialSubId,
            customerId: dbCustomer.id,
            planId: planId,
            providerId: (metadata.provider_id as string) || event.provider,
            providerSubscriptionId: trialSubscriptionCode,
            providerSubscriptionCode: trialSubscriptionCode,
            paystackSubscriptionCode: event.provider === "paystack" ? trialSubscriptionCode : null,
            status: "trialing",
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

        // Dispatch trial-end workflow
        if (this.trialEndWorkflow) {
          try {
            await this.trialEndWorkflow.create({
              params: {
                subscriptionId: trialSubId,
                customerId: dbCustomer.id,
                planId,
                organizationId: this.organizationId,
                providerId: (metadata.provider_id as string) || event.provider,
                environment: (metadata.environment as string) || "test",
                trialEndMs,
                authorizationCode: event.authorization?.code,
                email: event.customer.email,
                amount: Number(metadata.amount) || 0,
                currency: (metadata.currency as string) || event.payment?.currency || "USD",
                planSlug: metadata.plan_slug as string,
              },
            });
            console.log(`[TRIAL-WEBHOOK] Trial end workflow dispatched: subscription=${trialSubId}, trialEnds=${new Date(trialEndMs).toISOString()}`);
          } catch (wfErr) {
            console.error(`[TRIAL-WEBHOOK] Failed to dispatch trial end workflow for subscription=${trialSubId}:`, wfErr);
          }
        }
      }

      // Provision entitlements so trial users can access features
      await this.provisionEntitlements(dbCustomer.id, planId);
      console.log(`[TRIAL-WEBHOOK] Trial subscription flow complete for customer=${dbCustomer.id}`);
      return;
    }

    // 2b. Trial conversion charges (from trial-end workflow's chargeAuthorization)
    // The workflow handles subscription activation — skip to avoid creating a duplicate.
    const isTrialConversion = metadata.trial_conversion === true || metadata.trial_conversion === "true";
    if (isTrialConversion) {
      console.log(`[WEBHOOK] Trial conversion charge for customer=${dbCustomer.id}, plan=${metadata.plan_id} — workflow handles activation`);
      return;
    }

    // 3. Handle PLAN UPGRADE (checkout-based upgrade flow)
    if (metadata.type === "plan_upgrade") {
      const newPlanId = metadata.new_plan_id as string;
      const oldSubId = metadata.old_subscription_id as string;
      const oldPlanId = metadata.old_plan_id as string | undefined;
      const upgradeProviderId = (metadata.provider_id as string) || event.provider;

      let oldProviderSubCode: string | undefined;
      if (oldSubId) {
        const oldSub = await this.db.query.subscriptions.findFirst({
          where: eq(schema.subscriptions.id, oldSubId),
        });
        if (oldSub) {
          oldProviderSubCode = oldSub.providerSubscriptionCode || oldSub.paystackSubscriptionCode || undefined;
        }
      }

      if (this.planUpgradeWorkflow) {
        try {
          await this.planUpgradeWorkflow.create({
            params: {
              customerId: dbCustomer.id,
              oldSubscriptionId: oldSubId,
              oldPlanId,
              newPlanId,
              organizationId: this.organizationId,
              providerId: upgradeProviderId,
              environment: (metadata.environment as string) || "test",
              oldProviderSubscriptionCode: oldProviderSubCode,
              paidAt: event.payment?.paidAt,
              amount: event.payment?.amount,
              currency: event.payment?.currency || "USD",
            },
          });
          console.log(`[WEBHOOK] Plan upgrade workflow dispatched: customer=${dbCustomer.id}, newPlan=${newPlanId}`);
        } catch (wfErr) {
          console.error(`[WEBHOOK] Failed to dispatch plan upgrade workflow:`, wfErr);
          await this.handlePlanUpgradeInline(dbCustomer, event, oldSubId, oldPlanId, newPlanId, upgradeProviderId);
        }
      } else {
        await this.handlePlanUpgradeInline(dbCustomer, event, oldSubId, oldPlanId, newPlanId, upgradeProviderId);
      }

      return;
    }

    // 4. Handle CREDIT PACK PURCHASE (checkout-based add-on credits)
    if (metadata.type === "credit_purchase" && metadata.credits) {
      const creditPackId = metadata.credit_pack_id as string | undefined;

      // Quantity may have been adjusted by user on provider checkout page.
      // For providers that support adjustable quantity (e.g. Stripe), the
      // actual quantity comes from the checkout session. We store it in
      // metadata as a fallback, and recalculate credits from per-pack cost.
      const metaQuantity = Number(metadata.quantity) || 1;
      const creditsPerPack = Number(metadata.credits_per_pack) || 0;

      // If we have per-pack info, recalculate total from quantity
      // (handles case where user adjusted qty on checkout page).
      // Otherwise, fall back to the pre-computed credits value from metadata.
      // Prefer event-level checkout quantity (e.g. Stripe line_items) over metadata.
      const eventQuantity = event.checkout?.lineItems?.[0]?.quantity;
      const resolvedQuantity = typeof eventQuantity === "number" && eventQuantity > 0
        ? eventQuantity
        : metaQuantity;

      const creditsAmount = creditsPerPack > 0
        ? creditsPerPack * resolvedQuantity
        : Number(metadata.credits);

      if (isNaN(creditsAmount) || creditsAmount <= 0) {
        console.error(`[WEBHOOK] Invalid credits amount: credits=${metadata.credits}, perPack=${creditsPerPack}, qty=${resolvedQuantity}`);
        return;
      }

      // Every add-on must be attached to a credit system
      const creditSystemId = metadata.credit_system_id as string | undefined;
      if (!creditSystemId) {
        console.error(`[WEBHOOK] Credit purchase missing credit_system_id: pack=${creditPackId}`);
        return;
      }

      // Atomic upsert into credit_system_balances (uses UNIQUE index)
      await topUpScopedBalance(this.db, dbCustomer.id, creditSystemId, creditsAmount);

      // Record the purchase in the ledger
      await (this.db as any).insert((schema as any).creditPurchases).values({
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

      console.log(`[WEBHOOK] Credit purchase: customer=${dbCustomer.id}, credits=${creditsAmount}, qty=${resolvedQuantity}, pack=${creditPackId || "manual"}, system=${creditSystemId}`);
      return;
    }

    // 5. Handle ONE-TIME PURCHASE
    if (metadata.type === "one_time_purchase" && metadata.plan_id) {
      const planId = metadata.plan_id as string;
      const now = Date.now();

      const existingPurchase = await this.db.query.subscriptions.findFirst({
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
        await this.db.insert(schema.subscriptions).values([
          {
            id: crypto.randomUUID(),
            customerId: dbCustomer.id,
            planId: planId,
            providerId: (metadata.provider_id as string) || event.provider,
            providerSubscriptionId: "one-time",
            providerSubscriptionCode: "one-time",
            paystackSubscriptionCode: event.provider === "paystack" ? "one-time" : null,
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: now,
            metadata: { ...event.raw, billing_type: "one_time" },
          },
        ]);
      }

      await this.provisionEntitlements(dbCustomer.id, planId);
      return;
    }

    // 5. Handle regular Subscription / Plan Assignment
    if (metadata.plan_id) {
      const planId = metadata.plan_id as string;

      const existingSub = await this.db.query.subscriptions.findFirst({
        where: and(
          eq(schema.subscriptions.customerId, dbCustomer.id),
          eq(schema.subscriptions.planId, planId),
          or(
            eq(schema.subscriptions.status, "active"),
            eq(schema.subscriptions.status, "trialing"),
          ),
        ),
      });

      const plan = await this.db.query.plans.findFirst({
        where: eq(schema.plans.id, planId),
      });
      const periodMs = plan ? intervalToMs(plan.interval) : 30 * 24 * 60 * 60 * 1000;
      const startMs = safeParseDate(event.payment?.paidAt) || Date.now();

      if (!existingSub) {
        await this.db.insert(schema.subscriptions).values([
          {
            id: crypto.randomUUID(),
            customerId: dbCustomer.id,
            planId: planId,
            providerId: (metadata.provider_id as string) || event.provider,
            providerSubscriptionId: reference || "charge",
            providerSubscriptionCode: reference || "charge",
            paystackSubscriptionCode: event.provider === "paystack" ? (reference || "charge") : null,
            status: "active",
            currentPeriodStart: startMs,
            currentPeriodEnd: startMs + periodMs,
            metadata: event.raw,
          },
        ]);
      } else {
        // Renewal: advance billing period so usage pools (credit systems, metered features) reset correctly
        await this.db
          .update(schema.subscriptions)
          .set({
            status: "active",
            currentPeriodStart: startMs,
            currentPeriodEnd: startMs + periodMs,
            updatedAt: Date.now(),
          })
          .where(eq(schema.subscriptions.id, existingSub.id));
      }

      await this.provisionEntitlements(dbCustomer.id, planId);

      // Invalidate cached subscriptions so /check and /track see the updated period
      if (this.cache) {
        try {
          await this.cache.invalidateSubscriptions(this.organizationId, dbCustomer.id);
        } catch (e) {
          console.warn(`[WEBHOOK] Cache invalidation after subscription update failed:`, e);
        }
      }
    }

    // 5b. Fallback for auto-renewals: provider fires charge.success with
    // subscription_code but NO metadata.plan_id. Look up the subscription by
    // provider code and advance its billing period so usage pools reset.
    if (!metadata.plan_id && event.subscription?.providerCode) {
      const subCode = event.subscription.providerCode;
      const existingSub = await this.db.query.subscriptions.findFirst({
        where: or(
          eq(schema.subscriptions.providerSubscriptionCode, subCode),
          eq(schema.subscriptions.paystackSubscriptionCode, subCode),
        ),
        with: { plan: true },
      });

      if (existingSub && existingSub.plan) {
        const periodMs = intervalToMs(existingSub.plan.interval);
        const startMs = safeParseDate(event.payment?.paidAt) || Date.now();

        await this.db
          .update(schema.subscriptions)
          .set({
            status: "active",
            currentPeriodStart: startMs,
            currentPeriodEnd: startMs + periodMs,
            updatedAt: Date.now(),
          })
          .where(eq(schema.subscriptions.id, existingSub.id));

        console.log(`[WEBHOOK] Auto-renewal: advanced period for sub ${existingSub.id} (code=${subCode}), newEnd=${new Date(startMs + periodMs).toISOString()}`);

        // Invalidate cache so /check and /track see updated period
        if (this.cache) {
          try {
            await this.cache.invalidateSubscriptions(this.organizationId, existingSub.customerId);
          } catch (e) {
            console.warn(`[WEBHOOK] Auto-renewal cache invalidation failed:`, e);
          }
        }
      }
    }

    // 6. Handle Credits (if applicable)
    if (typeof metadata.credits === "number") {
      const existingCredits = await this.db.query.credits.findFirst({
        where: eq(schema.credits.customerId, dbCustomer.id),
      });

      if (existingCredits) {
        await this.db
          .update(schema.credits)
          .set({
            balance: existingCredits.balance + metadata.credits,
            updatedAt: Date.now(),
          })
          .where(eq(schema.credits.id, existingCredits.id));
      } else {
        await this.db.insert(schema.credits).values({
          id: crypto.randomUUID(),
          customerId: dbCustomer.id,
          balance: metadata.credits,
        });
      }
    }
  }

  private async handlePaymentFailed(event: NormalizedWebhookEvent) {
    const subscriptionCode = event.subscription?.providerCode;
    if (!subscriptionCode) return;

    // Fetch sub first for cache invalidation
    const sub = await this.db.query.subscriptions.findFirst({
      where: or(
        eq(schema.subscriptions.paystackSubscriptionCode, subscriptionCode),
        eq(schema.subscriptions.providerSubscriptionCode, subscriptionCode),
      ),
    });
    if (!sub) return;

    await this.db
      .update(schema.subscriptions)
      .set({ status: "past_due", updatedAt: Date.now() })
      .where(eq(schema.subscriptions.id, sub.id));

    if (this.cache) {
      try {
        await this.cache.invalidateSubscriptions(this.organizationId, sub.customerId);
      } catch (e) {
        console.warn(`[WEBHOOK] Payment failed cache invalidation failed:`, e);
      }
    }
  }

  private async handleRefund(event: NormalizedWebhookEvent) {
    const email = event.customer.email?.toLowerCase();
    if (!email) {
      console.warn(`[WEBHOOK] refund.success without customer email for org=${this.organizationId}`);
      return;
    }

    const refundAmount = event.refund?.amount || 0;
    console.log(`[WEBHOOK] Processing refund for org=${this.organizationId}, customer=${email}, amount=${refundAmount}, ref=${event.refund?.reference}`);

    // 1. Find customer
    const dbCustomer = await this.db.query.customers.findFirst({
      where: and(
        eq(schema.customers.email, email),
        eq(schema.customers.organizationId, this.organizationId),
      ),
    });

    if (!dbCustomer) {
      console.warn(`[WEBHOOK] Refund: customer ${email} not found in org ${this.organizationId}`);
      return;
    }

    const now = Date.now();

    // 2. Find all active/trialing subscriptions (with plan prices for comparison)
    const activeSubs = await this.db.query.subscriptions.findMany({
      where: and(
        eq(schema.subscriptions.customerId, dbCustomer.id),
        or(
          eq(schema.subscriptions.status, "active"),
          eq(schema.subscriptions.status, "trialing"),
        ),
      ),
      with: { plan: true },
    });

    // 3. Determine if this is a full or partial refund
    //    Full refund: refund amount >= any active plan's price (provider amounts are in smallest unit)
    //    Partial refund: refund amount < all plan prices → record it but keep access
    const isFullRefund = refundAmount === 0 || activeSubs.some(
      (sub: { plan?: { price: number } | null }) => sub.plan && refundAmount >= sub.plan.price,
    );

    if (!isFullRefund) {
      // Partial refund — record on subscription metadata, don't revoke access
      console.log(`[WEBHOOK] Partial refund (${refundAmount}) for customer ${dbCustomer.id} — recording without revoking access`);
      for (const sub of activeSubs) {
        const existingMeta = typeof sub.metadata === "object" && sub.metadata ? sub.metadata as Record<string, unknown> : {};
        const refunds = Array.isArray(existingMeta.refunds) ? existingMeta.refunds : [];
        refunds.push({
          amount: refundAmount,
          currency: event.refund?.currency,
          reference: event.refund?.reference,
          reason: event.refund?.reason,
          at: now,
        });
        await this.db
          .update(schema.subscriptions)
          .set({ metadata: { ...existingMeta, refunds }, updatedAt: now })
          .where(eq(schema.subscriptions.id, sub.id));
      }
      return;
    }

    // 4. Full refund — cancel each subscription (on provider + locally)
    for (const sub of activeSubs) {
      const subCode = sub.providerSubscriptionCode || sub.paystackSubscriptionCode;
      if (
        this.adapter &&
        this.providerAccount &&
        subCode &&
        subCode !== "one-time" &&
        !subCode.startsWith("trial-") &&
        !subCode.startsWith("charge") &&
        !subCode.startsWith("upgrade")
      ) {
        try {
          await this.adapter.cancelSubscription({
            subscription: { id: subCode, status: sub.status || "active" },
            environment: this.providerAccount.environment,
            account: this.providerAccount,
          });
        } catch (e) {
          console.warn(`[WEBHOOK] Refund: provider cancel failed for sub ${subCode}:`, e);
        }
      }

      await this.db
        .update(schema.subscriptions)
        .set({ status: "refunded", canceledAt: now, updatedAt: now })
        .where(eq(schema.subscriptions.id, sub.id));

      console.log(`[WEBHOOK] Refund: canceled subscription ${sub.id} (plan=${sub.planId})`);
    }

    // 5. Revoke all entitlements for this customer
    await this.db
      .delete(schema.entitlements)
      .where(eq(schema.entitlements.customerId, dbCustomer.id));

    // 5b. Invalidate cache so /check returns denied immediately
    if (this.cache) {
      try {
        await Promise.all([
          this.cache.invalidateCustomer(this.organizationId, email),
          this.cache.invalidateSubscriptions(this.organizationId, dbCustomer.id),
        ]);
      } catch (e) {
        console.warn(`[WEBHOOK] Refund: cache invalidation failed:`, e);
      }
    }

    console.log(`[WEBHOOK] Refund: revoked all entitlements for customer ${dbCustomer.id}`);

    // 6. Deduct credits if the original charge added them
    const refundMeta = event.metadata;
    if (typeof refundMeta.credits === "number" && refundMeta.credits > 0) {
      const existingCredits = await this.db.query.credits.findFirst({
        where: eq(schema.credits.customerId, dbCustomer.id),
      });

      if (existingCredits) {
        const newBalance = Math.max(0, existingCredits.balance - refundMeta.credits);
        await this.db
          .update(schema.credits)
          .set({ balance: newBalance, updatedAt: now })
          .where(eq(schema.credits.id, existingCredits.id));
        console.log(`[WEBHOOK] Refund: deducted ${refundMeta.credits} credits, new balance=${newBalance}`);
      }
    }
  }

  private async handlePlanUpgradeInline(
    dbCustomer: any,
    event: NormalizedWebhookEvent,
    oldSubId: string,
    oldPlanId: string | undefined,
    newPlanId: string,
    upgradeProviderId: string,
  ) {
    const now = Date.now();

    // Cancel old subscription
    if (oldSubId) {
      const oldSub = await this.db.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.id, oldSubId),
      });

      if (oldSub) {
        const subCode = oldSub.providerSubscriptionCode || oldSub.paystackSubscriptionCode;
        if (
          this.adapter &&
          this.providerAccount &&
          subCode &&
          subCode !== "one-time" &&
          !subCode.startsWith("trial-") &&
          !subCode.startsWith("charge")
        ) {
          try {
            await this.adapter.cancelSubscription({
              subscription: { id: subCode, status: oldSub.status || "active" },
              environment: this.providerAccount.environment,
              account: this.providerAccount,
            });
          } catch (e) {
            console.warn(`Webhook inline upgrade: provider cancel threw for ${subCode}:`, e);
          }
        }

        await this.db
          .update(schema.subscriptions)
          .set({ status: "canceled", canceledAt: now, updatedAt: now })
          .where(eq(schema.subscriptions.id, oldSubId));
      }
    }

    // Create new subscription
    const newPlan = await this.db.query.plans.findFirst({
      where: eq(schema.plans.id, newPlanId),
    });
    const periodMs = newPlan ? intervalToMs(newPlan.interval) : 30 * 24 * 60 * 60 * 1000;
    const startMs = safeParseDate(event.payment?.paidAt) || now;

    // Idempotency: check for existing active/trialing sub before inserting
    const existingUpgradedSub = await this.db.query.subscriptions.findFirst({
      where: and(
        eq(schema.subscriptions.customerId, dbCustomer.id),
        eq(schema.subscriptions.planId, newPlanId),
        or(
          eq(schema.subscriptions.status, "active"),
          eq(schema.subscriptions.status, "trialing"),
        ),
      ),
    });

    // Preserve old billing cycle end
    const oldSub = oldSubId
      ? await this.db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, oldSubId) })
      : null;
    const endMs = oldSub?.currentPeriodEnd || (startMs + periodMs);

    let newSubId: string | undefined;
    if (!existingUpgradedSub) {
      newSubId = crypto.randomUUID();
      await this.db.insert(schema.subscriptions).values([
        {
          id: newSubId,
          customerId: dbCustomer.id,
          planId: newPlanId,
          providerId: upgradeProviderId,
          providerSubscriptionId: "upgrade",
          providerSubscriptionCode: "upgrade",
          paystackSubscriptionCode: event.provider === "paystack" ? "upgrade" : null,
          status: "active",
          currentPeriodStart: startMs,
          currentPeriodEnd: endMs,
          metadata: { ...event.raw, switch_type: "upgrade" },
        },
      ]);
    } else {
      newSubId = existingUpgradedSub.id;
    }

    // Attempt to create provider subscription for recurring billing
    const providerPlanCode = newPlan?.providerPlanId || newPlan?.paystackPlanId;
    const authCode = dbCustomer.providerAuthorizationCode || dbCustomer.paystackAuthorizationCode;
    if (
      this.adapter &&
      this.providerAccount &&
      newPlan?.billingType === "recurring" &&
      providerPlanCode &&
      authCode
    ) {
      try {
        const result = await this.adapter.createSubscription({
          customer: { id: dbCustomer.email, email: dbCustomer.email },
          plan: { id: providerPlanCode },
          authorizationCode: authCode,
          startDate: new Date(endMs).toISOString(),
          environment: this.providerAccount.environment,
          account: this.providerAccount,
        });
        if (result.isOk() && newSubId) {
          await this.db
            .update(schema.subscriptions)
            .set({
              providerSubscriptionId: result.value.id,
              providerSubscriptionCode: result.value.id,
              paystackSubscriptionCode: event.provider === "paystack" ? result.value.id : null,
              updatedAt: Date.now(),
            })
            .where(eq(schema.subscriptions.id, newSubId));
        }
      } catch (e) {
        console.warn(`[WEBHOOK] Inline upgrade: provider createSubscription failed:`, e);
      }
    }

    await this.provisionEntitlements(dbCustomer.id, newPlanId, oldPlanId);

    // Invalidate cache so /check and /track see the new subscription
    if (this.cache) {
      try {
        await this.cache.invalidateSubscriptions(this.organizationId, dbCustomer.id);
      } catch (e) {
        console.warn(`[WEBHOOK] Inline upgrade cache invalidation failed:`, e);
      }
    }
  }

  private async provisionEntitlements(
    customerId: string,
    newPlanId: string,
    oldPlanId?: string,
  ) {
    await provisionEntitlementsShared(this.db, customerId, newPlanId, oldPlanId);
  }

  private async handleCustomerIdentified(event: NormalizedWebhookEvent) {
    const email = event.customer.email;
    if (!email) return;

    await this.db
      .update(schema.customers)
      .set({
        metadata: { verified: true, verifiedAt: new Date().toISOString() },
      })
      .where(
        and(
          eq(schema.customers.email, email),
          eq(schema.customers.organizationId, this.organizationId),
        ),
      );
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Parse a date string safely — returns 0 (falsy) if invalid/undefined */
function safeParseDate(value: unknown): number {
  if (!value || typeof value !== "string") return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function intervalToMs(interval: string): number {
  switch (interval) {
    case "hourly": return 60 * 60 * 1000;
    case "daily": return 24 * 60 * 60 * 1000;
    case "weekly": return 7 * 24 * 60 * 60 * 1000;
    case "monthly": return 30 * 24 * 60 * 60 * 1000;
    case "quarterly": return 90 * 24 * 60 * 60 * 1000;
    case "biannually": case "semi_annual": return 180 * 24 * 60 * 60 * 1000;
    case "annually": case "yearly": return 365 * 24 * 60 * 60 * 1000;
    default: return 30 * 24 * 60 * 60 * 1000;
  }
}
