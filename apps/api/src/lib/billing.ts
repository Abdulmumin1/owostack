import { Result } from "better-result";
import type { createDb } from "@owostack/db";
import { schema } from "@owostack/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { DatabaseError, NotFoundError, ValidationError } from "./errors";
import { getMinimumChargeAmount } from "./provider-minimums";
import type { UsageLedgerDO } from "./usage-ledger-do";
import {
  markUsageInvoiced,
  releaseUsageInvoice,
  sumUnbilledByFeaturePeriod,
} from "./usage-ledger";
import { releaseCustomerOverageBlockForInvoice } from "./overage-blocks";
import type { UsagePricingSnapshot } from "./usage-pricing-snapshot";
import { rateUsage } from "./usage-rating";
import { buildMeteredInvoiceLineData } from "./invoice-line-items";
import type {
  BillingTierBreakdown,
  PricingTier,
  RatingModel,
} from "@owostack/types";

type DB = ReturnType<typeof createDb>;

export type BillingServiceDependencies = {
  markUsageInvoiced: typeof markUsageInvoiced;
  releaseUsageInvoice: typeof releaseUsageInvoice;
  releaseCustomerOverageBlockForInvoice: typeof releaseCustomerOverageBlockForInvoice;
  sumUnbilledByFeaturePeriod: typeof sumUnbilledByFeaturePeriod;
};

const defaultDependencies: BillingServiceDependencies = {
  markUsageInvoiced,
  releaseUsageInvoice,
  releaseCustomerOverageBlockForInvoice,
  sumUnbilledByFeaturePeriod,
};

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
  usageWindowEnd: number;
}

export interface UnbilledUsageResult {
  customerId: string;
  usageWindowEnd: number;
  features: {
    featureId: string;
    featureSlug: string;
    featureName: string;
    subscriptionId?: string | null;
    planId?: string | null;
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
    pricingSnapshot?: UsagePricingSnapshot | null;
    billingGroupKey: string;
  }[];
  totalEstimated: number;
  currency: string;
}

export interface GetUnbilledUsageOptions {
  usageCutoffAt?: number;
}

export interface GenerateInvoiceOptions {
  idempotencyKey?: string;
  sourceTrigger?: "manual" | "threshold" | "period_end";
  usageCutoffAt?: number;
  usageWindowStart?: number | null;
}

export interface ReleaseInvoiceResult {
  invoiceId: string;
  status: "void";
  releasedUsageRecords: number;
}

function serializePricingSnapshot(
  snapshot?: UsagePricingSnapshot | null,
): string {
  return snapshot ? JSON.stringify(snapshot) : "null";
}

function buildBillingGroupKey(params: {
  featureId: string;
  periodStart: number;
  periodEnd: number;
  subscriptionId?: string | null;
  planId?: string | null;
  pricingSnapshot?: UsagePricingSnapshot | null;
}): string {
  return [
    params.featureId,
    params.periodStart,
    params.periodEnd,
    params.subscriptionId ?? "",
    params.planId ?? "",
    serializePricingSnapshot(params.pricingSnapshot),
  ].join("|");
}

function getInvoiceItemBillingGroupKey(item: {
  featureId?: string | null;
  periodStart?: number | null;
  periodEnd?: number | null;
  metadata?: Record<string, unknown> | null;
}): string {
  const metadata =
    item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
      ? item.metadata
      : null;

  if (metadata && typeof metadata.billingGroupKey === "string") {
    return metadata.billingGroupKey;
  }

  return buildBillingGroupKey({
    featureId: item.featureId || "feature",
    periodStart: item.periodStart || 0,
    periodEnd: item.periodEnd || 0,
    subscriptionId:
      typeof metadata?.subscriptionId === "string"
        ? metadata.subscriptionId
        : null,
    planId:
      typeof metadata?.planId === "string" ? metadata.planId : null,
    pricingSnapshot:
      metadata?.pricingSnapshot &&
      typeof metadata.pricingSnapshot === "object" &&
      !Array.isArray(metadata.pricingSnapshot)
        ? (metadata.pricingSnapshot as UsagePricingSnapshot)
        : null,
  });
}

export class BillingService {
  constructor(
    private db: DB,
    private opts?: {
      usageLedger?: DurableObjectNamespace<UsageLedgerDO>;
      deps?: Partial<BillingServiceDependencies>;
    },
  ) {}

  private get deps(): BillingServiceDependencies {
    return {
      ...defaultDependencies,
      ...this.opts?.deps,
    };
  }

  async getUnbilledUsage(
    customerId: string,
    organizationId: string,
    options?: GetUnbilledUsageOptions,
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
            usageWindowEnd: options?.usageCutoffAt ?? Date.now(),
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

        const unbilledUsageRows = await this.deps.sumUnbilledByFeaturePeriod(
          {
            usageLedger: this.opts?.usageLedger,
            organizationId,
          },
          customerId,
          options?.usageCutoffAt,
        );

        // CRITICAL: Do NOT fall back to D1 usageRecords - it has stale data
        // If UsageLedgerDO is unavailable, skip billing to prevent under-billing.
        if (unbilledUsageRows === null) {
          throw new DatabaseError({
            operation: "getUnbilledUsage",
            cause: new Error(
              `[billing] UsageLedgerDO unavailable for customer=${customerId}. ` +
                `Billing preview cannot continue safely.`,
            ),
          });
        }

        const features: UnbilledUsageResult["features"] = [];
        let totalEstimated = 0;
        let usageWindowEnd = options?.usageCutoffAt ?? 0;

        for (const row of unbilledUsageRows) {
          const snapshot = row.pricingSnapshot as UsagePricingSnapshot | null;
          const pf = planFeatureById.get(row.featureId);
          if (!snapshot && !pf) {
            console.warn(
              `[billing] Missing pricing snapshot and current plan feature for customer=${customerId}, feature=${row.featureId}. Skipping usage row.`,
            );
            continue;
          }

          const usage = Number(row.totalUsage || 0);
          if (usage === 0) continue;

          const rated = rateUsage(
            snapshot
              ? {
                  usageModel: snapshot.usageModel,
                  ratingModel: snapshot.ratingModel,
                  usage,
                  included: snapshot.included,
                  pricePerUnit: snapshot.pricePerUnit,
                  billingUnits: snapshot.billingUnits,
                  overagePrice: snapshot.overagePrice,
                  tiers: snapshot.tiers,
                }
              : {
                  usageModel: pf!.usageModel || "included",
                  ratingModel: pf!.ratingModel || "package",
                  usage,
                  included: pf!.limitValue,
                  pricePerUnit: pf!.pricePerUnit,
                  billingUnits: pf!.billingUnits,
                  overagePrice: pf!.overagePrice,
                  tiers: pf!.tiers,
                },
          );

          if (rated.billableQuantity === 0) continue;

          features.push({
            featureId: row.featureId,
            featureSlug: row.featureSlug || pf?.feature.slug || row.featureId,
            featureName:
              row.featureName ||
              pf?.feature.name ||
              row.featureSlug ||
              row.featureId,
            ...(row.subscriptionId
              ? { subscriptionId: row.subscriptionId }
              : {}),
            ...(row.planId ? { planId: row.planId } : {}),
            usageModel: rated.usageModel,
            usage,
            included: rated.included,
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
            pricingSnapshot: snapshot,
            billingGroupKey: buildBillingGroupKey({
              featureId: row.featureId,
              periodStart: row.periodStart,
              periodEnd: row.periodEnd,
              subscriptionId: row.subscriptionId ?? null,
              planId: row.planId ?? null,
              pricingSnapshot: snapshot,
            }),
          });

          totalEstimated += rated.amount;
          usageWindowEnd = Math.max(usageWindowEnd, row.lastCreatedAt || 0);
        }

        return {
          customerId,
          usageWindowEnd:
            usageWindowEnd || options?.usageCutoffAt || Date.now(),
          features,
          totalEstimated,
          currency: subscription.plan.currency || "USD",
        };
      },
      catch: (e) => {
        if (e instanceof NotFoundError || e instanceof DatabaseError) return e;
        return new DatabaseError({ operation: "getUnbilledUsage", cause: e });
      },
    });
  }

  async generateInvoice(
    customerId: string,
    organizationId: string,
    options?: GenerateInvoiceOptions,
  ): Promise<
    Result<
      GenerateInvoiceResult,
      NotFoundError | ValidationError | DatabaseError
    >
  > {
    return Result.tryPromise({
      try: async () => {
        const unbilledResult = await this.getUnbilledUsage(
          customerId,
          organizationId,
          {
            usageCutoffAt: options?.usageCutoffAt,
          },
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
        const idempotencyKey =
          options?.idempotencyKey ||
          `${options?.sourceTrigger || "manual"}:${organizationId}:${customerId}:${unbilled.usageWindowEnd}`;

        return await this.createInvoiceFromUsage(
          customerId,
          organizationId,
          unbilled,
          {
            idempotencyKey,
            sourceTrigger: options?.sourceTrigger || "manual",
            usageWindowStart: options?.usageWindowStart ?? null,
          },
        );
      },
      catch: (e) => {
        if (
          e instanceof NotFoundError ||
          e instanceof ValidationError ||
          e instanceof DatabaseError
        )
          return e;
        return new DatabaseError({ operation: "generateInvoice", cause: e });
      },
    });
  }

  async createInvoiceFromUsage(
    customerId: string,
    organizationId: string,
    unbilled: UnbilledUsageResult,
    options: {
      idempotencyKey: string;
      sourceTrigger: "manual" | "threshold" | "period_end";
      usageWindowStart?: number | null;
    },
  ): Promise<GenerateInvoiceResult> {
    const paymentMethod = await this.db.query.paymentMethods.findFirst({
      where: and(
        eq(schema.paymentMethods.customerId, customerId),
        eq(schema.paymentMethods.isValid, 1),
        eq(schema.paymentMethods.isDefault, 1),
      ),
    });

    const providerId = paymentMethod?.providerId || "unknown";
    const minimumAmount = getMinimumChargeAmount(providerId, unbilled.currency);

    if (minimumAmount > 0 && unbilled.totalEstimated < minimumAmount) {
      throw new ValidationError({
        field: "invoice_amount",
        details:
          `${unbilled.totalEstimated} ${unbilled.currency} is below the ` +
          `${providerId} minimum charge of ${minimumAmount}`,
      });
    }

    const periodStart = Math.min(
      ...unbilled.features.map((f) => f.periodStart),
    );
    const periodEnd = Math.max(...unbilled.features.map((f) => f.periodEnd));
    const usageWindowEnd = unbilled.usageWindowEnd;

    const existingInvoice = await this.db.query.invoices.findFirst({
      where: and(
        eq(schema.invoices.customerId, customerId),
        eq(schema.invoices.organizationId, organizationId),
        eq(schema.invoices.idempotencyKey, options.idempotencyKey),
      ),
      with: {
        items: true,
      },
    });

    const invoiceCount = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.invoices)
      .where(eq(schema.invoices.organizationId, organizationId));

    const seq = (invoiceCount[0]?.count || 0) + 1;
    const suffix = crypto.randomUUID().slice(0, 4).toUpperCase();
    const invoiceNumber = `INV-${String(seq).padStart(5, "0")}-${suffix}`;
    const invoiceId = existingInvoice?.id || crypto.randomUUID();
    const now = Date.now();
    const uniqueSubscriptionIds = [
      ...new Set(
        unbilled.features
          .map((feature) => feature.subscriptionId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const existingItemKeys = new Set(
      (existingInvoice?.items || []).map(
        (item: NonNullable<typeof existingInvoice>["items"][number]) =>
          getInvoiceItemBillingGroupKey(item),
      ),
    );

    const applyInvoiceWrites = async (executor: any) => {
      if (!existingInvoice) {
        await executor.insert(schema.invoices).values({
          id: invoiceId,
          organizationId,
          customerId,
          subscriptionId:
            uniqueSubscriptionIds.length === 1
              ? uniqueSubscriptionIds[0]
              : null,
          number: invoiceNumber,
          idempotencyKey: options.idempotencyKey,
          status: "open",
          currency: unbilled.currency,
          subtotal: unbilled.totalEstimated,
          tax: 0,
          total: unbilled.totalEstimated,
          amountPaid: 0,
          amountDue: unbilled.totalEstimated,
          periodStart,
          periodEnd,
          usageWindowStart: options.usageWindowStart ?? null,
          usageWindowEnd,
          usageCutoffAt: usageWindowEnd,
          dueAt: now + 7 * 24 * 60 * 60 * 1000,
          metadata: {
            sourceTrigger: options.sourceTrigger,
          },
          createdAt: now,
          updatedAt: now,
        });
      }

      for (const f of unbilled.features) {
        const itemKey = f.billingGroupKey;
        const line = buildMeteredInvoiceLineData({
          featureName: f.featureName,
          billableQuantity: f.billableQuantity,
          pricePerUnit: f.pricePerUnit,
          billingUnits: f.billingUnits,
          ratingModel: f.ratingModel,
          tierBreakdown: f.tierBreakdown,
        });
        const lineMetadata = {
          ...(line.metadata ?? {}),
          billingGroupKey: f.billingGroupKey,
          ...(f.subscriptionId ? { subscriptionId: f.subscriptionId } : {}),
          ...(f.planId ? { planId: f.planId } : {}),
          ...(f.pricingSnapshot
            ? { pricingSnapshot: f.pricingSnapshot }
            : {}),
        };

        if (!existingItemKeys.has(itemKey)) {
          await executor.insert(schema.invoiceItems).values({
            id: crypto.randomUUID(),
            invoiceId,
            featureId: f.featureId,
            description: line.description,
            quantity: f.billableQuantity,
            unitPrice: line.unitPrice,
            amount: f.estimatedAmount,
            periodStart: f.periodStart,
            periodEnd: f.periodEnd,
            metadata: lineMetadata,
            createdAt: now,
          });
          existingItemKeys.add(itemKey);
        }

        const ledgerMarked = await this.deps.markUsageInvoiced(
          {
            usageLedger: this.opts?.usageLedger,
            organizationId,
          },
          {
            customerId,
            featureId: f.featureId,
            periodStart: f.periodStart,
            periodEnd: f.periodEnd,
            usageCutoffAt: usageWindowEnd,
            invoiceId,
            ...(f.subscriptionId !== undefined
              ? { subscriptionId: f.subscriptionId }
              : {}),
            ...(f.planId !== undefined ? { planId: f.planId } : {}),
            ...(f.pricingSnapshot !== undefined
              ? { pricingSnapshot: f.pricingSnapshot }
              : {}),
          },
        );

        if (ledgerMarked === null) {
          throw new Error(
            `[billing] Failed to mark usage as invoiced in UsageLedgerDO for ` +
              `customer=${customerId}, feature=${f.featureId}, invoice=${invoiceId}`,
          );
        }
      }
    };

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
      try {
        await applyInvoiceWrites(this.db);
      } catch (applyError) {
        if (!existingInvoice) {
          await this.db
            .delete(schema.invoices)
            .where(eq(schema.invoices.id, invoiceId));
        }
        throw applyError;
      }
    }

    const finalInvoice = await this.db.query.invoices.findFirst({
      where: eq(schema.invoices.id, invoiceId),
      with: {
        items: true,
      },
    });

    if (!finalInvoice) {
      throw new Error(
        `[billing] Invoice ${invoiceId} disappeared after creation`,
      );
    }

    const featureSlugById = new Map(
      unbilled.features.map((feature) => [
        feature.featureId,
        feature.featureSlug,
      ]),
    );

    return {
      invoiceId: finalInvoice.id,
      number: finalInvoice.number || existingInvoice?.number || invoiceNumber,
      status: finalInvoice.status,
      currency: finalInvoice.currency,
      subtotal: finalInvoice.subtotal,
      total: finalInvoice.total,
      items: finalInvoice.items.map(
        (item: (typeof finalInvoice.items)[number]) => {
          const metadata = (item.metadata || {}) as Record<string, unknown>;
          return {
            featureId: item.featureId || "unknown",
            featureSlug:
              featureSlugById.get(item.featureId || "") ||
              item.featureId ||
              "unknown",
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            periodStart: item.periodStart || 0,
            periodEnd: item.periodEnd || 0,
            ...(typeof metadata.ratingModel === "string"
              ? { ratingModel: metadata.ratingModel as RatingModel }
              : {}),
            ...(Array.isArray(metadata.tierBreakdown)
              ? {
                  tierBreakdown:
                    metadata.tierBreakdown as BillingTierBreakdown[],
                }
              : {}),
          };
        },
      ),
      periodStart: finalInvoice.periodStart,
      periodEnd: finalInvoice.periodEnd,
      usageWindowEnd: finalInvoice.usageWindowEnd || usageWindowEnd,
    };
  }

  async releaseInvoiceToUnbilledUsage(
    invoiceId: string,
    organizationId: string,
    options: {
      reason: string;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<
    Result<
      ReleaseInvoiceResult,
      NotFoundError | ValidationError | DatabaseError
    >
  > {
    return Result.tryPromise({
      try: async () => {
        const invoice = await this.db.query.invoices.findFirst({
          where: and(
            eq(schema.invoices.id, invoiceId),
            eq(schema.invoices.organizationId, organizationId),
          ),
        });

        if (!invoice) {
          throw new NotFoundError({ resource: "Invoice", id: invoiceId });
        }

        if (invoice.status !== "open") {
          throw new ValidationError({
            field: "invoice_status",
            details: `only open invoices can be released (current: ${invoice.status})`,
          });
        }

        const successfulAttempt = await this.db.query.paymentAttempts.findFirst(
          {
            where: and(
              eq(schema.paymentAttempts.invoiceId, invoiceId),
              eq(schema.paymentAttempts.status, "succeeded"),
            ),
          },
        );

        if (successfulAttempt) {
          throw new ValidationError({
            field: "invoice_status",
            details:
              "cannot release an invoice with a successful payment attempt",
          });
        }

        const releasedUsageRecords = await this.deps.releaseUsageInvoice(
          {
            usageLedger: this.opts?.usageLedger,
            organizationId,
          },
          invoiceId,
        );

        if (releasedUsageRecords === null) {
          throw new Error(
            `[billing] Failed to release invoiced usage in UsageLedgerDO for invoice=${invoiceId}`,
          );
        }

        const now = Date.now();
        const existingMetadata =
          typeof invoice.metadata === "object" && invoice.metadata
            ? (invoice.metadata as Record<string, unknown>)
            : {};

        await this.db
          .update(schema.invoices)
          .set({
            status: "void",
            amountDue: 0,
            updatedAt: now,
            metadata: {
              ...existingMetadata,
              release: {
                reason: options.reason,
                releasedUsageRecords,
                releasedAt: new Date(now).toISOString(),
                ...(options.metadata ?? {}),
              },
            },
          })
          .where(eq(schema.invoices.id, invoiceId));

        await this.deps.releaseCustomerOverageBlockForInvoice(
          this.db,
          invoiceId,
          {
            failureReason: options.reason,
            metadata: options.metadata ?? null,
          },
        );

        return {
          invoiceId,
          status: "void" as const,
          releasedUsageRecords,
        };
      },
      catch: (e) => {
        if (
          e instanceof NotFoundError ||
          e instanceof ValidationError ||
          e instanceof DatabaseError
        ) {
          return e;
        }
        return new DatabaseError({
          operation: "releaseInvoiceToUnbilledUsage",
          cause: e,
        });
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
