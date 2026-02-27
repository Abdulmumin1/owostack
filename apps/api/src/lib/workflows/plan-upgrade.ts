import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import type { WorkflowEnv } from "./utils";
import { getAdapter, resolveProviderAccount, provisionEntitlements, intervalToMs } from "./utils";

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export interface PlanUpgradeParams {
  customerId: string;
  oldSubscriptionId?: string;
  oldPlanId?: string;
  newPlanId: string;
  organizationId: string;
  providerId: string;
  environment: string;
  oldProviderSubscriptionCode?: string;
  chargeReference?: string;
  paidAt?: string;
  amount?: number;
  currency?: string;
}

// ---------------------------------------------------------------------------
// PlanUpgradeWorkflow
//
// Handles checkout-based plan upgrades triggered by charge.success webhook.
// Cancels old subscription (on provider + DB), creates new subscription,
// and re-provisions entitlements.  Runs asynchronously so the webhook
// can ACK immediately.
// ---------------------------------------------------------------------------

export class PlanUpgradeWorkflow extends WorkflowEntrypoint<WorkflowEnv, PlanUpgradeParams> {
  async run(event: WorkflowEvent<PlanUpgradeParams>, step: WorkflowStep) {
    const {
      customerId,
      oldSubscriptionId,
      oldPlanId,
      newPlanId,
      organizationId,
      providerId,
      oldProviderSubscriptionCode,
      paidAt,
    } = event.payload;

    // Step 1: Cancel old subscription on provider (if applicable)
    if (
      oldSubscriptionId &&
      oldProviderSubscriptionCode &&
      oldProviderSubscriptionCode !== "one-time" &&
      !oldProviderSubscriptionCode.startsWith("trial-") &&
      !oldProviderSubscriptionCode.startsWith("charge")
    ) {
      await step.do(
        "cancel-old-on-provider",
        { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" } },
        async () => {
          const account = await resolveProviderAccount(this.env, organizationId, providerId);
          if (!account) {
            console.warn(`[PlanUpgradeWorkflow] No provider account, skipping provider cancel`);
            return;
          }

          const adapter = getAdapter(providerId);
          if (!adapter) {
            console.warn(`[PlanUpgradeWorkflow] No adapter for ${providerId}`);
            return;
          }

          const result = await adapter.cancelSubscription({
            subscription: { id: oldProviderSubscriptionCode, status: "active" },
            environment: account.environment as "test" | "live",
            account,
          });

          if (result.isErr()) {
            console.warn(`[PlanUpgradeWorkflow] Provider cancel failed: ${result.error.message}`);
          } else {
            console.log(`[PlanUpgradeWorkflow] Provider cancel succeeded: ${oldProviderSubscriptionCode}`);
          }
        },
      );
    }

    // Step 2: Cancel old subscription in DB
    if (oldSubscriptionId) {
      await step.do("cancel-old-sub-db", async () => {
        const now = Date.now();
        await this.env.DB.prepare(
          "UPDATE subscriptions SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?",
        ).bind(now, now, oldSubscriptionId).run();
        console.log(`[PlanUpgradeWorkflow] Canceled old sub in DB: ${oldSubscriptionId}`);
      });
    }

    // Step 3: Look up data needed for subscription creation + provider sub
    const lookupData = await step.do("lookup-plan-customer-oldsub", async () => {
      const plan = await this.env.DB.prepare(
        "SELECT id, interval, provider_plan_id, paystack_plan_id, billing_type FROM plans WHERE id = ? LIMIT 1",
      ).bind(newPlanId).first<{
        id: string; interval: string;
        provider_plan_id: string | null; paystack_plan_id: string | null;
        billing_type: string;
      }>();

      const customer = await this.env.DB.prepare(
        "SELECT id, email, provider_customer_id, paystack_customer_id, provider_authorization_code, paystack_authorization_code FROM customers WHERE id = ? LIMIT 1",
      ).bind(customerId).first<{
        id: string; email: string;
        provider_customer_id: string | null; paystack_customer_id: string | null;
        provider_authorization_code: string | null; paystack_authorization_code: string | null;
      }>();

      // Get old subscription's period end (to preserve billing cycle alignment)
      let oldPeriodEnd: number | null = null;
      if (oldSubscriptionId) {
        const oldSub = await this.env.DB.prepare(
          "SELECT current_period_end FROM subscriptions WHERE id = ? LIMIT 1",
        ).bind(oldSubscriptionId).first<{ current_period_end: number | null }>();
        oldPeriodEnd = oldSub?.current_period_end || null;
      }

      return { plan, customer, oldPeriodEnd };
    });

    const { plan, customer, oldPeriodEnd } = lookupData;
    const periodMs = intervalToMs(plan?.interval || "monthly");

    // Step 4: Create new subscription in DB (preserving billing cycle)
    const newSubId = await step.do("create-new-subscription", async () => {
      const now = Date.now();

      // Idempotency: check if already created (active or trialing)
      const existing = await this.env.DB.prepare(
        "SELECT id FROM subscriptions WHERE customer_id = ? AND plan_id = ? AND status IN ('active', 'trialing') LIMIT 1",
      ).bind(customerId, newPlanId).first<{ id: string }>();

      if (existing) {
        console.log(`[PlanUpgradeWorkflow] Upgraded sub already exists: ${existing.id}`);
        return existing.id;
      }

      // Preserve old billing cycle end, or fall back to paidAt + period
      const startMs = paidAt ? new Date(paidAt).getTime() : now;
      const endMs = oldPeriodEnd || (startMs + periodMs);

      const subId = crypto.randomUUID();
      await this.env.DB.prepare(
        `INSERT INTO subscriptions (id, customer_id, plan_id, provider_id, provider_subscription_id, provider_subscription_code, status, current_period_start, current_period_end, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      ).bind(
        subId,
        customerId,
        newPlanId,
        providerId,
        "upgrade",
        "upgrade",
        startMs,
        endMs,
        JSON.stringify({ switch_type: "upgrade", upgraded_from: oldPlanId || oldSubscriptionId }),
        now,
        now,
      ).run();

      console.log(`[PlanUpgradeWorkflow] Created upgraded sub: ${subId}, periodEnd=${new Date(endMs).toISOString()}`);
      return subId;
    });

    // Step 5: Create provider subscription for recurring billing
    const providerPlanCode = plan?.provider_plan_id || plan?.paystack_plan_id;
    const authCode = customer?.provider_authorization_code || customer?.paystack_authorization_code;
    const isRecurring = plan?.billing_type === "recurring";
    let providerSubCode: string | null = null;

    // Skip provider subscription creation for providers with native subscription
    // management (supportsNativeTrials) — createSubscription would create a checkout, not a real sub.
    const upgradeAdapter = getAdapter(providerId);
    const skipProviderSub = upgradeAdapter?.supportsNativeTrials === true;

    if (isRecurring && providerPlanCode && authCode && customer && !skipProviderSub) {
      try {
        const subResult = await step.do("create-provider-subscription", async () => {
          const account = await resolveProviderAccount(this.env, organizationId, providerId);
          if (!account) throw new Error("No provider account");

          const adapter = getAdapter(providerId);
          if (!adapter) throw new Error(`No adapter for ${providerId}`);

          // Start date = old period end (proration covers until then)
          // or now + period if no old sub
          const startDate = oldPeriodEnd
            ? new Date(oldPeriodEnd).toISOString()
            : new Date(Date.now() + periodMs).toISOString();

          const result = await adapter.createSubscription({
            customer: { id: customer!.email, email: customer!.email },
            plan: { id: providerPlanCode! },
            authorizationCode: authCode!,
            startDate,
            environment: account.environment as "test" | "live",
            account,
            metadata: { subscription_id: newSubId, switch_type: "upgrade" },
          });

          if (result.isErr()) {
            throw new Error(`Provider createSubscription failed: ${result.error.message}`);
          }

          console.log(`[PlanUpgradeWorkflow] Provider sub created: ${result.value.id}, nextCharge=${startDate}`);
          return result.value.id;
        });
        providerSubCode = subResult;
      } catch (err) {
        console.error(`[PlanUpgradeWorkflow] Failed to create provider subscription:`, err);
      }
    }

    // Step 6: Update subscription with provider sub code (if created)
    if (providerSubCode && newSubId) {
      await step.do("link-provider-sub", async () => {
        const paystackCode = providerId === "paystack" ? providerSubCode : null;
        await this.env.DB.prepare(
          `UPDATE subscriptions
           SET provider_subscription_id = COALESCE(?, provider_subscription_id),
               provider_subscription_code = COALESCE(?, provider_subscription_code),
               paystack_subscription_code = COALESCE(?, paystack_subscription_code),
               updated_at = ?
           WHERE id = ?`,
        ).bind(providerSubCode, providerSubCode, paystackCode, Date.now(), newSubId).run();
        console.log(`[PlanUpgradeWorkflow] Linked provider sub ${providerSubCode} to ${newSubId}`);
      });
    }

    // Step 7: Re-provision entitlements
    await step.do("provision-entitlements", async () => {
      await provisionEntitlements(this.env, customerId, newPlanId, oldPlanId);
      console.log(`[PlanUpgradeWorkflow] Entitlements provisioned: customer=${customerId}, plan=${newPlanId}`);
    });
  }
}
