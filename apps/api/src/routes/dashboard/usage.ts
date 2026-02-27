import { Hono } from "hono";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import { schema } from "@owostack/db";
import type { Env, Variables } from "../../index";
import { convertMrrTotal } from "../../lib/exchange-rates";

const USAGE_CACHE_TTL = 60; // seconds
const FEATURE_CONSUMPTION_LIMIT = 10;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET /  — Lightweight summary stats (loaded on page mount)
// ---------------------------------------------------------------------------
app.get("/", async (c) => {
  const organizationId = c.req.query("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  // Try KV cache first
  const cacheKey = `dashboard:usage:${organizationId}`;
  if (c.env.CACHE) {
    const cached = await c.env.CACHE.get(cacheKey, "json");
    if (cached) {
      return c.json(cached);
    }
  }

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
    featureConsumptionResult,
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

    // 4. Feature consumption: top N features by usage (current month)
    db
      .select({
        featureId: schema.features.id,
        featureName: schema.features.name,
        featureSlug: schema.features.slug,
        unit: schema.features.unit,
        type: schema.features.type,
        uniqueConsumers: sql<number>`count(DISTINCT ${schema.usageRecords.customerId})`,
        totalUsage: sql<number>`COALESCE(sum(${schema.usageRecords.amount}), 0)`,
      })
      .from(schema.usageRecords)
      .innerJoin(
        schema.features,
        eq(schema.usageRecords.featureId, schema.features.id),
      )
      .where(
        and(
          eq(schema.features.organizationId, organizationId),
          gte(schema.usageRecords.createdAt, monthStart),
        ),
      )
      .groupBy(schema.features.id)
      .orderBy(sql`sum(${schema.usageRecords.amount}) DESC`)
      .limit(FEATURE_CONSUMPTION_LIMIT),

    // 5. Customer growth: new customers per day for last 30 days
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

  const totalCustomers = customerCountResult[0]?.count || 0;

  // Derive active subscriptions count and MRR from the per-plan breakdown
  let activeSubscriptions = 0;
  const mrrByCurrency: Record<string, number> = {};
  for (const plan of customersPerPlanResult) {
    activeSubscriptions += plan.count;
    const monthlyPrice =
      plan.interval === "yearly" ? plan.price / 12 :
      plan.interval === "quarterly" ? plan.price / 3 :
      plan.price;
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
  const defaultCurrency = (orgMeta.defaultCurrency as string) || mrr[0]?.currency || "USD";

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
// GET /activity  — Paginated recent activity (lazy-loaded by frontend)
// ---------------------------------------------------------------------------
app.get("/activity", async (c) => {
  const organizationId = c.req.query("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const limit = Math.min(Number(c.req.query("limit")) || 20, 50);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

  const db = c.get("db");

  const [countResult, records] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.usageRecords)
      .innerJoin(
        schema.features,
        eq(schema.usageRecords.featureId, schema.features.id),
      )
      .where(eq(schema.features.organizationId, organizationId)),
    db
      .select({
        featureName: schema.features.name,
        featureSlug: schema.features.slug,
        unit: schema.features.unit,
        customerEmail: schema.customers.email,
        customerName: schema.customers.name,
        amount: schema.usageRecords.amount,
        createdAt: schema.usageRecords.createdAt,
      })
      .from(schema.usageRecords)
      .innerJoin(
        schema.features,
        eq(schema.usageRecords.featureId, schema.features.id),
      )
      .innerJoin(
        schema.customers,
        eq(schema.usageRecords.customerId, schema.customers.id),
      )
      .where(eq(schema.features.organizationId, organizationId))
      .orderBy(desc(schema.usageRecords.createdAt))
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
