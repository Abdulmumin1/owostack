import { Hono } from "hono";
import { z } from "zod";
import { eq, and, desc, gte, sql, like, or } from "drizzle-orm";
import { schema } from "@owostack/db";
import { EntitlementCache } from "../../lib/cache";
import {
  featureUsageSummaryForCustomer,
  listRecentUsageForCustomer,
} from "../../lib/usage-ledger";
import { listRecentEvents } from "../../lib/analytics-engine";
import type { Env, Variables } from "../../index";
import { zodErrorToResponse } from "../../lib/validation";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

type FeatureMetaRow = {
  id: string;
  name: string;
  slug: string;
  unit: string | null;
};

const createCustomerSchema = z.object({
  organizationId: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  externalId: z.string().optional(),
});

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createCustomerSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const {
    organizationId: orgIdFromData,
    email,
    name,
    externalId,
  } = parsed.data;
  const organizationId = c.get("organizationId") || orgIdFromData;
  const db = c.get("db");

  try {
    const [customer] = await db
      .insert(schema.customers)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        email,
        name,
        externalId,
      })
      .returning();

    // Auto-subscribe customer to all auto-enabled plans
    const autoEnablePlans = await db.query.plans.findMany({
      where: and(
        eq(schema.plans.organizationId, organizationId),
        eq(schema.plans.autoEnable, true),
        eq(schema.plans.isActive, true),
      ),
    });

    if (autoEnablePlans.length > 0) {
      const now = Date.now();
      const thirtyDaysFromNow = now + 30 * 24 * 60 * 60 * 1000;

      for (const plan of autoEnablePlans) {
        // Free plans → active immediately; Paid plans → pending (awaits payment)
        const subscriptionStatus = plan.type === "free" ? "active" : "pending";

        await db.insert(schema.subscriptions).values({
          id: crypto.randomUUID(),
          customerId: customer.id,
          planId: plan.id,
          status: subscriptionStatus,
          currentPeriodStart: now,
          currentPeriodEnd: thirtyDaysFromNow,
        });
      }
    }

    return c.json({ success: true, data: customer });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

app.get("/", async (c) => {
  const organizationId = c.get("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const limit = Math.min(Number(c.req.query("limit")) || 25, 100);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);
  const search = c.req.query("search")?.trim();

  const db = c.get("db");

  // Build where conditions
  const conditions = [eq(schema.customers.organizationId, organizationId)];
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        like(schema.customers.email, pattern),
        like(schema.customers.name, pattern),
        like(schema.customers.externalId, pattern),
      )!,
    );
  }

  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  // Run count + page fetch in parallel
  const [countResult, customers] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.customers)
      .where(where),
    db
      .select({
        id: schema.customers.id,
        email: schema.customers.email,
        name: schema.customers.name,
        externalId: schema.customers.externalId,
        providerId: schema.customers.providerId,
        createdAt: schema.customers.createdAt,
      })
      .from(schema.customers)
      .where(where)
      .orderBy(desc(schema.customers.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  return c.json({
    success: true,
    data: customers,
    total: countResult[0]?.count || 0,
    limit,
    offset,
  });
});

const CUSTOMER_DETAIL_TTL = 60; // seconds (KV minimum is 60)

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  // Try KV cache first
  const cacheKey = `dashboard:customer:${id}`;
  if (c.env.CACHE) {
    const cached = await c.env.CACHE.get(cacheKey, "json");
    if (cached) {
      return c.json(cached);
    }
  }

  try {
    // 1. Get customer
    const customer = await db.query.customers.findFirst({
      where: eq(schema.customers.id, id),
    });

    if (!customer) {
      return c.json({ success: false, error: "Customer not found" }, 404);
    }

    // Run base detail queries in parallel
    const [subscriptions, events] = await Promise.all([
      // 2. Subscriptions with plan details
      db
        .select({
          id: schema.subscriptions.id,
          status: schema.subscriptions.status,
          providerId: schema.subscriptions.providerId,
          currentPeriodStart: schema.subscriptions.currentPeriodStart,
          currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
          cancelAt: schema.subscriptions.cancelAt,
          canceledAt: schema.subscriptions.canceledAt,
          createdAt: schema.subscriptions.createdAt,
          planId: schema.plans.id,
          planName: schema.plans.name,
          planSlug: schema.plans.slug,
          planPrice: schema.plans.price,
          planCurrency: schema.plans.currency,
          planInterval: schema.plans.interval,
        })
        .from(schema.subscriptions)
        .innerJoin(
          schema.plans,
          eq(schema.subscriptions.planId, schema.plans.id),
        )
        .where(eq(schema.subscriptions.customerId, id))
        .orderBy(desc(schema.subscriptions.createdAt)),

      // 3. Recent events for this customer (last 20)
      listRecentEvents(c.env, { customerId: id, limit: 20 }),
    ]);

    const monthStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    ).getTime();

    const [ledgerRecentUsage, ledgerFeatureSummary] = await Promise.all([
      listRecentUsageForCustomer(
        {
          usageLedger: c.env.USAGE_LEDGER,
          organizationId: customer.organizationId,
        },
        id,
        20,
      ),
      featureUsageSummaryForCustomer(
        {
          usageLedger: c.env.USAGE_LEDGER,
          organizationId: customer.organizationId,
        },
        id,
        monthStart,
      ),
    ]);

    const d1RecentUsageFallback = async () =>
      db
        .select({
          id: schema.usageDailySummaries.id,
          featureId: schema.usageDailySummaries.featureId,
          amount: schema.usageDailySummaries.amount,
          createdAt: schema.usageDailySummaries.updatedAt,
        })
        .from(schema.usageDailySummaries)
        .where(eq(schema.usageDailySummaries.customerId, id))
        .orderBy(desc(schema.usageDailySummaries.updatedAt))
        .limit(20);

    const d1FeatureSummaryFallback = async () =>
      db
        .select({
          featureId: schema.features.id,
          totalUsage: sql<number>`COALESCE(sum(${schema.usageDailySummaries.amount}), 0)`,
          recordCount: sql<number>`count(*)`,
        })
        .from(schema.usageDailySummaries)
        .innerJoin(
          schema.features,
          eq(schema.usageDailySummaries.featureId, schema.features.id),
        )
        .where(
          and(
            eq(schema.usageDailySummaries.customerId, id),
            gte(
              schema.usageDailySummaries.date,
              new Date(monthStart).toISOString().split("T")[0],
            ),
          ),
        )
        .groupBy(schema.features.id)
        .orderBy(sql`sum(${schema.usageDailySummaries.amount}) DESC`);

    const [baseRecentUsage, baseFeatureSummary] = await Promise.all([
      ledgerRecentUsage ?? d1RecentUsageFallback(),
      ledgerFeatureSummary ?? d1FeatureSummaryFallback(),
    ]);

    const allFeatureIds = [
      ...new Set([
        ...baseRecentUsage.map((row: any) => row.featureId),
        ...baseFeatureSummary.map((row: any) => row.featureId),
      ]),
    ];

    const featureMeta: FeatureMetaRow[] =
      allFeatureIds.length === 0
        ? []
        : await db
            .select({
              id: schema.features.id,
              name: schema.features.name,
              slug: schema.features.slug,
              unit: schema.features.unit,
            })
            .from(schema.features)
            .where(
              and(
                eq(schema.features.organizationId, customer.organizationId),
                sql`${schema.features.id} IN (${sql.join(
                  allFeatureIds.map((fid) => sql`${fid}`),
                  sql`, `,
                )})`,
              ),
            );
    const featureById = new Map<string, FeatureMetaRow>(
      featureMeta.map((row: FeatureMetaRow) => [row.id, row]),
    );

    const recentUsage = baseRecentUsage
      .map((row: any) => {
        const meta = featureById.get(row.featureId);
        if (!meta) return null;
        return {
          id: row.id,
          amount: row.amount,
          createdAt: row.createdAt,
          featureName: meta.name,
          featureSlug: meta.slug,
          unit: meta.unit,
        };
      })
      .filter((row: any): row is NonNullable<typeof row> => row !== null);

    const featureUsageSummary = baseFeatureSummary
      .map((row: any) => {
        const meta = featureById.get(row.featureId);
        if (!meta) return null;
        return {
          featureId: row.featureId,
          featureName: meta.name,
          featureSlug: meta.slug,
          unit: meta.unit,
          totalUsage: row.totalUsage,
          recordCount: row.recordCount,
        };
      })
      .filter((row: any): row is NonNullable<typeof row> => row !== null);

    const response = {
      success: true,
      data: {
        customer,
        subscriptions,
        recentUsage,
        featureUsageSummary,
        events,
      },
    };

    // Cache in KV (non-blocking)
    if (c.env.CACHE) {
      c.executionCtx.waitUntil(
        c.env.CACHE.put(cacheKey, JSON.stringify(response), {
          expirationTtl: CUSTOMER_DETAIL_TTL,
        }),
      );
    }

    return c.json(response);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  try {
    // Get customer before delete for cache invalidation
    const customer = await db.query.customers.findFirst({
      where: eq(schema.customers.id, id),
    });

    await db.delete(schema.customers).where(eq(schema.customers.id, id));

    // Invalidate cache
    if (customer && c.env.CACHE) {
      const cache = new EntitlementCache(c.env.CACHE);
      const cacheAny = cache as any;
      await Promise.all([
        typeof cacheAny.invalidateCustomerAliases === "function"
          ? cacheAny.invalidateCustomerAliases(customer.organizationId, {
              id: customer.id,
              email: customer.email,
              externalId: customer.externalId,
            })
          : Promise.all([
              cache.invalidateCustomer(customer.organizationId, customer.id),
              cache.invalidateCustomer(customer.organizationId, customer.email),
              customer.externalId
                ? cache.invalidateCustomer(
                    customer.organizationId,
                    customer.externalId,
                  )
                : Promise.resolve(),
            ]),
        cache.invalidateSubscriptions(customer.organizationId, customer.id),
        cache.invalidateDashboardCustomer(id),
      ]);
    }

    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
