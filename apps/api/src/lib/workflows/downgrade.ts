import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent,
} from "cloudflare:workers";
import type { WorkflowEnv } from "./utils";
import {
  getAdapter,
  resolveProviderAccount,
  provisionEntitlements,
  intervalToMs,
  invalidateSubscriptionCache,
} from "./utils";

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export interface DowngradeParams {
  subscriptionId: string;
  customerId: string;
  newPlanId: string;
  organizationId: string;
  providerId: string;
  environment: string;
  executeAt: number;
  oldPlanId?: string;
  providerSubscriptionCode?: string;
  customerEmail?: string;
  customerAuthorizationCode?: string;
  newPlanProviderCode?: string;
}

// ---------------------------------------------------------------------------
// DowngradeWorkflow
//
// Sleeps until the current billing period ends, then cancels the old
// subscription and creates a new one on the lower-tier plan.
// Uses the adapter for all provider interactions.
// ---------------------------------------------------------------------------

export class DowngradeWorkflow extends WorkflowEntrypoint<
  WorkflowEnv,
  DowngradeParams
> {
  async run(event: WorkflowEvent<DowngradeParams>, step: WorkflowStep) {
    const {
      subscriptionId,
      customerId,
      newPlanId,
      organizationId,
      providerId,
      executeAt,
      oldPlanId,
      providerSubscriptionCode,
      customerEmail,
      customerAuthorizationCode,
      newPlanProviderCode,
    } = event.payload;

    // Step 1: Sleep until period end
    const waitMs = executeAt - Date.now();
    if (waitMs > 0) {
      await step.sleep("wait-for-period-end", waitMs);
    }

    // Step 2: Verify the downgrade is still pending
    const sub = await step.do("check-downgrade-pending", async () => {
      const result = await this.env.DB.prepare(
        "SELECT id, status, metadata FROM subscriptions WHERE id = ? LIMIT 1",
      )
        .bind(subscriptionId)
        .first<{ id: string; status: string; metadata: string | null }>();
      return result;
    });

    if (!sub) {
      console.log(
        `[DowngradeWorkflow] Subscription ${subscriptionId} not found, skipping`,
      );
      return;
    }

    // If subscription is already canceled/expired/refunded, don't proceed
    if (
      sub.status === "canceled" ||
      sub.status === "expired" ||
      sub.status === "refunded"
    ) {
      console.log(
        `[DowngradeWorkflow] Subscription ${subscriptionId} already ${sub.status}, skipping`,
      );
      return;
    }

    // Check metadata for scheduled_downgrade — user may have canceled the downgrade
    try {
      let meta: Record<string, unknown> = {};
      if (sub.metadata) {
        // Raw D1 may return string or already-parsed object depending on column mode
        meta =
          typeof sub.metadata === "string"
            ? JSON.parse(sub.metadata)
            : (sub.metadata as unknown as Record<string, unknown>);
      }
      if (!meta.scheduled_downgrade) {
        console.log(
          `[DowngradeWorkflow] No scheduled_downgrade in metadata for ${subscriptionId}, skipping`,
        );
        return;
      }
    } catch (parseError) {
      // Metadata parse failure — safe default is to SKIP the downgrade
      // If we can't verify the user wants to downgrade, don't proceed
      console.error(
        `[DowngradeWorkflow] Metadata parse failed for ${subscriptionId}, skipping downgrade:`,
        parseError,
      );
      return;
    }

    // Step 3: Cancel old subscription in DB
    await step.do("cancel-old-sub-db", async () => {
      const now = Date.now();
      await this.env.DB.prepare(
        "UPDATE subscriptions SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?",
      )
        .bind(now, now, subscriptionId)
        .run();
      await invalidateSubscriptionCache(this.env, organizationId, customerId);
      console.log(
        `[DowngradeWorkflow] Canceled old sub in DB: ${subscriptionId}`,
      );
    });

    // Step 4: Cancel on provider (via adapter) if applicable
    if (
      providerSubscriptionCode &&
      providerSubscriptionCode !== "one-time" &&
      !providerSubscriptionCode.startsWith("trial-") &&
      !providerSubscriptionCode.startsWith("charge")
    ) {
      await step.do(
        "cancel-on-provider",
        { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" } },
        async () => {
          const account = await resolveProviderAccount(
            this.env,
            organizationId,
            providerId,
          );
          if (!account) {
            console.warn(
              `[DowngradeWorkflow] No provider account for cancel, skipping provider cancel`,
            );
            return;
          }

          const adapter = getAdapter(providerId);
          if (!adapter) {
            console.warn(
              `[DowngradeWorkflow] No adapter for ${providerId}, skipping provider cancel`,
            );
            return;
          }

          const result = await adapter.cancelSubscription({
            subscription: { id: providerSubscriptionCode!, status: "active" },
            environment: account.environment as "test" | "live",
            account,
          });

          if (result.isErr()) {
            console.warn(
              `[DowngradeWorkflow] Provider cancel failed: ${result.error.message}`,
            );
            // Don't throw — provider cancel is best-effort, DB cancel already happened
          } else {
            console.log(
              `[DowngradeWorkflow] Provider cancel succeeded for ${providerSubscriptionCode}`,
            );
          }
        },
      );
    }

    // Step 5: Fetch new plan details + create subscription on provider if applicable
    // Skip for providers with native subscription management (supportsNativeTrials) —
    // createSubscription would create a checkout session, not a real subscription.
    const downgradeAdapter = getAdapter(providerId);
    const skipProviderSub = downgradeAdapter?.supportsNativeTrials === true;

    const newProviderSubCode = await step.do(
      "create-provider-subscription",
      async () => {
        if (
          skipProviderSub ||
          !newPlanProviderCode ||
          !customerEmail ||
          !customerAuthorizationCode
        ) {
          return null;
        }

        const account = await resolveProviderAccount(
          this.env,
          organizationId,
          providerId,
        );
        if (!account) return null;

        const adapter = getAdapter(providerId);
        if (!adapter) return null;

        const result = await adapter.createSubscription({
          customer: { id: customerEmail, email: customerEmail },
          plan: { id: newPlanProviderCode },
          authorizationCode: customerAuthorizationCode,
          environment: account.environment as "test" | "live",
          account,
        });

        if (result.isErr()) {
          console.warn(
            `[DowngradeWorkflow] Provider subscription creation failed: ${result.error.message}`,
          );
          return null;
        }

        console.log(
          `[DowngradeWorkflow] Created provider subscription: ${result.value.id}`,
        );
        return result.value.id;
      },
    );

    // Step 6: Create new DB subscription on the downgraded plan
    await step.do("create-downgraded-sub-db", async () => {
      const now = Date.now();

      // Idempotency: check if already created (active or trialing)
      const existing = await this.env.DB.prepare(
        "SELECT id FROM subscriptions WHERE customer_id = ? AND plan_id = ? AND status IN ('active', 'trialing') LIMIT 1",
      )
        .bind(customerId, newPlanId)
        .first<{ id: string }>();

      if (existing) {
        console.log(
          `[DowngradeWorkflow] Downgraded sub already exists: ${existing.id}`,
        );
        return;
      }

      // Fetch new plan interval
      const plan = await this.env.DB.prepare(
        "SELECT interval FROM plans WHERE id = ? LIMIT 1",
      )
        .bind(newPlanId)
        .first<{ interval: string }>();

      const periodMs = intervalToMs(plan?.interval || "monthly");

      await this.env.DB.prepare(
        `INSERT INTO subscriptions (id, customer_id, plan_id, provider_id, provider_subscription_id, provider_subscription_code, status, current_period_start, current_period_end, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          customerId,
          newPlanId,
          providerId,
          newProviderSubCode || "downgrade",
          newProviderSubCode || "downgrade",
          now,
          now + periodMs,
          JSON.stringify({
            switched_from: oldPlanId || subscriptionId,
            switch_type: "downgrade",
          }),
          now,
          now,
        )
        .run();

      console.log(
        `[DowngradeWorkflow] Created downgraded sub: customer=${customerId}, plan=${newPlanId}`,
      );
      await invalidateSubscriptionCache(this.env, organizationId, customerId);
    });

    // Step 7: Re-provision entitlements
    await step.do("provision-entitlements", async () => {
      await provisionEntitlements(this.env, customerId, newPlanId, oldPlanId);
      console.log(
        `[DowngradeWorkflow] Entitlements provisioned: customer=${customerId}, plan=${newPlanId}`,
      );
    });
  }
}
