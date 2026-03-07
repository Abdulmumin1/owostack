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
import { buildMeteredInvoiceLineData } from "../invoice-line-items";
import { markUsageInvoiced } from "../usage-ledger";
import {
  PAID_SUBSCRIPTION_PERIOD_GRACE_MS,
  isPaidActivePastGracePeriod,
  isPlaceholderSubscriptionCode,
} from "../subscription-health";

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
  const periodMs = intervalToMs(interval);

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
        await invalidateSubscriptionCache(this.env, organizationId, customerId);
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

          const adapter = getAdapter(providerId);
          if (!adapter) {
            console.warn(
              `[OverageBilling] Reconcile skipped: no adapter for provider=${providerId}, sub=${sub.id}`,
            );
            await maybeMarkPastDueIfStale(sub, "missing_provider_adapter");
            continue;
          }

          const account = await resolveProviderAccount(
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
          await invalidateSubscriptionCache(
            this.env,
            organizationId,
            customerId,
          );
        },
      );
    }
  }

  async run(event: WorkflowEvent<OverageBillingParams>, step: WorkflowStep) {
    const { organizationId, customerId, trigger } = event.payload;
    let deferPaidReconcile = false;

    console.log(
      `[OverageBilling] Starting: customer=${customerId}, org=${organizationId}, trigger=${trigger}`,
    );

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
        const db = createDb(this.env.DB);
        const billingService = new BillingService(db, {
          usageLedger: this.env.USAGE_LEDGER,
        });
        const result = await billingService.getUnbilledUsage(
          customerId,
          organizationId,
        );
        if (result.isErr()) {
          console.warn(
            `[OverageBilling] Failed to calculate unbilled usage: ${result.error.message}`,
          );
          return { features: [], totalEstimated: 0, currency: "USD" };
        }

        return result.value;
      });

      if (unbilled.features.length === 0 || unbilled.totalEstimated === 0) {
        console.log(
          `[OverageBilling] No unbilled usage for customer=${customerId}. Done.`,
        );
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
        deferPaidReconcile = true;
        console.log(
          `[OverageBilling] Invoice amount ${unbilled.totalEstimated} ${unbilled.currency} below provider minimum ${minimumAmount}. Accumulating for next billing cycle.`,
        );
        // Usage records remain unstamped - they will accumulate for next billing cycle
        return;
      }

      // Step 4: Generate invoice (idempotent — safe to retry)
      const invoice = await step.do("generate-invoice", async () => {
        const now = Date.now();
        const periodStart = Math.min(
          ...unbilled.features.map((f) => f.periodStart),
        );
        const periodEnd = Math.max(
          ...unbilled.features.map((f) => f.periodEnd),
        );

        // Idempotency: check if an invoice already exists for this customer/period
        // This prevents duplicate invoices if the workflow retries after a crash.
        const existing = await this.env.DB.prepare(
          `SELECT id, number, total, currency FROM invoices
         WHERE customer_id = ? AND organization_id = ? AND period_start = ? AND period_end = ?
           AND status IN ('open', 'paid')
         LIMIT 1`,
        )
          .bind(customerId, organizationId, periodStart, periodEnd)
          .first<{
            id: string;
            number: string;
            total: number;
            currency: string;
          }>();

        let invoiceId: string;
        let invoiceNumber: string;

        if (existing) {
          console.log(
            `[OverageBilling] Existing invoice found: ${existing.number} — completing any missing line items`,
          );
          invoiceId = existing.id;
          invoiceNumber = existing.number;
        } else {
          // Get invoice count for numbering
          const countResult = await this.env.DB.prepare(
            "SELECT COUNT(*) as count FROM invoices WHERE organization_id = ?",
          )
            .bind(organizationId)
            .first<{ count: number }>();
          const seq = String((countResult?.count || 0) + 1).padStart(5, "0");
          const suffix = crypto.randomUUID().slice(0, 4).toUpperCase();
          invoiceNumber = `INV-${seq}-${suffix}`;

          invoiceId = crypto.randomUUID();

          // Create invoice
          await this.env.DB.prepare(
            `INSERT INTO invoices (id, organization_id, customer_id, number, status, currency, subtotal, tax, total, amount_paid, amount_due, period_start, period_end, usage_cutoff_at, due_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'open', ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              invoiceId,
              organizationId,
              customerId,
              invoiceNumber,
              unbilled.currency,
              unbilled.totalEstimated,
              unbilled.totalEstimated,
              unbilled.totalEstimated,
              periodStart,
              periodEnd,
              now,
              now + 7 * 24 * 60 * 60 * 1000, // due in 7 days
              now,
              now,
            )
            .run();
        }

        // Create line items + stamp usage records (idempotent on retry)
        // On retry after crash, some line items may already exist. Check each before inserting.
        // Usage stamping is naturally idempotent (WHERE invoice_id IS NULL).
        for (const f of unbilled.features) {
          const existingItem = await this.env.DB.prepare(
            "SELECT id FROM invoice_items WHERE invoice_id = ? AND feature_id = ? LIMIT 1",
          )
            .bind(invoiceId, f.featureId)
            .first();

          if (!existingItem) {
            const itemId = crypto.randomUUID();
            const line = buildMeteredInvoiceLineData({
              featureName: f.featureName,
              billableQuantity: f.billableQuantity,
              pricePerUnit: f.pricePerUnit,
              billingUnits: f.billingUnits,
              ratingModel: f.ratingModel,
              tierBreakdown: f.tierBreakdown,
            });

            await this.env.DB.prepare(
              `INSERT INTO invoice_items (id, invoice_id, feature_id, description, quantity, unit_price, amount, period_start, period_end, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
              .bind(
                itemId,
                invoiceId,
                f.featureId,
                line.description,
                f.billableQuantity,
                line.unitPrice,
                f.estimatedAmount,
                f.periodStart,
                f.periodEnd,
                line.metadata ? JSON.stringify(line.metadata) : null,
                now,
              )
              .run();
          }

          const ledgerStamped = await markUsageInvoiced(
            {
              usageLedger: this.env.USAGE_LEDGER,
              organizationId,
            },
            {
              customerId,
              featureId: f.featureId,
              periodStart: f.periodStart,
              periodEnd: f.periodEnd,
              usageCutoffAt: now,
              invoiceId,
            },
          );

          if (ledgerStamped === null) {
            await this.env.DB.prepare(
              `UPDATE usage_records SET invoice_id = ?
             WHERE customer_id = ? AND feature_id = ? AND period_start >= ? AND period_end <= ? AND invoice_id IS NULL AND created_at <= ?`,
            )
              .bind(
                invoiceId,
                customerId,
                f.featureId,
                f.periodStart,
                f.periodEnd,
                now,
              )
              .run();
          }
        }

        return {
          invoiceId,
          invoiceNumber,
          total: unbilled.totalEstimated,
          currency: unbilled.currency,
        };
      });

      console.log(
        `[OverageBilling] Invoice ${invoice.invoiceNumber} created: ${invoice.currency} ${invoice.total}`,
      );

      // Step 5: Auto-collect if enabled
      if (!settings.auto_collect) {
        console.log(
          `[OverageBilling] Auto-collect disabled. Invoice ${invoice.invoiceNumber} left as open.`,
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
            "SELECT email FROM customers WHERE id = ? LIMIT 1",
          )
            .bind(customerId)
            .first<{ email: string | null }>();

          return {
            email: customer?.email || null,
            providerId: pm?.provider_id || null,
            authCode: pm?.token || null,
          };
        },
      );

      const authCode = customerPayment?.authCode;
      const providerId = customerPayment?.providerId || "unknown";

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
        return;
      }

      // Step 5b: Resolve adapter + provider account
      const accountData: ResolvedAccount | null = await step.do(
        "resolve-provider",
        async () => {
          const account = await resolveProviderAccount(
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
          return row?.status === "open";
        },
      );

      if (!invoiceStillOpen) {
        console.log(
          `[OverageBilling] Invoice ${invoice.invoiceNumber} already paid/void. Skipping charge.`,
        );
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
            const adapter = getAdapter(providerId);
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
                customer: { id: customerId, email: customerPayment!.email! },
                authorizationCode: authCode!,
                amount: invoice.total,
                currency: invoice.currency,
                metadata: {
                  invoice_id: invoice.invoiceId,
                  invoice_number: invoice.invoiceNumber,
                  type: "overage_billing",
                  organization_id: organizationId,
                  customer_id: customerId,
                },
                environment: accountData.environment as "test" | "live",
                account: accountData as unknown as ProviderAccount,
              });

              if (chargeResult.isErr()) {
                const errMsg =
                  chargeResult.error.message ||
                  JSON.stringify(chargeResult.error);
                const permanent =
                  /invalid_authorization|validation_error|invalid_request|authorization.*(invalid|expired|not found)/i.test(
                    errMsg,
                  );
                console.error(
                  `[OverageBilling] Charge attempt ${attempt} failed: ${errMsg} (permanent=${permanent})`,
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
          `[OverageBilling] All charge attempts failed for invoice=${invoice.invoiceNumber}: ${lastError}`,
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
            `[OverageBilling] Invoice ${invoice.invoiceNumber} marked as paid.`,
          );
        } else {
          // Leave as open — can be retried or paid manually
          console.log(
            `[OverageBilling] Invoice ${invoice.invoiceNumber} remains open (charge failed).`,
          );
        }
      });
    } finally {
      if (trigger === "period_end") {
        await this.advanceDueFreeSubscriptionPeriods(
          step,
          organizationId,
          customerId,
        );
        if (!deferPaidReconcile) {
          await this.reconcileDuePaidSubscriptionPeriods(
            step,
            organizationId,
            customerId,
          );
        } else {
          await this.reconcileDuePaidSubscriptionPeriods(
            step,
            organizationId,
            customerId,
            { allowPeriodAdvance: false },
          );
          console.log(
            `[OverageBilling] Deferred paid period advancement for customer=${customerId} due to below-minimum carry-forward.`,
          );
        }
      } else if (trigger === "reconcile_only") {
        await this.reconcileDuePaidSubscriptionPeriods(
          step,
          organizationId,
          customerId,
        );
      } else if (trigger === "cron" && !deferPaidReconcile) {
        await this.reconcileDuePaidSubscriptionPeriods(
          step,
          organizationId,
          customerId,
        );
      } else if (trigger === "cron" && deferPaidReconcile) {
        await this.reconcileDuePaidSubscriptionPeriods(
          step,
          organizationId,
          customerId,
          { allowPeriodAdvance: false },
        );
        console.log(
          `[OverageBilling] Deferred paid period advancement for customer=${customerId} due to below-minimum carry-forward.`,
        );
      }
    }
  }
}
