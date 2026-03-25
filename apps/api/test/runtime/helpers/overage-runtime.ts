import type { UsagePricingSnapshot } from "../../../src/lib/usage-pricing-snapshot";
import type {
  UsageLedgerDO,
  UsageLedgerRecord,
} from "../../../src/lib/usage-ledger-do";
import {
  insertSubscription,
  seedWorkflowBase,
  type TEST_ENCRYPTION_KEY,
} from "./workflow-runtime";

type StoredUsageRecord = Required<
  Pick<
    UsageLedgerRecord,
    | "customerId"
    | "featureId"
    | "amount"
    | "periodStart"
    | "periodEnd"
    | "createdAt"
    | "invoiceId"
  >
> &
  Pick<
    UsageLedgerRecord,
    | "id"
    | "featureSlug"
    | "featureName"
    | "entityId"
    | "subscriptionId"
    | "planId"
    | "pricingSnapshot"
  >;

function cloneRecord(record: StoredUsageRecord): StoredUsageRecord {
  return {
    ...record,
    pricingSnapshot: record.pricingSnapshot
      ? JSON.parse(JSON.stringify(record.pricingSnapshot))
      : null,
  };
}

function pricingSnapshotKey(snapshot?: UsagePricingSnapshot | null) {
  return snapshot ? JSON.stringify(snapshot) : "null";
}

class SimulatedUsageLedgerStub {
  constructor(private readonly records: StoredUsageRecord[]) {}

  async appendUsage(record: UsageLedgerRecord) {
    this.records.push({
      id: record.id || crypto.randomUUID(),
      customerId: record.customerId,
      featureId: record.featureId,
      featureSlug: record.featureSlug ?? null,
      featureName: record.featureName ?? null,
      entityId: record.entityId ?? null,
      amount: record.amount,
      periodStart: record.periodStart,
      periodEnd: record.periodEnd,
      subscriptionId: record.subscriptionId ?? null,
      planId: record.planId ?? null,
      pricingSnapshot: record.pricingSnapshot ?? null,
      invoiceId: record.invoiceId ?? null,
      createdAt: record.createdAt ?? Date.now(),
    });
    return { success: true };
  }

  async appendUsageBatch(records: UsageLedgerRecord[]) {
    for (const record of records) {
      await this.appendUsage(record);
    }
    return { inserted: records.length, total: records.length };
  }

  async sumUsage(query: {
    customerId: string;
    featureId: string;
    periodStart?: number;
    periodEnd?: number;
    createdAtFrom?: number;
    createdAtTo?: number;
    entityId?: string | null;
    unbilledOnly?: boolean;
  }) {
    return this.records
      .filter((record) => {
        if (record.customerId !== query.customerId) return false;
        if (record.featureId !== query.featureId) return false;
        if (
          typeof query.periodStart === "number" &&
          record.periodStart < query.periodStart
        ) {
          return false;
        }
        if (
          typeof query.periodEnd === "number" &&
          record.periodEnd > query.periodEnd
        ) {
          return false;
        }
        if (
          typeof query.createdAtFrom === "number" &&
          record.createdAt < query.createdAtFrom
        ) {
          return false;
        }
        if (
          typeof query.createdAtTo === "number" &&
          record.createdAt > query.createdAtTo
        ) {
          return false;
        }
        if (
          query.entityId !== undefined &&
          record.entityId !== query.entityId
        ) {
          return false;
        }
        if (query.unbilledOnly && record.invoiceId !== null) return false;
        return true;
      })
      .reduce((total, record) => total + record.amount, 0);
  }

  async markInvoiced(query: {
    customerId: string;
    featureId: string;
    periodStart: number;
    periodEnd: number;
    usageCutoffAt: number;
    invoiceId: string;
  }) {
    let updated = 0;
    for (const record of this.records) {
      if (record.customerId !== query.customerId) continue;
      if (record.featureId !== query.featureId) continue;
      if (record.periodStart < query.periodStart) continue;
      if (record.periodEnd > query.periodEnd) continue;
      if (record.createdAt > query.usageCutoffAt) continue;
      if (record.invoiceId !== null) continue;
      record.invoiceId = query.invoiceId;
      updated += 1;
    }
    return { updated };
  }

  async releaseInvoice(query: { invoiceId: string }) {
    let updated = 0;
    for (const record of this.records) {
      if (record.invoiceId !== query.invoiceId) continue;
      record.invoiceId = null;
      updated += 1;
    }
    return { updated };
  }

  async sumUnbilledByFeature(_customerId: string) {
    const totals = new Map<string, number>();
    for (const record of this.records) {
      if (record.customerId !== _customerId || record.invoiceId !== null) {
        continue;
      }
      totals.set(
        record.featureId,
        (totals.get(record.featureId) || 0) + record.amount,
      );
    }
    return [...totals.entries()].map(([featureId, totalUsage]) => ({
      featureId,
      totalUsage,
    }));
  }

  async sumUnbilledByFeaturePeriod(customerId: string, usageCutoffAt?: number) {
    const grouped = new Map<
      string,
      {
        featureId: string;
        featureSlug: string | null;
        featureName: string | null;
        periodStart: number;
        periodEnd: number;
        subscriptionId: string | null;
        planId: string | null;
        pricingSnapshot: UsagePricingSnapshot | null;
        totalUsage: number;
        lastCreatedAt: number;
      }
    >();

    for (const record of this.records) {
      if (record.customerId !== customerId || record.invoiceId !== null)
        continue;
      if (
        typeof usageCutoffAt === "number" &&
        record.createdAt > usageCutoffAt
      ) {
        continue;
      }

      const key = [
        record.featureId,
        record.featureSlug ?? "",
        record.featureName ?? "",
        record.periodStart,
        record.periodEnd,
        record.subscriptionId ?? "",
        record.planId ?? "",
        pricingSnapshotKey(record.pricingSnapshot),
      ].join("|");

      const existing = grouped.get(key);
      if (existing) {
        existing.totalUsage += record.amount;
        existing.lastCreatedAt = Math.max(
          existing.lastCreatedAt,
          record.createdAt,
        );
        continue;
      }

      grouped.set(key, {
        featureId: record.featureId,
        featureSlug: record.featureSlug ?? null,
        featureName: record.featureName ?? null,
        periodStart: record.periodStart,
        periodEnd: record.periodEnd,
        subscriptionId: record.subscriptionId ?? null,
        planId: record.planId ?? null,
        pricingSnapshot: record.pricingSnapshot ?? null,
        totalUsage: record.amount,
        lastCreatedAt: record.createdAt,
      });
    }

    return [...grouped.values()];
  }
}

export class SimulatedUsageLedgerNamespace {
  private readonly recordsByOrg = new Map<string, StoredUsageRecord[]>();

  idFromName(name: string) {
    return name;
  }

  get(id: string) {
    if (!this.recordsByOrg.has(id)) {
      this.recordsByOrg.set(id, []);
    }

    return new SimulatedUsageLedgerStub(
      this.recordsByOrg.get(id)!,
    ) as unknown as DurableObjectStub<UsageLedgerDO>;
  }

  listRecords(organizationId: string) {
    return (this.recordsByOrg.get(`org:${organizationId}`) || []).map(
      cloneRecord,
    );
  }
}

export async function insertFeature(
  db: D1Database,
  params: {
    id?: string;
    organizationId?: string;
    slug?: string;
    name?: string;
    type?: string;
    meterType?: string;
    source?: string;
  } = {},
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO features
       (id, organization_id, name, slug, type, meter_type, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id || "feature_1",
      params.organizationId || "org_1",
      params.name || "Agent Runs",
      params.slug || "agent-runs",
      params.type || "metered",
      params.meterType || "consumable",
      params.source || "dashboard",
      now,
    )
    .run();
}

export async function insertPlanFeature(
  db: D1Database,
  params: {
    id?: string;
    planId?: string;
    featureId?: string;
    limitValue?: number | null;
    resetInterval?: string;
    resetOnEnable?: number;
    rolloverEnabled?: number;
    rolloverMaxBalance?: number | null;
    usageModel?: string;
    pricePerUnit?: number | null;
    billingUnits?: number;
    ratingModel?: string;
    tiers?: Array<{
      upTo: number | null;
      unitPrice?: number;
      flatFee?: number;
    }> | null;
    maxPurchaseLimit?: number | null;
    creditCost?: number;
    overage?: string;
    overagePrice?: number | null;
    maxOverageUnits?: number | null;
  } = {},
) {
  await db
    .prepare(
      `INSERT INTO plan_features
       (id, plan_id, feature_id, limit_value, reset_interval, reset_on_enable, rollover_enabled, rollover_max_balance, usage_model, price_per_unit, billing_units, rating_model, tiers, max_purchase_limit, credit_cost, overage, overage_price, max_overage_units)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id || "plan_feature_1",
      params.planId || "plan_1",
      params.featureId || "feature_1",
      params.limitValue ?? 1000,
      params.resetInterval || "monthly",
      params.resetOnEnable ?? 1,
      params.rolloverEnabled ?? 0,
      params.rolloverMaxBalance ?? null,
      params.usageModel || "included",
      params.pricePerUnit ?? null,
      params.billingUnits ?? 100,
      params.ratingModel || "package",
      params.tiers ? JSON.stringify(params.tiers) : null,
      params.maxPurchaseLimit ?? null,
      params.creditCost ?? 0,
      params.overage || "charge",
      params.overagePrice ?? 5000,
      params.maxOverageUnits ?? null,
    )
    .run();
}

export async function insertOverageSettings(
  db: D1Database,
  params: {
    id?: string;
    organizationId?: string;
    billingInterval?: string;
    thresholdAmount?: number | null;
    autoCollect?: number;
    gracePeriodHours?: number;
  } = {},
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO overage_settings
       (id, organization_id, billing_interval, threshold_amount, auto_collect, grace_period_hours, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id || "overage_settings_1",
      params.organizationId || "org_1",
      params.billingInterval || "end_of_period",
      params.thresholdAmount ?? null,
      params.autoCollect ?? 1,
      params.gracePeriodHours ?? 0,
      now,
      now,
    )
    .run();
}

export async function insertBillingRun(
  db: D1Database,
  params: {
    id?: string;
    organizationId?: string;
    customerId?: string;
    trigger?: string;
    status?: string;
    idempotencyKey?: string;
    activeLockKey?: string | null;
    thresholdAmount?: number | null;
    usageWindowStart?: number | null;
    usageWindowEnd?: number;
    invoiceId?: string | null;
    failureReason?: string | null;
    metadata?: Record<string, unknown> | null;
  } = {},
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO billing_runs
       (id, organization_id, customer_id, trigger, status, idempotency_key, active_lock_key, threshold_amount, usage_window_start, usage_window_end, invoice_id, failure_reason, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id || "run_1",
      params.organizationId || "org_1",
      params.customerId || "cust_1",
      params.trigger || "threshold",
      params.status || "pending",
      params.idempotencyKey || "threshold:org_1:cust_1:2500",
      params.activeLockKey === undefined
        ? "threshold:cust_1"
        : params.activeLockKey,
      params.thresholdAmount ?? 20000,
      params.usageWindowStart ?? null,
      params.usageWindowEnd ?? 2500,
      params.invoiceId ?? null,
      params.failureReason ?? null,
      params.metadata
        ? JSON.stringify(params.metadata)
        : JSON.stringify({
            effectiveThreshold: params.thresholdAmount ?? 20000,
          }),
      now,
      now,
    )
    .run();
}

export async function insertInvoice(
  db: D1Database,
  params: {
    id?: string;
    organizationId?: string;
    customerId?: string;
    subscriptionId?: string | null;
    number?: string;
    idempotencyKey?: string;
    status?: string;
    currency?: string;
    subtotal?: number;
    total?: number;
    amountPaid?: number;
    amountDue?: number;
    periodStart?: number;
    periodEnd?: number;
    usageWindowStart?: number | null;
    usageWindowEnd?: number;
    usageCutoffAt?: number;
    metadata?: Record<string, unknown> | null;
  } = {},
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO invoices
       (id, organization_id, customer_id, subscription_id, number, idempotency_key, status, currency, subtotal, tax, total, amount_paid, amount_due, period_start, period_end, usage_window_start, usage_window_end, usage_cutoff_at, due_at, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id || "inv_1",
      params.organizationId || "org_1",
      params.customerId || "cust_1",
      params.subscriptionId ?? "sub_1",
      params.number || "INV-00001-TEST",
      params.idempotencyKey || "threshold:org_1:cust_1:2500",
      params.status || "open",
      params.currency || "USD",
      params.subtotal ?? 25000,
      params.total ?? 25000,
      params.amountPaid ?? 0,
      params.amountDue ?? params.total ?? 25000,
      params.periodStart ?? 1000,
      params.periodEnd ?? 2000,
      params.usageWindowStart ?? null,
      params.usageWindowEnd ?? 2500,
      params.usageCutoffAt ?? 2500,
      now + 7 * 24 * 60 * 60 * 1000,
      params.metadata
        ? JSON.stringify(params.metadata)
        : JSON.stringify({
            sourceTrigger: "threshold",
          }),
      now,
      now,
    )
    .run();
}

export async function insertPaymentAttempt(
  db: D1Database,
  params: {
    id?: string;
    invoiceId?: string;
    amount?: number;
    currency?: string;
    status?: string;
    provider?: string | null;
    providerReference?: string | null;
    attemptNumber?: number;
    lastError?: string | null;
  } = {},
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO payment_attempts
       (id, invoice_id, amount, currency, status, provider, provider_reference, attempt_number, last_error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id || crypto.randomUUID(),
      params.invoiceId || "inv_1",
      params.amount ?? 25000,
      params.currency || "USD",
      params.status || "succeeded",
      params.provider ?? "paystack",
      params.providerReference ?? "ch_123",
      params.attemptNumber ?? 1,
      params.lastError ?? null,
      now,
    )
    .run();
}

export async function seedOverageWorkflowBase(
  db: D1Database,
  params: {
    organizationId?: string;
    customer?: Parameters<typeof seedWorkflowBase>[1]["customer"];
    providerAccount?: Parameters<typeof seedWorkflowBase>[1]["providerAccount"];
    plan?: Parameters<typeof seedWorkflowBase>[1]["plan"];
    paymentMethod?:
      | Parameters<typeof seedWorkflowBase>[1]["paymentMethods"][number]
      | null;
    subscription?: Parameters<typeof insertSubscription>[1];
    feature?: Parameters<typeof insertFeature>[1];
    planFeature?: Parameters<typeof insertPlanFeature>[1];
  } = {},
) {
  const organizationId = params.organizationId || "org_1";
  const customerId = params.customer?.id || "cust_1";
  const planId = params.plan?.id || "plan_1";

  await seedWorkflowBase(db, {
    organizationId,
    providerAccount: params.providerAccount,
    customer: params.customer,
    plan: {
      currency: "USD",
      ...(params.plan || {}),
    },
    paymentMethods:
      params.paymentMethod === null
        ? []
        : params.paymentMethod
          ? [params.paymentMethod]
          : [
              {
                id: "pm_1",
                providerId: "paystack",
                token: "AUTH_123",
                isDefault: 1,
              },
            ],
  });

  await insertSubscription(db, {
    id: "sub_1",
    customerId,
    planId,
    providerId:
      params.subscription?.providerId ??
      params.paymentMethod?.providerId ??
      "paystack",
    providerSubscriptionCode: "sub_code_1",
    status: "active",
    ...(params.subscription || {}),
  });
  await insertFeature(db, {
    organizationId,
    ...(params.feature || {}),
  });
  await insertPlanFeature(db, {
    planId,
    featureId: params.feature?.id || "feature_1",
    ...(params.planFeature || {}),
  });
}
