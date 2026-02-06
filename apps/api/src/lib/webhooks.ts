import { Result } from "better-result";
import type { createDb } from "@owostack/db";
import { schema } from "@owostack/db";
import { eq, and, or } from "drizzle-orm";
import { WebhookError, DatabaseError } from "./errors";
import type { ProviderAdapter, ProviderAccount } from "@owostack/adapters";

// =============================================================================
// Types
// =============================================================================

interface WebhookPayload {
  event: string;
  data: Record<string, unknown>;
}

type DB = ReturnType<typeof createDb>;

// =============================================================================
// Handler Implementation
// =============================================================================

export class WebhookHandler {
  private adapter: ProviderAdapter | null;
  private providerAccount: ProviderAccount | null;

  constructor(
    private secret: string,
    private db: DB,
    private organizationId: string,
    opts?: { adapter?: ProviderAdapter; account?: ProviderAccount },
  ) {
    this.adapter = opts?.adapter || null;
    this.providerAccount = opts?.account || null;
  }

  /**
   * Verify webhook signature using HMAC SHA-512
   */
  async verify(
    signature: string,
    payload: string,
  ): Promise<Result<boolean, WebhookError>> {
    return Result.tryPromise({
      try: async () => {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          "raw",
          encoder.encode(this.secret),
          { name: "HMAC", hash: "SHA-512" },
          false,
          ["verify"],
        );

        const signatureBytes = hexToBytes(signature);
        const verified = await crypto.subtle.verify(
          "HMAC",
          key,
          signatureBytes,
          encoder.encode(payload),
        );

        if (!verified) {
          throw new WebhookError({ reason: "invalid_signature" });
        }

        return true;
      },
      catch: (e) => {
        if (e instanceof WebhookError) return e;
        return new WebhookError({ reason: "invalid_signature" });
      },
    });
  }

  /**
   * Handle webhook event - scoped to organization
   */
  async handle(
    payload: WebhookPayload,
  ): Promise<Result<boolean, DatabaseError>> {
    return Result.tryPromise({
      try: async () => {
        // 2. Log event for audit trail
        await this.db.insert(schema.events).values({
          id: crypto.randomUUID(),
          organizationId: this.organizationId,
          type: payload.event,
          data: payload.data,
          processed: false,
        });

        // 3. Route to specific handler
        switch (payload.event) {
          case "subscription.create":
            await this.handleSubscriptionCreate(payload.data);
            break;
          case "subscription.disable":
            await this.handleSubscriptionStatusChange(payload.data, "canceled");
            break;
          case "subscription.enable":
            await this.handleSubscriptionStatusChange(payload.data, "active");
            break;
          case "subscription.not_renew":
            await this.handleSubscriptionStatusChange(
              payload.data,
              "pending_cancel",
            );
            break;
          case "charge.success":
            await this.handleChargeSuccess(payload.data);
            break;
          case "invoice.payment_failed":
            await this.handlePaymentFailed(payload.data);
            break;
          case "customeridentification.success":
            await this.handleCustomerIdentified(payload.data);
            break;
        }

        // 4. Mark event as processed
        // Could update the event record here

        return true;
      },
      catch: (e) => new DatabaseError({ operation: "handleWebhook", cause: e }),
    });
  }

  private async handleSubscriptionCreate(data: Record<string, unknown>) {
    const customer = data.customer as { email: string; customer_code: string };
    const plan = data.plan as { plan_code: string };

    // Find or create customer scoped to this organization
    let dbCustomer = await this.db.query.customers.findFirst({
      where: and(
        eq(schema.customers.email, customer.email),
        eq(schema.customers.organizationId, this.organizationId),
      ),
    });

    if (!dbCustomer) {
      // Auto-create customer from Paystack data
      const [newCustomer] = await this.db
        .insert(schema.customers)
        .values({
          id: crypto.randomUUID(),
          organizationId: this.organizationId,
          email: customer.email,
          providerId: "paystack",
          providerCustomerId: customer.customer_code,
          paystackCustomerId: customer.customer_code,
        })
        .returning();
      dbCustomer = newCustomer;
    }

    const dbPlan = await this.db.query.plans.findFirst({
      where: and(
        or(
          eq(schema.plans.paystackPlanId, plan.plan_code),
          eq(schema.plans.providerPlanId, plan.plan_code),
        ),
        eq(schema.plans.organizationId, this.organizationId),
      ),
    });

    if (!dbPlan) {
      // Plan not synced to Paystack — try to link subscription_code to an
      // existing subscription created by charge.success for this customer
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
            providerSubscriptionId: data.subscription_code as string,
            providerSubscriptionCode: data.subscription_code as string,
            paystackSubscriptionId: data.subscription_code as string,
            paystackSubscriptionCode: data.subscription_code as string,
            updatedAt: Date.now(),
          })
          .where(eq(schema.subscriptions.id, existingSubForCustomer.id));
      } else {
        console.warn(
          `Plan ${plan.plan_code} not found in org ${this.organizationId}, no existing sub to link`,
        );
      }
      return;
    }

    // Check for existing subscription (idempotency)
    const existing = await this.db.query.subscriptions.findFirst({
      where: or(
        eq(
          schema.subscriptions.paystackSubscriptionCode,
          data.subscription_code as string,
        ),
        eq(
          schema.subscriptions.providerSubscriptionCode,
          data.subscription_code as string,
        ),
      ),
    });

    if (existing) return; // Already processed

    // Create subscription
    // Paystack subscription.create webhook fields vary — use safe fallbacks
    const now = Date.now();
    const periodStart =
      safeParseDate(data.start as string) ||
      safeParseDate(data.createdAt as string) ||
      safeParseDate(data.created_at as string) ||
      now;
    const periodEnd =
      safeParseDate(data.next_payment_date as string) ||
      periodStart + 30 * 24 * 60 * 60 * 1000; // fallback: +30 days

    await this.db.insert(schema.subscriptions).values([
      {
        id: crypto.randomUUID(),
        customerId: dbCustomer.id,
        planId: dbPlan.id,
        providerId: "paystack",
        providerSubscriptionId: data.subscription_code as string,
        providerSubscriptionCode: data.subscription_code as string,
        paystackSubscriptionId: data.subscription_code as string,
        paystackSubscriptionCode: data.subscription_code as string,
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        providerMetadata: data,
        metadata: data,
      },
    ]);
  }

  private async handleSubscriptionStatusChange(
    data: Record<string, unknown>,
    status: string,
  ) {
    const subscriptionCode = data.subscription_code as string;
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

  private async handleChargeSuccess(data: Record<string, unknown>) {
    // Paystack metadata can be 0, null, a string, or an object — normalize
    let metadata: Record<string, unknown> = {};
    const rawMeta = data.metadata;
    if (rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)) {
      metadata = rawMeta as Record<string, unknown>;
    } else if (typeof rawMeta === "string") {
      try { metadata = JSON.parse(rawMeta); } catch { metadata = {}; }
    }
    const customerData = data.customer as {
      email: string;
      customer_code: string;
    };
    const authorization = data.authorization as {
      authorization_code: string;
      card_type: string;
      last4: string;
      exp_month: string;
      exp_year: string;
      reusable: boolean;
    } | undefined;

    // 1. Find or Create Customer
    let dbCustomer = await this.db.query.customers.findFirst({
      where: and(
        eq(schema.customers.email, customerData.email.toLowerCase()),
        eq(schema.customers.organizationId, this.organizationId),
      ),
    });

    if (!dbCustomer) {
      const [newCustomer] = await this.db
        .insert(schema.customers)
        .values({
          id: crypto.randomUUID(),
          organizationId: this.organizationId,
          email: customerData.email.toLowerCase(),
          providerId: "paystack",
          providerCustomerId: customerData.customer_code,
          providerAuthorizationCode: authorization?.reusable
            ? authorization.authorization_code
            : null,
          paystackCustomerId: customerData.customer_code,
          paystackAuthorizationCode: authorization?.reusable
            ? authorization.authorization_code
            : null,
        })
        .returning();
      dbCustomer = newCustomer;
    } else if (authorization?.reusable && authorization.authorization_code) {
      // Update authorization code if we got a new reusable one
      await this.db
        .update(schema.customers)
        .set({
          providerId: "paystack",
          providerCustomerId: customerData.customer_code,
          providerAuthorizationCode: authorization.authorization_code,
          paystackAuthorizationCode: authorization.authorization_code,
          paystackCustomerId: customerData.customer_code,
          updatedAt: Date.now(),
        })
        .where(eq(schema.customers.id, dbCustomer.id));
    }

    // 2. Handle TRIAL subscriptions (is_trial in metadata)
    const isTrial = metadata.is_trial === true;
    const trialDays = (metadata.trial_days as number) || 0;

    if (isTrial && metadata.plan_id && trialDays > 0) {
      const planId = metadata.plan_id as string;
      const now = Date.now();
      const trialEndMs = now + trialDays * 24 * 60 * 60 * 1000;
      const trialSubscriptionCode = `trial-${crypto.randomUUID().slice(0, 8)}`;

      // Check if subscription already exists
      const existingSub = await this.db.query.subscriptions.findFirst({
        where: and(
          eq(schema.subscriptions.customerId, dbCustomer.id),
          eq(schema.subscriptions.planId, planId),
        ),
      });

      if (!existingSub) {
        // Create subscription in trialing status
        await this.db.insert(schema.subscriptions).values([
          {
            id: crypto.randomUUID(),
            customerId: dbCustomer.id,
            planId: planId,
            providerId: (metadata.provider_id as string) || "paystack",
            providerSubscriptionId: trialSubscriptionCode,
            providerSubscriptionCode: trialSubscriptionCode,
            paystackSubscriptionCode: trialSubscriptionCode,
            status: "trialing",
            currentPeriodStart: now,
            currentPeriodEnd: trialEndMs,
            metadata: {
              ...data,
              trial: true,
              trial_ends_at: trialEndMs,
              authorization_code: authorization?.authorization_code,
            },
          },
        ]);
      }

      return; // Don't process as regular charge
    }

    // 3. Handle PLAN UPGRADE (checkout-based upgrade flow)
    if (metadata.type === "plan_upgrade") {
      const newPlanId = metadata.new_plan_id as string;
      const oldSubId = metadata.old_subscription_id as string;
      const oldPlanId = metadata.old_plan_id as string | undefined;
      const now = Date.now();

      // Cancel old subscription (both DB and provider)
      if (oldSubId) {
        const oldSub = await this.db.query.subscriptions.findFirst({
          where: eq(schema.subscriptions.id, oldSubId),
        });

        if (oldSub) {
          // Cancel on provider first
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
              const cancelResult = await this.adapter.cancelSubscription({
                subscription: { id: subCode, status: oldSub.status || "active" },
                environment: this.providerAccount.environment,
                account: this.providerAccount,
              });
              if (cancelResult.isErr()) {
                console.warn(`Webhook: provider cancel failed for ${subCode}:`, cancelResult.error.message);
              }
            } catch (e) {
              console.warn(`Webhook: provider cancel threw for ${subCode}:`, e);
            }
          }

          // Cancel in DB
          await this.db
            .update(schema.subscriptions)
            .set({ status: "canceled", canceledAt: now, updatedAt: now })
            .where(eq(schema.subscriptions.id, oldSubId));
        }
      }

      // Look up new plan to get the correct interval
      const newPlan = await this.db.query.plans.findFirst({
        where: eq(schema.plans.id, newPlanId),
      });
      const periodMs = newPlan ? intervalToMs(newPlan.interval) : 30 * 24 * 60 * 60 * 1000;

      // Create new subscription for upgraded plan
      const upgradeProviderId = (metadata.provider_id as string) || "paystack";
      const upgradeSubCode = (data.plan as any)?.plan_code || "one-time";
      const startMs = new Date(data.paid_at as string).getTime();
      await this.db.insert(schema.subscriptions).values([
        {
          id: crypto.randomUUID(),
          customerId: dbCustomer.id,
          planId: newPlanId,
          providerId: upgradeProviderId,
          providerSubscriptionId: upgradeSubCode,
          providerSubscriptionCode: upgradeSubCode,
          paystackSubscriptionCode: upgradeSubCode,
          status: "active",
          currentPeriodStart: startMs,
          currentPeriodEnd: startMs + periodMs,
          metadata: { ...data, switch_type: "upgrade" },
        },
      ]);

      // Provision entitlements for the new plan (clean up old plan's features)
      await this.provisionEntitlements(dbCustomer.id, newPlanId, oldPlanId);

      return; // Don't process as regular charge
    }

    // 4. Handle ONE-TIME PURCHASE (from plan-switch.ts one-time flow via checkout)
    if (metadata.type === "one_time_purchase" && metadata.plan_id) {
      const planId = metadata.plan_id as string;
      const now = Date.now();

      // Check if purchase already exists (idempotency)
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
            providerId: (metadata.provider_id as string) || "paystack",
            providerSubscriptionId: "one-time",
            providerSubscriptionCode: "one-time",
            paystackSubscriptionCode: "one-time",
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: now, // No recurring period for one-time
            metadata: { ...data, billing_type: "one_time" },
          },
        ]);
      }

      // Provision entitlements for the purchased plan
      await this.provisionEntitlements(dbCustomer.id, planId);
      return; // Don't process as regular charge
    }

    // 5. Handle regular Subscription / Plan Assignment
    if (metadata.plan_id) {
      const planId = metadata.plan_id as string;

      // Check if active subscription exists
      const existingSub = await this.db.query.subscriptions.findFirst({
        where: and(
          eq(schema.subscriptions.customerId, dbCustomer.id),
          eq(schema.subscriptions.planId, planId),
          eq(schema.subscriptions.status, "active"),
        ),
      });

      if (!existingSub) {
        const startDate = new Date(data.paid_at as string);
        const startMs = startDate.getTime();

        // Look up plan to determine billing type and interval
        const plan = await this.db.query.plans.findFirst({
          where: eq(schema.plans.id, planId),
        });
        const periodMs = plan ? intervalToMs(plan.interval) : 30 * 24 * 60 * 60 * 1000;

        // Always create subscription from charge.success when metadata.plan_id
        // is present. The existingSub check above already prevents duplicates
        // if subscription.create handled it first.
        await this.db.insert(schema.subscriptions).values([
          {
            id: crypto.randomUUID(),
            customerId: dbCustomer.id,
            planId: planId,
            providerId: (metadata.provider_id as string) || "paystack",
            providerSubscriptionId: data.reference as string || "charge",
            providerSubscriptionCode: data.reference as string || "charge",
            paystackSubscriptionCode: data.reference as string || "charge",
            status: "active",
            currentPeriodStart: startMs,
            currentPeriodEnd: startMs + periodMs,
            metadata: data,
          },
        ]);
      }

      // Provision entitlements for the plan
      await this.provisionEntitlements(dbCustomer.id, planId);
    }

    // 4. Handle Credits (if applicable)
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

  private async handlePaymentFailed(data: Record<string, unknown>) {
    const subscriptionCode = data.subscription_code as string;
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

  private async handleCustomerIdentified(data: Record<string, unknown>) {
    const email = data.email as string;
    if (!email) return;

    // Update customer verification status
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

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

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
