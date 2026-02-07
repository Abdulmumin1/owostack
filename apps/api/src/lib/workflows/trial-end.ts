import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import type { WorkflowEnv } from "./utils";
import { getAdapter, resolveProviderAccount } from "./utils";
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
        "SELECT id, status FROM subscriptions WHERE id = ? LIMIT 1",
      ).bind(subscriptionId).first<{ id: string; status: string }>();
      return result;
    });

    if (!sub || sub.status !== "trialing") {
      console.log(`[TrialEndWorkflow] Subscription ${subscriptionId} is ${sub?.status ?? "missing"}, skipping`);
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
      // Step 6a: Activate subscription after successful charge
      // (The webhook for charge.success will also handle this, but we do it
      //  here as a safety net in case the webhook is delayed)
      await step.do("activate-subscription", async () => {
        const now = Date.now();
        await this.env.DB.prepare(
          "UPDATE subscriptions SET status = 'active', updated_at = ? WHERE id = ? AND status = 'trialing'",
        ).bind(now, subscriptionId).run();
        console.log(`[TrialEndWorkflow] Activated: subscription=${subscriptionId}`);
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
