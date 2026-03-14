import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent,
} from "cloudflare:workers";
import type { WorkflowEnv } from "./utils";
import {
  getAdapter,
  resolveProviderAccount,
  intervalToMs,
  provisionEntitlements,
  invalidateSubscriptionCache,
} from "./utils";
import type { ProviderAccount } from "@owostack/adapters";
import {
  RENEWAL_SETUP_RETRY_DELAYS_MS,
  writeRenewalSetupMetadata,
} from "../renewal-setup";

export type TrialEndWorkflowDependencies = {
  getAdapter: typeof getAdapter;
  resolveProviderAccount: typeof resolveProviderAccount;
  intervalToMs: typeof intervalToMs;
  provisionEntitlements: typeof provisionEntitlements;
  invalidateSubscriptionCache: typeof invalidateSubscriptionCache;
};

const defaultDependencies: TrialEndWorkflowDependencies = {
  getAdapter,
  resolveProviderAccount,
  intervalToMs,
  provisionEntitlements,
  invalidateSubscriptionCache,
};

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

function parseMetadata(
  metadata: string | Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!metadata) return {};

  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  return metadata;
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
  nativeTrial?: boolean;
}

// ---------------------------------------------------------------------------
// TrialEndWorkflow
//
// Sleeps until trial end, then either charges the saved card (card-required
// trial) or expires the subscription (no-card trial).  Each step is
// individually retryable and durable.
// ---------------------------------------------------------------------------

export class TrialEndWorkflow extends WorkflowEntrypoint<
  WorkflowEnv,
  TrialEndParams
> {
  static dependencies: TrialEndWorkflowDependencies = defaultDependencies;

  private get deps() {
    return TrialEndWorkflow.dependencies;
  }

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
      nativeTrial,
    } = event.payload;

    // Step 1: Sleep until trial ends
    console.log(
      `[TrialEndWorkflow] Waiting for trial end: subscription=${subscriptionId}`,
    );
    const waitMs = trialEndMs - Date.now();
    if (waitMs > 0) {
      await step.sleep("wait-for-trial-end", waitMs);
    }

    // Step 2: Verify subscription is still in trialing state (idempotency)
    const sub = await step.do<{
      id: string;
      status: string;
      cancel_at: number | null;
      metadata: string | null;
    } | null>("check-subscription-status", async () => {
      const result = await this.env.DB.prepare(
        "SELECT id, status, cancel_at, metadata FROM subscriptions WHERE id = ? LIMIT 1",
      )
        .bind(subscriptionId)
        .first<{
          id: string;
          status: string;
          cancel_at: number | null;
          metadata: string | Record<string, unknown> | null;
        }>();

      if (!result) return null;

      return {
        id: result.id,
        status: result.status,
        cancel_at: result.cancel_at,
        metadata:
          typeof result.metadata === "string"
            ? result.metadata
            : result.metadata
              ? JSON.stringify(result.metadata)
              : null,
      };
    });

    if (!sub || sub.status !== "trialing") {
      console.log(
        `[TrialEndWorkflow] Subscription ${subscriptionId} is ${sub?.status ?? "missing"}, skipping`,
      );
      return;
    }

    // If user canceled before trial end, expire instead of charging
    if (sub.cancel_at) {
      const metadata = parseMetadata(sub.metadata);
      if (metadata.scheduled_downgrade) {
        console.log(
          `[TrialEndWorkflow] Scheduled downgrade will take over at period end: subscription=${subscriptionId}`,
        );
        return;
      }

      await step.do("expire-canceled-trial", async () => {
        const now = Date.now();
        await this.env.DB.prepare(
          "UPDATE subscriptions SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?",
        )
          .bind(now, now, subscriptionId)
          .run();
        await this.deps.invalidateSubscriptionCache(
          this.env,
          organizationId,
          customerId,
        );
        console.log(
          `[TrialEndWorkflow] Canceled (user requested): subscription=${subscriptionId}`,
        );
      });
      return;
    }

    // Step 2b: Native trial — provider (e.g. Dodo) manages billing automatically.
    // Just activate the subscription; the provider's webhook will confirm the charge.
    if (nativeTrial) {
      await step.do("activate-native-trial", async () => {
        const now = Date.now();
        await this.env.DB.prepare(
          "UPDATE subscriptions SET status = 'active', updated_at = ? WHERE id = ? AND status = 'trialing'",
        )
          .bind(now, subscriptionId)
          .run();
        await this.deps.invalidateSubscriptionCache(
          this.env,
          organizationId,
          customerId,
        );
        console.log(
          `[TrialEndWorkflow] Native trial ended, activated: subscription=${subscriptionId} (provider handles billing)`,
        );
      });
      return;
    }

    // Step 3: Re-fetch latest auth from payment_methods table.
    // The customer may have updated their card since the trial started.
    const latestAuth = await step.do("fetch-latest-auth", async () => {
      const providerDefaultPm = await this.env.DB.prepare(
        "SELECT token, provider_id FROM payment_methods WHERE customer_id = ? AND provider_id = ? AND is_valid = 1 AND is_default = 1 LIMIT 1",
      )
        .bind(customerId, providerId)
        .first<{ token: string; provider_id: string }>();

      const providerPm =
        providerDefaultPm ||
        (await this.env.DB.prepare(
          "SELECT token, provider_id FROM payment_methods WHERE customer_id = ? AND provider_id = ? AND is_valid = 1 LIMIT 1",
        )
          .bind(customerId, providerId)
          .first<{ token: string; provider_id: string }>());

      const customer = await this.env.DB.prepare(
        "SELECT email, provider_customer_id, paystack_customer_id FROM customers WHERE id = ? LIMIT 1",
      )
        .bind(customerId)
        .first<{
          email: string | null;
          provider_customer_id: string | null;
          paystack_customer_id: string | null;
        }>();

      return {
        authCode: providerPm?.token || authorizationCode || null,
        email: customer?.email || email || null,
        providerCustomerId:
          customer?.provider_customer_id ||
          customer?.paystack_customer_id ||
          null,
      };
    });

    const resolvedAuthCode = latestAuth.authCode;
    const resolvedEmail = latestAuth.email;
    const resolvedProviderCustomerId = latestAuth.providerCustomerId;

    // Step 3b: Branch — no card, missing charge data, or zero amount → expire
    if (!resolvedAuthCode || !resolvedEmail || !amount || amount <= 0) {
      await step.do("expire-subscription", async () => {
        const now = Date.now();
        await this.env.DB.prepare(
          "UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE id = ?",
        )
          .bind(now, subscriptionId)
          .run();
        await this.deps.invalidateSubscriptionCache(
          this.env,
          organizationId,
          customerId,
        );
        console.log(
          `[TrialEndWorkflow] Expired (no card/data): subscription=${subscriptionId}, authCode=${!!resolvedAuthCode}, email=${!!resolvedEmail}, amount=${amount}`,
        );
      });
      return;
    }

    // Step 4: Resolve adapter + provider account
    const accountData: ResolvedAccount | null = await step.do(
      "resolve-provider",
      async () => {
        const account = await this.deps.resolveProviderAccount(
          this.env,
          organizationId,
          providerId,
        );
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
      },
    );

    if (!accountData) {
      // Can't charge — expire the subscription instead
      await step.do("expire-no-provider", async () => {
        const now = Date.now();
        await this.env.DB.prepare(
          "UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE id = ?",
        )
          .bind(now, subscriptionId)
          .run();
        console.log(
          `[TrialEndWorkflow] Expired (no provider key): subscription=${subscriptionId}`,
        );
      });
      return;
    }

    // Step 5: Charge the saved card via adapter.
    // IMPORTANT: Never throw from inside step.do for provider errors — Cloudflare
    // Workflows treats exhausted retries as a terminal workflow failure, bypassing
    // JavaScript try/catch. Instead, return a result object and handle failures
    // gracefully so the expire fallback always runs.
    const MAX_CHARGE_ATTEMPTS = 3;
    let chargeSucceeded = false;
    let lastChargeError = "";

    for (let attempt = 0; attempt < MAX_CHARGE_ATTEMPTS; attempt++) {
      const result = await step.do(
        `charge-card-attempt-${attempt}`,
        async () => {
          const adapter = this.deps.getAdapter(providerId);
          if (!adapter) {
            return {
              success: false as const,
              error: `No adapter for provider: ${providerId}`,
              retryable: false,
            };
          }

          try {
            const chargeResult = await adapter.chargeAuthorization({
              customer: {
                id: resolvedProviderCustomerId || customerId,
                email: resolvedEmail,
              },
              authorizationCode: resolvedAuthCode,
              amount: amount!,
              currency: currency || "USD",
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

            if (chargeResult.isErr()) {
              const errMsg =
                chargeResult.error.message ||
                JSON.stringify(chargeResult.error);
              // Determine if the error is retryable.
              // Authorization/validation errors are permanent — retrying won't help.
              const permanent =
                /invalid_authorization|validation_error|invalid_request|authorization.*(invalid|expired|not found)/i.test(
                  errMsg,
                );
              console.error(
                `[TrialEndWorkflow] Charge attempt ${attempt} failed: ${errMsg} (permanent=${permanent})`,
              );
              return {
                success: false as const,
                error: errMsg,
                retryable: !permanent,
              };
            }

            console.log(
              `[TrialEndWorkflow] Charge succeeded: subscription=${subscriptionId}, ref=${chargeResult.value.reference}`,
            );
            return {
              success: true as const,
              reference: chargeResult.value.reference,
            };
          } catch (networkErr: any) {
            // Network/timeout errors are retryable
            console.error(
              `[TrialEndWorkflow] Charge attempt ${attempt} threw: ${networkErr.message}`,
            );
            return {
              success: false as const,
              error: networkErr.message,
              retryable: true,
            };
          }
        },
      );

      if (result.success) {
        chargeSucceeded = true;
        break;
      }

      lastChargeError = result.error;

      // Don't retry permanent errors
      if (!result.retryable) {
        console.log(
          `[TrialEndWorkflow] Permanent charge error — skipping remaining attempts`,
        );
        break;
      }

      // Wait before retrying (exponential backoff: 30s, 60s)
      if (attempt < MAX_CHARGE_ATTEMPTS - 1) {
        const delayMs = 30_000 * Math.pow(2, attempt);
        await step.sleep(`charge-retry-wait-${attempt}`, delayMs);
      }
    }

    if (!chargeSucceeded) {
      console.error(
        `[TrialEndWorkflow] All charge attempts failed: subscription=${subscriptionId}, lastError=${lastChargeError}`,
      );
    }

    if (chargeSucceeded) {
      // Step 6a: Look up plan + customer to decide if we need a provider subscription
      const planAndCustomer = await step.do(
        "lookup-plan-customer",
        async () => {
          const plan = await this.env.DB.prepare(
            "SELECT id, billing_type, interval, provider_plan_id, paystack_plan_id, currency FROM plans WHERE id = ? LIMIT 1",
          )
            .bind(planId)
            .first<{
              id: string;
              billing_type: string;
              interval: string;
              provider_plan_id: string | null;
              paystack_plan_id: string | null;
              currency: string;
            }>();

          const customer = await this.env.DB.prepare(
            "SELECT id, email, provider_customer_id, paystack_customer_id FROM customers WHERE id = ? LIMIT 1",
          )
            .bind(customerId)
            .first<{
              id: string;
              email: string;
              provider_customer_id: string | null;
              paystack_customer_id: string | null;
            }>();

          return { plan, customer };
        },
      );

      const { plan, customer } = planAndCustomer;
      const isRecurring = plan?.billing_type === "recurring";
      const providerPlanCode = plan?.provider_plan_id || plan?.paystack_plan_id;
      const customerCode =
        customer?.provider_customer_id || customer?.paystack_customer_id;
      const subscriptionPeriodEnd = plan
        ? Date.now() + this.deps.intervalToMs(plan.interval)
        : Date.now() + 30 * 24 * 60 * 60 * 1000;

      // Step 6b: For recurring plans with provider plan codes, create a
      // subscription on the provider so it handles future billing cycles.
      // Use start_date = now + 1 billing cycle to avoid double-charging
      // (we already charged the first cycle via chargeAuthorization).
      let providerSubCode: string | null = null;

      // Skip provider subscription creation for providers with native trial/subscription
      // management (supportsNativeTrials). For these providers, the subscription already
      // exists from the initial checkout — calling createSubscription would create a new
      // checkout session requiring user interaction.
      const trialAdapter = this.deps.getAdapter(providerId);
      const skipProviderSub = trialAdapter?.supportsNativeTrials === true;
      const requiresProviderSubscription = isRecurring && !skipProviderSub;
      const missingRenewalInputs: string[] = [];
      if (requiresProviderSubscription && !providerPlanCode) {
        missingRenewalInputs.push("provider_plan_code");
      }
      if (requiresProviderSubscription && !customerCode) {
        missingRenewalInputs.push("provider_customer_id");
      }
      if (requiresProviderSubscription && !resolvedAuthCode) {
        missingRenewalInputs.push("authorization_code");
      }
      let renewalSetupFailureReason: string | null =
        missingRenewalInputs.length > 0
          ? `missing_${missingRenewalInputs.join("_")}`
          : null;

      if (requiresProviderSubscription && !renewalSetupFailureReason) {
        try {
          const subResult = await step.do(
            "create-provider-subscription",
            {
              retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
            },
            async () => {
              const adapter = this.deps.getAdapter(providerId);
              if (!adapter)
                throw new Error(`No adapter for provider: ${providerId}`);

              const startDate = new Date(subscriptionPeriodEnd);

              const result = await adapter.createSubscription({
                customer: {
                  id: customerCode!,
                  email: email || customer!.email,
                },
                plan: { id: providerPlanCode! },
                authorizationCode: resolvedAuthCode,
                startDate: startDate.toISOString(),
                environment: accountData.environment as "test" | "live",
                account: accountData as unknown as ProviderAccount,
                metadata: {
                  subscription_id: subscriptionId,
                  trial_conversion: true,
                },
              });

              if (result.isErr()) {
                throw new Error(
                  `Create subscription failed: ${result.error.message}`,
                );
              }

              console.log(
                `[TrialEndWorkflow] Provider subscription created: ${result.value.id}, next charge at ${startDate.toISOString()}`,
              );
              return result.value.id;
            },
          );
          providerSubCode = subResult;
        } catch (subErr) {
          renewalSetupFailureReason =
            subErr instanceof Error ? subErr.message : String(subErr);
          // Non-fatal — subscription is active locally, just no auto-renewal
          console.error(
            `[TrialEndWorkflow] Failed to create provider subscription: subscription=${subscriptionId}`,
            subErr,
          );
        }
      } else if (renewalSetupFailureReason) {
        console.error(
          `[TrialEndWorkflow] Missing recurring renewal inputs for subscription=${subscriptionId}: ${renewalSetupFailureReason}`,
        );
      }

      // Step 6c: Activate subscription in DB (+ update provider sub code if created)
      await step.do("activate-subscription", async () => {
        const now = Date.now();
        const paystackSubCode =
          providerId === "paystack" ? providerSubCode : null;
        const cancelAt =
          requiresProviderSubscription && !providerSubCode
            ? subscriptionPeriodEnd
            : null;

        await this.env.DB.prepare(
          `UPDATE subscriptions
           SET status = 'active',
               provider_subscription_id = COALESCE(?, provider_subscription_id),
               provider_subscription_code = COALESCE(?, provider_subscription_code),
               paystack_subscription_code = COALESCE(?, paystack_subscription_code),
               current_period_start = ?,
               current_period_end = ?,
               cancel_at = ?,
               updated_at = ?
           WHERE id = ? AND status = 'trialing'`,
        )
          .bind(
            providerSubCode,
            providerSubCode,
            paystackSubCode,
            now,
            subscriptionPeriodEnd,
            cancelAt,
            now,
            subscriptionId,
          )
          .run();

        if (cancelAt) {
          console.warn(
            `[TrialEndWorkflow] Activated without recurring renewal: subscription=${subscriptionId}, cancelAt=${new Date(cancelAt).toISOString()}, reason=${renewalSetupFailureReason || "provider_subscription_missing"}`,
          );
        } else {
          console.log(
            `[TrialEndWorkflow] Activated: subscription=${subscriptionId}, providerSub=${providerSubCode || "none"}`,
          );
        }
        await this.deps.invalidateSubscriptionCache(
          this.env,
          organizationId,
          customerId,
        );
      });

      if (requiresProviderSubscription && !providerSubCode) {
        let retryScheduled = false;

        if (this.env.RENEWAL_SETUP_WORKFLOW) {
          try {
            const workflow = await this.env.RENEWAL_SETUP_WORKFLOW.create({
              params: {
                subscriptionId,
                customerId,
                organizationId,
                providerId,
                source: "trial_end",
                immediate: false,
              },
            });
            retryScheduled = true;
            console.log(
              `[TrialEndWorkflow] Scheduled renewal setup retry workflow ${workflow.id} for subscription=${subscriptionId}`,
            );
          } catch (retryErr) {
            console.error(
              `[TrialEndWorkflow] Failed to schedule renewal setup retry for subscription=${subscriptionId}`,
              retryErr,
            );
          }
        }

        await step.do("record-renewal-setup-state", async () => {
          const row = await this.env.DB.prepare(
            "SELECT metadata FROM subscriptions WHERE id = ? LIMIT 1",
          )
            .bind(subscriptionId)
            .first<{ metadata: unknown }>();
          const now = Date.now();
          const nextAttemptAt = retryScheduled
            ? now + RENEWAL_SETUP_RETRY_DELAYS_MS[0]
            : null;
          const nextMetadata = writeRenewalSetupMetadata(row?.metadata, {
            renewal_setup_status: retryScheduled ? "scheduled" : "failed",
            renewal_setup_retry_count: 0,
            renewal_setup_last_error:
              renewalSetupFailureReason || "provider_subscription_missing",
            renewal_setup_last_attempt_at: now,
            renewal_setup_next_attempt_at: nextAttemptAt,
            renewal_setup_updated_at: now,
            renewal_setup_last_source: "trial_end",
          });

          await this.env.DB.prepare(
            "UPDATE subscriptions SET metadata = ?, updated_at = ? WHERE id = ?",
          )
            .bind(JSON.stringify(nextMetadata), now, subscriptionId)
            .run();
        });
      }

      // Step 6d: Re-provision entitlements (idempotent — ensures features are current)
      await step.do("provision-entitlements", async () => {
        await this.deps.provisionEntitlements(this.env, customerId, planId);
        console.log(
          `[TrialEndWorkflow] Entitlements provisioned: customer=${customerId}, plan=${planId}`,
        );
      });
    } else {
      // Step 6b: Charge failed after all retries — expire the subscription
      await step.do("expire-charge-failed", async () => {
        const now = Date.now();
        await this.env.DB.prepare(
          "UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'trialing'",
        )
          .bind(now, subscriptionId)
          .run();
        await this.deps.invalidateSubscriptionCache(
          this.env,
          organizationId,
          customerId,
        );
        console.log(
          `[TrialEndWorkflow] Expired (charge failed): subscription=${subscriptionId}`,
        );
      });
    }
  }
}
