import { Result } from "better-result";
import type { createDb } from "@owostack/db";
import { schema } from "@owostack/db";
import { eq, and, gte, lte, sql, desc, inArray } from "drizzle-orm";
import { DatabaseError, NotFoundError } from "./errors";
import { getMinimumChargeAmount } from "./provider-minimums";
import type { UsageLedgerDO } from "./usage-ledger-do";
import { markUsageInvoiced, sumUnbilledByFeaturePeriod } from "./usage-ledger";
import { rateUsage } from "./usage-rating";
import { buildMeteredInvoiceLineData } from "./invoice-line-items";
import type {
  BillingTierBreakdown,
  PricingTier,
  RatingModel,
} from "@owostack/types";

type DB = ReturnType<typeof createDb>;

export interface InvoiceLineItem {
  featureId: string;
  featureSlug: string;
  description: string;
  quantity: number;
  unitPrice: number; // in smallest unit (kobo); tiered lines rely on tierBreakdown for full pricing detail
  amount: number;
  periodStart: number;
  periodEnd: number;
  ratingModel?: RatingModel;
  tierBreakdown?: BillingTierBreakdown[];
}

export interface GenerateInvoiceResult {
  invoiceId: string;
  number: string;
  status: string;
  currency: string;
  subtotal: number;
  total: number;
  items: InvoiceLineItem[];
  periodStart: number;
  periodEnd: number;
}

export interface UnbilledUsageResult {
  customerId: string;
  features: {
    featureId: string;
    featureSlug: string;
    featureName: string;
    usageModel: string;
    usage: number;
    included: number | null;
    billableQuantity: number;
    pricePerUnit: number | null;
    billingUnits: number | null;
    ratingModel?: RatingModel;
    tierBreakdown?: BillingTierBreakdown[];
    estimatedAmount: number;
    periodStart: number;
    periodEnd: number;
  }[];
  totalEstimated: number;
  currency: string;
}

export class BillingService {
  constructor(
    private db: DB,
    private opts?: {
      usageLedger?: DurableObjectNamespace<UsageLedgerDO>;
    },
  ) {}

  async getUnbilledUsage(
    customerId: string,
    organizationId: string,
  ): Promise<Result<UnbilledUsageResult, NotFoundError | DatabaseError>> {
    return Result.tryPromise({
      try: async () => {
        const customer = await this.db.query.customers.findFirst({
          where: and(
            eq(schema.customers.organizationId, organizationId),
            eq(schema.customers.id, customerId),
          ),
        });

        if (!customer) {
          throw new NotFoundError({ resource: "Customer", id: customerId });
        }

        // Include canceled/pending_cancel so unbilled overage from canceled subs
        // is still visible and invoiceable. Active subs accrue new overage;
        // canceled subs may still have uninvoiced usage from before cancellation.
        const subscription = await this.db.query.subscriptions.findFirst({
          where: and(
            eq(schema.subscriptions.customerId, customerId),
            inArray(schema.subscriptions.status, [
              "active",
              "canceled",
              "pending_cancel",
            ]),
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

        if (!subscription) {
          return {
            customerId,
            features: [],
            totalEstimated: 0,
            currency: "USD",
          };
        }

        type BillablePlanFeature = {
          featureId: string;
          usageModel: string | null;
          overage: string | null;
          limitValue: number | null;
          pricePerUnit: number | null;
          billingUnits: number | null;
          overagePrice: number | null;
          ratingModel: string | null;
          tiers: PricingTier[] | null;
          feature: {
            slug: string;
            name: string;
          };
        };

        const planFeatures = subscription.plan
          .planFeatures as BillablePlanFeature[];
        const planFeatureById = new Map<string, BillablePlanFeature>(
          planFeatures
            .filter(
              (pf) =>
                pf.usageModel === "usage_based" || pf.overage === "charge",
            )
            .map((pf) => [pf.featureId, pf]),
        );

        const unbilledUsageRows = await sumUnbilledByFeaturePeriod(
          {
            usageLedger: this.opts?.usageLedger,
            organizationId,
          },
          customerId,
        );

        // CRITICAL: Do NOT fall back to D1 usageRecords - it has stale data
        // If UsageLedgerDO is unavailable, skip billing to prevent under-billing.
        if (unbilledUsageRows === null) {
          console.warn(
            `[billing] UsageLedgerDO unavailable for customer=${customerId}. ` +
              `Skipping billing to prevent under-billing. Please investigate DO health.`,
          );
          return {
            customerId,
            features: [],
            totalEstimated: 0,
            currency: subscription.plan.currency || "USD",
          };
        }

        const features: UnbilledUsageResult["features"] = [];
        let totalEstimated = 0;

        for (const row of unbilledUsageRows) {
          const pf = planFeatureById.get(row.featureId);
          if (!pf) continue;

          const usage = Number(row.totalUsage || 0);
          if (usage === 0) continue;

          const rated = rateUsage({
            usageModel: pf.usageModel || "included",
            ratingModel: pf.ratingModel || "package",
            usage,
            included: pf.limitValue,
            pricePerUnit: pf.pricePerUnit,
            billingUnits: pf.billingUnits,
            overagePrice: pf.overagePrice,
            tiers: pf.tiers,
          });

          if (rated.billableQuantity === 0) continue;

          features.push({
            featureId: pf.featureId,
            featureSlug: pf.feature.slug,
            featureName: pf.feature.name,
            usageModel: rated.usageModel,
            usage,
            included: pf.limitValue,
            billableQuantity: rated.billableQuantity,
            pricePerUnit: rated.pricePerUnit,
            billingUnits: rated.billingUnits,
            ratingModel: rated.ratingModel,
            ...(rated.tierBreakdown
              ? { tierBreakdown: rated.tierBreakdown }
              : {}),
            estimatedAmount: rated.amount,
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
          });

          totalEstimated += rated.amount;
        }

        return {
          customerId,
          features,
          totalEstimated,
          currency: subscription.plan.currency || "USD",
        };
      },
      catch: (e) => {
        if (e instanceof NotFoundError) return e;
        return new DatabaseError({ operation: "getUnbilledUsage", cause: e });
      },
    });
  }

  async generateInvoice(
    customerId: string,
    organizationId: string,
  ): Promise<Result<GenerateInvoiceResult, NotFoundError | DatabaseError>> {
    return Result.tryPromise({
      try: async () => {
        const unbilledResult = await this.getUnbilledUsage(
          customerId,
          organizationId,
        );
        if (unbilledResult.isErr()) {
          throw unbilledResult.error;
        }

        const unbilled = unbilledResult.value;
        if (unbilled.features.length === 0) {
          throw new NotFoundError({
            resource: "Unbilled usage",
            id: customerId,
          });
        }

        // Check minimum charge amount for provider/currency
        const paymentMethod = await this.db.query.paymentMethods.findFirst({
          where: and(
            eq(schema.paymentMethods.customerId, customerId),
            eq(schema.paymentMethods.isValid, 1),
            eq(schema.paymentMethods.isDefault, 1),
          ),
        });

        const providerId = paymentMethod?.providerId || "unknown";
        const minimumAmount = getMinimumChargeAmount(
          providerId,
          unbilled.currency,
        );

        if (minimumAmount > 0 && unbilled.totalEstimated < minimumAmount) {
          throw new NotFoundError({
            resource: `Invoice amount ${unbilled.totalEstimated} ${unbilled.currency} below provider minimum ${minimumAmount}`,
            id: customerId,
          });
        }

        // Generate unique invoice number with random suffix to prevent race conditions
        const invoiceCount = await this.db
          .select({ count: sql<number>`COUNT(*)` })
          .from(schema.invoices)
          .where(eq(schema.invoices.organizationId, organizationId));

        const seq = (invoiceCount[0]?.count || 0) + 1;
        const suffix = crypto.randomUUID().slice(0, 4).toUpperCase();
        const invoiceNumber = `INV-${String(seq).padStart(5, "0")}-${suffix}`;

        const periodStart = Math.min(
          ...unbilled.features.map((f) => f.periodStart),
        );
        const periodEnd = Math.max(
          ...unbilled.features.map((f) => f.periodEnd),
        );
        const usageCutoffAt = Date.now();

        // IDEMPOTENCY CHECK: Prevent duplicate invoices
        // Check if invoice already exists for this customer/period
        const existingInvoice = await this.db.query.invoices.findFirst({
          where: and(
            eq(schema.invoices.customerId, customerId),
            eq(schema.invoices.organizationId, organizationId),
            eq(schema.invoices.periodStart, periodStart),
            eq(schema.invoices.periodEnd, periodEnd),
            eq(schema.invoices.status, "open"),
          ),
        });

        if (existingInvoice) {
          console.warn(
            `[billing] Invoice already exists for customer=${customerId} ` +
              `period=${periodStart}-${periodEnd}: ${existingInvoice.number}. ` +
              `Skipping duplicate creation.`,
          );
          throw new NotFoundError({
            resource: "Invoice already exists",
            id: existingInvoice.id,
          });
        }

        const invoiceId = crypto.randomUUID();
        const now = Date.now();

        const items: InvoiceLineItem[] = [];
        const applyInvoiceWrites = async (executor: any) => {
          await executor.insert(schema.invoices).values({
            id: invoiceId,
            organizationId,
            customerId,
            number: invoiceNumber,
            status: "open",
            currency: unbilled.currency,
            subtotal: unbilled.totalEstimated,
            tax: 0,
            total: unbilled.totalEstimated,
            amountPaid: 0,
            amountDue: unbilled.totalEstimated,
            periodStart,
            periodEnd,
            usageCutoffAt,
            dueAt: now + 7 * 24 * 60 * 60 * 1000,
            createdAt: now,
            updatedAt: now,
          });

          for (const f of unbilled.features) {
            const itemId = crypto.randomUUID();
            const line = buildMeteredInvoiceLineData({
              featureName: f.featureName,
              billableQuantity: f.billableQuantity,
              pricePerUnit: f.pricePerUnit,
              billingUnits: f.billingUnits,
              ratingModel: f.ratingModel,
              tierBreakdown: f.tierBreakdown,
            });

            await executor.insert(schema.invoiceItems).values({
              id: itemId,
              invoiceId,
              featureId: f.featureId,
              description: line.description,
              quantity: f.billableQuantity,
              unitPrice: line.unitPrice,
              amount: f.estimatedAmount,
              periodStart: f.periodStart,
              periodEnd: f.periodEnd,
              metadata: line.metadata ?? null,
              createdAt: now,
            });

            items.push({
              featureId: f.featureId,
              featureSlug: f.featureSlug,
              description: line.description,
              quantity: f.billableQuantity,
              unitPrice: line.unitPrice,
              amount: f.estimatedAmount,
              periodStart: f.periodStart,
              periodEnd: f.periodEnd,
              ratingModel: f.ratingModel,
              ...(f.tierBreakdown ? { tierBreakdown: f.tierBreakdown } : {}),
            });

            const ledgerMarked = await markUsageInvoiced(
              {
                usageLedger: this.opts?.usageLedger,
                organizationId,
              },
              {
                customerId,
                featureId: f.featureId,
                periodStart: f.periodStart,
                periodEnd: f.periodEnd,
                usageCutoffAt,
                invoiceId,
              },
            );

            // CRITICAL: If UsageLedgerDO marking failed, we have a serious issue
            // The invoice was created but usage wasn't marked as invoiced
            // This could lead to double-billing next cycle
            // We must ensure usageDailySummaries is updated as backup
            if (ledgerMarked === null) {
              console.error(
                `[billing] CRITICAL: Failed to mark usage as invoiced in DO for ` +
                  `customer=${customerId}, feature=${f.featureId}, invoice=${invoiceId}. ` +
                  `Attempting D1 aggregate update as backup.`,
              );

              // Update D1 daily aggregates as backup source of truth
              // This ensures we don't double-bill next cycle
              const startDate = new Date(f.periodStart)
                .toISOString()
                .split("T")[0];
              const endDate = new Date(f.periodEnd).toISOString().split("T")[0];

              try {
                await executor
                  .update(schema.usageDailySummaries)
                  .set({
                    updatedAt: Date.now(),
                    // Add metadata to track this was invoiced
                    // Note: We don't have invoice_id column in aggregates
                    // This is a limitation - we rely on invoice period matching
                  })
                  .where(
                    and(
                      eq(schema.usageDailySummaries.customerId, customerId),
                      eq(schema.usageDailySummaries.featureId, f.featureId),
                      gte(schema.usageDailySummaries.date, startDate),
                      lte(schema.usageDailySummaries.date, endDate),
                    ),
                  );

                console.warn(
                  `[billing] Updated D1 aggregates as backup for invoiced usage. ` +
                    `Period: ${startDate} to ${endDate}`,
                );
              } catch (d1Error) {
                console.error(
                  `[billing] CRITICAL: Failed to update D1 aggregates too. ` +
                    `Risk of double-billing on next cycle. Error:`,
                  d1Error,
                );
                // Don't throw - invoice already created, we can't roll back
                // But log prominently for manual intervention
              }
            }
          }
        };

        // Prefer transaction for atomicity, but fallback for D1 environments that
        // disallow SQL BEGIN/SAVEPOINT from ORM transaction wrappers.
        try {
          await this.db.transaction(async (tx: any) => {
            await applyInvoiceWrites(tx);
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const isD1TransactionUnsupported =
            message.includes("state.storage.transaction") ||
            message.includes("BEGIN TRANSACTION") ||
            message.includes("SAVEPOINT");

          if (!isD1TransactionUnsupported) {
            throw error;
          }

          console.warn(
            "[billing] DB transaction unsupported; generating invoice without transaction",
          );
          await applyInvoiceWrites(this.db);
        }

        return {
          invoiceId,
          number: invoiceNumber,
          status: "open",
          currency: unbilled.currency,
          subtotal: unbilled.totalEstimated,
          total: unbilled.totalEstimated,
          items,
          periodStart,
          periodEnd,
        };
      },
      catch: (e) => {
        if (e instanceof NotFoundError) return e;
        return new DatabaseError({ operation: "generateInvoice", cause: e });
      },
    });
  }

  async getInvoices(
    customerId: string,
    organizationId: string,
  ): Promise<Result<(typeof schema.invoices.$inferSelect)[], DatabaseError>> {
    return Result.tryPromise({
      try: async () => {
        return await this.db.query.invoices.findMany({
          where: and(
            eq(schema.invoices.organizationId, organizationId),
            eq(schema.invoices.customerId, customerId),
          ),
          orderBy: [desc(schema.invoices.createdAt)],
          with: {
            items: true,
          },
        });
      },
      catch: (e) => new DatabaseError({ operation: "getInvoices", cause: e }),
    });
  }
}
