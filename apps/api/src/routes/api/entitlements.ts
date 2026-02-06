import { Hono } from "hono";
import { z } from "zod";
import { eq, and, sql, or } from "drizzle-orm";
import { schema } from "@owostack/db";
import { verifyApiKey } from "../../lib/api-keys";
import { EntitlementCache } from "../../lib/cache";
import type { Env, Variables } from "../../index";
import { getResetPeriod } from "../../lib/reset-period";
import { zodErrorToResponse } from "../../lib/validation";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Middleware for API Key Auth
app.use("*", async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "Missing API Key" }, 401);
  }

  const apiKey = authHeader.split(" ")[1];
  const db = c.get("db");

  const keyRecord = await verifyApiKey(db, apiKey);
  if (!keyRecord) {
    return c.json({ success: false, error: "Invalid API Key" }, 401);
  }

  c.set("organizationId", keyRecord.organizationId);
  return await next();
});

const checkSchema = z.object({
  customer: z.string(), // email or id
  feature: z.string(), // slug or id
  value: z.number().default(1),
});

// Check Access
app.post("/check", async (c) => {
  const body = await c.req.json();
  const parsed = checkSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { customer: customerId, feature: featureId, value } = parsed.data;
  const db = c.get("db");
  const organizationId = c.get("organizationId");
  const cache = c.env.CACHE ? new EntitlementCache(c.env.CACHE) : null;

  if (!organizationId) {
    return c.json(
      { success: false, error: "Organization Context Missing" },
      500,
    );
  }

  // 1. Resolve Customer (cache-first, then DB)
  // Normalize email to lowercase for case-insensitive matching
  const customerIdLower = customerId.toLowerCase();
  let customer = cache
    ? await cache.getCustomer<typeof schema.customers.$inferSelect>(organizationId, customerIdLower)
    : null;

  if (!customer) {
    customer = (await db.query.customers.findFirst({
      where: and(
        eq(schema.customers.organizationId, organizationId),
        or(
          eq(schema.customers.id, customerId),
          eq(schema.customers.externalId, customerId),
          eq(schema.customers.email, customerIdLower),
        ),
      ),
    })) ?? null;

    if (customer && cache) {
      await cache.setCustomer(organizationId, customerIdLower, customer);
    }
  }

  if (!customer) {
    return c.json({
      success: true,
      allowed: false,
      code: "customer_not_found",
    });
  }

  // 2. Resolve Feature (cache-first, then DB)
  let feature = cache
    ? await cache.getFeature<typeof schema.features.$inferSelect>(organizationId, featureId)
    : null;

  if (!feature) {
    feature = (await db.query.features.findFirst({
      where: and(
        eq(schema.features.organizationId, organizationId),
        or(
          eq(schema.features.id, featureId),
          eq(schema.features.slug, featureId),
        ),
      ),
    })) ?? null;

    if (feature && cache) {
      await cache.setFeature(organizationId, featureId, feature);
    }
  }

  if (!feature) {
    return c.json({ success: true, allowed: false, code: "feature_not_found" });
  }

  // 3. Check Subscription & Plans (cache-first, then DB)
  const subsCacheKey = customer.id;
  let subscriptions = cache
    ? await cache.getSubscriptions<Awaited<ReturnType<typeof db.query.subscriptions.findMany>>>(
        organizationId,
        subsCacheKey
      )
    : null;

  if (!subscriptions) {
    subscriptions = await db.query.subscriptions.findMany({
      where: and(
        eq(schema.subscriptions.customerId, customer.id),
        eq(schema.subscriptions.status, "active"),
      ),
      with: {
        plan: true,
      },
    });

    if (subscriptions.length > 0 && cache) {
      await cache.setSubscriptions(organizationId, subsCacheKey, subscriptions);
    }
  }

  if (!subscriptions || subscriptions.length === 0) {
    return c.json({
      success: true,
      allowed: false,
      code: "no_active_subscription",
    });
  }

  // 4. Check Plan Features (cache-first, then batch DB query)
  const planIds = subscriptions.map((s: { planId: string }) => s.planId);
  const pfCacheKey = `${planIds.sort().join(",")}:${feature.id}`;
  let planFeatures = cache
    ? await cache.getPlanFeatures<Awaited<ReturnType<typeof db.query.planFeatures.findMany>>>(
        organizationId,
        pfCacheKey
      )
    : null;

  if (!planFeatures) {
    planFeatures = await db.query.planFeatures.findMany({
      where: and(
        sql`${schema.planFeatures.planId} IN (${sql.join(planIds.map((id: string) => sql`${id}`), sql`, `)})`,
        eq(schema.planFeatures.featureId, feature.id),
      ),
    });

    if (planFeatures.length > 0 && cache) {
      await cache.setPlanFeatures(organizationId, pfCacheKey, planFeatures);
    }
  }

  // Find the first subscription that has a matching planFeature
  let accessGrantingSubscription: (typeof subscriptions)[number] | null = null;
  let accessGrantingPlanFeature: (typeof planFeatures)[number] | null = null;

  for (const pf of planFeatures) {
    const sub = subscriptions.find((s: { planId: string }) => s.planId === pf.planId);
    if (sub) {
      accessGrantingSubscription = sub;
      accessGrantingPlanFeature = pf;
      break;
    }
  }

  if (!accessGrantingSubscription || !accessGrantingPlanFeature) {
    return c.json({
      success: true,
      allowed: false,
      code: "feature_not_in_plan",
    });
  }

  // Use the granting subscription/feature for the rest of the logic
  const subscription = accessGrantingSubscription;
  const planFeature = accessGrantingPlanFeature;

  // 5. Check Logic based on Type
  if (feature.type === "boolean") {
    return c.json({ success: true, allowed: true, code: "access_granted" });
  }

  if (feature.type === "metered") {
    // Compute reset period once for all response paths
    const resetPeriod = getResetPeriod(
      planFeature.resetInterval,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
    );
    const resetsAt = new Date(resetPeriod.periodEnd).toISOString();

    // ===========================================================================
    // DO Check (Preferred for atomicity)
    // ===========================================================================
    if (c.env.USAGE_METER && organizationId) {
      const doId = c.env.USAGE_METER.idFromName(
        `${organizationId}:${customer.id}`,
      );
      const usageMeter = c.env.USAGE_METER.get(doId);

      // Pass current config inline — single RPC call, no extra round-trip
      const currentConfig = {
        limit: planFeature.limitValue,
        resetInterval: planFeature.resetInterval,
        resetOnEnable: planFeature.resetOnEnable || false,
        rolloverEnabled: planFeature.rolloverEnabled || false,
        rolloverMaxBalance: planFeature.rolloverMaxBalance,
        usageModel: planFeature.usageModel || "included",
        creditCost: planFeature.creditCost || 0,
      };

      let doResult = await usageMeter.check(feature.slug || feature.id, value, currentConfig);

      // If DO has no state yet (fresh/restart), migrate usage from DB and configure
      if (doResult.code === "feature_not_found") {
        const { periodStart: migPeriodStart, periodEnd: migPeriodEnd } = resetPeriod;
        const usageResult = await db
          .select({ total: sql<number>`sum(amount)` })
          .from(schema.usageRecords)
          .where(
            and(
              eq(schema.usageRecords.customerId, customer.id),
              eq(schema.usageRecords.featureId, feature.id),
              sql`${schema.usageRecords.createdAt} >= ${migPeriodStart}`,
              sql`${schema.usageRecords.createdAt} <= ${migPeriodEnd}`,
            ),
          );
        const currentUsage = usageResult[0]?.total || 0;

        await usageMeter.configureFeature(
          feature.slug || feature.id,
          { ...currentConfig, initialUsage: currentUsage },
        );

        doResult = await usageMeter.check(feature.slug || feature.id, value);
      }

      if (!doResult.allowed) {
        return c.json({
          success: true,
          allowed: false,
          code: doResult.code,
          currentUsage: doResult.usage,
          limit: doResult.limit,
          resetsAt,
          resetInterval: planFeature.resetInterval,
        });
      }

      return c.json({
        success: true,
        allowed: true,
        code: "access_granted",
        remaining:
          doResult.limit === null ? null : doResult.limit - doResult.usage,
        resetsAt,
        resetInterval: planFeature.resetInterval,
      });
    }
    // Check Usage Limit
    // If limitValue is null, it's unlimited
    if (planFeature.limitValue === null) {
      return c.json({ success: true, allowed: true, code: "unlimited_access" });
    }

    // Calculate current usage for this period using the feature's reset interval
    const { periodStart: currentPeriodStart, periodEnd: currentPeriodEnd } = getResetPeriod(
      planFeature.resetInterval,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
    );

    // Sum usage records within the reset-interval-aware period
    const usageResult = await db
      .select({
        total: sql<number>`sum(amount)`,
      })
      .from(schema.usageRecords)
      .where(
        and(
          eq(schema.usageRecords.customerId, customer.id),
          eq(schema.usageRecords.featureId, feature.id),
          sql`${schema.usageRecords.createdAt} >= ${currentPeriodStart}`,
          sql`${schema.usageRecords.createdAt} <= ${currentPeriodEnd}`,
        ),
      );

    const currentUsage = usageResult[0]?.total || 0;

    if (currentUsage + value > planFeature.limitValue) {
      return c.json({
        success: true,
        allowed: false,
        code: "limit_exceeded",
        currentUsage,
        limit: planFeature.limitValue,
        resetsAt,
        resetInterval: planFeature.resetInterval,
      });
    }

    // If it costs credits, check balance
    if (planFeature.creditCost && planFeature.creditCost > 0) {
      const cost = value * planFeature.creditCost;
      const creditRecord = await db.query.credits.findFirst({
        where: eq(schema.credits.customerId, customer.id),
      });
      const balance = creditRecord?.balance || 0;

      if (balance < cost) {
        return c.json({
          success: true,
          allowed: false,
          code: "insufficient_credits",
          balance,
          required: cost,
        });
      }
    }

    return c.json({
      success: true,
      allowed: true,
      code: "access_granted",
      remaining: planFeature.limitValue - currentUsage,
      resetsAt,
      resetInterval: planFeature.resetInterval,
    });
  }

  return c.json({
    success: true,
    allowed: false,
    code: "unknown_feature_type",
  });
});

// Track Usage
app.post("/track", async (c) => {
  const body = await c.req.json();
  const parsed = checkSchema.safeParse(body); // Same schema works for now

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { customer: customerId, feature: featureId, value } = parsed.data;
  const db = c.get("db");
  const organizationId = c.get("organizationId");
  const cache = c.env.CACHE ? new EntitlementCache(c.env.CACHE) : null;

  if (!organizationId) {
    return c.json(
      { success: false, error: "Organization Context Missing" },
      500,
    );
  }

  // 1. Resolve Customer (cache-first, then DB)
  // Normalize email to lowercase for case-insensitive matching
  const customerIdLowerTrack = customerId.toLowerCase();
  let customer = cache
    ? await cache.getCustomer<typeof schema.customers.$inferSelect>(organizationId, customerIdLowerTrack)
    : null;

  if (!customer) {
    customer = (await db.query.customers.findFirst({
      where: and(
        eq(schema.customers.organizationId, organizationId),
        or(
          eq(schema.customers.id, customerId),
          eq(schema.customers.externalId, customerId),
          eq(schema.customers.email, customerIdLowerTrack),
        ),
      ),
    })) ?? null;

    if (customer && cache) {
      await cache.setCustomer(organizationId, customerIdLowerTrack, customer);
    }
  }

  if (!customer) {
    return c.json({ success: false, error: "Customer not found" }, 404);
  }

  // 2. Resolve Feature (cache-first, then DB)
  let feature = cache
    ? await cache.getFeature<typeof schema.features.$inferSelect>(organizationId, featureId)
    : null;

  if (!feature) {
    feature = (await db.query.features.findFirst({
      where: and(
        eq(schema.features.organizationId, organizationId),
        or(
          eq(schema.features.id, featureId),
          eq(schema.features.slug, featureId),
        ),
      ),
    })) ?? null;

    if (feature && cache) {
      await cache.setFeature(organizationId, featureId, feature);
    }
  }

  if (!feature) {
    return c.json({ success: false, error: "Feature not found" }, 404);
  }

  // 3. Find active subscriptions (cache-first, then DB)
  const subsCacheKey = customer.id;
  let subscriptions = cache
    ? await cache.getSubscriptions<Awaited<ReturnType<typeof db.query.subscriptions.findMany>>>(
        organizationId,
        subsCacheKey
      )
    : null;

  if (!subscriptions) {
    subscriptions = await db.query.subscriptions.findMany({
      where: and(
        eq(schema.subscriptions.customerId, customer.id),
        eq(schema.subscriptions.status, "active"),
      ),
    });

    if (subscriptions.length > 0 && cache) {
      await cache.setSubscriptions(organizationId, subsCacheKey, subscriptions);
    }
  }

  if (subscriptions.length === 0) {
    return c.json(
      { success: false, error: "No active subscription" },
      400,
    );
  }

  // 4. Find planFeatures (cache-first, then batch DB query)
  const planIds = subscriptions.map((s: { planId: string }) => s.planId);
  const pfCacheKey = `${planIds.sort().join(",")}:${feature.id}`;
  let planFeatures = cache
    ? await cache.getPlanFeatures<Awaited<ReturnType<typeof db.query.planFeatures.findMany>>>(
        organizationId,
        pfCacheKey
      )
    : null;

  if (!planFeatures) {
    planFeatures = await db.query.planFeatures.findMany({
      where: and(
        sql`${schema.planFeatures.planId} IN (${sql.join(planIds.map((id: string) => sql`${id}`), sql`, `)})`,
        eq(schema.planFeatures.featureId, feature.id),
      ),
    });

    if (planFeatures.length > 0 && cache) {
      await cache.setPlanFeatures(organizationId, pfCacheKey, planFeatures);
    }
  }

  let accessGrantingSubscription: (typeof subscriptions)[number] | null = null;
  let accessGrantingPlanFeature: (typeof planFeatures)[number] | null = null;

  for (const pf of planFeatures) {
    const sub = subscriptions.find((s: { planId: string }) => s.planId === pf.planId);
    if (sub) {
      accessGrantingSubscription = sub;
      accessGrantingPlanFeature = pf;
      break;
    }
  }

  const subscription = accessGrantingSubscription;
  const planFeature = accessGrantingPlanFeature;

  if (!subscription || !planFeature) {
    return c.json(
      {
        success: false,
        error: "Feature is not enabled for this customer's plan",
      },
      400,
    );
  }

  // Use the feature's resetInterval to determine the correct usage period
  const { periodStart, periodEnd } = getResetPeriod(
    planFeature.resetInterval,
    subscription.currentPeriodStart,
    subscription.currentPeriodEnd,
  );

  try {
    // ===========================================================================
    // Use Durable Object for atomic real-time tracking (if available)
    // ===========================================================================
    let doResult: { allowed: boolean; balance: number; code: string } | null =
      null;

    if (c.env.USAGE_METER && planFeature) {
      // Get customer's DO instance by their ID (scoped to org)
      const doId = c.env.USAGE_METER.idFromName(
        `${organizationId}:${customer.id}`,
      );

      const usageMeter = c.env.USAGE_METER.get(doId);

      // Pass current config inline — single RPC call, no extra round-trip
      const currentConfig = {
        limit: planFeature.limitValue,
        resetInterval: planFeature.resetInterval,
        resetOnEnable: planFeature.resetOnEnable || false,
        rolloverEnabled: planFeature.rolloverEnabled || false,
        rolloverMaxBalance: planFeature.rolloverMaxBalance,
        usageModel: planFeature.usageModel || "included",
        creditCost: planFeature.creditCost || 0,
      };

      // Track usage atomically via RPC (config synced inline)
      doResult = await usageMeter.track(feature.slug || feature.id, value, currentConfig);

      // If DO has no state yet (fresh/restart), migrate usage from DB and configure
      if (doResult.code === "feature_not_found") {
        const usageResult = await db
          .select({ total: sql<number>`sum(amount)` })
          .from(schema.usageRecords)
          .where(
            and(
              eq(schema.usageRecords.customerId, customer.id),
              eq(schema.usageRecords.featureId, feature.id),
              sql`${schema.usageRecords.createdAt} >= ${periodStart}`,
              sql`${schema.usageRecords.createdAt} <= ${periodEnd}`,
            ),
          );
        const currentUsage = usageResult[0]?.total || 0;

        await usageMeter.configureFeature(
          feature.slug || feature.id,
          { ...currentConfig, initialUsage: currentUsage },
        );

        doResult = await usageMeter.track(feature.slug || feature.id, value);
      }

      // If DO says not allowed, return early
      if (doResult && !doResult.allowed) {
        const resetsAt = new Date(periodEnd).toISOString();
        return c.json({
          success: false,
          allowed: false,
          code: doResult.code,
          balance: doResult.balance,
          resetsAt,
          resetInterval: planFeature.resetInterval,
        });
      }
    }

    // ===========================================================================
    // Persist to DB (for audit trail and backup)
    // ===========================================================================
    await db.insert(schema.usageRecords).values({
      id: crypto.randomUUID(),
      customerId: customer.id,
      featureId: feature.id,
      amount: value,
      periodStart,
      periodEnd,
    });

    // Deduct Credits if applicable (DB fallback for non-DO path)
    if (subscription && !c.env.USAGE_METER) {
      const planFeature = await db.query.planFeatures.findFirst({
        where: and(
          eq(schema.planFeatures.planId, subscription.planId),
          eq(schema.planFeatures.featureId, feature.id),
        ),
      });

      if (planFeature && planFeature.creditCost && planFeature.creditCost > 0) {
        const cost = value * planFeature.creditCost;
        await db
          .update(schema.credits)
          .set({
            balance: sql`${schema.credits.balance} - ${cost}`,
            updatedAt: Date.now(),
          })
          .where(eq(schema.credits.customerId, customer.id));
      }
    }

    return c.json({
      success: true,
      allowed: true,
      balance: doResult?.balance,
      resetsAt: new Date(periodEnd).toISOString(),
      resetInterval: planFeature.resetInterval,
    });
  } catch (e: any) {
    console.error("Track failed:", e);
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
