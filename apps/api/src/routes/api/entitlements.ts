import { Hono } from "hono";
import { z } from "zod";
import { eq, and, sql, or, inArray } from "drizzle-orm";
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
  const authDb = c.get("authDb");

  const keyRecord = await verifyApiKey(authDb, apiKey);
  if (!keyRecord) {
    return c.json({ success: false, error: "Invalid API Key" }, 401);
  }

  c.set("organizationId", keyRecord.organizationId);
  return await next();
});

const customerDataSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const checkSchema = z.object({
  customer: z.string(),
  feature: z.string(),
  value: z.number().default(1),
  customerData: customerDataSchema.optional(),
  sendEvent: z.boolean().default(false),
  entity: z.string().optional(),
});

const trackSchema = z.object({
  customer: z.string(),
  feature: z.string(),
  value: z.number().default(1),
  customerData: customerDataSchema.optional(),
  entity: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Resolve an existing customer or auto-create one when customerData is provided.
 * Returns the customer record or null if not found and no customerData to create from.
 */
async function resolveOrCreateCustomer(
  db: any,
  organizationId: string,
  customerId: string,
  customerData?: { email: string; name?: string; metadata?: Record<string, unknown> },
  cache?: EntitlementCache | null,
) {
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
      cache.setCustomer(organizationId, customerIdLower, customer); // fire-and-forget
    }
  }

  // Auto-create customer if not found and customerData provided
  if (!customer && customerData) {
    const now = Date.now();
    const newCustomer = {
      id: crypto.randomUUID(),
      organizationId,
      externalId: customerId,
      email: customerData.email.toLowerCase(),
      name: customerData.name || null,
      metadata: customerData.metadata || null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(schema.customers).values(newCustomer);
    customer = newCustomer as typeof schema.customers.$inferSelect;

    if (cache) {
      cache.setCustomer(organizationId, customerIdLower, customer); // fire-and-forget
    }
  }

  return customer;
}

// Check Access
app.post("/check", async (c) => {
  const body = await c.req.json();
  const parsed = checkSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { customer: customerId, feature: featureId, value, customerData, sendEvent, entity } = parsed.data;
  const db = c.get("db");
  const organizationId = c.get("organizationId");
  const cache = c.env.CACHE ? new EntitlementCache(c.env.CACHE) : null;

  if (!organizationId) {
    return c.json(
      { success: false, error: "Organization Context Missing" },
      500,
    );
  }

  // 1. Resolve Customer (cache-first, then DB, auto-create if customerData provided)
  const customer = await resolveOrCreateCustomer(db, organizationId, customerId, customerData, cache);

  if (!customer) {
    return c.json({
      allowed: false,
      code: "customer_not_found",
      details: { message: `Customer '${customerId}' not found in this organization.` },
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
      cache.setFeature(organizationId, featureId, feature); // fire-and-forget
    }
  }

  if (!feature) {
    return c.json({ allowed: false, code: "feature_not_found", details: { message: `Feature '${featureId}' not found.` } });
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
        inArray(schema.subscriptions.status, ["active", "trialing"]),
      ),
      with: {
        plan: true,
      },
    });

    if (subscriptions.length > 0 && cache) {
      cache.setSubscriptions(organizationId, subsCacheKey, subscriptions); // fire-and-forget
    }
  }

  // Filter out expired trialing subscriptions and lazily mark them in DB
  const now = Date.now();
  const expiredTrialIds: string[] = [];
  subscriptions = subscriptions.filter((s: any) => {
    if (s.status === "trialing" && s.currentPeriodEnd && s.currentPeriodEnd < now) {
      expiredTrialIds.push(s.id);
      return false;
    }
    return true;
  });
  if (expiredTrialIds.length > 0) {
    // Fire-and-forget: mark expired trials in DB
    c.executionCtx.waitUntil(
      db.update(schema.subscriptions)
        .set({ status: "expired", updatedAt: now })
        .where(inArray(schema.subscriptions.id, expiredTrialIds))
    );
    // Invalidate cache so next request gets fresh data
    if (cache) {
      cache.invalidateSubscriptions(organizationId, subsCacheKey);
    }
  }

  if (!subscriptions || subscriptions.length === 0) {
    return c.json({
      allowed: false,
      code: "no_active_subscription",
      details: { message: "No active or trialing subscription found for this customer." },
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
      cache.setPlanFeatures(organizationId, pfCacheKey, planFeatures); // fire-and-forget
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
      allowed: false,
      code: "feature_not_in_plan",
      details: { message: `Feature '${feature.slug || feature.id}' is not included in the customer's current plan.` },
    });
  }

  // Use the granting subscription/feature for the rest of the logic
  const subscription = accessGrantingSubscription;
  const planFeature = accessGrantingPlanFeature;

  // Build reusable details context
  const isTrial = subscription.status === "trialing";
  const trialEndsAt = isTrial && subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toISOString()
    : null;
  const planName = (subscription as any).plan?.name || "current plan";

  // Helper to build the details object — only includes truthy optional fields
  function buildDetails(message: string, extra?: Record<string, unknown>) {
    return {
      message,
      planName,
      ...(isTrial ? { trial: true, trialEndsAt } : {}),
      ...extra,
    };
  }

  // 5. Check Logic based on Type
  if (feature.type === "boolean") {
    return c.json({
      allowed: true,
      code: "access_granted",
      details: buildDetails(
        isTrial
          ? `Feature '${feature.slug || feature.id}' enabled on ${planName} via free trial (ends ${trialEndsAt}).`
          : `Feature '${feature.slug || feature.id}' enabled on ${planName}.`,
      ),
    });
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
    // When entity is provided, scope DO feature key and DB queries by entity
    const featureKey = entity
      ? `${feature.slug || feature.id}:${entity}`
      : (feature.slug || feature.id);

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

      let doResult = await usageMeter.check(featureKey, value, currentConfig);

      // If DO has no state yet (fresh/restart), migrate usage from DB and configure
      if (doResult.code === "feature_not_found") {
        const { periodStart: migPeriodStart, periodEnd: migPeriodEnd } = resetPeriod;
        const entityFilter = entity
          ? eq(schema.usageRecords.entityId, entity)
          : undefined;
        const usageResult = await db
          .select({ total: sql<number>`sum(amount)` })
          .from(schema.usageRecords)
          .where(
            and(
              eq(schema.usageRecords.customerId, customer.id),
              eq(schema.usageRecords.featureId, feature.id),
              entityFilter,
              sql`${schema.usageRecords.createdAt} >= ${migPeriodStart}`,
              sql`${schema.usageRecords.createdAt} <= ${migPeriodEnd}`,
            ),
          );
        const currentUsage = usageResult[0]?.total || 0;

        await usageMeter.configureFeature(
          featureKey,
          { ...currentConfig, initialUsage: currentUsage },
        );

        doResult = await usageMeter.check(featureKey, value);
      }

      if (!doResult.allowed) {
        const overageSetting = planFeature.overage || "block";
        
        // If overage is "charge", allow but indicate overage
        if (overageSetting === "charge") {
          return c.json({
            allowed: true,
            code: "overage_allowed",
            usage: doResult.usage,
            limit: doResult.limit,
            balance: doResult.limit === null ? null : doResult.limit - doResult.usage,
            resetsAt,
            resetInterval: planFeature.resetInterval,
            details: buildDetails(
              `Usage exceeds limit (${doResult.usage}/${doResult.limit}), overage will be billed.`,
              {
                overage: {
                  type: overageSetting,
                  willBeBilled: true,
                  pricePerUnit: planFeature.pricePerUnit,
                  billingUnits: planFeature.billingUnits,
                },
              },
            ),
          });
        }
        
        // Otherwise block
        return c.json({
          allowed: false,
          code: doResult.code,
          usage: doResult.usage,
          limit: doResult.limit,
          balance: doResult.limit === null ? null : doResult.limit - doResult.usage,
          resetsAt,
          resetInterval: planFeature.resetInterval,
          details: buildDetails(`Usage limit reached (${doResult.usage}/${doResult.limit}). Resets at ${resetsAt}.`),
        });
      }

      // sendEvent: atomically track usage if check passed
      if (sendEvent) {
        const trackResult = await usageMeter.track(featureKey, value, currentConfig);
        if (trackResult && !trackResult.allowed) {
          return c.json({
            allowed: false,
            code: trackResult.code,
            balance: trackResult.balance,
            resetsAt,
            resetInterval: planFeature.resetInterval,
            details: buildDetails(`Usage tracking denied — insufficient balance (${trackResult.balance} remaining). Resets at ${resetsAt}.`),
          });
        }
        // Also persist to DB for audit trail
        await db.insert(schema.usageRecords).values({
          id: crypto.randomUUID(),
          customerId: customer.id,
          featureId: feature.id,
          entityId: entity || null,
          amount: value,
          periodStart: resetPeriod.periodStart,
          periodEnd: resetPeriod.periodEnd,
        });
      }

      return c.json({
        allowed: true,
        code: "access_granted",
        usage: doResult.usage,
        limit: doResult.limit,
        balance: doResult.limit === null ? null : doResult.limit - doResult.usage,
        unlimited: doResult.limit === null,
        resetsAt,
        resetInterval: planFeature.resetInterval,
        details: buildDetails(
          doResult.limit === null
            ? `Unlimited access to '${feature.slug || feature.id}' on ${planName}.`
            : `Access granted — used ${doResult.usage} of ${doResult.limit}.`,
        ),
      });
    }
    // Check Usage Limit
    // If limitValue is null, it's unlimited
    if (planFeature.limitValue === null) {
      return c.json({
        allowed: true,
        code: "access_granted",
        unlimited: true,
        details: buildDetails(`Unlimited access to '${feature.slug || feature.id}' on ${planName}.`),
      });
    }

    // Calculate current usage for this period using the feature's reset interval
    const { periodStart: currentPeriodStart, periodEnd: currentPeriodEnd } = getResetPeriod(
      planFeature.resetInterval,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
    );

    // Sum usage records within the reset-interval-aware period
    const dbEntityFilter = entity
      ? eq(schema.usageRecords.entityId, entity)
      : undefined;
    const usageResult = await db
      .select({
        total: sql<number>`sum(amount)`,
      })
      .from(schema.usageRecords)
      .where(
        and(
          eq(schema.usageRecords.customerId, customer.id),
          eq(schema.usageRecords.featureId, feature.id),
          dbEntityFilter,
          sql`${schema.usageRecords.createdAt} >= ${currentPeriodStart}`,
          sql`${schema.usageRecords.createdAt} <= ${currentPeriodEnd}`,
        ),
      );

    const currentUsage = usageResult[0]?.total || 0;

    if (currentUsage + value > planFeature.limitValue) {
      const overageSetting = planFeature.overage || "block";
      
      // If overage is "charge" or "notify", allow but indicate overage
      if (overageSetting === "charge" || overageSetting === "notify") {
        return c.json({
          allowed: true,
          code: "overage_allowed",
          usage: currentUsage,
          limit: planFeature.limitValue,
          balance: planFeature.limitValue - currentUsage,
          resetsAt,
          resetInterval: planFeature.resetInterval,
          details: buildDetails(
            `Usage exceeds limit (${currentUsage}/${planFeature.limitValue}), overage will be ${overageSetting === "charge" ? "billed" : "notified"}.`,
            {
              overage: {
                type: overageSetting,
                willBeBilled: overageSetting === "charge",
                pricePerUnit: planFeature.pricePerUnit,
                billingUnits: planFeature.billingUnits,
              },
            },
          ),
        });
      }
      
      return c.json({
        allowed: false,
        code: "limit_exceeded",
        usage: currentUsage,
        limit: planFeature.limitValue,
        balance: planFeature.limitValue - currentUsage,
        resetsAt,
        resetInterval: planFeature.resetInterval,
        details: buildDetails(`Usage limit exceeded (${currentUsage}/${planFeature.limitValue}). Resets at ${resetsAt}.`),
      });
    }

    // If it costs credits, check balance
    if (planFeature.creditCost && planFeature.creditCost > 0) {
      const cost = value * planFeature.creditCost;
      const creditRecord = await db.query.credits.findFirst({
        where: eq(schema.credits.customerId, customer.id),
      });
      const creditBalance = creditRecord?.balance || 0;

      if (creditBalance < cost) {
        return c.json({
          allowed: false,
          code: "insufficient_credits",
          balance: creditBalance,
          limit: cost,
          details: buildDetails(`Insufficient credits — balance: ${creditBalance}, required: ${cost}.`),
        });
      }
    }

    // sendEvent: track usage inline (DB-only path, no DO)
    if (sendEvent) {
      await db.insert(schema.usageRecords).values({
        id: crypto.randomUUID(),
        customerId: customer.id,
        featureId: feature.id,
        entityId: entity || null,
        amount: value,
        periodStart: currentPeriodStart,
        periodEnd: currentPeriodEnd,
      });
    }

    return c.json({
      allowed: true,
      code: "access_granted",
      usage: currentUsage,
      limit: planFeature.limitValue,
      balance: planFeature.limitValue - currentUsage,
      resetsAt,
      resetInterval: planFeature.resetInterval,
      details: buildDetails(`Access granted — used ${currentUsage} of ${planFeature.limitValue}.`),
    });
  }

  return c.json({
    allowed: false,
    code: "unknown_feature_type",
    details: { message: `Unrecognized feature type '${feature.type}'.` },
  });
});

// Track Usage
app.post("/track", async (c) => {
  const body = await c.req.json();
  const parsed = trackSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { customer: customerId, feature: featureId, value, customerData, entity } = parsed.data;
  const db = c.get("db");
  const organizationId = c.get("organizationId");
  const cache = c.env.CACHE ? new EntitlementCache(c.env.CACHE) : null;

  if (!organizationId) {
    return c.json(
      { success: false, error: "Organization Context Missing" },
      500,
    );
  }

  // 1. Resolve Customer (cache-first, then DB, auto-create if customerData provided)
  const customer = await resolveOrCreateCustomer(db, organizationId, customerId, customerData, cache);

  if (!customer) {
    return c.json({ success: false, allowed: false, code: "customer_not_found", details: { message: `Customer '${customerId}' not found in this organization.` } }, 404);
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
      cache.setFeature(organizationId, featureId, feature); // fire-and-forget
    }
  }

  if (!feature) {
    return c.json({ success: false, allowed: false, code: "feature_not_found", details: { message: `Feature '${featureId}' not found.` } }, 404);
  }

  // 3. Find active/trialing subscriptions (cache-first, then DB)
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
        inArray(schema.subscriptions.status, ["active", "trialing"]),
      ),
    });

    if (subscriptions.length > 0 && cache) {
      cache.setSubscriptions(organizationId, subsCacheKey, subscriptions); // fire-and-forget
    }
  }

  // Filter out expired trialing subscriptions and lazily mark them in DB
  const trackNow = Date.now();
  const trackExpiredTrialIds: string[] = [];
  subscriptions = subscriptions.filter((s: any) => {
    if (s.status === "trialing" && s.currentPeriodEnd && s.currentPeriodEnd < trackNow) {
      trackExpiredTrialIds.push(s.id);
      return false;
    }
    return true;
  });
  if (trackExpiredTrialIds.length > 0) {
    c.executionCtx.waitUntil(
      db.update(schema.subscriptions)
        .set({ status: "expired", updatedAt: trackNow })
        .where(inArray(schema.subscriptions.id, trackExpiredTrialIds))
    );
    if (cache) {
      cache.invalidateSubscriptions(organizationId, subsCacheKey);
    }
  }

  if (subscriptions.length === 0) {
    return c.json(
      { success: false, allowed: false, code: "no_active_subscription", details: { message: "No active or trialing subscription found for this customer." } },
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
      cache.setPlanFeatures(organizationId, pfCacheKey, planFeatures); // fire-and-forget
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
      { success: false, allowed: false, code: "feature_not_in_plan", details: { message: `Feature '${feature.slug || feature.id}' is not included in the customer's current plan.` } },
      400,
    );
  }

  // Build reusable details context for track responses
  const isTrial = subscription.status === "trialing";
  const trialEndsAt = isTrial && subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toISOString()
    : null;

  function buildTrackDetails(message: string, extra?: Record<string, unknown>) {
    return {
      message,
      ...(isTrial ? { trial: true, trialEndsAt } : {}),
      ...extra,
    };
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

    // When entity is provided, scope DO feature key and DB queries by entity
    const trackFeatureKey = entity
      ? `${feature.slug || feature.id}:${entity}`
      : (feature.slug || feature.id);

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
      doResult = await usageMeter.track(trackFeatureKey, value, currentConfig);

      // If DO has no state yet (fresh/restart), migrate usage from DB and configure
      if (doResult.code === "feature_not_found") {
        const trackEntityFilter = entity
          ? eq(schema.usageRecords.entityId, entity)
          : undefined;
        const usageResult = await db
          .select({ total: sql<number>`sum(amount)` })
          .from(schema.usageRecords)
          .where(
            and(
              eq(schema.usageRecords.customerId, customer.id),
              eq(schema.usageRecords.featureId, feature.id),
              trackEntityFilter,
              sql`${schema.usageRecords.createdAt} >= ${periodStart}`,
              sql`${schema.usageRecords.createdAt} <= ${periodEnd}`,
            ),
          );
        const currentUsage = usageResult[0]?.total || 0;

        await usageMeter.configureFeature(
          trackFeatureKey,
          { ...currentConfig, initialUsage: currentUsage },
        );

        doResult = await usageMeter.track(trackFeatureKey, value);
      }

      // If DO says not allowed, check overage setting
      if (doResult && !doResult.allowed) {
        const overageSetting = planFeature.overage || "block";
        
        // If overage is "block", deny the request
        if (overageSetting === "block") {
          return c.json({
            success: false,
            allowed: false,
            code: doResult.code,
            balance: doResult.balance,
            resetsAt: new Date(periodEnd).toISOString(),
            resetInterval: planFeature.resetInterval,
            details: buildTrackDetails(`Usage tracking denied — limit reached (${doResult.balance} remaining). Resets at ${new Date(periodEnd).toISOString()}.`),
          });
        }
        
        // If overage is "charge", allow the usage (will be billed later)
        // Continue to persist the usage record
      }
    }

    // ===========================================================================
    // Persist to DB asynchronously (for audit trail and backup)
    // Using waitUntil to avoid blocking the response
    // ===========================================================================
    c.executionCtx.waitUntil(
      db.insert(schema.usageRecords).values({
        id: crypto.randomUUID(),
        customerId: customer.id,
        featureId: feature.id,
        entityId: entity || null,
        amount: value,
        periodStart,
        periodEnd,
      })
    );

    // Deduct Credits if applicable (DB fallback for non-DO path)
    if (subscription && !c.env.USAGE_METER && planFeature.creditCost && planFeature.creditCost > 0) {
      const cost = value * planFeature.creditCost;
      c.executionCtx.waitUntil(
        db
          .update(schema.credits)
          .set({
            balance: sql`${schema.credits.balance} - ${cost}`,
            updatedAt: Date.now(),
          })
          .where(eq(schema.credits.customerId, customer.id))
      );
    }

    // Determine if this was an overage usage
    const isOverage = doResult && !doResult.allowed && planFeature.overage === "charge";
    
    return c.json({
      success: true,
      allowed: true,
      code: isOverage ? "tracked_overage" : "tracked",
      balance: doResult?.balance ?? null,
      resetsAt: new Date(periodEnd).toISOString(),
      resetInterval: planFeature.resetInterval,
      details: isOverage
        ? buildTrackDetails(
            `Usage tracked as overage (will be billed).`,
            { overage: { type: planFeature.overage, willBeBilled: true } },
          )
        : buildTrackDetails(`Usage tracked successfully (${doResult?.balance ?? 'n/a'} remaining).`),
    });
  } catch (e: any) {
    console.error("Track failed:", e);
    return c.json({ success: false, allowed: false, code: "internal_error", details: { message: "An internal error occurred while tracking usage." } }, 500);
  }
});

export default app;
