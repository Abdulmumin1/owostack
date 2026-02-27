import type {
  UsageLedgerDO,
  UsageLedgerRecord,
  UsageSumQuery,
} from "./usage-ledger-do";
import { schema } from "@owostack/db";
import { eq, gte, and } from "drizzle-orm";

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

/**
 * Rehydrate UsageLedgerDO from D1 daily aggregates
 * Call this when DO returns empty/no data to backfill from D1
 */
export async function rehydrateUsageLedger(
  opts: UsageLedgerOptions,
  db: any,
  customerIds?: string[], // Optional: specific customers, otherwise all in org
  daysBack = 30, // How many days of history to load
): Promise<{ inserted: number; success: boolean }> {
  const stub = getStub(opts);
  if (!stub) return { inserted: 0, success: false };

  try {
    // Calculate date range
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Build query
    let query = db
      .select({
        customerId: schema.usageDailySummaries.customerId,
        featureId: schema.usageDailySummaries.featureId,
        date: schema.usageDailySummaries.date,
        amount: schema.usageDailySummaries.amount,
        updatedAt: schema.usageDailySummaries.updatedAt,
      })
      .from(schema.usageDailySummaries)
      .where(
        and(
          eq(
            schema.usageDailySummaries.organizationId,
            opts.organizationId || "",
          ),
          gte(
            schema.usageDailySummaries.date,
            startDate.toISOString().split("T")[0],
          ),
        ),
      );

    // Filter to specific customers if provided
    if (customerIds && customerIds.length > 0) {
      // Note: This would need sql`IN (${...}) syntax, simplified here
      // In production, use proper parameterized IN clause
    }

    const aggregates = await query;

    if (aggregates.length === 0) {
      console.log("[usage-ledger] No aggregates found for rehydration");
      return { inserted: 0, success: true };
    }

    // Call DO rehydration method
    const result = await stub.rehydrateFromAggregates(aggregates);

    console.log(
      `[usage-ledger] Rehydrated ${result.inserted} records from ${aggregates.length} aggregates`,
    );

    return { inserted: result.inserted, success: true };
  } catch (error) {
    console.error("[usage-ledger] Rehydration failed:", error);
    return { inserted: 0, success: false };
  }
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

export async function listRecentUsageForCustomer(
  opts: UsageLedgerOptions,
  customerId: string,
  limit = 20,
): Promise<Array<{
  id: string;
  featureId: string;
  amount: number;
  createdAt: number;
}> | null> {
  const stub = getStub(opts);
  if (!stub) return null;

  try {
    return await stub.listRecentUsageForCustomer(customerId, limit);
  } catch (error) {
    console.error("[usage-ledger] listRecentUsageForCustomer failed:", error);
    return null;
  }
}

export async function featureUsageSummaryForCustomer(
  opts: UsageLedgerOptions,
  customerId: string,
  createdAtFrom: number,
): Promise<Array<{
  featureId: string;
  totalUsage: number;
  recordCount: number;
}> | null> {
  const stub = getStub(opts);
  if (!stub) return null;

  try {
    return await stub.featureUsageSummaryForCustomer(customerId, createdAtFrom);
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
): Promise<Array<{
  featureId: string;
  uniqueConsumers: number;
  totalUsage: number;
}> | null> {
  const stub = getStub(opts);
  if (!stub) return null;

  try {
    return await stub.featureConsumptionForOrg(createdAtFrom, limit);
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
    return await stub.usageTimeseriesForOrg(createdAtFrom, createdAtTo, featureId, customerId);
  } catch (error) {
    console.error("[usage-ledger] usageTimeseriesForOrg failed:", error);
    return null;
  }
}
