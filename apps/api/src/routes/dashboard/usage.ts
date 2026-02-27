import { Hono } from "hono";
import { eq, sql, desc, and, gte, lte } from "drizzle-orm";
import { schema } from "@owostack/db";
import type { Env, Variables } from "../../index";
import { convertMrrTotal } from "../../lib/exchange-rates";
import { trackBusinessEvent } from "../../lib/analytics-engine";
import {
  featureConsumptionForOrg,
  recentUsageForOrg,
  usageCountForOrg,
  usageTimeseriesForOrg,
} from "../../lib/usage-ledger";

const USAGE_CACHE_TTL = 60; // seconds
const FEATURE_CONSUMPTION_LIMIT = 10;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

type FeatureMetaRow = {
  id: string;
  name: string;
  slug: string;
  unit: string | null;
  type: string | null;
};

type CustomerMetaRow = {
  id: string;
  email: string;
  name: string | null;
};

// ---------------------------------------------------------------------------
// GET /  — Lightweight summary stats (loaded on page mount)
// ---------------------------------------------------------------------------
app.get("/", async (c) => {
  const organizationId = c.get("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  // Try KV cache first
  const cacheKey = `dashboard:usage:${organizationId}`;
  if (c.env.CACHE) {
    const cached = await c.env.CACHE.get(cacheKey, "json");
    if (cached) {
      trackBusinessEvent(c.env, {
        event: "dashboard.usage.cache",
        outcome: "hit",
        organizationId,
      });
      return c.json(cached);
    }
  }

  trackBusinessEvent(c.env, {
    event: "dashboard.usage.cache",
    outcome: "miss",
    organizationId,
  });

  const db = c.get("db");

  // Precompute timestamps used in multiple queries
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  // Run all summary queries in parallel (5 queries — no recent activity)
  const [
    customerCountResult,
    subscriptionsByStatusResult,
    customersPerPlanResult,
    customerGrowthResult,
  ] = await Promise.all([
    // 1. Total customers
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.customers)
      .where(eq(schema.customers.organizationId, organizationId)),

    // 2. Subscriptions by status
    db
      .select({
        status: schema.subscriptions.status,
        count: sql<number>`count(*)`,
      })
      .from(schema.subscriptions)
      .innerJoin(
        schema.customers,
        eq(schema.subscriptions.customerId, schema.customers.id),
      )
      .where(eq(schema.customers.organizationId, organizationId))
      .groupBy(schema.subscriptions.status),

    // 3. Customers per plan (with plan name and price) — active subs only
    //    Also used to derive activeSubscriptions count and MRR
    db
      .select({
        planId: schema.plans.id,
        planName: schema.plans.name,
        price: schema.plans.price,
        currency: schema.plans.currency,
        interval: schema.plans.interval,
        count: sql<number>`count(DISTINCT ${schema.subscriptions.customerId})`,
      })
      .from(schema.subscriptions)
      .innerJoin(schema.plans, eq(schema.subscriptions.planId, schema.plans.id))
      .innerJoin(
        schema.customers,
        eq(schema.subscriptions.customerId, schema.customers.id),
      )
      .where(
        and(
          eq(schema.customers.organizationId, organizationId),
          eq(schema.subscriptions.status, "active"),
        ),
      )
      .groupBy(schema.plans.id),

    // 4. Customer growth: new customers per day for last 30 days
    db
      .select({
        day: sql<string>`date(${schema.customers.createdAt} / 1000, 'unixepoch')`,
        count: sql<number>`count(*)`,
      })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.organizationId, organizationId),
          gte(schema.customers.createdAt, thirtyDaysAgo),
        ),
      )
      .groupBy(sql`date(${schema.customers.createdAt} / 1000, 'unixepoch')`)
      .orderBy(sql`date(${schema.customers.createdAt} / 1000, 'unixepoch')`),
  ]);

  const d1FeatureConsumption = await db
    .select({
      featureId: schema.features.id,
      featureName: schema.features.name,
      featureSlug: schema.features.slug,
      unit: schema.features.unit,
      type: schema.features.type,
      uniqueConsumers: sql<number>`count(DISTINCT ${schema.usageDailySummaries.customerId})`,
      totalUsage: sql<number>`COALESCE(sum(${schema.usageDailySummaries.amount}), 0)`,
    })
    .from(schema.usageDailySummaries)
    .innerJoin(
      schema.features,
      eq(schema.usageDailySummaries.featureId, schema.features.id),
    )
    .where(
      and(
        eq(schema.features.organizationId, organizationId),
        gte(
          schema.usageDailySummaries.date,
          new Date(monthStart).toISOString().split("T")[0],
        ),
      ),
    )
    .groupBy(schema.features.id)
    .orderBy(sql`sum(${schema.usageDailySummaries.amount}) DESC`)
    .limit(FEATURE_CONSUMPTION_LIMIT);

  let featureConsumptionResult = d1FeatureConsumption;
  const ledgerFeatureRows = await featureConsumptionForOrg(
    {
      usageLedger: c.env.USAGE_LEDGER,
      organizationId,
    },
    monthStart,
    FEATURE_CONSUMPTION_LIMIT,
  );
  if (ledgerFeatureRows) {
    const featureIds = [
      ...new Set(ledgerFeatureRows.map((row) => row.featureId)),
    ];
    if (featureIds.length === 0) {
      featureConsumptionResult = [];
    } else {
      const featureRows: FeatureMetaRow[] = await db
        .select({
          id: schema.features.id,
          name: schema.features.name,
          slug: schema.features.slug,
          unit: schema.features.unit,
          type: schema.features.type,
        })
        .from(schema.features)
        .where(
          and(
            eq(schema.features.organizationId, organizationId),
            sql`${schema.features.id} IN (${sql.join(
              featureIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          ),
        );

      const featureById = new Map<string, FeatureMetaRow>(
        featureRows.map((f: FeatureMetaRow) => [f.id, f]),
      );
      featureConsumptionResult = ledgerFeatureRows
        .map((row) => {
          const meta = featureById.get(row.featureId);
          if (!meta) return null;
          return {
            featureId: row.featureId,
            featureName: meta.name,
            featureSlug: meta.slug,
            unit: meta.unit,
            type: meta.type,
            uniqueConsumers: row.uniqueConsumers,
            totalUsage: row.totalUsage,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);
    }
  }

  const totalCustomers = customerCountResult[0]?.count || 0;

  // Derive active subscriptions count and MRR from the per-plan breakdown
  let activeSubscriptions = 0;
  const mrrByCurrency: Record<string, number> = {};
  for (const plan of customersPerPlanResult) {
    activeSubscriptions += plan.count;
    const monthlyPrice =
      plan.interval === "yearly"
        ? plan.price / 12
        : plan.interval === "quarterly"
          ? plan.price / 3
          : plan.price;
    const cur = (plan.currency || "USD").toUpperCase();
    mrrByCurrency[cur] = (mrrByCurrency[cur] || 0) + monthlyPrice * plan.count;
  }
  const mrr = Object.entries(mrrByCurrency).map(([currency, amount]) => ({
    currency,
    amount: Math.round(amount),
  }));

  // Resolve org default currency for converted total
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, organizationId),
    columns: { metadata: true },
  });
  const orgMeta = (org?.metadata as Record<string, unknown>) || {};
  const defaultCurrency =
    (orgMeta.defaultCurrency as string) || mrr[0]?.currency || "USD";

  const mrrTotal = await convertMrrTotal(mrr, defaultCurrency, c.env.CACHE);

  const response = {
    success: true,
    data: {
      totalCustomers,
      activeSubscriptions,
      mrr,
      mrrTotal,
      subscriptionsByStatus: subscriptionsByStatusResult,
      customersPerPlan: customersPerPlanResult,
      featureConsumption: featureConsumptionResult,
      customerGrowth: customerGrowthResult,
    },
  };

  // Cache the response in KV (non-blocking)
  if (c.env.CACHE) {
    c.executionCtx.waitUntil(
      c.env.CACHE.put(cacheKey, JSON.stringify(response), {
        expirationTtl: USAGE_CACHE_TTL,
      }),
    );
  }

  return c.json(response);
});

// ---------------------------------------------------------------------------
// GET /timeseries  — Daily usage breakdown for charting
// ---------------------------------------------------------------------------
app.get("/timeseries", async (c) => {
  const organizationId = c.get("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const days = Math.min(Number(c.req.query("days")) || 30, 90);
  const featureId = c.req.query("featureId") || null;
  const customerId = c.req.query("customerId") || null;

  const now = Date.now();
  const fromTs = now - days * 24 * 60 * 60 * 1000;
  const fromDate = new Date(fromTs).toISOString().split("T")[0];
  const toDate = new Date(now).toISOString().split("T")[0];

  const db = c.get("db");

  // Try ledger DO first
  const ledgerRows = await usageTimeseriesForOrg(
    { usageLedger: c.env.USAGE_LEDGER, organizationId },
    fromTs,
    now,
    featureId,
    customerId,
  );

  let timeseriesData: Array<{ date: string; featureId: string; totalUsage: number }>;

  if (ledgerRows) {
    timeseriesData = ledgerRows;
  } else {
    // Fallback to D1
    let query = db
      .select({
        date: schema.usageDailySummaries.date,
        featureId: schema.usageDailySummaries.featureId,
        totalUsage: sql<number>`COALESCE(sum(${schema.usageDailySummaries.amount}), 0)`,
      })
      .from(schema.usageDailySummaries)
      .where(
        and(
          eq(schema.usageDailySummaries.organizationId, organizationId),
          gte(schema.usageDailySummaries.date, fromDate),
          lte(schema.usageDailySummaries.date, toDate),
          ...(featureId ? [eq(schema.usageDailySummaries.featureId, featureId)] : []),
          ...(customerId ? [eq(schema.usageDailySummaries.customerId, customerId)] : []),
        ),
      )
      .groupBy(schema.usageDailySummaries.date, schema.usageDailySummaries.featureId)
      .orderBy(schema.usageDailySummaries.date);

    timeseriesData = await query;
  }

  // Enrich with feature names
  const featureIds = [...new Set(timeseriesData.map((r) => r.featureId))];
  let featureMeta: Array<{ id: string; name: string; slug: string }> = [];
  if (featureIds.length > 0) {
    featureMeta = await db
      .select({
        id: schema.features.id,
        name: schema.features.name,
        slug: schema.features.slug,
      })
      .from(schema.features)
      .where(
        and(
          eq(schema.features.organizationId, organizationId),
          sql`${schema.features.id} IN (${sql.join(
            featureIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      );
  }

  return c.json({
    success: true,
    data: timeseriesData,
    features: featureMeta,
    days,
  });
});

// ---------------------------------------------------------------------------
// GET /activity  — Paginated recent activity (lazy-loaded by frontend)
// ---------------------------------------------------------------------------
app.get("/activity", async (c) => {
  const organizationId = c.get("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const limit = Math.min(Number(c.req.query("limit")) || 20, 50);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

  const db = c.get("db");

  const ledgerRows = await recentUsageForOrg(
    {
      usageLedger: c.env.USAGE_LEDGER,
      organizationId,
    },
    limit,
    offset,
  );
  if (ledgerRows) {
    const [featureRows, customerRows, totalFromLedger] = await Promise.all([
      ledgerRows.length === 0
        ? ([] as FeatureMetaRow[])
        : db
            .select({
              id: schema.features.id,
              name: schema.features.name,
              slug: schema.features.slug,
              unit: schema.features.unit,
            })
            .from(schema.features)
            .where(
              and(
                eq(schema.features.organizationId, organizationId),
                sql`${schema.features.id} IN (${sql.join(
                  [...new Set(ledgerRows.map((row) => row.featureId))].map(
                    (id) => sql`${id}`,
                  ),
                  sql`, `,
                )})`,
              ),
            ),
      ledgerRows.length === 0
        ? ([] as CustomerMetaRow[])
        : db
            .select({
              id: schema.customers.id,
              email: schema.customers.email,
              name: schema.customers.name,
            })
            .from(schema.customers)
            .where(
              and(
                eq(schema.customers.organizationId, organizationId),
                sql`${schema.customers.id} IN (${sql.join(
                  [...new Set(ledgerRows.map((row) => row.customerId))].map(
                    (id) => sql`${id}`,
                  ),
                  sql`, `,
                )})`,
              ),
            ),
      usageCountForOrg({
        usageLedger: c.env.USAGE_LEDGER,
        organizationId,
      }),
    ]);

    const featureById = new Map<string, FeatureMetaRow>(
      featureRows.map((f: FeatureMetaRow) => [f.id, f]),
    );
    const customerById = new Map<string, CustomerMetaRow>(
      customerRows.map((row: CustomerMetaRow) => [row.id, row]),
    );
    const records = ledgerRows
      .map((row) => {
        const feature = featureById.get(row.featureId);
        const customer = customerById.get(row.customerId);
        if (!feature || !customer) return null;
        return {
          featureName: feature.name,
          featureSlug: feature.slug,
          unit: feature.unit,
          customerEmail: customer.email,
          customerName: customer.name,
          amount: row.amount,
          createdAt: row.createdAt,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return c.json({
      success: true,
      data: records,
      total: totalFromLedger ?? records.length,
      limit,
      offset,
    });
  }

  const [countResult, records] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.usageDailySummaries)
      .innerJoin(
        schema.features,
        eq(schema.usageDailySummaries.featureId, schema.features.id),
      )
      .where(eq(schema.features.organizationId, organizationId)),
    db
      .select({
        featureName: schema.features.name,
        featureSlug: schema.features.slug,
        unit: schema.features.unit,
        customerEmail: schema.customers.email,
        customerName: schema.customers.name,
        amount: schema.usageDailySummaries.amount,
        createdAt: schema.usageDailySummaries.updatedAt,
      })
      .from(schema.usageDailySummaries)
      .innerJoin(
        schema.features,
        eq(schema.usageDailySummaries.featureId, schema.features.id),
      )
      .innerJoin(
        schema.customers,
        eq(schema.usageDailySummaries.customerId, schema.customers.id),
      )
      .where(eq(schema.features.organizationId, organizationId))
      .orderBy(desc(schema.usageDailySummaries.updatedAt))
      .limit(limit)
      .offset(offset),
  ]);

  return c.json({
    success: true,
    data: records,
    total: countResult[0]?.count || 0,
    limit,
    offset,
  });
});

export default app;
