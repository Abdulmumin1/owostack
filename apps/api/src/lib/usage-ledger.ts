import type {
  CustomerUsageLedgerScope,
  UsageLedgerDO,
  UsageLedgerRecord,
  UnbilledUsagePeriodRow,
  UsageSumQuery,
} from "./usage-ledger-do";
import type { UsagePricingSnapshot } from "./usage-pricing-snapshot";

interface UsageLedgerOptions {
  usageLedger?: DurableObjectNamespace<UsageLedgerDO>;
  organizationId?: string | null;
}

function getStub(
  opts: UsageLedgerOptions,
): DurableObjectStub<UsageLedgerDO> | null {
  if (!opts.usageLedger || !opts.organizationId) return null;
  const id = opts.usageLedger.idFromName(`org:${opts.organizationId}`);
  return opts.usageLedger.get(id);
}

export async function appendUsageRecord(
  opts: UsageLedgerOptions,
  record: UsageLedgerRecord,
): Promise<boolean> {
  const stub = getStub(opts);
  if (!stub) return false;

  try {
    await stub.appendUsage(record);
    return true;
  } catch (error) {
    console.error("[usage-ledger] appendUsageRecord failed:", error);
    return false;
  }
}

export async function appendUsageBatch(
  opts: UsageLedgerOptions,
  records: UsageLedgerRecord[],
): Promise<{ inserted: number; total: number } | null> {
  if (records.length === 0) {
    return { inserted: 0, total: 0 };
  }

  const stub = getStub(opts);
  if (!stub) return null;

  try {
    return await stub.appendUsageBatch(records);
  } catch (error) {
    console.error("[usage-ledger] appendUsageBatch failed:", error);
    return null;
  }
}

export async function sumUsageAmount(
  opts: UsageLedgerOptions,
  query: UsageSumQuery,
): Promise<number | null> {
  const stub = getStub(opts);
  if (!stub) return null;

  try {
    const total = await stub.sumUsage(query);
    return Number(total || 0);
  } catch (error) {
    console.error("[usage-ledger] sumUsageAmount failed:", error);
    return null;
  }
}

export async function markUsageInvoiced(
  opts: UsageLedgerOptions,
  query: {
    customerId: string;
    featureId: string;
    periodStart: number;
    periodEnd: number;
    usageCutoffAt: number;
    invoiceId: string;
    subscriptionId?: string | null;
    planId?: string | null;
    pricingSnapshot?: UsagePricingSnapshot | null;
  },
): Promise<number | null> {
  const stub = getStub(opts);
  if (!stub) return null;

  try {
    const result = await stub.markInvoiced(query);
    return Number(result?.updated || 0);
  } catch (error) {
    console.error("[usage-ledger] markUsageInvoiced failed:", error);
    return null;
  }
}

export async function releaseUsageInvoice(
  opts: UsageLedgerOptions,
  invoiceId: string,
): Promise<number | null> {
  const stub = getStub(opts);
  if (!stub) return null;

  try {
    const result = await stub.releaseInvoice({ invoiceId });
    return Number(result?.updated || 0);
  } catch (error) {
    console.error("[usage-ledger] releaseUsageInvoice failed:", error);
    return null;
  }
}

export async function sumUnbilledByFeature(
  opts: UsageLedgerOptions,
  customerId: string,
): Promise<Array<{ featureId: string; totalUsage: number }> | null> {
  const stub = getStub(opts);
  if (!stub) return null;

  try {
    return await stub.sumUnbilledByFeature(customerId);
  } catch (error) {
    console.error("[usage-ledger] sumUnbilledByFeature failed:", error);
    return null;
  }
}

export async function sumUnbilledByFeaturePeriod(
  opts: UsageLedgerOptions,
  customerId: string,
  usageCutoffAt?: number,
): Promise<UnbilledUsagePeriodRow[] | null> {
  const stub = getStub(opts);
  if (!stub) return null;

  try {
    return await stub.sumUnbilledByFeaturePeriod(customerId, usageCutoffAt);
  } catch (error) {
    console.error("[usage-ledger] sumUnbilledByFeaturePeriod failed:", error);
    return null;
  }
}

export async function listRecentUsageForCustomer(
  opts: UsageLedgerOptions,
  customerId: string,
  limit = 20,
  scope?: CustomerUsageLedgerScope,
): Promise<Array<{
  id: string;
  featureId: string;
  amount: number;
  createdAt: number;
}> | null> {
  const stub = getStub(opts);
  if (!stub) return null;

  try {
    return await stub.listRecentUsageForCustomer(customerId, limit, scope);
  } catch (error) {
    console.error("[usage-ledger] listRecentUsageForCustomer failed:", error);
    return null;
  }
}

export async function featureUsageSummaryForCustomer(
  opts: UsageLedgerOptions,
  customerId: string,
  createdAtFrom: number,
  scope?: CustomerUsageLedgerScope,
): Promise<Array<{
  featureId: string;
  totalUsage: number;
  recordCount: number;
}> | null> {
  const stub = getStub(opts);
  if (!stub) return null;

  try {
    return await stub.featureUsageSummaryForCustomer(
      customerId,
      createdAtFrom,
      scope,
    );
  } catch (error) {
    console.error(
      "[usage-ledger] featureUsageSummaryForCustomer failed:",
      error,
    );
    return null;
  }
}

export async function featureConsumptionForOrg(
  opts: UsageLedgerOptions,
  createdAtFrom: number,
  limit = 10,
  customerId?: string | null,
): Promise<Array<{
  featureId: string;
  uniqueConsumers: number;
  totalUsage: number;
}> | null> {
  const stub = getStub(opts);
  if (!stub) return null;

  try {
    return await stub.featureConsumptionForOrg(
      createdAtFrom,
      limit,
      customerId,
    );
  } catch (error) {
    console.error("[usage-ledger] featureConsumptionForOrg failed:", error);
    return null;
  }
}

export async function recentUsageForOrg(
  opts: UsageLedgerOptions,
  limit = 20,
  offset = 0,
): Promise<Array<{
  featureId: string;
  customerId: string;
  amount: number;
  createdAt: number;
}> | null> {
  const stub = getStub(opts);
  if (!stub) return null;

  try {
    return await stub.recentUsageForOrg(limit, offset);
  } catch (error) {
    console.error("[usage-ledger] recentUsageForOrg failed:", error);
    return null;
  }
}

export async function usageCountForOrg(
  opts: UsageLedgerOptions,
): Promise<number | null> {
  const stub = getStub(opts);
  if (!stub) return null;

  try {
    return await stub.usageCountForOrg();
  } catch (error) {
    console.error("[usage-ledger] usageCountForOrg failed:", error);
    return null;
  }
}

export async function usageTimeseriesForOrg(
  opts: UsageLedgerOptions,
  createdAtFrom: number,
  createdAtTo: number,
  featureId?: string | null,
  customerId?: string | null,
): Promise<Array<{
  date: string;
  featureId: string;
  totalUsage: number;
}> | null> {
  const stub = getStub(opts);
  if (!stub) return null;

  try {
    return await stub.usageTimeseriesForOrg(
      createdAtFrom,
      createdAtTo,
      featureId,
      customerId,
    );
  } catch (error) {
    console.error("[usage-ledger] usageTimeseriesForOrg failed:", error);
    return null;
  }
}
