import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import type { WorkflowEnv } from "./utils";
import { getAdapter, resolveProviderAccount } from "./utils";
import type { ProviderAccount } from "@owostack/adapters";
import { createDb, schema } from "@owostack/db";
import { eq, and, gte, lte, sql, isNull, inArray } from "drizzle-orm";
import { getResetPeriod } from "../reset-period";

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

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export interface OverageBillingParams {
  organizationId: string;
  customerId: string;
  /** Trigger reason: scheduled cron, threshold crossed, or period end */
  trigger: "cron" | "threshold" | "period_end";
}

// ---------------------------------------------------------------------------
// OverageBillingWorkflow
//
// Calculates unbilled overage → generates invoice → optionally charges card.
// Each step is individually retryable and durable.
// ---------------------------------------------------------------------------

export class OverageBillingWorkflow extends WorkflowEntrypoint<WorkflowEnv, OverageBillingParams> {
  async run(event: WorkflowEvent<OverageBillingParams>, step: WorkflowStep) {
    const { organizationId, customerId, trigger } = event.payload;

    console.log(`[OverageBilling] Starting: customer=${customerId}, org=${organizationId}, trigger=${trigger}`);

    // Step 1: Load overage settings for this org
    const settings = await step.do("load-overage-settings", async () => {
      const row = await this.env.DB.prepare(
        "SELECT * FROM overage_settings WHERE organization_id = ? LIMIT 1",
      ).bind(organizationId).first<{
        billing_interval: string;
        threshold_amount: number | null;
        auto_collect: number;
        grace_period_hours: number;
      }>();

      return row || {
        billing_interval: "end_of_period",
        threshold_amount: null,
        auto_collect: 0,
        grace_period_hours: 0,
      };
    });

    // Step 2: If grace period is set, wait
    if (settings.grace_period_hours > 0) {
      const waitMs = settings.grace_period_hours * 60 * 60 * 1000;
      console.log(`[OverageBilling] Waiting grace period: ${settings.grace_period_hours}h`);
      await step.sleep("grace-period-wait", waitMs);
    }

    // Step 3: Calculate unbilled overage usage
    const unbilled = await step.do("calculate-unbilled-usage", async () => {
      const db = createDb(this.env.DB);

      // Get customer + active subscription
      const customer = await db.query.customers.findFirst({
        where: eq(schema.customers.id, customerId),
      });
      if (!customer) return { features: [], totalEstimated: 0, currency: "USD" };

      const subscription = await db.query.subscriptions.findFirst({
        where: and(
          eq(schema.subscriptions.customerId, customerId),
          inArray(schema.subscriptions.status, ["active", "canceled", "pending_cancel", "trialing"]),
        ),
        with: {
          plan: {
            with: {
              planFeatures: {
                with: { feature: true },
              },
            },
          },
        },
      });

      if (!subscription) return { features: [], totalEstimated: 0, currency: "USD" };

      const features: Array<{
        featureId: string;
        featureSlug: string;
        featureName: string;
        usageModel: string;
        usage: number;
        included: number | null;
        billableQuantity: number;
        pricePerUnit: number;
        billingUnits: number;
        estimatedAmount: number;
        periodStart: number;
        periodEnd: number;
      }> = [];
      let totalEstimated = 0;

      for (const pf of subscription.plan.planFeatures) {
        if (pf.usageModel !== "usage_based" && pf.overage !== "charge") continue;

        const { periodStart, periodEnd } = getResetPeriod(
          pf.resetInterval,
          subscription.currentPeriodStart,
          subscription.currentPeriodEnd,
        );

        const usageResult = await db
          .select({ total: sql<number>`COALESCE(SUM(${schema.usageRecords.amount}), 0)` })
          .from(schema.usageRecords)
          .where(
            and(
              eq(schema.usageRecords.customerId, customerId),
              eq(schema.usageRecords.featureId, pf.featureId),
              gte(schema.usageRecords.periodStart, periodStart),
              lte(schema.usageRecords.periodEnd, periodEnd),
              isNull(schema.usageRecords.invoiceId),
            ),
          );

        const usage = Number(usageResult[0]?.total || 0);
        if (usage === 0) continue;

        let billableQuantity = usage;
        const included = pf.limitValue;
        if (pf.usageModel === "included" && pf.overage === "charge") {
          billableQuantity = Math.max(0, usage - (included || 0));
        }
        if (billableQuantity === 0) continue;

        const pricePerUnit = pf.pricePerUnit || pf.overagePrice || 0;
        const billingUnits = pf.billingUnits || 1;
        const packages = Math.ceil(billableQuantity / billingUnits);
        const amount = packages * pricePerUnit;

        features.push({
          featureId: pf.featureId,
          featureSlug: pf.feature.slug,
          featureName: pf.feature.name,
          usageModel: pf.usageModel || "included",
          usage,
          included,
          billableQuantity,
          pricePerUnit,
          billingUnits,
          estimatedAmount: amount,
          periodStart,
          periodEnd,
        });

        totalEstimated += amount;
      }

      return {
        features,
        totalEstimated,
        currency: subscription.plan.currency || "USD",
      };
    });

    if (unbilled.features.length === 0 || unbilled.totalEstimated === 0) {
      console.log(`[OverageBilling] No unbilled usage for customer=${customerId}. Done.`);
      return;
    }

    console.log(`[OverageBilling] Unbilled: ${unbilled.currency} ${unbilled.totalEstimated} across ${unbilled.features.length} features`);

    // Step 4: Generate invoice (idempotent — safe to retry)
    const invoice = await step.do("generate-invoice", async () => {
      const now = Date.now();
      const periodStart = Math.min(...unbilled.features.map(f => f.periodStart));
      const periodEnd = Math.max(...unbilled.features.map(f => f.periodEnd));

      // Idempotency: check if an invoice already exists for this customer/period
      // This prevents duplicate invoices if the workflow retries after a crash.
      const existing = await this.env.DB.prepare(
        `SELECT id, number, total, currency FROM invoices
         WHERE customer_id = ? AND organization_id = ? AND period_start = ? AND period_end = ?
           AND status IN ('open', 'paid')
         LIMIT 1`,
      ).bind(customerId, organizationId, periodStart, periodEnd)
        .first<{ id: string; number: string; total: number; currency: string }>();

      let invoiceId: string;
      let invoiceNumber: string;

      if (existing) {
        console.log(`[OverageBilling] Existing invoice found: ${existing.number} — completing any missing line items`);
        invoiceId = existing.id;
        invoiceNumber = existing.number;
      } else {
        // Get invoice count for numbering
        const countResult = await this.env.DB.prepare(
          "SELECT COUNT(*) as count FROM invoices WHERE organization_id = ?",
        ).bind(organizationId).first<{ count: number }>();
        const seq = String((countResult?.count || 0) + 1).padStart(5, "0");
        const suffix = crypto.randomUUID().slice(0, 4).toUpperCase();
        invoiceNumber = `INV-${seq}-${suffix}`;

        invoiceId = crypto.randomUUID();

        // Create invoice
        await this.env.DB.prepare(
          `INSERT INTO invoices (id, organization_id, customer_id, number, status, currency, subtotal, tax, total, amount_paid, amount_due, period_start, period_end, usage_cutoff_at, due_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'open', ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          invoiceId, organizationId, customerId, invoiceNumber, unbilled.currency,
          unbilled.totalEstimated, unbilled.totalEstimated, unbilled.totalEstimated,
          periodStart, periodEnd, now,
          now + 7 * 24 * 60 * 60 * 1000, // due in 7 days
          now, now,
        ).run();
      }

      // Create line items + stamp usage records (idempotent on retry)
      // On retry after crash, some line items may already exist. Check each before inserting.
      // Usage stamping is naturally idempotent (WHERE invoice_id IS NULL).
      for (const f of unbilled.features) {
        const existingItem = await this.env.DB.prepare(
          "SELECT id FROM invoice_items WHERE invoice_id = ? AND feature_id = ? LIMIT 1",
        ).bind(invoiceId, f.featureId).first();

        if (!existingItem) {
          const itemId = crypto.randomUUID();
          const description = `${f.featureName}: ${f.billableQuantity} ${f.billingUnits > 1 ? `units (${f.billingUnits} per package)` : "units"}`;

          await this.env.DB.prepare(
            `INSERT INTO invoice_items (id, invoice_id, feature_id, description, quantity, unit_price, amount, period_start, period_end, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            itemId, invoiceId, f.featureId, description,
            f.billableQuantity, Math.round(f.pricePerUnit / f.billingUnits),
            f.estimatedAmount, f.periodStart, f.periodEnd, now,
          ).run();
        }

        // Stamp usage records as invoiced
        await this.env.DB.prepare(
          `UPDATE usage_records SET invoice_id = ?
           WHERE customer_id = ? AND feature_id = ? AND period_start >= ? AND period_end <= ? AND invoice_id IS NULL AND created_at <= ?`,
        ).bind(invoiceId, customerId, f.featureId, f.periodStart, f.periodEnd, now).run();
      }

      return { invoiceId, invoiceNumber, total: unbilled.totalEstimated, currency: unbilled.currency };
    });

    console.log(`[OverageBilling] Invoice ${invoice.invoiceNumber} created: ${invoice.currency} ${invoice.total}`);

    // Step 5: Auto-collect if enabled
    if (!settings.auto_collect) {
      console.log(`[OverageBilling] Auto-collect disabled. Invoice ${invoice.invoiceNumber} left as open.`);
      return;
    }

    // Step 5a: Load customer's payment info from payment_methods table
    const customerPayment = await step.do("load-customer-payment", async () => {
      const pm = await this.env.DB.prepare(
        "SELECT token, provider_id FROM payment_methods WHERE customer_id = ? AND is_valid = 1 AND is_default = 1 LIMIT 1",
      ).bind(customerId).first<{ token: string; provider_id: string }>();

      const customer = await this.env.DB.prepare(
        "SELECT email FROM customers WHERE id = ? LIMIT 1",
      ).bind(customerId).first<{ email: string | null }>();

      return {
        email: customer?.email || null,
        providerId: pm?.provider_id || null,
        authCode: pm?.token || null,
      };
    });

    const authCode = customerPayment?.authCode;
    const providerId = customerPayment?.providerId || "unknown";

    if (!authCode || !customerPayment?.email) {
      console.log(`[OverageBilling] No payment method for customer=${customerId}. Invoice stays open.`);
      // Record failed attempt
      await step.do("record-no-card-attempt", async () => {
        await this.env.DB.prepare(
          `INSERT INTO payment_attempts (id, invoice_id, amount, currency, status, provider, attempt_number, last_error, created_at)
           VALUES (?, ?, ?, ?, 'failed', ?, 1, 'No payment method on file', ?)`,
        ).bind(crypto.randomUUID(), invoice.invoiceId, invoice.total, invoice.currency, providerId, Date.now()).run();
      });
      return;
    }

    // Step 5b: Resolve adapter + provider account
    const accountData: ResolvedAccount | null = await step.do("resolve-provider", async () => {
      const account = await resolveProviderAccount(this.env, organizationId, providerId);
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
    });

    if (!accountData) {
      console.log(`[OverageBilling] No provider account for org=${organizationId}. Invoice stays open.`);
      return;
    }

    // Step 5c: Re-check invoice status before charging (guards against concurrent
    // workflows — e.g. cron + threshold — both trying to charge the same invoice).
    const invoiceStillOpen = await step.do("pre-charge-status-check", async () => {
      const row = await this.env.DB.prepare(
        "SELECT status FROM invoices WHERE id = ? LIMIT 1",
      ).bind(invoice.invoiceId).first<{ status: string }>();
      return row?.status === "open";
    });

    if (!invoiceStillOpen) {
      console.log(`[OverageBilling] Invoice ${invoice.invoiceNumber} already paid/void. Skipping charge.`);
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
      const result = await step.do(`charge-card-attempt-${attempt}`, async () => {
        const adapter = getAdapter(providerId);
        if (!adapter) {
          return { success: false as const, error: `No adapter for provider: ${providerId}`, retryable: false, reference: null };
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
            const errMsg = chargeResult.error.message || JSON.stringify(chargeResult.error);
            const permanent = /invalid_authorization|validation_error|invalid_request|authorization.*(invalid|expired|not found)/i.test(errMsg);
            console.error(`[OverageBilling] Charge attempt ${attempt} failed: ${errMsg} (permanent=${permanent})`);
            return { success: false as const, error: errMsg, retryable: !permanent, reference: null };
          }

          console.log(`[OverageBilling] Charge succeeded: ref=${chargeResult.value.reference}`);
          return { success: true as const, error: "", retryable: false, reference: chargeResult.value.reference };
        } catch (networkErr: any) {
          console.error(`[OverageBilling] Charge attempt ${attempt} threw: ${networkErr.message}`);
          return { success: false as const, error: networkErr.message, retryable: true, reference: null };
        }
      });

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
      console.error(`[OverageBilling] All charge attempts failed for invoice=${invoice.invoiceNumber}: ${lastError}`);
    }

    // Step 5d: Record payment attempt + update invoice status
    await step.do("record-payment", async () => {
      const now = Date.now();

      await this.env.DB.prepare(
        `INSERT INTO payment_attempts (id, invoice_id, amount, currency, status, provider, provider_reference, attempt_number, last_error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        invoice.invoiceId,
        invoice.total,
        invoice.currency,
        chargeSucceeded ? "succeeded" : "failed",
        providerId,
        chargeRef,
        attemptsMade,
        chargeSucceeded ? null : "Charge failed after retries",
        now,
      ).run();

      if (chargeSucceeded) {
        await this.env.DB.prepare(
          "UPDATE invoices SET status = 'paid', amount_paid = ?, amount_due = 0, updated_at = ? WHERE id = ?",
        ).bind(invoice.total, now, invoice.invoiceId).run();
        console.log(`[OverageBilling] Invoice ${invoice.invoiceNumber} marked as paid.`);
      } else {
        // Leave as open — can be retried or paid manually
        console.log(`[OverageBilling] Invoice ${invoice.invoiceNumber} remains open (charge failed).`);
      }
    });
  }
}
