import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent,
} from "cloudflare:workers";
import type { WorkflowEnv } from "./utils";
import {
  getAdapter,
  intervalToMs,
  invalidateSubscriptionCache,
  resolveProviderAccount,
} from "./utils";
import type { ProviderAccount } from "@owostack/adapters";
import { createDb } from "@owostack/db";
import { getMinimumChargeAmount } from "../provider-minimums";
import { BillingService } from "../billing";
import { updateBillingRun, getBillingRun } from "../billing-runs";
import {
  blockCustomerOverage,
  clearCustomerOverageBlock,
} from "../overage-blocks";
import {
  PAID_SUBSCRIPTION_PERIOD_GRACE_MS,
  isPaidActivePastGracePeriod,
  isPlaceholderSubscriptionCode,
} from "../subscription-health";

export type OverageBillingWorkflowDependencies = {
  getAdapter: typeof getAdapter;
  intervalToMs: typeof intervalToMs;
  invalidateSubscriptionCache: typeof invalidateSubscriptionCache;
  resolveProviderAccount: typeof resolveProviderAccount;
  createDb: typeof createDb;
  createBillingService: (
    db: ReturnType<typeof createDb>,
    options: { usageLedger: WorkflowEnv["USAGE_LEDGER"] },
  ) => Pick<BillingService, "getUnbilledUsage" | "createInvoiceFromUsage">;
};

const defaultDependencies: OverageBillingWorkflowDependencies = {
  getAdapter,
  intervalToMs,
  invalidateSubscriptionCache,
  resolveProviderAccount,
  createDb,
  createBillingService: (db, options) => new BillingService(db, options),
};

// Serializable snapshot of ProviderAccount
interface ResolvedAccount {
  id: string;
  organizationId: string;
  providerId: string;
  environment: string;
  credentials: { secretKey?: string; [k: string]: string | undefined };
  createdAt: number;
  updatedAt: number;
}

interface DueFreeSubscriptionRow {
  id: string;
  current_period_end: number;
  interval: string | null;
}

interface DuePaidSubscriptionRow {
  id: string;
  customer_id: string;
  provider_id: string | null;
  provider_subscription_code: string | null;
  paystack_subscription_code: string | null;
  current_period_end: number;
}

export function rollPeriodForward(
  currentPeriodEnd: number,
  interval: string,
  now: number = Date.now(),
): { nextPeriodStart: number; nextPeriodEnd: number } {
  const periodMs = defaultDependencies.intervalToMs(interval);

  let nextPeriodStart = currentPeriodEnd;
  let nextPeriodEnd = currentPeriodEnd + periodMs;
  while (nextPeriodEnd <= now) {
    nextPeriodStart = nextPeriodEnd;
    nextPeriodEnd += periodMs;
  }

  return { nextPeriodStart, nextPeriodEnd };
}

function safeParseDate(value: unknown): number {
  if (!value || typeof value !== "string") return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export function deriveReconciledPeriodStart(
  currentPeriodEnd: number,
  nextPaymentMs: number,
  providerStartDate: unknown,
): number {
  const providerStartMs = safeParseDate(providerStartDate);
  if (!providerStartMs) return currentPeriodEnd;
  if (providerStartMs < currentPeriodEnd) return currentPeriodEnd;
  if (providerStartMs >= nextPaymentMs) return currentPeriodEnd;
  return providerStartMs;
}

function normalizeProviderStatus(value: unknown): string {
  if (!value || typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function isTerminalProviderStatus(status: string): boolean {
  return (
    status.includes("cancel") ||
    status.includes("expired") ||
    status.includes("unpaid") ||
    status.includes("revoked") ||
    status.includes("terminated") ||
    status === "inactive" ||
    status === "failed" ||
    status === "completed"
  );
}

function isPendingProviderStatus(status: string): boolean {
  return (
    status === "past_due" ||
    status === "on_hold" ||
    status === "paused" ||
    status === "attention" ||
    status === "pending_cancel" ||
    status === "non_renewing" ||
    status === "not_renew" ||
    status.includes("past_due") ||
    status.includes("non_renew")
  );
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export interface OverageBillingParams {
  organizationId: string;
  customerId: string;
  /** Trigger reason: scheduled cron, threshold crossed, or period end */
  trigger: "cron" | "threshold" | "period_end" | "reconcile_only";
  billingRunId?: string;
}

// ---------------------------------------------------------------------------
// OverageBillingWorkflow
//
// Calculates unbilled overage → generates invoice → optionally charges card.
// Each step is individually retryable and durable.
// ---------------------------------------------------------------------------

export class OverageBillingWorkflow extends WorkflowEntrypoint<
  WorkflowEnv,
  OverageBillingParams
> {
  static dependencies: OverageBillingWorkflowDependencies = defaultDependencies;

  private get deps() {
    return OverageBillingWorkflow.dependencies;
  }

  private async advanceDueFreeSubscriptionPeriods(
    step: WorkflowStep,
    organizationId: string,
    customerId: string,
  ): Promise<void> {
    const now = Date.now();
    const dueSubscriptions = await step.do(
      "load-due-free-subscriptions",
      async () => {
        const rows = await this.env.DB.prepare(
          `SELECT s.id, s.current_period_end, p.interval
           FROM subscriptions s
           INNER JOIN plans p ON p.id = s.plan_id
           INNER JOIN customers c ON c.id = s.customer_id
           WHERE s.customer_id = ?
             AND c.organization_id = ?
             AND s.status = 'active'
             AND p.type = 'free'
             AND s.current_period_end <= ?`,
        )
          .bind(customerId, organizationId, now)
          .all<DueFreeSubscriptionRow>();

        return rows.results || [];
      },
    );

    if (dueSubscriptions.length === 0) {
      console.log(
        `[OverageBilling] No due free subscriptions to roll forward for customer=${customerId}.`,
      );
      return;
    }

    const advancedCount = await step.do(
      "roll-forward-free-subscription-periods",
      async () => {
        const updateNow = Date.now();
        let count = 0;

        for (const sub of dueSubscriptions) {
          const { nextPeriodStart, nextPeriodEnd } = rollPeriodForward(
            sub.current_period_end,
            sub.interval || "monthly",
            updateNow,
          );

          const result = await this.env.DB.prepare(
            `UPDATE subscriptions
             SET current_period_start = ?, current_period_end = ?, updated_at = ?
             WHERE id = ? AND current_period_end = ?`,
          )
            .bind(
              nextPeriodStart,
              nextPeriodEnd,
              updateNow,
              sub.id,
              sub.current_period_end,
            )
            .run();

          if (Number((result as any)?.meta?.changes || 0) > 0) {
            count += 1;
            console.log(
              `[OverageBilling] Rolled free sub ${sub.id} forward: ${new Date(nextPeriodStart).toISOString()} -> ${new Date(nextPeriodEnd).toISOString()}`,
            );
          }
        }

        return count;
      },
    );

    if (advancedCount > 0) {
      await step.do("invalidate-period-end-subscription-cache", async () => {
        await this.deps.invalidateSubscriptionCache(
          this.env,
          organizationId,
          customerId,
        );
      });
    }
  }

  private async reconcileDuePaidSubscriptionPeriods(
    step: WorkflowStep,
    organizationId: string,
    customerId: string,
    options?: { allowPeriodAdvance?: boolean },
  ): Promise<void> {
    const allowPeriodAdvance = options?.allowPeriodAdvance !== false;
    const now = Date.now();
    const dueSubscriptions = await step.do(
      "load-due-paid-subscriptions",
      async () => {
        const rows = await this.env.DB.prepare(
          `SELECT s.id,
                  s.customer_id,
                  s.provider_id,
                  s.provider_subscription_code,
                  s.paystack_subscription_code,
                  s.current_period_end
           FROM subscriptions s
           INNER JOIN plans p ON p.id = s.plan_id
           INNER JOIN customers c ON c.id = s.customer_id
           WHERE s.customer_id = ?
             AND c.organization_id = ?
             AND s.status = 'active'
             AND p.type != 'free'
             AND s.current_period_end <= ?`,
        )
          .bind(customerId, organizationId, now)
          .all<DuePaidSubscriptionRow>();

        return rows.results || [];
      },
    );

    if (dueSubscriptions.length === 0) {
      return;
    }

    const advancedCount = await step.do(
      "reconcile-paid-subscription-periods",
      async () => {
        let count = 0;
        const updatedAt = Date.now();
        const maybeMarkPastDueIfStale = async (
          sub: DuePaidSubscriptionRow,
          reason: string,
        ) => {
          if (
            !isPaidActivePastGracePeriod(
              {
                status: "active",
                currentPeriodEnd: sub.current_period_end,
                planType: "paid",
              },
              now,
              PAID_SUBSCRIPTION_PERIOD_GRACE_MS,
            )
          ) {
            return;
          }

          const result = await this.env.DB.prepare(
            `UPDATE subscriptions
             SET status = 'past_due',
                 updated_at = ?
             WHERE id = ? AND status = 'active'`,
          )
            .bind(updatedAt, sub.id)
            .run();

          if (Number((result as any)?.meta?.changes || 0) > 0) {
            count += 1;
            console.warn(
              `[OverageBilling] Marked paid sub ${sub.id} as past_due after reconcile gap (${reason}).`,
            );
          }
        };

        for (const sub of dueSubscriptions) {
          const providerId = sub.provider_id || null;
          const subCode =
            sub.provider_subscription_code || sub.paystack_subscription_code;

          if (
            !providerId ||
            !subCode ||
            isPlaceholderSubscriptionCode(subCode)
          ) {
            await maybeMarkPastDueIfStale(sub, "missing_provider_link");
            continue;
          }

          const adapter = this.deps.getAdapter(providerId);
          if (!adapter) {
            console.warn(
              `[OverageBilling] Reconcile skipped: no adapter for provider=${providerId}, sub=${sub.id}`,
            );
            await maybeMarkPastDueIfStale(sub, "missing_provider_adapter");
            continue;
          }

          const account = await this.deps.resolveProviderAccount(
            this.env,
            organizationId,
            providerId,
          );
          if (!account) {
            console.warn(
              `[OverageBilling] Reconcile skipped: no provider account for org=${organizationId}, provider=${providerId}`,
            );
            await maybeMarkPastDueIfStale(sub, "missing_provider_account");
            continue;
          }

          let fetchResult: Awaited<
            ReturnType<typeof adapter.fetchSubscription>
          >;
          try {
            fetchResult = await adapter.fetchSubscription({
              subscriptionId: subCode,
              environment: account.environment as "test" | "live",
              account: account as unknown as ProviderAccount,
            });
          } catch (error) {
            console.warn(
              `[OverageBilling] Reconcile provider lookup failed for sub=${sub.id} code=${subCode}:`,
              error,
            );
            await maybeMarkPastDueIfStale(sub, "provider_lookup_exception");
            continue;
          }

          if (fetchResult.isErr()) {
            console.warn(
              `[OverageBilling] Reconcile provider lookup error for sub=${sub.id} code=${subCode}: ${fetchResult.error.message}`,
            );
            await maybeMarkPastDueIfStale(sub, "provider_lookup_error");
            continue;
          }

          const normalizedStatus = normalizeProviderStatus(
            fetchResult.value.status,
          );

          if (isTerminalProviderStatus(normalizedStatus)) {
            const result = await this.env.DB.prepare(
              `UPDATE subscriptions
               SET status = 'canceled',
                   canceled_at = COALESCE(canceled_at, ?),
                   updated_at = ?
               WHERE id = ? AND status = 'active'`,
            )
              .bind(updatedAt, updatedAt, sub.id)
              .run();

            if (Number((result as any)?.meta?.changes || 0) > 0) {
              count += 1;
              console.log(
                `[OverageBilling] Reconciled paid sub ${sub.id} to canceled (provider status=${normalizedStatus})`,
              );
            }
            continue;
          }

          if (isPendingProviderStatus(normalizedStatus)) {
            const result = await this.env.DB.prepare(
              `UPDATE subscriptions
               SET status = 'pending_cancel',
                   cancel_at = ?,
                   updated_at = ?
               WHERE id = ? AND status = 'active'`,
            )
              .bind(sub.current_period_end, updatedAt, sub.id)
              .run();

            if (Number((result as any)?.meta?.changes || 0) > 0) {
              count += 1;
              console.log(
                `[OverageBilling] Reconciled paid sub ${sub.id} to pending_cancel (provider status=${normalizedStatus})`,
              );
            }
            continue;
          }

          const nextPaymentMs = safeParseDate(
            fetchResult.value.nextPaymentDate,
          );
          if (!allowPeriodAdvance) {
            continue;
          }
          if (!nextPaymentMs || nextPaymentMs <= sub.current_period_end) {
            await maybeMarkPastDueIfStale(
              sub,
              !nextPaymentMs
                ? "missing_next_payment_date"
                : "non_advancing_next_payment_date",
            );
            continue;
          }

          const nextPeriodStart = deriveReconciledPeriodStart(
            sub.current_period_end,
            nextPaymentMs,
            fetchResult.value.startDate,
          );
          const nextPeriodEnd = nextPaymentMs;

          const result = await this.env.DB.prepare(
            `UPDATE subscriptions
             SET status = 'active',
                 current_period_start = ?,
                 current_period_end = ?,
                 updated_at = ?
             WHERE id = ? AND current_period_end = ?`,
          )
            .bind(
              nextPeriodStart,
              nextPeriodEnd,
              updatedAt,
              sub.id,
              sub.current_period_end,
            )
            .run();

          if (Number((result as any)?.meta?.changes || 0) > 0) {
            count += 1;

            // Finalize deferred entity removals once renewal is confirmed.
            await this.env.DB.prepare(
              `DELETE FROM entities
               WHERE customer_id = ? AND status = 'pending_removal'`,
            )
              .bind(sub.customer_id)
              .run();

            console.log(
              `[OverageBilling] Reconciled paid sub ${sub.id} via provider ${providerId}, newEnd=${new Date(nextPeriodEnd).toISOString()}`,
            );
          }
        }

        return count;
      },
    );

    if (advancedCount > 0) {
      await step.do(
        "invalidate-paid-reconcile-subscription-cache",
        async () => {
          await this.deps.invalidateSubscriptionCache(
            this.env,
            organizationId,
            customerId,
          );
        },
      );
    }
  }

  async run(event: WorkflowEvent<OverageBillingParams>, step: WorkflowStep) {
    const { organizationId, customerId, trigger, billingRunId } = event.payload;

    console.log(
      `[OverageBilling] Starting: customer=${customerId}, org=${organizationId}, trigger=${trigger}`,
    );

    let thresholdRun: Awaited<ReturnType<typeof getBillingRun>> | null = null;
    let thresholdRunInvoiceId: string | null = null;

    const mergeThresholdMetadata = (
      extra?: Record<string, unknown> | null,
    ): Record<string, unknown> | null => {
      if (extra === null) return null;

      const base =
        thresholdRun?.metadata &&
        typeof thresholdRun.metadata === "object" &&
        !Array.isArray(thresholdRun.metadata)
          ? (thresholdRun.metadata as Record<string, unknown>)
          : {};

      return {
        ...base,
        ...(extra || {}),
      };
    };

    const updateThresholdRunState = async (
      stepName: string,
      updates: Parameters<typeof updateBillingRun>[2],
    ) => {
      if (!thresholdRun) return;

      const refreshedRun = await step.do(stepName, async () => {
        const db = this.deps.createDb(this.env.DB);
        await updateBillingRun(db, thresholdRun!.id, {
          ...updates,
          ...(updates.metadata !== undefined
            ? { metadata: mergeThresholdMetadata(updates.metadata) }
            : {}),
        });
        return await getBillingRun(db, thresholdRun!.id);
      });

      thresholdRun = refreshedRun ?? thresholdRun;
      thresholdRunInvoiceId = thresholdRun?.invoiceId ?? thresholdRunInvoiceId;
    };

    const completeThresholdRun = async (
      stepName: string,
      metadata?: Record<string, unknown>,
    ) => {
      if (!thresholdRun) return;
      await updateThresholdRunState(stepName, {
        status: "completed",
        invoiceId: thresholdRunInvoiceId,
        activeLockKey: null,
        failureReason: null,
        metadata,
      });
    };

    const deferThresholdRun = async (
      stepName: string,
      reason: string,
      metadata?: Record<string, unknown>,
    ) => {
      if (!thresholdRun) return;
      await updateThresholdRunState(stepName, {
        status: "deferred",
        invoiceId: thresholdRunInvoiceId,
        activeLockKey: null,
        failureReason: reason,
        metadata,
      });
    };

    const clearThresholdBlockAndComplete = async (
      stepName: string,
      metadata?: Record<string, unknown>,
    ) => {
      if (!thresholdRun) return;

      const refreshedRun = await step.do(stepName, async () => {
        const db = this.deps.createDb(this.env.DB);
        await clearCustomerOverageBlock(db, customerId);
        await updateBillingRun(db, thresholdRun!.id, {
          status: "completed",
          invoiceId: thresholdRunInvoiceId,
          activeLockKey: null,
          failureReason: null,
          metadata: mergeThresholdMetadata(metadata),
        });
        return await getBillingRun(db, thresholdRun!.id);
      });

      thresholdRun = refreshedRun ?? thresholdRun;
      thresholdRunInvoiceId = thresholdRun?.invoiceId ?? thresholdRunInvoiceId;
    };

    const blockThresholdRun = async (
      stepName: string,
      reason: string,
      metadata?: Record<string, unknown>,
    ) => {
      if (!thresholdRun) return;

      const refreshedRun = await step.do(stepName, async () => {
        const db = this.deps.createDb(this.env.DB);
        const mergedMetadata = mergeThresholdMetadata(metadata);

        await blockCustomerOverage(db, {
          customerId,
          organizationId,
          billingRunId: thresholdRun!.id,
          invoiceId: thresholdRunInvoiceId,
          reason,
          metadata: mergedMetadata,
        });
        await updateBillingRun(db, thresholdRun!.id, {
          status: "blocked",
          invoiceId: thresholdRunInvoiceId,
          activeLockKey: null,
          failureReason: reason,
          metadata: mergedMetadata,
        });

        return await getBillingRun(db, thresholdRun!.id);
      });

      thresholdRun = refreshedRun ?? thresholdRun;
      thresholdRunInvoiceId = thresholdRun?.invoiceId ?? thresholdRunInvoiceId;
    };

    try {
      // Step 1: Load overage settings for this org
      const settings = await step.do("load-overage-settings", async () => {
        const row = await this.env.DB.prepare(
          "SELECT * FROM overage_settings WHERE organization_id = ? LIMIT 1",
        )
          .bind(organizationId)
          .first<{
            billing_interval: string;
            threshold_amount: number | null;
            auto_collect: number;
            grace_period_hours: number;
          }>();

        return (
          row || {
            billing_interval: "end_of_period",
            threshold_amount: null,
            auto_collect: 0,
            grace_period_hours: 0,
          }
        );
      });

      // Reconciliation-only runs provider checks without billing side effects.
      if (trigger === "reconcile_only") {
        return;
      }

      if (trigger === "threshold") {
        if (!billingRunId) {
          console.warn(
            `[OverageBilling] Threshold trigger missing billingRunId for customer=${customerId}.`,
          );
          return;
        }

        thresholdRun = await step.do("load-threshold-billing-run", async () => {
          const db = this.deps.createDb(this.env.DB);
          return await getBillingRun(db, billingRunId);
        });

        if (!thresholdRun) {
          console.warn(
            `[OverageBilling] Threshold billing run ${billingRunId} not found for customer=${customerId}.`,
          );
          return;
        }

        thresholdRunInvoiceId = thresholdRun.invoiceId ?? null;

        if (
          thresholdRun.status === "completed" ||
          thresholdRun.status === "blocked" ||
          thresholdRun.status === "failed" ||
          thresholdRun.status === "deferred"
        ) {
          console.log(
            `[OverageBilling] Threshold billing run ${thresholdRun.id} already ${thresholdRun.status}.`,
          );
          return;
        }

        if (thresholdRun.status !== "processing") {
          await updateThresholdRunState("mark-threshold-run-processing", {
            status: "processing",
            invoiceId: thresholdRunInvoiceId,
            failureReason: null,
          });
        }

        if (!settings.auto_collect) {
          await updateThresholdRunState("fail-threshold-run-auto-collect", {
            status: "failed",
            invoiceId: thresholdRunInvoiceId,
            activeLockKey: null,
            failureReason: "threshold_requires_auto_collect",
            metadata: {
              outcome: "threshold_requires_auto_collect",
            },
          });
          return;
        }
      }

      // Step 2: Grace delay is only for recurring/threshold billing triggers.
      // Period-end renewal/reconciliation should not be delayed by grace windows.
      if (
        settings.grace_period_hours > 0 &&
        (trigger === "cron" || trigger === "threshold")
      ) {
        const waitMs = settings.grace_period_hours * 60 * 60 * 1000;
        console.log(
          `[OverageBilling] Waiting grace period: ${settings.grace_period_hours}h`,
        );
        await step.sleep("grace-period-wait", waitMs);
      }

      // Step 3: Calculate unbilled overage usage
      const unbilled = await step.do("calculate-unbilled-usage", async () => {
        const db = this.deps.createDb(this.env.DB);
        const billingService = this.deps.createBillingService(db, {
          usageLedger: this.env.USAGE_LEDGER,
        });
        const result = await billingService.getUnbilledUsage(
          customerId,
          organizationId,
          thresholdRun
            ? {
                usageCutoffAt: thresholdRun.usageWindowEnd,
              }
            : undefined,
        );
        if (result.isErr()) {
          throw new Error(
            `[OverageBilling] Failed to calculate unbilled usage: ${result.error.message}`,
          );
        }

        return result.value;
      });

      if (unbilled.features.length === 0 || unbilled.totalEstimated === 0) {
        console.log(
          `[OverageBilling] No unbilled usage for customer=${customerId}. Done.`,
        );
        if (thresholdRun) {
          await completeThresholdRun("complete-threshold-run-empty", {
            outcome: "no_billable_usage",
            usageWindowEnd: thresholdRun.usageWindowEnd,
          });
        }
        return;
      }

      console.log(
        `[OverageBilling] Unbilled: ${unbilled.currency} ${unbilled.totalEstimated} across ${unbilled.features.length} features`,
      );

      // Step 3b: Load customer's payment method to get provider for minimum check
      const customerPaymentInfo = await step.do(
        "load-customer-payment-info",
        async () => {
          const pm = await this.env.DB.prepare(
            "SELECT provider_id FROM payment_methods WHERE customer_id = ? AND is_valid = 1 AND is_default = 1 LIMIT 1",
          )
            .bind(customerId)
            .first<{ provider_id: string }>();

          return {
            providerId: pm?.provider_id || null,
          };
        },
      );

      // Check if amount meets provider minimum
      const billingProviderId = customerPaymentInfo.providerId || "unknown";
      const minimumAmount = getMinimumChargeAmount(
        billingProviderId,
        unbilled.currency,
      );

      if (minimumAmount > 0 && unbilled.totalEstimated < minimumAmount) {
        console.log(
          `[OverageBilling] Invoice amount ${unbilled.totalEstimated} ${unbilled.currency} below provider minimum ${minimumAmount}. Leaving usage unbilled so it can accumulate across future periods.`,
        );
        if (thresholdRun) {
          await deferThresholdRun(
            "defer-threshold-run-below-minimum",
            "below_provider_minimum",
            {
              outcome: "below_provider_minimum",
              invoiceAmount: unbilled.totalEstimated,
              minimumAmount,
              currency: unbilled.currency,
              usageWindowEnd: unbilled.usageWindowEnd,
            },
          );
        }
        // Usage remains unstamped, but period reconciliation still runs so future
        // usage keeps the correct billing window instead of collapsing into the
        // expired period.
        return;
      }

      // Step 4: Generate invoice (idempotent — safe to retry)
      const invoice = await step.do("generate-invoice", async () => {
        const db = this.deps.createDb(this.env.DB);
        const billingService = this.deps.createBillingService(db, {
          usageLedger: this.env.USAGE_LEDGER,
        });
        const sourceTrigger =
          trigger === "threshold" ? "threshold" : "period_end";
        const idempotencyKey =
          thresholdRun?.idempotencyKey ||
          `${sourceTrigger}:${organizationId}:${customerId}:${unbilled.usageWindowEnd}`;

        return await billingService.createInvoiceFromUsage(
          customerId,
          organizationId,
          unbilled,
          {
            idempotencyKey,
            sourceTrigger,
            usageWindowStart: thresholdRun?.usageWindowStart ?? null,
          },
        );
      });

      thresholdRunInvoiceId = invoice.invoiceId;

      if (thresholdRun) {
        await updateThresholdRunState("attach-threshold-run-invoice", {
          invoiceId: invoice.invoiceId,
          metadata: {
            outcome: "invoice_created",
            invoiceNumber: invoice.number,
            usageWindowEnd: invoice.usageWindowEnd,
          },
        });
      }

      console.log(
        `[OverageBilling] Invoice ${invoice.number} created: ${invoice.currency} ${invoice.total}`,
      );

      // Step 5: Auto-collect if enabled
      if (!settings.auto_collect) {
        console.log(
          `[OverageBilling] Auto-collect disabled. Invoice ${invoice.number} left as open.`,
        );
        return;
      }

      // Step 5a: Load customer's payment info from payment_methods table
      const customerPayment = await step.do(
        "load-customer-payment",
        async () => {
          const pm = await this.env.DB.prepare(
            "SELECT token, provider_id FROM payment_methods WHERE customer_id = ? AND is_valid = 1 AND is_default = 1 LIMIT 1",
          )
            .bind(customerId)
            .first<{ token: string; provider_id: string }>();

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
            email: customer?.email || null,
            providerId: pm?.provider_id || null,
            authCode: pm?.token || null,
            providerCustomerId:
              customer?.provider_customer_id ||
              customer?.paystack_customer_id ||
              null,
          };
        },
      );

      const authCode = customerPayment?.authCode;
      const providerId = customerPayment?.providerId || "unknown";
      const providerCustomerId =
        customerPayment?.providerCustomerId || customerId;

      if (!authCode || !customerPayment?.email) {
        console.log(
          `[OverageBilling] No payment method for customer=${customerId}. Invoice stays open.`,
        );
        // Record failed attempt
        await step.do("record-no-card-attempt", async () => {
          await this.env.DB.prepare(
            `INSERT INTO payment_attempts (id, invoice_id, amount, currency, status, provider, attempt_number, last_error, created_at)
           VALUES (?, ?, ?, ?, 'failed', ?, 1, 'No payment method on file', ?)`,
          )
            .bind(
              crypto.randomUUID(),
              invoice.invoiceId,
              invoice.total,
              invoice.currency,
              providerId,
              Date.now(),
            )
            .run();
        });

        if (thresholdRun) {
          await blockThresholdRun(
            "block-threshold-run-no-card",
            "no_payment_method_on_file",
            {
              outcome: "no_payment_method_on_file",
              invoiceId: invoice.invoiceId,
              invoiceNumber: invoice.number,
            },
          );
        }
        return;
      }

      // Step 5b: Resolve adapter + provider account
      const accountData: ResolvedAccount | null = await step.do(
        "resolve-provider",
        async () => {
          const account = await this.deps.resolveProviderAccount(
            this.env,
            organizationId,
            providerId,
          );
          if (!account) return null;
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
        console.log(
          `[OverageBilling] No provider account for org=${organizationId}. Invoice stays open.`,
        );
        await step.do("record-no-provider-account-attempt", async () => {
          await this.env.DB.prepare(
            `INSERT INTO payment_attempts (id, invoice_id, amount, currency, status, provider, attempt_number, last_error, created_at)
           VALUES (?, ?, ?, ?, 'failed', ?, 1, 'No provider account configured', ?)`,
          )
            .bind(
              crypto.randomUUID(),
              invoice.invoiceId,
              invoice.total,
              invoice.currency,
              providerId,
              Date.now(),
            )
            .run();
        });

        if (thresholdRun) {
          await blockThresholdRun(
            "block-threshold-run-no-provider-account",
            "no_provider_account_configured",
            {
              outcome: "no_provider_account_configured",
              invoiceId: invoice.invoiceId,
              invoiceNumber: invoice.number,
              providerId,
            },
          );
        }
        return;
      }

      // Step 5c: Re-check invoice status before charging (guards against concurrent
      // workflows — e.g. cron + threshold — both trying to charge the same invoice).
      const invoiceStillOpen = await step.do(
        "pre-charge-status-check",
        async () => {
          const row = await this.env.DB.prepare(
            "SELECT status FROM invoices WHERE id = ? LIMIT 1",
          )
            .bind(invoice.invoiceId)
            .first<{ status: string }>();
          if (row?.status === "paid") {
            return {
              shouldCharge: false,
              reason: "invoice_already_paid" as const,
              status: row.status,
            };
          }
          if (row?.status !== "open") {
            return {
              shouldCharge: false,
              reason: "invoice_not_open" as const,
              status: row?.status || null,
            };
          }

          const successfulAttempt = await this.env.DB.prepare(
            `SELECT provider_reference
             FROM payment_attempts
             WHERE invoice_id = ? AND status = 'succeeded'
             ORDER BY created_at DESC
             LIMIT 1`,
          )
            .bind(invoice.invoiceId)
            .first<{ provider_reference: string | null }>();

          if (successfulAttempt) {
            await this.env.DB.prepare(
              `UPDATE invoices
               SET status = 'paid',
                   amount_paid = ?,
                   amount_due = 0,
                   paid_at = COALESCE(paid_at, ?),
                   updated_at = ?
               WHERE id = ? AND status = 'open'`,
            )
              .bind(invoice.total, Date.now(), Date.now(), invoice.invoiceId)
              .run();

            return {
              shouldCharge: false,
              reason: "payment_attempt_already_succeeded" as const,
              status: "paid",
            };
          }

          return { shouldCharge: true, reason: null, status: "open" };
        },
      );

      if (!invoiceStillOpen.shouldCharge) {
        console.log(
          `[OverageBilling] Invoice ${invoice.number} charge skipped (${invoiceStillOpen.reason}).`,
        );
        if (
          thresholdRun &&
          (invoiceStillOpen.reason === "invoice_already_paid" ||
            invoiceStillOpen.reason === "payment_attempt_already_succeeded")
        ) {
          await clearThresholdBlockAndComplete(
            "complete-threshold-run-paid-before-charge",
            {
              outcome: invoiceStillOpen.reason,
              invoiceId: invoice.invoiceId,
              invoiceNumber: invoice.number,
            },
          );
        } else if (thresholdRun) {
          await completeThresholdRun(
            "complete-threshold-run-non-open-invoice",
            {
              outcome: invoiceStillOpen.reason,
              invoiceId: invoice.invoiceId,
              invoiceNumber: invoice.number,
              invoiceStatus: invoiceStillOpen.status,
            },
          );
        }
        return;
      }

      // Charge the card (manual retries — never throw from step.do
      // to avoid Cloudflare Workflows treating exhausted retries as terminal failure).
      const MAX_CHARGE_ATTEMPTS = 3;
      let chargeSucceeded = false;
      let chargeRef: string | null = null;
      let lastError = "";
      let attemptsMade = 0;

      for (let attempt = 0; attempt < MAX_CHARGE_ATTEMPTS; attempt++) {
        attemptsMade = attempt + 1;
        const result = await step.do(
          `charge-card-attempt-${attempt}`,
          async () => {
            const adapter = this.deps.getAdapter(providerId);
            if (!adapter) {
              return {
                success: false as const,
                error: `No adapter for provider: ${providerId}`,
                retryable: false,
                reference: null,
              };
            }

            try {
              const chargeResult = await adapter.chargeAuthorization({
                customer: {
                  id: providerCustomerId,
                  email: customerPayment!.email!,
                },
                authorizationCode: authCode!,
                amount: invoice.total,
                currency: invoice.currency,
                reference: invoice.invoiceId,
                metadata: {
                  invoice_id: invoice.invoiceId,
                  invoice_number: invoice.number,
                  type: "overage_billing",
                  organization_id: organizationId,
                  customer_id: customerId,
                  billing_run_id: thresholdRun?.id ?? null,
                },
                environment: accountData.environment as "test" | "live",
                account: accountData as unknown as ProviderAccount,
              });

              if (chargeResult.isErr()) {
                const errCode = chargeResult.error.code || "";
                const errMsg =
                  chargeResult.error.message ||
                  JSON.stringify(chargeResult.error);
                const permanent =
                  /invalid_authorization|validation_error|invalid_request/.test(
                    errCode,
                  ) ||
                  /invalid_authorization|validation_error|invalid_request|authorization.*(invalid|expired|not found)|customer id/i.test(
                    errMsg,
                  );
                console.error(
                  `[OverageBilling] Charge attempt ${attempt} failed: ${errMsg} (code=${errCode || "unknown"}, permanent=${permanent})`,
                );
                return {
                  success: false as const,
                  error: errMsg,
                  retryable: !permanent,
                  reference: null,
                };
              }

              console.log(
                `[OverageBilling] Charge succeeded: ref=${chargeResult.value.reference}`,
              );
              return {
                success: true as const,
                error: "",
                retryable: false,
                reference: chargeResult.value.reference,
              };
            } catch (networkErr: any) {
              console.error(
                `[OverageBilling] Charge attempt ${attempt} threw: ${networkErr.message}`,
              );
              return {
                success: false as const,
                error: networkErr.message,
                retryable: true,
                reference: null,
              };
            }
          },
        );

        if (result.success) {
          chargeSucceeded = true;
          chargeRef = result.reference;
          break;
        }

        lastError = result.error;
        if (!result.retryable) break;

        if (attempt < MAX_CHARGE_ATTEMPTS - 1) {
          const delayMs = 30_000 * Math.pow(2, attempt);
          await step.sleep(`charge-retry-wait-${attempt}`, delayMs);
        }
      }

      if (!chargeSucceeded) {
        console.error(
          `[OverageBilling] All charge attempts failed for invoice=${invoice.number}: ${lastError}`,
        );
      }

      // Step 5d: Record payment attempt + update invoice status
      await step.do("record-payment", async () => {
        const now = Date.now();

        await this.env.DB.prepare(
          `INSERT INTO payment_attempts (id, invoice_id, amount, currency, status, provider, provider_reference, attempt_number, last_error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            crypto.randomUUID(),
            invoice.invoiceId,
            invoice.total,
            invoice.currency,
            chargeSucceeded ? "succeeded" : "failed",
            providerId,
            chargeRef,
            attemptsMade,
            chargeSucceeded ? null : lastError || "Charge failed after retries",
            now,
          )
          .run();

        if (chargeSucceeded) {
          await this.env.DB.prepare(
            "UPDATE invoices SET status = 'paid', amount_paid = ?, amount_due = 0, updated_at = ? WHERE id = ?",
          )
            .bind(invoice.total, now, invoice.invoiceId)
            .run();
          console.log(
            `[OverageBilling] Invoice ${invoice.number} marked as paid.`,
          );
        } else {
          // Leave as open — can be retried or paid manually
          console.log(
            `[OverageBilling] Invoice ${invoice.number} remains open (charge failed).`,
          );
        }
      });

      if (chargeSucceeded) {
        if (thresholdRun) {
          await clearThresholdBlockAndComplete(
            "complete-threshold-run-charge-succeeded",
            {
              outcome: "charge_succeeded",
              invoiceId: invoice.invoiceId,
              invoiceNumber: invoice.number,
              providerReference: chargeRef,
            },
          );
        }
      } else if (thresholdRun) {
        await blockThresholdRun(
          "block-threshold-run-charge-failed",
          "threshold_charge_failed",
          {
            outcome: "threshold_charge_failed",
            invoiceId: invoice.invoiceId,
            invoiceNumber: invoice.number,
            lastError: lastError || "Charge failed after retries",
          },
        );
      }
    } catch (error) {
      if (thresholdRun) {
        const failureReason =
          error instanceof Error ? error.message : "threshold_billing_failed";

        await blockThresholdRun(
          "block-threshold-run-unexpected-error",
          failureReason,
          {
            outcome: "threshold_billing_failed",
            invoiceId: thresholdRunInvoiceId,
            error: failureReason,
          },
        );
      }

      throw error;
    } finally {
      if (trigger === "period_end") {
        await this.advanceDueFreeSubscriptionPeriods(
          step,
          organizationId,
          customerId,
        );
        await this.reconcileDuePaidSubscriptionPeriods(
          step,
          organizationId,
          customerId,
        );
      } else if (trigger === "reconcile_only") {
        await this.reconcileDuePaidSubscriptionPeriods(
          step,
          organizationId,
          customerId,
        );
      } else if (trigger === "cron") {
        await this.reconcileDuePaidSubscriptionPeriods(
          step,
          organizationId,
          customerId,
        );
      }
    }
  }
}
