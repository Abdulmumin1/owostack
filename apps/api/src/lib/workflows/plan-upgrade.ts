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
  getRuntimeProviderEnvironment,
} from "./utils";
import {
  RENEWAL_SETUP_RETRY_DELAYS_MS,
  buildRenewalSetupFailureMetadata,
} from "../renewal-setup";
import { calculateAlignedPeriodEnd } from "../plan-switch";

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

export class PlanUpgradeWorkflow extends WorkflowEntrypoint<
  WorkflowEnv,
  PlanUpgradeParams
> {
  static dependencies = {
    getAdapter,
    resolveProviderAccount,
    provisionEntitlements,
    intervalToMs,
    invalidateSubscriptionCache,
  };

  private get deps() {
    return PlanUpgradeWorkflow.dependencies;
  }

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
    const providerEnvironment = getRuntimeProviderEnvironment(
      this.env.ENVIRONMENT,
    );

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
          const account = await this.deps.resolveProviderAccount(
            this.env,
            organizationId,
            providerId,
          );
          if (!account) {
            console.warn(
              `[PlanUpgradeWorkflow] No provider account, skipping provider cancel`,
            );
            return;
          }

          const adapter = this.deps.getAdapter(providerId);
          if (!adapter) {
            console.warn(`[PlanUpgradeWorkflow] No adapter for ${providerId}`);
            return;
          }

          const result = await adapter.cancelSubscription({
            subscription: { id: oldProviderSubscriptionCode, status: "active" },
            environment: providerEnvironment,
            account,
          });

          if (result.isErr()) {
            console.warn(
              `[PlanUpgradeWorkflow] Provider cancel failed: ${result.error.message}`,
            );
          } else {
            console.log(
              `[PlanUpgradeWorkflow] Provider cancel succeeded: ${oldProviderSubscriptionCode}`,
            );
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
        )
          .bind(now, now, oldSubscriptionId)
          .run();
        await this.deps.invalidateSubscriptionCache(
          this.env,
          organizationId,
          customerId,
        );
        console.log(
          `[PlanUpgradeWorkflow] Canceled old sub in DB: ${oldSubscriptionId}`,
        );
      });
    }

    // Step 3: Look up data needed for subscription creation + provider sub
    const lookupData = await step.do(
      "lookup-plan-customer-oldsub",
      async () => {
        const plan = await this.env.DB.prepare(
          "SELECT id, interval, provider_plan_id, paystack_plan_id, billing_type FROM plans WHERE id = ? LIMIT 1",
        )
          .bind(newPlanId)
          .first<{
            id: string;
            interval: string;
            provider_plan_id: string | null;
            paystack_plan_id: string | null;
            billing_type: string;
          }>();

        const customer = await this.env.DB.prepare(
          "SELECT id, email, provider_customer_id, paystack_customer_id, provider_authorization_code, paystack_authorization_code FROM customers WHERE id = ? LIMIT 1",
        )
          .bind(customerId)
          .first<{
            id: string;
            email: string;
            provider_customer_id: string | null;
            paystack_customer_id: string | null;
            provider_authorization_code: string | null;
            paystack_authorization_code: string | null;
          }>();

        // Get old subscription's period end (to preserve billing cycle alignment)
        let oldPeriodEnd: number | null = null;
        if (oldSubscriptionId) {
          const oldSub = await this.env.DB.prepare(
            "SELECT current_period_end FROM subscriptions WHERE id = ? LIMIT 1",
          )
            .bind(oldSubscriptionId)
            .first<{ current_period_end: number | null }>();
          oldPeriodEnd = oldSub?.current_period_end || null;
        }

        return { plan, customer, oldPeriodEnd };
      },
    );

    const { plan, customer, oldPeriodEnd } = lookupData;
    const periodMs = this.deps.intervalToMs(plan?.interval || "monthly");

    // Step 4: Create new subscription in DB (preserving billing cycle)
    const newSubId = await step.do("create-new-subscription", async () => {
      const now = Date.now();

      // Idempotency: check if already created (active or trialing)
      const existing = await this.env.DB.prepare(
        "SELECT id FROM subscriptions WHERE customer_id = ? AND plan_id = ? AND status IN ('active', 'trialing') LIMIT 1",
      )
        .bind(customerId, newPlanId)
        .first<{ id: string }>();

      if (existing) {
        console.log(
          `[PlanUpgradeWorkflow] Upgraded sub already exists: ${existing.id}`,
        );
        return existing.id;
      }

      // Preserve old billing cycle end, or fall back to paidAt + period
      const startMs = paidAt ? new Date(paidAt).getTime() : now;
      const endMs = calculateAlignedPeriodEnd(oldPeriodEnd, startMs, periodMs);

      const subId = crypto.randomUUID();
      await this.env.DB.prepare(
        `INSERT INTO subscriptions (id, customer_id, plan_id, provider_id, provider_subscription_id, provider_subscription_code, status, current_period_start, current_period_end, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      )
        .bind(
          subId,
          customerId,
          newPlanId,
          providerId,
          "upgrade",
          "upgrade",
          startMs,
          endMs,
          JSON.stringify({
            switch_type: "upgrade",
            upgraded_from: oldPlanId || oldSubscriptionId,
          }),
          now,
          now,
        )
        .run();

      console.log(
        `[PlanUpgradeWorkflow] Created upgraded sub: ${subId}, periodEnd=${new Date(endMs).toISOString()}`,
      );
      await this.deps.invalidateSubscriptionCache(
        this.env,
        organizationId,
        customerId,
      );
      return subId;
    });

    const newSubState = await step.do(
      "load-upgraded-subscription-state",
      async () =>
        this.env.DB.prepare(
          "SELECT provider_subscription_code FROM subscriptions WHERE id = ? LIMIT 1",
        )
          .bind(newSubId)
          .first<{ provider_subscription_code: string | null }>(),
    );

    // Step 5: Create provider subscription for recurring billing
    const providerPlanCode = plan?.provider_plan_id || plan?.paystack_plan_id;
    const authCode =
      customer?.provider_authorization_code ||
      customer?.paystack_authorization_code;
    const isRecurring = plan?.billing_type === "recurring";
    let providerSubCode: string | null = null;
    const upgradeStartMs = paidAt ? new Date(paidAt).getTime() : Date.now();
    const periodEnd = calculateAlignedPeriodEnd(
      oldPeriodEnd,
      upgradeStartMs,
      periodMs,
    );
    const customerCode =
      customer?.provider_customer_id ||
      customer?.paystack_customer_id ||
      customer?.email ||
      null;

    // Skip provider subscription creation for providers with native subscription
    // management (supportsNativeTrials) — createSubscription would create a checkout, not a real sub.
    const upgradeAdapter = this.deps.getAdapter(providerId);
    const skipProviderSub = upgradeAdapter?.supportsNativeTrials === true;
    const requiresProviderSubscription = isRecurring && !skipProviderSub;
    const needsProviderSubscriptionLink =
      !newSubState?.provider_subscription_code ||
      newSubState.provider_subscription_code === "upgrade";
    const missingRenewalInputs: string[] = [];
    if (requiresProviderSubscription && !providerPlanCode) {
      missingRenewalInputs.push("provider_plan_code");
    }
    if (requiresProviderSubscription && !customer?.email) {
      missingRenewalInputs.push("customer_email");
    }
    if (requiresProviderSubscription && !authCode) {
      missingRenewalInputs.push("provider_payment_method");
    }
    let renewalSetupFailureReason: string | null =
      missingRenewalInputs.length > 0
        ? `missing_${missingRenewalInputs.join("_")}`
        : null;

    if (
      requiresProviderSubscription &&
      needsProviderSubscriptionLink &&
      providerPlanCode &&
      authCode &&
      customer &&
      customer.email
    ) {
      try {
        const subResult = await step.do(
          "create-provider-subscription",
          async () => {
            const account = await this.deps.resolveProviderAccount(
              this.env,
              organizationId,
              providerId,
            );
            if (!account) throw new Error("No provider account");

            const adapter = this.deps.getAdapter(providerId);
            if (!adapter) throw new Error(`No adapter for ${providerId}`);

            const startDate = new Date(periodEnd).toISOString();

            const result = await adapter.createSubscription({
              customer: {
                id: customerCode || customer!.email,
                email: customer!.email,
              },
              plan: { id: providerPlanCode! },
              authorizationCode: authCode!,
              startDate,
              environment: providerEnvironment,
              account,
              metadata: { subscription_id: newSubId, switch_type: "upgrade" },
            });

            if (result.isErr()) {
              throw new Error(
                `Provider createSubscription failed: ${result.error.message}`,
              );
            }

            console.log(
              `[PlanUpgradeWorkflow] Provider sub created: ${result.value.id}, nextCharge=${startDate}`,
            );
            return result.value.id;
          },
        );
        providerSubCode = subResult;
      } catch (err) {
        renewalSetupFailureReason =
          err instanceof Error ? err.message : String(err);
        console.error(
          `[PlanUpgradeWorkflow] Failed to create provider subscription:`,
          err,
        );
      }
    }

    let retryScheduled = false;
    if (
      requiresProviderSubscription &&
      needsProviderSubscriptionLink &&
      !providerSubCode
    ) {
      if (this.env.RENEWAL_SETUP_WORKFLOW) {
        try {
          const workflow = await this.env.RENEWAL_SETUP_WORKFLOW.create({
            params: {
              subscriptionId: newSubId,
              customerId,
              organizationId,
              providerId,
              source: "plan_upgrade",
              immediate: false,
            },
          });
          retryScheduled = true;
          console.log(
            `[PlanUpgradeWorkflow] Scheduled renewal setup retry workflow ${workflow.id} for subscription=${newSubId}`,
          );
        } catch (retryErr) {
          console.error(
            `[PlanUpgradeWorkflow] Failed to schedule renewal setup retry for subscription=${newSubId}`,
            retryErr,
          );
        }
      }
    }

    await step.do("finalize-upgraded-subscription", async () => {
      const row = await this.env.DB.prepare(
        "SELECT metadata FROM subscriptions WHERE id = ? LIMIT 1",
      )
        .bind(newSubId)
        .first<{ metadata: unknown }>();
      const now = Date.now();
      const linkedProviderCode = needsProviderSubscriptionLink
        ? providerSubCode
        : newSubState?.provider_subscription_code || null;
      const paystackCode =
        providerId === "paystack" ? linkedProviderCode : null;
      const baseMetadata =
        row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const metadata =
        requiresProviderSubscription &&
        needsProviderSubscriptionLink &&
        !providerSubCode
          ? buildRenewalSetupFailureMetadata(baseMetadata, {
              reason:
                renewalSetupFailureReason || "provider_subscription_missing",
              source: "plan_upgrade",
              retryScheduled,
              nextAttemptAt: retryScheduled
                ? now + RENEWAL_SETUP_RETRY_DELAYS_MS[0]
                : null,
              now,
            })
          : baseMetadata;

      await this.env.DB.prepare(
        `UPDATE subscriptions
         SET provider_subscription_id = ?,
             provider_subscription_code = ?,
             paystack_subscription_code = ?,
             cancel_at = ?,
             metadata = ?,
             updated_at = ?
         WHERE id = ?`,
      )
        .bind(
          linkedProviderCode,
          linkedProviderCode,
          paystackCode,
          requiresProviderSubscription &&
            needsProviderSubscriptionLink &&
            !providerSubCode
            ? periodEnd
            : null,
          JSON.stringify(metadata || {}),
          now,
          newSubId,
        )
        .run();

      await this.deps.invalidateSubscriptionCache(
        this.env,
        organizationId,
        customerId,
      );

      if (providerSubCode) {
        console.log(
          `[PlanUpgradeWorkflow] Linked provider sub ${providerSubCode} to ${newSubId}`,
        );
      }
    });

    // Step 7: Re-provision entitlements
    await step.do("provision-entitlements", async () => {
      await this.deps.provisionEntitlements(
        this.env,
        customerId,
        newPlanId,
        oldPlanId,
      );
      console.log(
        `[PlanUpgradeWorkflow] Entitlements provisioned: customer=${customerId}, plan=${newPlanId}`,
      );
    });
  }
}
