import { Result } from "better-result";
import type { createDb } from "@owostack/db";
import { schema } from "@owostack/db";
import { eq, and, or } from "drizzle-orm";
import { DatabaseError } from "./errors";
import type { ProviderAdapter, ProviderAccount, NormalizedWebhookEvent } from "@owostack/adapters";

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

  constructor(
    private db: DB,
    private organizationId: string,
    opts?: {
      adapter?: ProviderAdapter;
      account?: ProviderAccount;
      trialEndWorkflow?: any;
      planUpgradeWorkflow?: any;
    },
  ) {
    this.adapter = opts?.adapter || null;
    this.providerAccount = opts?.account || null;
    this.trialEndWorkflow = opts?.trialEndWorkflow || null;
    this.planUpgradeWorkflow = opts?.planUpgradeWorkflow || null;
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

    // Check for existing subscription (idempotency)
    if (providerCode) {
      const existing = await this.db.query.subscriptions.findFirst({
        where: or(
          eq(schema.subscriptions.paystackSubscriptionCode, providerCode),
          eq(schema.subscriptions.providerSubscriptionCode, providerCode),
        ),
      });
      if (existing) return;
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
  }

  private async handleSubscriptionStatusChange(
    event: NormalizedWebhookEvent,
    status: string,
  ) {
    const subscriptionCode = event.subscription?.providerCode;
    if (!subscriptionCode) return;

    await this.db
      .update(schema.subscriptions)
      .set({
        status,
        updatedAt: Date.now(),
        ...(status === "canceled" ? { canceledAt: Date.now() } : {}),
      })
      .where(
        or(
          eq(schema.subscriptions.paystackSubscriptionCode, subscriptionCode),
          eq(schema.subscriptions.providerSubscriptionCode, subscriptionCode),
        ),
      );
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
                currency: (metadata.currency as string) || event.payment?.currency || "NGN",
                planSlug: metadata.plan_slug as string,
              },
            });
            console.log(`[TRIAL-WEBHOOK] Trial end workflow dispatched: subscription=${trialSubId}, trialEnds=${new Date(trialEndMs).toISOString()}`);
          } catch (wfErr) {
            console.error(`[TRIAL-WEBHOOK] Failed to dispatch trial end workflow for subscription=${trialSubId}:`, wfErr);
          }
        }
      }

      console.log(`[TRIAL-WEBHOOK] Trial subscription flow complete for customer=${dbCustomer.id}`);
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
              currency: event.payment?.currency || "NGN",
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

    // 4. Handle ONE-TIME PURCHASE
    if (metadata.type === "one_time_purchase" && metadata.plan_id) {
      const planId = metadata.plan_id as string;
      const now = Date.now();

      const existingPurchase = await this.db.query.subscriptions.findFirst({
        where: and(
          eq(schema.subscriptions.customerId, dbCustomer.id),
          eq(schema.subscriptions.planId, planId),
          eq(schema.subscriptions.status, "active"),
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
          eq(schema.subscriptions.status, "active"),
        ),
      });

      if (!existingSub) {
        const startMs = safeParseDate(event.payment?.paidAt) || Date.now();
        const plan = await this.db.query.plans.findFirst({
          where: eq(schema.plans.id, planId),
        });
        const periodMs = plan ? intervalToMs(plan.interval) : 30 * 24 * 60 * 60 * 1000;

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
      }

      await this.provisionEntitlements(dbCustomer.id, planId);
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

    await this.db
      .update(schema.subscriptions)
      .set({ status: "past_due", updatedAt: Date.now() })
      .where(
        or(
          eq(schema.subscriptions.paystackSubscriptionCode, subscriptionCode),
          eq(schema.subscriptions.providerSubscriptionCode, subscriptionCode),
        ),
      );
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
    const upgradeSubCode = event.plan?.providerPlanCode || "one-time";
    const startMs = safeParseDate(event.payment?.paidAt) || now;

    await this.db.insert(schema.subscriptions).values([
      {
        id: crypto.randomUUID(),
        customerId: dbCustomer.id,
        planId: newPlanId,
        providerId: upgradeProviderId,
        providerSubscriptionId: upgradeSubCode,
        providerSubscriptionCode: upgradeSubCode,
        paystackSubscriptionCode: event.provider === "paystack" ? upgradeSubCode : null,
        status: "active",
        currentPeriodStart: startMs,
        currentPeriodEnd: startMs + periodMs,
        metadata: { ...event.raw, switch_type: "upgrade" },
      },
    ]);

    await this.provisionEntitlements(dbCustomer.id, newPlanId, oldPlanId);
  }

  private async provisionEntitlements(
    customerId: string,
    newPlanId: string,
    oldPlanId?: string,
  ) {
    const planFeatures = await this.db.query.planFeatures.findMany({
      where: eq(schema.planFeatures.planId, newPlanId),
      with: { feature: true },
    });

    // Remove entitlements from old plan to avoid orphans
    if (oldPlanId) {
      const oldPlanFeatures = await this.db.query.planFeatures.findMany({
        where: eq(schema.planFeatures.planId, oldPlanId),
      });
      for (const opf of oldPlanFeatures) {
        await this.db
          .delete(schema.entitlements)
          .where(
            and(
              eq(schema.entitlements.customerId, customerId),
              eq(schema.entitlements.featureId, opf.featureId),
            ),
          );
      }
    } else {
      // No old plan — just clear entitlements for features in the new plan
      for (const pf of planFeatures) {
        await this.db
          .delete(schema.entitlements)
          .where(
            and(
              eq(schema.entitlements.customerId, customerId),
              eq(schema.entitlements.featureId, pf.featureId),
            ),
          );
      }
    }

    // Create new entitlements
    const now = Date.now();
    const values = planFeatures.map((pf: any) => ({
      id: crypto.randomUUID(),
      customerId,
      featureId: pf.featureId,
      limitValue: pf.limitValue,
      resetInterval: pf.resetInterval,
      lastResetAt: pf.resetOnEnable ? now : null,
      createdAt: now,
      updatedAt: now,
    }));

    if (values.length > 0) {
      await this.db.insert(schema.entitlements).values(values);
    }
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
