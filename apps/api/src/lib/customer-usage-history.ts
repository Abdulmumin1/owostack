import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { schema } from "@owostack/db";
import type { Env } from "../index";
import { listUsageForCustomerRange } from "./usage-ledger";

export type UsageHistoryGranularity = "day" | "week" | "month";
export type UsageHistoryRange = "7d" | "30d" | "90d" | "custom";
export type UsageHistoryGroupBy = "total" | "feature";

export type UsageHistoryQuery = {
  range: UsageHistoryRange;
  granularity: UsageHistoryGranularity;
  groupBy: UsageHistoryGroupBy;
  timezone: string;
  from?: string;
  to?: string;
  featureId?: string | null;
  featureRef?: string | null;
};

export type UsageHistoryScope = {
  planId?: string | null;
  subscriptionIds?: string[] | null;
  featureIds?: string[] | null;
};

type UsageSourceRow = {
  featureId: string;
  dayKey: string;
  amount: number;
  records: number;
};

type HistoryFeatureMeta = {
  id: string;
  slug: string | null;
  name: string;
  unit: string | null;
};

export type UsageHistoryResult = {
  customer: {
    id: string;
  };
  query: {
    range: {
      from: string;
      to: string;
    };
    granularity: UsageHistoryGranularity;
    feature: string | null;
    groupBy: UsageHistoryGroupBy;
    timezone: string;
  };
  totals: {
    usage: number;
    records: number;
  };
  series: Array<{
    bucket: string;
    value: number;
  }>;
  breakdown: Array<{
    feature: HistoryFeatureMeta;
    totals: {
      usage: number;
      records: number;
    };
    series: Array<{
      bucket: string;
      value: number;
    }>;
  }>;
};

function getDayFormatter(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatDayKey(timestamp: number, timezone: string) {
  const parts = getDayFormatter(timezone).formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Failed to format date for timezone ${timezone}`);
  }

  return `${year}-${month}-${day}`;
}

function parseDayKey(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toDayKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDayKey(dayKey: string, days: number) {
  const date = parseDayKey(dayKey);
  date.setUTCDate(date.getUTCDate() + days);
  return toDayKey(date);
}

function getWeekBucket(dayKey: string) {
  const date = parseDayKey(dayKey);
  const weekday = date.getUTCDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  return shiftDayKey(dayKey, diff);
}

function getBucketKey(
  dayKey: string,
  granularity: UsageHistoryGranularity,
): string {
  if (granularity === "week") return getWeekBucket(dayKey);
  if (granularity === "month") return dayKey.slice(0, 7);
  return dayKey;
}

function listBucketKeys(
  fromDayKey: string,
  toDayKey: string,
  granularity: UsageHistoryGranularity,
) {
  const buckets: string[] = [];
  let cursor = fromDayKey;

  while (cursor <= toDayKey) {
    const bucket = getBucketKey(cursor, granularity);
    if (buckets[buckets.length - 1] !== bucket) {
      buckets.push(bucket);
    }
    cursor = shiftDayKey(cursor, 1);
  }

  return buckets;
}

function resolveRangeWindow(
  range: UsageHistoryRange,
  timezone: string,
  from?: string,
  to?: string,
) {
  if (range === "custom") {
    if (!from || !to) {
      throw new Error("Custom range requires from and to");
    }
    if (from > to) {
      throw new Error("Custom range must have from <= to");
    }
    return { from, to };
  }

  const dayCount = Number.parseInt(range.replace("d", ""), 10);
  const end = formatDayKey(Date.now(), timezone);
  const start = shiftDayKey(end, -(dayCount - 1));
  return { from: start, to: end };
}

async function loadUsageSourceRows(params: {
  db: any;
  env: Env;
  organizationId: string;
  customerId: string;
  timezone: string;
  fromDayKey: string;
  toDayKey: string;
  featureId?: string | null;
  scope?: UsageHistoryScope;
}): Promise<UsageSourceRow[]> {
  const expandedFrom = shiftDayKey(params.fromDayKey, -1);
  const expandedTo = shiftDayKey(params.toDayKey, 1);
  const createdAtFrom = Date.parse(`${expandedFrom}T00:00:00.000Z`);
  const createdAtTo = Date.parse(`${expandedTo}T23:59:59.999Z`);

  const ledgerRows = await listUsageForCustomerRange(
    {
      usageLedger: params.env.USAGE_LEDGER,
      organizationId: params.organizationId,
    },
    params.customerId,
    createdAtFrom,
    createdAtTo,
    params.featureId,
    {
      planId: params.scope?.planId,
      subscriptionIds: params.scope?.subscriptionIds,
    },
  );

  if (ledgerRows) {
    return ledgerRows
      .map((row) => ({
        featureId: row.featureId,
        dayKey: formatDayKey(row.createdAt, params.timezone),
        amount: row.amount,
        records: 1,
      }))
      .filter(
        (row) => row.dayKey >= params.fromDayKey && row.dayKey <= params.toDayKey,
      );
  }

  const dailyRows = await params.db
    .select({
      dayKey: schema.usageDailySummaries.date,
      featureId: schema.usageDailySummaries.featureId,
      amount: sql<number>`COALESCE(sum(${schema.usageDailySummaries.amount}), 0)`,
      records: sql<number>`count(*)`,
    })
    .from(schema.usageDailySummaries)
    .where(
      and(
        eq(schema.usageDailySummaries.organizationId, params.organizationId),
        eq(schema.usageDailySummaries.customerId, params.customerId),
        gte(schema.usageDailySummaries.date, expandedFrom),
        lte(schema.usageDailySummaries.date, expandedTo),
        params.featureId
          ? eq(schema.usageDailySummaries.featureId, params.featureId)
          : params.scope?.featureIds && params.scope.featureIds.length > 0
            ? inArray(
                schema.usageDailySummaries.featureId,
                params.scope.featureIds,
              )
            : undefined,
      ),
    )
    .groupBy(
      schema.usageDailySummaries.date,
      schema.usageDailySummaries.featureId,
    )
    .orderBy(schema.usageDailySummaries.date);

  return dailyRows
    .map((row) => ({
      featureId: row.featureId,
      dayKey: row.dayKey,
      amount: Number(row.amount || 0),
      records: Number(row.records || 0),
    }))
    .filter(
      (row) => row.dayKey >= params.fromDayKey && row.dayKey <= params.toDayKey,
    );
}

async function loadFeatureMeta(
  db: any,
  organizationId: string,
  featureIds: string[],
): Promise<Map<string, HistoryFeatureMeta>> {
  if (featureIds.length === 0) return new Map();

  const features = await db
    .select({
      id: schema.features.id,
      slug: schema.features.slug,
      name: schema.features.name,
      unit: schema.features.unit,
    })
    .from(schema.features)
    .where(
      and(
        eq(schema.features.organizationId, organizationId),
        inArray(schema.features.id, featureIds),
      ),
    );

  return new Map(
    features.map((feature) => [
      feature.id,
      {
        id: feature.id,
        slug: feature.slug,
        name: feature.name,
        unit: feature.unit,
      },
    ]),
  );
}

export async function buildCustomerUsageHistory(params: {
  db: any;
  env: Env;
  organizationId: string;
  customerId: string;
  query: UsageHistoryQuery;
  scope?: UsageHistoryScope;
}): Promise<UsageHistoryResult> {
  const { from, to } = resolveRangeWindow(
    params.query.range,
    params.query.timezone,
    params.query.from,
    params.query.to,
  );

  const sourceRows = await loadUsageSourceRows({
    db: params.db,
    env: params.env,
    organizationId: params.organizationId,
    customerId: params.customerId,
    timezone: params.query.timezone,
    fromDayKey: from,
    toDayKey: to,
    featureId: params.query.featureId,
    scope: params.scope,
  });

  const bucketKeys = listBucketKeys(from, to, params.query.granularity);
  const totalByBucket = new Map<string, number>(
    bucketKeys.map((bucket) => [bucket, 0]),
  );
  const groupedByFeature = new Map<
    string,
    {
      usage: number;
      records: number;
      series: Map<string, number>;
    }
  >();

  let totalUsage = 0;
  let totalRecords = 0;

  for (const row of sourceRows) {
    const bucket = getBucketKey(row.dayKey, params.query.granularity);
    if (!totalByBucket.has(bucket)) continue;

    totalByBucket.set(bucket, (totalByBucket.get(bucket) || 0) + row.amount);
    totalUsage += row.amount;
    totalRecords += row.records;

    if (params.query.groupBy !== "feature") continue;

    const existing = groupedByFeature.get(row.featureId) ?? {
      usage: 0,
      records: 0,
      series: new Map(bucketKeys.map((bucketKey) => [bucketKey, 0])),
    };

    existing.usage += row.amount;
    existing.records += row.records;
    existing.series.set(bucket, (existing.series.get(bucket) || 0) + row.amount);
    groupedByFeature.set(row.featureId, existing);
  }

  const breakdown =
    params.query.groupBy === "feature"
      ? (() => {
          const featureById = loadFeatureMeta(
            params.db,
            params.organizationId,
            [...groupedByFeature.keys()],
          );
          return featureById.then((featureMeta) =>
            [...groupedByFeature.entries()]
              .map(([featureId, value]) => {
                const feature = featureMeta.get(featureId);
                if (!feature) return null;

                return {
                  feature,
                  totals: {
                    usage: value.usage,
                    records: value.records,
                  },
                  series: bucketKeys.map((bucket) => ({
                    bucket,
                    value: value.series.get(bucket) || 0,
                  })),
                };
              })
              .filter(
                (
                  row,
                ): row is NonNullable<typeof row> =>
                  row !== null,
              )
              .sort((left, right) => right.totals.usage - left.totals.usage),
          );
        })()
      : Promise.resolve([]);

  return {
    customer: {
      id: params.customerId,
    },
    query: {
      range: {
        from,
        to,
      },
      granularity: params.query.granularity,
      feature: params.query.featureRef || null,
      groupBy: params.query.groupBy,
      timezone: params.query.timezone,
    },
    totals: {
      usage: totalUsage,
      records: totalRecords,
    },
    series: bucketKeys.map((bucket) => ({
      bucket,
      value: totalByBucket.get(bucket) || 0,
    })),
    breakdown: await breakdown,
  };
}
