import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep,
} from "cloudflare:workers";
import type { ProviderAccount } from "@owostack/adapters";
import { isPlaceholderSubscriptionCode } from "../subscription-health";
import {
  coerceMetadataRecord,
  RENEWAL_SETUP_RETRY_DELAYS_MS,
  readRenewalSetupMetadata,
  writeRenewalSetupMetadata,
} from "../renewal-setup";
import type { WorkflowEnv } from "./utils";
import {
  getAdapter,
  invalidateSubscriptionCache,
  resolveProviderAccount,
} from "./utils";

export interface RenewalSetupRetryParams {
  subscriptionId: string;
  customerId: string;
  organizationId: string;
  providerId: string;
  source?: string;
  immediate?: boolean;
}

type RetryAttemptResult =
  | { status: "succeeded" | "noop" | "aborted"; reason?: string }
  | { status: "retryable"; reason: string };

interface SubscriptionRow {
  id: string;
  status: string;
  customer_id: string;
  plan_id: string;
  provider_id: string | null;
  provider_subscription_code: string | null;
  paystack_subscription_code: string | null;
  current_period_end: number;
  cancel_at: number | null;
  metadata: unknown;
}

interface PlanRow {
  id: string;
  type: string | null;
  billing_type: string | null;
  interval: string | null;
  provider_plan_id: string | null;
  paystack_plan_id: string | null;
}

interface CustomerRow {
  id: string;
  email: string | null;
  provider_customer_id: string | null;
  paystack_customer_id: string | null;
}

interface PaymentMethodRow {
  token: string;
  provider_id: string;
}

async function readSubscription(
  env: WorkflowEnv,
  subscriptionId: string,
): Promise<SubscriptionRow | null> {
  return env.DB.prepare(
    `SELECT id, status, customer_id, plan_id, provider_id, provider_subscription_code,
            paystack_subscription_code, current_period_end, cancel_at, metadata
     FROM subscriptions
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(subscriptionId)
    .first<SubscriptionRow>();
}

async function readPlan(
  env: WorkflowEnv,
  planId: string,
): Promise<PlanRow | null> {
  return env.DB.prepare(
    `SELECT id, type, billing_type, interval, provider_plan_id, paystack_plan_id
     FROM plans
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(planId)
    .first<PlanRow>();
}

async function readCustomer(
  env: WorkflowEnv,
  customerId: string,
): Promise<CustomerRow | null> {
  return env.DB.prepare(
    `SELECT id, email, provider_customer_id, paystack_customer_id
     FROM customers
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(customerId)
    .first<CustomerRow>();
}

async function readProviderPaymentMethod(
  env: WorkflowEnv,
  customerId: string,
  providerId: string,
): Promise<PaymentMethodRow | null> {
  const defaultPm = await env.DB.prepare(
    `SELECT token, provider_id
     FROM payment_methods
     WHERE customer_id = ? AND provider_id = ? AND is_valid = 1 AND is_default = 1
     LIMIT 1`,
  )
    .bind(customerId, providerId)
    .first<PaymentMethodRow>();

  if (defaultPm) return defaultPm;

  return env.DB.prepare(
    `SELECT token, provider_id
     FROM payment_methods
     WHERE customer_id = ? AND provider_id = ? AND is_valid = 1
     LIMIT 1`,
  )
    .bind(customerId, providerId)
    .first<PaymentMethodRow>();
}

async function updateSubscriptionMetadata(
  env: WorkflowEnv,
  subscription: SubscriptionRow,
  patch: Record<string, unknown>,
): Promise<void> {
  const nextMetadata = writeRenewalSetupMetadata(subscription.metadata, patch);
  await env.DB.prepare(
    "UPDATE subscriptions SET metadata = ?, updated_at = ? WHERE id = ?",
  )
    .bind(JSON.stringify(nextMetadata), Date.now(), subscription.id)
    .run();
}

async function attemptRenewalSetup(
  env: WorkflowEnv,
  payload: RenewalSetupRetryParams,
  source: string,
  nextDelayMs: number | null,
): Promise<RetryAttemptResult> {
  const now = Date.now();
  const subscription = await readSubscription(env, payload.subscriptionId);
  if (!subscription) {
    return { status: "aborted", reason: "subscription_missing" };
  }
  const renewalSetup = readRenewalSetupMetadata(subscription.metadata);
  const retryCount = (renewalSetup.renewal_setup_retry_count || 0) + 1;

  const existingCode =
    subscription.provider_subscription_code || subscription.paystack_subscription_code;
  if (existingCode && !isPlaceholderSubscriptionCode(existingCode)) {
    await updateSubscriptionMetadata(env, subscription, {
      renewal_setup_status: "complete",
      renewal_setup_retry_count: retryCount,
      renewal_setup_last_error: null,
      renewal_setup_last_attempt_at: now,
      renewal_setup_next_attempt_at: null,
      renewal_setup_updated_at: now,
      renewal_setup_last_source: source,
    });
    if (subscription.cancel_at) {
      await env.DB.prepare(
        "UPDATE subscriptions SET cancel_at = NULL, updated_at = ? WHERE id = ?",
      )
        .bind(now, subscription.id)
        .run();
    }
    return { status: "noop", reason: "provider_subscription_exists" };
  }

  if (subscription.status !== "active") {
    return { status: "aborted", reason: `subscription_${subscription.status}` };
  }

  if (!subscription.current_period_end || subscription.current_period_end <= now) {
    return { status: "aborted", reason: "period_elapsed" };
  }

  const plan = await readPlan(env, subscription.plan_id);
  if (!plan) return { status: "aborted", reason: "plan_missing" };
  if ((plan.type || "").toLowerCase() === "free") {
    return { status: "aborted", reason: "free_plan" };
  }
  if ((plan.billing_type || "").toLowerCase() !== "recurring") {
    return { status: "aborted", reason: "non_recurring_plan" };
  }

  const providerPlanCode = plan.provider_plan_id || plan.paystack_plan_id;
  if (!providerPlanCode) {
    await updateSubscriptionMetadata(env, subscription, {
      renewal_setup_status: nextDelayMs ? "scheduled" : "failed",
      renewal_setup_retry_count: retryCount,
      renewal_setup_last_error: "missing_provider_plan_code",
      renewal_setup_last_attempt_at: now,
      renewal_setup_next_attempt_at: nextDelayMs ? now + nextDelayMs : null,
      renewal_setup_updated_at: now,
      renewal_setup_last_source: source,
    });
    return { status: nextDelayMs ? "retryable" : "aborted", reason: "missing_provider_plan_code" };
  }

  const customer = await readCustomer(env, subscription.customer_id);
  if (!customer?.email) {
    await updateSubscriptionMetadata(env, subscription, {
      renewal_setup_status: nextDelayMs ? "scheduled" : "failed",
      renewal_setup_retry_count: retryCount,
      renewal_setup_last_error: "missing_customer_email",
      renewal_setup_last_attempt_at: now,
      renewal_setup_next_attempt_at: nextDelayMs ? now + nextDelayMs : null,
      renewal_setup_updated_at: now,
      renewal_setup_last_source: source,
    });
    return { status: nextDelayMs ? "retryable" : "aborted", reason: "missing_customer_email" };
  }

  const customerCode =
    customer.provider_customer_id || customer.paystack_customer_id;
  if (!customerCode) {
    await updateSubscriptionMetadata(env, subscription, {
      renewal_setup_status: nextDelayMs ? "scheduled" : "failed",
      renewal_setup_retry_count: retryCount,
      renewal_setup_last_error: "missing_provider_customer_id",
      renewal_setup_last_attempt_at: now,
      renewal_setup_next_attempt_at: nextDelayMs ? now + nextDelayMs : null,
      renewal_setup_updated_at: now,
      renewal_setup_last_source: source,
    });
    return { status: nextDelayMs ? "retryable" : "aborted", reason: "missing_provider_customer_id" };
  }

  const paymentMethod = await readProviderPaymentMethod(
    env,
    subscription.customer_id,
    payload.providerId,
  );
  if (!paymentMethod?.token) {
    await updateSubscriptionMetadata(env, subscription, {
      renewal_setup_status: nextDelayMs ? "scheduled" : "failed",
      renewal_setup_retry_count: retryCount,
      renewal_setup_last_error: "missing_provider_payment_method",
      renewal_setup_last_attempt_at: now,
      renewal_setup_next_attempt_at: nextDelayMs ? now + nextDelayMs : null,
      renewal_setup_updated_at: now,
      renewal_setup_last_source: source,
    });
    return { status: nextDelayMs ? "retryable" : "aborted", reason: "missing_provider_payment_method" };
  }

  const adapter = getAdapter(payload.providerId);
  if (!adapter) {
    await updateSubscriptionMetadata(env, subscription, {
      renewal_setup_status: nextDelayMs ? "scheduled" : "failed",
      renewal_setup_retry_count: retryCount,
      renewal_setup_last_error: "missing_provider_adapter",
      renewal_setup_last_attempt_at: now,
      renewal_setup_next_attempt_at: nextDelayMs ? now + nextDelayMs : null,
      renewal_setup_updated_at: now,
      renewal_setup_last_source: source,
    });
    return { status: nextDelayMs ? "retryable" : "aborted", reason: "missing_provider_adapter" };
  }

  const account = await resolveProviderAccount(
    env,
    payload.organizationId,
    payload.providerId,
  );
  if (!account) {
    await updateSubscriptionMetadata(env, subscription, {
      renewal_setup_status: nextDelayMs ? "scheduled" : "failed",
      renewal_setup_retry_count: retryCount,
      renewal_setup_last_error: "missing_provider_account",
      renewal_setup_last_attempt_at: now,
      renewal_setup_next_attempt_at: nextDelayMs ? now + nextDelayMs : null,
      renewal_setup_updated_at: now,
      renewal_setup_last_source: source,
    });
    return { status: nextDelayMs ? "retryable" : "aborted", reason: "missing_provider_account" };
  }

  const startDate = new Date(subscription.current_period_end).toISOString();
  const result = await adapter.createSubscription({
    customer: {
      id: customerCode,
      email: customer.email,
    },
    plan: { id: providerPlanCode },
    authorizationCode: paymentMethod.token,
    startDate,
    environment: account.environment as "test" | "live",
    account: account as ProviderAccount,
    metadata: {
      subscription_id: subscription.id,
      renewal_setup_retry: true,
      source,
    },
  });

  if (result.isErr()) {
    const reason = result.error.message || "create_subscription_failed";
    await updateSubscriptionMetadata(env, subscription, {
      renewal_setup_status: nextDelayMs ? "scheduled" : "failed",
      renewal_setup_retry_count: retryCount,
      renewal_setup_last_error: reason,
      renewal_setup_last_attempt_at: now,
      renewal_setup_next_attempt_at: nextDelayMs ? now + nextDelayMs : null,
      renewal_setup_updated_at: now,
      renewal_setup_last_source: source,
    });
    return nextDelayMs
      ? { status: "retryable", reason }
      : { status: "aborted", reason };
  }

  const providerSubCode = result.value.id;
  const nextMetadata = writeRenewalSetupMetadata(subscription.metadata, {
    renewal_setup_status: "complete",
    renewal_setup_retry_count: retryCount,
    renewal_setup_last_error: null,
    renewal_setup_last_attempt_at: now,
    renewal_setup_next_attempt_at: null,
    renewal_setup_updated_at: now,
    renewal_setup_last_source: source,
  });

  await env.DB.prepare(
    `UPDATE subscriptions
     SET provider_subscription_id = ?,
         provider_subscription_code = ?,
         paystack_subscription_code = ?,
         cancel_at = NULL,
         metadata = ?,
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      providerSubCode,
      providerSubCode,
      payload.providerId === "paystack" ? providerSubCode : null,
      JSON.stringify(nextMetadata),
      now,
      subscription.id,
    )
    .run();

  await invalidateSubscriptionCache(
    env,
    payload.organizationId,
    payload.customerId,
  );

  return { status: "succeeded" };
}

export class RenewalSetupRetryWorkflow extends WorkflowEntrypoint<
  WorkflowEnv,
  RenewalSetupRetryParams
> {
  async run(event: WorkflowEvent<RenewalSetupRetryParams>, step: WorkflowStep) {
    const source = event.payload.source || "renewal_setup_retry";
    const delays = event.payload.immediate
      ? [0, ...RENEWAL_SETUP_RETRY_DELAYS_MS]
      : [...RENEWAL_SETUP_RETRY_DELAYS_MS];

    for (let i = 0; i < delays.length; i++) {
      const delayMs = delays[i];
      if (delayMs > 0) {
        await step.sleep(`renewal-setup-wait-${i}`, delayMs);
      }

      const nextDelayMs = delays[i + 1] ?? null;
      const result = await step.do(`renewal-setup-attempt-${i}`, async () =>
        attemptRenewalSetup(this.env, event.payload, source, nextDelayMs),
      );

      if (result.status === "succeeded" || result.status === "noop") {
        console.log(
          `[RenewalSetupRetry] Completed for subscription=${event.payload.subscriptionId}, status=${result.status}`,
        );
        return;
      }

      if (result.status === "aborted") {
        console.warn(
          `[RenewalSetupRetry] Aborted for subscription=${event.payload.subscriptionId}, reason=${result.reason || "unknown"}`,
        );
        return;
      }
    }

    const finalSub = await readSubscription(this.env, event.payload.subscriptionId);
    if (finalSub) {
      const finalMetadata = coerceMetadataRecord(finalSub.metadata);
      if (finalMetadata.renewal_setup_status !== "complete") {
        await updateSubscriptionMetadata(this.env, finalSub, {
          renewal_setup_status: "failed",
          renewal_setup_next_attempt_at: null,
          renewal_setup_updated_at: Date.now(),
          renewal_setup_last_source: source,
        });
      }
    }
  }
}
