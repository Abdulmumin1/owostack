import { Result } from "better-result";
import type { createDb } from "@owostack/db";
import { schema } from "@owostack/db";
import { eq, and, gte, lte, sql, isNull, desc, inArray } from "drizzle-orm";
import { DatabaseError, NotFoundError } from "./errors";
import { getResetPeriod } from "./reset-period";
import { getMinimumChargeAmount } from "./provider-minimums";

type DB = ReturnType<typeof createDb>;

export interface InvoiceLineItem {
  featureId: string;
  featureSlug: string;
  description: string;
  quantity: number;
  unitPrice: number; // in smallest unit (kobo)
  amount: number;
  periodStart: number;
  periodEnd: number;
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
    pricePerUnit: number;
    billingUnits: number;
    estimatedAmount: number;
    periodStart: number;
    periodEnd: number;
  }[];
  totalEstimated: number;
  currency: string;
}

export class BillingService {
  constructor(private db: DB) {}

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

        const features: UnbilledUsageResult["features"] = [];
        let totalEstimated = 0;

        for (const pf of subscription.plan.planFeatures) {
          if (pf.usageModel !== "usage_based" && pf.overage !== "charge") {
            continue;
          }

          const { periodStart, periodEnd } = getResetPeriod(
            pf.resetInterval,
            subscription.currentPeriodStart,
            subscription.currentPeriodEnd,
          );

          const usageResult = await this.db
            .select({
              total: sql<number>`COALESCE(SUM(${schema.usageRecords.amount}), 0)`,
            })
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
            const description = `${f.featureName}: ${f.billableQuantity} ${f.billingUnits > 1 ? `units (${f.billingUnits} per package)` : "units"}`;

            await executor.insert(schema.invoiceItems).values({
              id: itemId,
              invoiceId,
              featureId: f.featureId,
              description,
              quantity: f.billableQuantity,
              unitPrice: Math.round(f.pricePerUnit / f.billingUnits),
              amount: f.estimatedAmount,
              periodStart: f.periodStart,
              periodEnd: f.periodEnd,
              createdAt: now,
            });

            items.push({
              featureId: f.featureId,
              featureSlug: f.featureSlug,
              description,
              quantity: f.billableQuantity,
              unitPrice: Math.round(f.pricePerUnit / f.billingUnits),
              amount: f.estimatedAmount,
              periodStart: f.periodStart,
              periodEnd: f.periodEnd,
            });

            await executor
              .update(schema.usageRecords)
              .set({ invoiceId })
              .where(
                and(
                  eq(schema.usageRecords.customerId, customerId),
                  eq(schema.usageRecords.featureId, f.featureId),
                  gte(schema.usageRecords.periodStart, f.periodStart),
                  lte(schema.usageRecords.periodEnd, f.periodEnd),
                  isNull(schema.usageRecords.invoiceId),
                  lte(schema.usageRecords.createdAt, usageCutoffAt),
                ),
              );
          }
        };

        // Prefer transaction for atomicity, but fallback for D1 environments that
        // disallow SQL BEGIN/SAVEPOINT from ORM transaction wrappers.
        try {
          await this.db.transaction(async (tx: any) => {
            await applyInvoiceWrites(tx);
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
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
