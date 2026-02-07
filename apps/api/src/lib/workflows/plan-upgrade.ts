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

    // Step 3: Create new subscription in DB
    await step.do("create-new-subscription", async () => {
      const now = Date.now();

      // Idempotency: check if already created
      const existing = await this.env.DB.prepare(
        "SELECT id FROM subscriptions WHERE customer_id = ? AND plan_id = ? AND status = 'active' LIMIT 1",
      ).bind(customerId, newPlanId).first<{ id: string }>();

      if (existing) {
        console.log(`[PlanUpgradeWorkflow] Upgraded sub already exists: ${existing.id}`);
        return;
      }

      // Fetch new plan for interval
      const plan = await this.env.DB.prepare(
        "SELECT interval FROM plans WHERE id = ? LIMIT 1",
      ).bind(newPlanId).first<{ interval: string }>();

      const periodMs = intervalToMs(plan?.interval || "monthly");
      const startMs = paidAt ? new Date(paidAt).getTime() : now;

      await this.env.DB.prepare(
        `INSERT INTO subscriptions (id, customer_id, plan_id, provider_id, provider_subscription_id, provider_subscription_code, status, current_period_start, current_period_end, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        customerId,
        newPlanId,
        providerId,
        "upgrade",
        "upgrade",
        startMs,
        startMs + periodMs,
        JSON.stringify({ switch_type: "upgrade", upgraded_from: oldPlanId || oldSubscriptionId }),
        now,
        now,
      ).run();

      console.log(`[PlanUpgradeWorkflow] Created upgraded sub: customer=${customerId}, plan=${newPlanId}`);
    });

    // Step 4: Re-provision entitlements
    await step.do("provision-entitlements", async () => {
      await provisionEntitlements(this.env, customerId, newPlanId, oldPlanId);
      console.log(`[PlanUpgradeWorkflow] Entitlements provisioned: customer=${customerId}, plan=${newPlanId}`);
    });
  }
}
