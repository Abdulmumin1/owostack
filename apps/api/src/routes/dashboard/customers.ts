import { Hono } from "hono";
import { z } from "zod";
import {
  eq,
  and,
  desc,
  gte,
  gt,
  isNull,
  sql,
  like,
  or,
  inArray,
} from "drizzle-orm";
import { schema } from "@owostack/db";
import { EntitlementCache } from "../../lib/cache";
import {
  featureUsageSummaryForCustomer,
  listRecentUsageForCustomer,
} from "../../lib/usage-ledger";
import { listRecentEvents } from "../../lib/analytics-engine";
import {
  filterDashboardEventsToPlanScope,
  invoiceMatchesCustomerPlanScope,
} from "../../lib/customer-plan-scope";
import {
  buildCustomerAccessSnapshot,
  filterAccessGrantingSubscriptions,
} from "../../lib/customer-access";
import type { Env, Variables } from "../../index";
import { zodErrorToResponse } from "../../lib/validation";
import { getSubscriptionHealthState } from "../../lib/subscription-health";
import {
  hasRenewalSetupIssue,
  readRenewalSetupMetadata,
} from "../../lib/renewal-setup";
import { autoAssignPlansToNewCustomer } from "../../lib/customer-auto-plans";

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

    await autoAssignPlansToNewCustomer({
      db,
      organizationId,
      customerId: customer.id,
    });

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
  const requestedPlanId = c.req.query("planId")?.trim() || null;
  const db = c.get("db");

  // Try KV cache first
  const cacheKey = requestedPlanId ? null : `dashboard:customer:${id}`;
  if (cacheKey && c.env.CACHE) {
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

    const planScope = requestedPlanId
      ? await db.query.plans.findFirst({
          columns: {
            id: true,
            name: true,
            slug: true,
          },
          where: and(
            eq(schema.plans.id, requestedPlanId),
            eq(schema.plans.organizationId, customer.organizationId),
          ),
        })
      : null;

    const scopedFeatureRows: Array<{ featureId: string }> =
      requestedPlanId && planScope
        ? await db
            .select({
              featureId: schema.planFeatures.featureId,
            })
            .from(schema.planFeatures)
            .where(eq(schema.planFeatures.planId, planScope.id))
        : [];
    const scopedFeatureIds = scopedFeatureRows.map((row) => row.featureId);

    // Run base detail queries in parallel
    const [subscriptions, eventsRaw, invoiceRows] = await Promise.all([
      // 2. Subscriptions with plan details
      db
        .select({
          id: schema.subscriptions.id,
          status: schema.subscriptions.status,
          providerId: schema.subscriptions.providerId,
          providerSubscriptionCode:
            schema.subscriptions.providerSubscriptionCode,
          paystackSubscriptionCode:
            schema.subscriptions.paystackSubscriptionCode,
          currentPeriodStart: schema.subscriptions.currentPeriodStart,
          currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
          cancelAt: schema.subscriptions.cancelAt,
          canceledAt: schema.subscriptions.canceledAt,
          metadata: schema.subscriptions.metadata,
          createdAt: schema.subscriptions.createdAt,
          planId: schema.plans.id,
          planName: schema.plans.name,
          planSlug: schema.plans.slug,
          planType: schema.plans.type,
          planPrice: schema.plans.price,
          planCurrency: schema.plans.currency,
          planInterval: schema.plans.interval,
        })
        .from(schema.subscriptions)
        .innerJoin(
          schema.plans,
          eq(schema.subscriptions.planId, schema.plans.id),
        )
        .where(
          requestedPlanId
            ? and(
                eq(schema.subscriptions.customerId, id),
                eq(schema.subscriptions.planId, requestedPlanId),
              )
            : eq(schema.subscriptions.customerId, id),
        )
        .orderBy(desc(schema.subscriptions.createdAt)),

      // 3. Recent events for this customer
      listRecentEvents(c.env, {
        customerId: id,
        limit: requestedPlanId ? 60 : 20,
      }).then((result) => (result.success ? result.data : [])),

      db
        .select({
          id: schema.invoices.id,
          number: schema.invoices.number,
          total: schema.invoices.total,
          amountDue: schema.invoices.amountDue,
          currency: schema.invoices.currency,
          status: schema.invoices.status,
          description: schema.invoices.description,
          metadata: schema.invoices.metadata,
          createdAt: schema.invoices.createdAt,
          dueAt: schema.invoices.dueAt,
          paidAt: schema.invoices.paidAt,
          subscriptionPlanId: schema.subscriptions.planId,
        })
        .from(schema.invoices)
        .leftJoin(
          schema.subscriptions,
          eq(schema.invoices.subscriptionId, schema.subscriptions.id),
        )
        .where(
          and(
            eq(schema.invoices.customerId, id),
            eq(schema.invoices.organizationId, customer.organizationId),
          ),
        )
        .orderBy(desc(schema.invoices.createdAt))
        .limit(12),
    ]);

    const invoiceIds = invoiceRows.map((invoice: any) => invoice.id);
    const invoiceItems =
      invoiceIds.length > 0
        ? await db
            .select({
              invoiceId: schema.invoiceItems.invoiceId,
              featureId: schema.invoiceItems.featureId,
              description: schema.invoiceItems.description,
            })
            .from(schema.invoiceItems)
            .where(inArray(schema.invoiceItems.invoiceId, invoiceIds))
        : [];

    const accessSubscriptions = filterAccessGrantingSubscriptions(
      subscriptions.map((subscription: any) => ({
        id: subscription.id,
        status: subscription.status,
        planId: subscription.planId,
        planName: subscription.planName,
        planType: subscription.planType,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAt: subscription.cancelAt,
        canceledAt: subscription.canceledAt,
      })),
    );
    const accessPlanIds = [
      ...new Set(
        accessSubscriptions
          .map((subscription) => subscription.planId)
          .filter((planId): planId is string => typeof planId === "string"),
      ),
    ];

    const [accessPlanFeatures, manualEntitlementRows, creditBalanceRows] =
      await Promise.all([
        accessPlanIds.length > 0
          ? db
              .select({
                planId: schema.planFeatures.planId,
                featureId: schema.features.id,
                featureName: schema.features.name,
                featureSlug: schema.features.slug,
                featureType: schema.features.type,
                unit: schema.features.unit,
                limitValue: schema.planFeatures.limitValue,
                resetInterval: schema.planFeatures.resetInterval,
                usageModel: schema.planFeatures.usageModel,
                creditCost: schema.planFeatures.creditCost,
                resetOnEnable: schema.planFeatures.resetOnEnable,
                rolloverEnabled: schema.planFeatures.rolloverEnabled,
                rolloverMaxBalance: schema.planFeatures.rolloverMaxBalance,
              })
              .from(schema.planFeatures)
              .innerJoin(
                schema.features,
                eq(schema.planFeatures.featureId, schema.features.id),
              )
              .where(inArray(schema.planFeatures.planId, accessPlanIds))
          : Promise.resolve([]),
        requestedPlanId && scopedFeatureIds.length === 0
          ? Promise.resolve([])
          : db
              .select({
                id: schema.entitlements.id,
                featureId: schema.features.id,
                featureName: schema.features.name,
                featureSlug: schema.features.slug,
                featureType: schema.features.type,
                unit: schema.features.unit,
                limitValue: schema.entitlements.limitValue,
                resetInterval: schema.entitlements.resetInterval,
                expiresAt: schema.entitlements.expiresAt,
                source: schema.entitlements.source,
                grantedReason: schema.entitlements.grantedReason,
              })
              .from(schema.entitlements)
              .innerJoin(
                schema.features,
                eq(schema.entitlements.featureId, schema.features.id),
              )
              .where(
                and(
                  eq(schema.entitlements.customerId, id),
                  eq(schema.entitlements.source, "manual"),
                  or(
                    isNull(schema.entitlements.expiresAt),
                    gt(schema.entitlements.expiresAt, Date.now()),
                  ),
                  requestedPlanId
                    ? inArray(schema.entitlements.featureId, scopedFeatureIds)
                    : sql`1 = 1`,
                ),
              ),
        db
          .select({
            creditSystemId: schema.creditSystemBalances.creditSystemId,
            balance: schema.creditSystemBalances.balance,
          })
          .from(schema.creditSystemBalances)
          .where(eq(schema.creditSystemBalances.customerId, id)),
      ]);
    const accessFeatureIds = [
      ...new Set(accessPlanFeatures.map((feature: any) => feature.featureId)),
    ];
    const planEntitlementRows =
      accessFeatureIds.length > 0
        ? await db
            .select({
              id: schema.entitlements.id,
              featureId: schema.features.id,
              featureName: schema.features.name,
              featureSlug: schema.features.slug,
              featureType: schema.features.type,
              unit: schema.features.unit,
              limitValue: schema.entitlements.limitValue,
              resetInterval: schema.entitlements.resetInterval,
              expiresAt: schema.entitlements.expiresAt,
              source: schema.entitlements.source,
              grantedReason: schema.entitlements.grantedReason,
            })
            .from(schema.entitlements)
            .innerJoin(
              schema.features,
              eq(schema.entitlements.featureId, schema.features.id),
            )
            .where(
              and(
                eq(schema.entitlements.customerId, id),
                eq(schema.entitlements.source, "plan"),
                inArray(schema.entitlements.featureId, accessFeatureIds),
              ),
            )
        : [];
    const customerAccess = await buildCustomerAccessSnapshot({
      env: c.env,
      organizationId: customer.organizationId,
      customerId: id,
      subscriptions: accessSubscriptions,
      planFeatures: accessPlanFeatures,
      planEntitlements: planEntitlementRows,
      manualEntitlements: manualEntitlementRows,
      creditBalances: creditBalanceRows,
    });

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
        requestedPlanId,
      ),
      featureUsageSummaryForCustomer(
        {
          usageLedger: c.env.USAGE_LEDGER,
          organizationId: customer.organizationId,
        },
        id,
        monthStart,
        requestedPlanId,
      ),
    ]);

    const d1RecentUsageFallback = async () => {
      if (!requestedPlanId) {
        return db
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
      }

      return db
        .select({
          id: schema.usageDailySummaries.id,
          featureId: schema.usageDailySummaries.featureId,
          amount: schema.usageDailySummaries.amount,
          createdAt: schema.usageDailySummaries.updatedAt,
        })
        .from(schema.usageDailySummaries)
        .innerJoin(
          schema.planFeatures,
          and(
            eq(
              schema.planFeatures.featureId,
              schema.usageDailySummaries.featureId,
            ),
            eq(schema.planFeatures.planId, requestedPlanId),
          ),
        )
        .where(eq(schema.usageDailySummaries.customerId, id))
        .orderBy(desc(schema.usageDailySummaries.updatedAt))
        .limit(20);
    };

    const d1FeatureSummaryFallback = async () => {
      if (!requestedPlanId) {
        return db
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
      }

      return db
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
        .innerJoin(
          schema.planFeatures,
          and(
            eq(schema.planFeatures.featureId, schema.features.id),
            eq(schema.planFeatures.planId, requestedPlanId),
          ),
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
    };

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

    const subscriptionsWithHealth = subscriptions.map((sub: any) => {
      const health = getSubscriptionHealthState({
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        providerId: sub.providerId,
        providerSubscriptionCode: sub.providerSubscriptionCode,
        paystackSubscriptionCode: sub.paystackSubscriptionCode,
        planType: sub.planType,
      });
      const renewalSetupIssue = hasRenewalSetupIssue(sub.metadata);
      return {
        ...sub,
        health: {
          ...health,
          requiresAction: health.requiresAction || renewalSetupIssue,
          renewalSetup: readRenewalSetupMetadata(sub.metadata),
          reasons: [
            ...(health.pastGracePeriodEnd ? ["period_end_stale"] : []),
            ...(health.providerLinkMissing ? ["provider_link_missing"] : []),
            ...(renewalSetupIssue ? ["renewal_setup_failed"] : []),
          ],
        },
      };
    });

    const events = requestedPlanId
      ? filterDashboardEventsToPlanScope(eventsRaw, {
          planId: requestedPlanId,
          subscriptionIds: subscriptionsWithHealth.map(
            (subscription: any) => subscription.id,
          ),
          limit: 20,
        })
      : eventsRaw;

    // Calculate usage chart data
    const days = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const usageByDay = new Map<number, number>();
    if (Array.isArray(recentUsage)) {
      recentUsage.forEach((u: any) => {
        if (!u.createdAt) return;
        const d = new Date(u.createdAt);
        d.setHours(0, 0, 0, 0);
        const time = d.getTime();
        usageByDay.set(time, (usageByDay.get(time) || 0) + (Number(u.amount) || 0));
      });
    }

    let maxVal = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const val = usageByDay.get(d.getTime()) || 0;
      if (val > maxVal) maxVal = val;
    }

    const chartMax = maxVal > 0 ? Math.ceil(maxVal * 1.25) : 140;
    const maxTick = Math.max(Math.ceil(chartMax / 4) * 4, 4);

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push({
        label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        value: usageByDay.get(d.getTime()) || 0,
      });
    }

    const usageChartData = {
      days,
      max: maxTick,
      ticks: [
        maxTick,
        Math.round(maxTick * 0.75),
        Math.round(maxTick * 0.5),
        Math.round(maxTick * 0.25),
        0,
      ],
    };

    const scopedFeatureIdSet = new Set(scopedFeatureIds);
    const invoiceItemsByInvoiceId = new Map<
      string,
      Array<{
        featureId: string | null;
        description: string;
      }>
    >();
    for (const item of invoiceItems) {
      const items = invoiceItemsByInvoiceId.get(item.invoiceId) ?? [];
      items.push({
        featureId: item.featureId,
        description: item.description,
      });
      invoiceItemsByInvoiceId.set(item.invoiceId, items);
    }

    const invoices = invoiceRows
      .map((invoice: any) => {
        const allItems = invoiceItemsByInvoiceId.get(invoice.id) ?? [];
        const scopedItems = requestedPlanId
          ? allItems.filter(
              (item) => item.featureId && scopedFeatureIdSet.has(item.featureId),
            )
          : allItems;

        if (
          requestedPlanId &&
          !invoiceMatchesCustomerPlanScope(
            {
              subscriptionPlanId: invoice.subscriptionPlanId,
              featureIds: allItems.map((item) => item.featureId),
              metadata:
                invoice.metadata &&
                typeof invoice.metadata === "object" &&
                !Array.isArray(invoice.metadata)
                  ? (invoice.metadata as Record<string, unknown>)
                  : null,
            },
            {
              planId: requestedPlanId,
              scopedFeatureIds,
            },
          )
        ) {
          return null;
        }

        const visibleItems = scopedItems.length > 0 ? scopedItems : allItems;
        const productDescriptions = [
          ...new Set(
            visibleItems
              .map((item) => item.description.trim())
              .filter((description) => description.length > 0),
          ),
        ];

        return {
          id: invoice.id,
          number: invoice.number,
          total: invoice.total,
          amountDue: invoice.amountDue,
          currency: invoice.currency,
          status: invoice.status,
          createdAt: invoice.createdAt,
          dueAt: invoice.dueAt,
          paidAt: invoice.paidAt,
          products:
            productDescriptions.length > 0
              ? productDescriptions
              : [
                  invoice.description ||
                    invoice.number ||
                    "Usage charges",
                ],
        };
      })
      .filter((invoice: any): invoice is NonNullable<typeof invoice> => invoice !== null);

    const response = {
      success: true,
      data: {
        customer,
        subscriptions: subscriptionsWithHealth,
        recentUsage,
        featureUsageSummary,
        events,
        usageChartData,
        invoices,
        customerAccess,
        scope: requestedPlanId
          ? {
              plan: {
                id: requestedPlanId,
                name: planScope?.name ?? null,
                slug: planScope?.slug ?? null,
              },
              featureIds: scopedFeatureIds,
            }
          : null,
      },
    };

    // Cache in KV (non-blocking)
    if (cacheKey && c.env.CACHE) {
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
