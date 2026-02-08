import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import type { WorkflowEnv } from "./utils";
import { getAdapter, resolveProviderAccount, intervalToMs, provisionEntitlements } from "./utils";
import type { ProviderAccount } from "@owostack/adapters";

// Serializable snapshot of the fields we need from ProviderAccount
interface ResolvedAccount {
  id: string;
  organizationId: string;
  providerId: string;
  environment: string;
  credentials: { secretKey?: string; [k: string]: string | undefined };
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export interface TrialEndParams {
  subscriptionId: string;
  customerId: string;
  planId: string;
  organizationId: string;
  providerId: string;
  environment: string;
  trialEndMs: number;
  authorizationCode?: string;
  email?: string;
  amount?: number;
  currency?: string;
  planSlug?: string;
}

// ---------------------------------------------------------------------------
// TrialEndWorkflow
//
// Sleeps until trial end, then either charges the saved card (card-required
// trial) or expires the subscription (no-card trial).  Each step is
// individually retryable and durable.
// ---------------------------------------------------------------------------

export class TrialEndWorkflow extends WorkflowEntrypoint<WorkflowEnv, TrialEndParams> {
  async run(event: WorkflowEvent<TrialEndParams>, step: WorkflowStep) {
    const {
      subscriptionId,
      customerId,
      planId,
      organizationId,
      providerId,
      trialEndMs,
      authorizationCode,
      email,
      amount,
      currency,
    } = event.payload;

    // Step 1: Sleep until trial ends
    console.log(`[TrialEndWorkflow] Waiting for trial end: subscription=${subscriptionId}`);
    const waitMs = trialEndMs - Date.now();
    if (waitMs > 0) {
      await step.sleep("wait-for-trial-end", waitMs);
    }

    // Step 2: Verify subscription is still in trialing state (idempotency)
    const sub = await step.do("check-subscription-status", async () => {
      const result = await this.env.DB.prepare(
        "SELECT id, status, cancel_at FROM subscriptions WHERE id = ? LIMIT 1",
      ).bind(subscriptionId).first<{ id: string; status: string; cancel_at: number | null }>();
      return result;
    });

    if (!sub || sub.status !== "trialing") {
      console.log(`[TrialEndWorkflow] Subscription ${subscriptionId} is ${sub?.status ?? "missing"}, skipping`);
      return;
    }

    // If user canceled before trial end, expire instead of charging
    if (sub.cancel_at) {
      await step.do("expire-canceled-trial", async () => {
        const now = Date.now();
        await this.env.DB.prepare(
          "UPDATE subscriptions SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?",
        ).bind(now, now, subscriptionId).run();
        console.log(`[TrialEndWorkflow] Canceled (user requested): subscription=${subscriptionId}`);
      });
      return;
    }

    // Step 3: Branch — no card, missing charge data, or zero amount → expire
    if (!authorizationCode || !email || !amount || amount <= 0) {
      await step.do("expire-subscription", async () => {
        const now = Date.now();
        await this.env.DB.prepare(
          "UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE id = ?",
        ).bind(now, subscriptionId).run();
        console.log(`[TrialEndWorkflow] Expired (no card): subscription=${subscriptionId}`);
      });
      return;
    }

    // Step 4: Resolve adapter + provider account
    const accountData: ResolvedAccount | null = await step.do("resolve-provider", async () => {
      const account = await resolveProviderAccount(this.env, organizationId, providerId);
      if (!account) return null;
      // Return a plain serializable snapshot
      return {
        id: account.id,
        organizationId: account.organizationId,
        providerId: account.providerId,
        environment: account.environment,
        credentials: account.credentials as ResolvedAccount["credentials"],
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      };
    });

    if (!accountData) {
      // Can't charge — expire the subscription instead
      await step.do("expire-no-provider", async () => {
        const now = Date.now();
        await this.env.DB.prepare(
          "UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE id = ?",
        ).bind(now, subscriptionId).run();
        console.log(`[TrialEndWorkflow] Expired (no provider key): subscription=${subscriptionId}`);
      });
      return;
    }

    // Step 5: Charge the saved card via adapter (with retries)
    let chargeSucceeded = false;
    try {
      await step.do(
        "charge-card",
        {
          retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
          timeout: "30 seconds",
        },
        async () => {
          const adapter = getAdapter(providerId);
          if (!adapter) throw new Error(`No adapter registered for provider: ${providerId}`);

          const result = await adapter.chargeAuthorization({
            customer: { id: customerId, email: email! },
            authorizationCode: authorizationCode!,
            amount: amount!,
            currency: currency || "NGN",
            metadata: {
              subscription_id: subscriptionId,
              plan_id: planId,
              customer_id: customerId,
              organization_id: organizationId,
              trial_conversion: true,
            },
            environment: accountData.environment as "test" | "live",
            account: accountData as unknown as ProviderAccount,
          });

          if (result.isErr()) {
            throw new Error(`Charge failed: ${result.error.message}`);
          }

          console.log(`[TrialEndWorkflow] Charge succeeded: subscription=${subscriptionId}, ref=${result.value.reference}`);
          return { reference: result.value.reference };
        },
      );
      chargeSucceeded = true;
    } catch (chargeErr) {
      console.error(`[TrialEndWorkflow] Charge exhausted retries: subscription=${subscriptionId}`, chargeErr);
    }

    if (chargeSucceeded) {
      // Step 6a: Look up plan + customer to decide if we need a provider subscription
      const planAndCustomer = await step.do("lookup-plan-customer", async () => {
        const plan = await this.env.DB.prepare(
          "SELECT id, billing_type, interval, provider_plan_id, paystack_plan_id, currency FROM plans WHERE id = ? LIMIT 1",
        ).bind(planId).first<{
          id: string;
          billing_type: string;
          interval: string;
          provider_plan_id: string | null;
          paystack_plan_id: string | null;
          currency: string;
        }>();

        const customer = await this.env.DB.prepare(
          "SELECT id, email, provider_customer_id, paystack_customer_id FROM customers WHERE id = ? LIMIT 1",
        ).bind(customerId).first<{
          id: string;
          email: string;
          provider_customer_id: string | null;
          paystack_customer_id: string | null;
        }>();

        return { plan, customer };
      });

      const { plan, customer } = planAndCustomer;
      const isRecurring = plan?.billing_type === "recurring";
      const providerPlanCode = plan?.provider_plan_id || plan?.paystack_plan_id;
      const customerCode = customer?.provider_customer_id || customer?.paystack_customer_id;

      // Step 6b: For recurring plans with provider plan codes, create a
      // subscription on the provider so it handles future billing cycles.
      // Use start_date = now + 1 billing cycle to avoid double-charging
      // (we already charged the first cycle via chargeAuthorization).
      let providerSubCode: string | null = null;

      if (isRecurring && providerPlanCode && customerCode && authorizationCode) {
        try {
          const subResult = await step.do("create-provider-subscription", async () => {
            const adapter = getAdapter(providerId);
            if (!adapter) throw new Error(`No adapter for provider: ${providerId}`);

            const startDate = new Date(Date.now() + intervalToMs(plan!.interval));

            const result = await adapter.createSubscription({
              customer: { id: customerCode!, email: email || customer!.email },
              plan: { id: providerPlanCode! },
              authorizationCode,
              startDate: startDate.toISOString(),
              environment: accountData.environment as "test" | "live",
              account: accountData as unknown as ProviderAccount,
              metadata: {
                subscription_id: subscriptionId,
                trial_conversion: true,
              },
            });

            if (result.isErr()) {
              throw new Error(`Create subscription failed: ${result.error.message}`);
            }

            console.log(`[TrialEndWorkflow] Provider subscription created: ${result.value.id}, next charge at ${startDate.toISOString()}`);
            return result.value.id;
          });
          providerSubCode = subResult;
        } catch (subErr) {
          // Non-fatal — subscription is active locally, just no auto-renewal
          console.error(`[TrialEndWorkflow] Failed to create provider subscription: subscription=${subscriptionId}`, subErr);
        }
      }

      // Step 6c: Activate subscription in DB (+ update provider sub code if created)
      await step.do("activate-subscription", async () => {
        const now = Date.now();
        const periodEnd = plan ? now + intervalToMs(plan.interval) : now + 30 * 24 * 60 * 60 * 1000;
        const paystackSubCode = providerId === "paystack" ? providerSubCode : null;

        await this.env.DB.prepare(
          `UPDATE subscriptions
           SET status = 'active',
               provider_subscription_id = COALESCE(?, provider_subscription_id),
               provider_subscription_code = COALESCE(?, provider_subscription_code),
               paystack_subscription_code = COALESCE(?, paystack_subscription_code),
               current_period_start = ?,
               current_period_end = ?,
               updated_at = ?
           WHERE id = ? AND status = 'trialing'`,
        ).bind(
          providerSubCode, providerSubCode, paystackSubCode,
          now, periodEnd, now, subscriptionId,
        ).run();

        console.log(`[TrialEndWorkflow] Activated: subscription=${subscriptionId}, providerSub=${providerSubCode || "none"}`);
      });

      // Step 6d: Re-provision entitlements (idempotent — ensures features are current)
      await step.do("provision-entitlements", async () => {
        await provisionEntitlements(this.env, customerId, planId);
        console.log(`[TrialEndWorkflow] Entitlements provisioned: customer=${customerId}, plan=${planId}`);
      });
    } else {
      // Step 6b: Charge failed after all retries — expire the subscription
      await step.do("expire-charge-failed", async () => {
        const now = Date.now();
        await this.env.DB.prepare(
          "UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'trialing'",
        ).bind(now, subscriptionId).run();
        console.log(`[TrialEndWorkflow] Expired (charge failed): subscription=${subscriptionId}`);
      });
    }
  }
}
