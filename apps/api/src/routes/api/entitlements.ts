import { Hono } from "hono";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { schema } from "@owostack/db";
import { verifyApiKey } from "../../lib/api-keys";
import type { Env, Variables } from "../../index";
import { errorToResponse, ValidationError } from "../../lib/errors";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function zodErrorToResponse(zodError: {
  flatten: () => {
    formErrors: string[];
    fieldErrors: Record<string, string[] | undefined>;
  };
}) {
  const flattened = zodError.flatten();
  const fieldErrors = Object.entries(flattened.fieldErrors);

  if (fieldErrors.length > 0) {
    const [field, messages] = fieldErrors[0];
    return errorToResponse(
      new ValidationError({ field, details: messages?.[0] || "Invalid value" }),
    );
  }

  const formError = flattened.formErrors[0];
  return errorToResponse(
    new ValidationError({
      field: "input",
      details: formError || "Invalid request body",
    }),
  );
}

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
  await next();
});

const checkSchema = z.object({
  customerId: z.string(),
  featureId: z.string(),
  value: z.number().default(1),
});

// Check Access
app.post("/check", async (c) => {
  const body = await c.req.json();
  const parsed = checkSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { customerId, featureId, value } = parsed.data;
  const db = c.get("db");
  const organizationId = c.get("organizationId");

  if (!organizationId) {
    return c.json(
      { success: false, error: "Organization Context Missing" },
      500,
    );
  }

  // 1. Resolve Customer (by ID or External ID)
  let customer = await db.query.customers.findFirst({
    where: and(
      eq(schema.customers.organizationId, organizationId),
      eq(schema.customers.id, customerId),
    ),
  });

  if (!customer) {
    customer = await db.query.customers.findFirst({
      where: and(
        eq(schema.customers.organizationId, organizationId),
        eq(schema.customers.externalId, customerId),
      ),
    });
  }

  if (!customer) {
    return c.json({
      success: true,
      allowed: false,
      code: "customer_not_found",
    });
  }

  // 2. Resolve Feature (by slug or ID)
  let feature = await db.query.features.findFirst({
    where: and(
      eq(schema.features.organizationId, organizationId),
      eq(schema.features.id, featureId),
    ),
  });

  if (!feature) {
    feature = await db.query.features.findFirst({
      where: and(
        eq(schema.features.organizationId, organizationId),
        eq(schema.features.slug, featureId),
      ),
    });
  }

  if (!feature) {
    return c.json({ success: true, allowed: false, code: "feature_not_found" });
  }

  // 3. Check Subscription & Plans
  // Find active subscription
  const subscription = await db.query.subscriptions.findFirst({
    where: and(
      eq(schema.subscriptions.customerId, customer.id),
      eq(schema.subscriptions.status, "active"),
    ),
    with: {
      plan: true,
    },
  });

  // If no subscription, access denied (unless we support freemium without sub later)
  if (!subscription) {
    // Check if maybe they are on a free plan that doesn't need a sub object?
    // For now, assume subs required for access check logic or default to denied.
    // Autumn usually implies "Plan defines features".
    return c.json({
      success: true,
      allowed: false,
      code: "no_active_subscription",
    });
  }

  // 4. Check Plan Features
  const planFeature = await db.query.planFeatures.findFirst({
    where: and(
      eq(schema.planFeatures.planId, subscription.planId),
      eq(schema.planFeatures.featureId, feature.id),
    ),
  });

  if (!planFeature) {
    return c.json({
      success: true,
      allowed: false,
      code: "feature_not_in_plan",
    });
  }

  // 5. Check Logic based on Type
  if (feature.type === "boolean") {
    return c.json({ success: true, allowed: true, code: "access_granted" });
  }

  if (feature.type === "metered") {
    // ===========================================================================
    // DO Check (Preferred for atomicity)
    // ===========================================================================
    if (c.env.USAGE_METER && organizationId) {
      const doId = c.env.USAGE_METER.idFromName(
        `${organizationId}:${customer.id}`,
      );
      const usageMeter = c.env.USAGE_METER.get(doId);
      let doResult = await usageMeter.check(feature.slug || feature.id, value);

      // Lazy Configuration
      if (doResult.code === "feature_not_found") {
        const periodStart = subscription.currentPeriodStart;
        const periodEnd = subscription.currentPeriodEnd;

        // Calculate usage from DB for migration
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
          {
            limit: planFeature.limitValue,
            resetInterval: planFeature.resetInterval,
            resetOnEnable: planFeature.resetOnEnable || false,
            rolloverEnabled: planFeature.rolloverEnabled || false,
            rolloverMaxBalance: planFeature.rolloverMaxBalance,
            usageModel: planFeature.usageModel || "included",
            creditCost: planFeature.creditCost || 0,
            initialUsage: currentUsage,
          },
          { lazy: true },
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
        });
      }

      return c.json({
        success: true,
        allowed: true,
        code: "access_granted",
        remaining:
          doResult.limit === null ? null : doResult.limit - doResult.usage,
      });
    }
    // Check Usage Limit
    // If limitValue is null, it's unlimited
    if (planFeature.limitValue === null) {
      return c.json({ success: true, allowed: true, code: "unlimited_access" });
    }

    // Calculate current usage for this period
    const currentPeriodStart = subscription.currentPeriodStart;
    const currentPeriodEnd = subscription.currentPeriodEnd;

    // Sum usage records
    // D1 Drizzle sum might be tricky, let's fetch roughly or use sql
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

  const { customerId, featureId, value } = parsed.data;
  const db = c.get("db");
  const organizationId = c.get("organizationId");

  if (!organizationId) {
    return c.json(
      { success: false, error: "Organization Context Missing" },
      500,
    );
  }

  // 1. Resolve Customer
  let customer = await db.query.customers.findFirst({
    where: and(
      eq(schema.customers.organizationId, organizationId),
      eq(schema.customers.id, customerId),
    ),
  });

  if (!customer) {
    customer = await db.query.customers.findFirst({
      where: and(
        eq(schema.customers.organizationId, organizationId),
        eq(schema.customers.externalId, customerId),
      ),
    });
  }

  if (!customer) {
    return c.json({ success: false, error: "Customer not found" }, 404);
  }

  // 2. Resolve Feature
  let feature = await db.query.features.findFirst({
    where: and(
      eq(schema.features.organizationId, organizationId),
      eq(schema.features.id, featureId),
    ),
  });

  if (!feature) {
    feature = await db.query.features.findFirst({
      where: and(
        eq(schema.features.organizationId, organizationId),
        eq(schema.features.slug, featureId),
      ),
    });
  }

  if (!feature) {
    return c.json({ success: false, error: "Feature not found" }, 404);
  }

  // 3. Find active subscription period (to tag the usage record properly)
  const subscription = await db.query.subscriptions.findFirst({
    where: and(
      eq(schema.subscriptions.customerId, customer.id),
      eq(schema.subscriptions.status, "active"),
    ),
  });

  const periodStart = subscription?.currentPeriodStart || new Date();
  const periodEnd =
    subscription?.currentPeriodEnd ||
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // fallback

  // Fetch Plan Feature details if subscription exists (needed for DO config)
  const planFeature = subscription
    ? await db.query.planFeatures.findFirst({
        where: and(
          eq(schema.planFeatures.planId, subscription.planId),
          eq(schema.planFeatures.featureId, feature.id),
        ),
      })
    : null;

  try {
    // ===========================================================================
    // Use Durable Object for atomic real-time tracking (if available)
    // With compat date > 2024-04-03, we use RPC instead of fetch
    // ===========================================================================
    let doResult: { allowed: boolean; balance: number; code: string } | null =
      null;

    if (c.env.USAGE_METER && planFeature) {
      // Get customer's DO instance by their ID (scoped to org)
      const doId = c.env.USAGE_METER.idFromName(
        `${organizationId}:${customer.id}`,
      );
      const usageMeter = c.env.USAGE_METER.get(doId);

      // Track usage atomically via RPC
      doResult = await usageMeter.track(feature.slug || feature.id, value);

      // Lazy Configuration: If feature not found, configure and retry
      if (doResult.code === "feature_not_found") {
        // Calculate current usage from DB for migration (so we don't start at 0)
        const usageResult = await db
          .select({
            total: sql<number>`sum(amount)`,
          })
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
          {
            limit: planFeature.limitValue,
            resetInterval: planFeature.resetInterval,
            resetOnEnable: planFeature.resetOnEnable || false,
            rolloverEnabled: planFeature.rolloverEnabled || false,
            rolloverMaxBalance: planFeature.rolloverMaxBalance,
            usageModel: planFeature.usageModel || "included",
            creditCost: planFeature.creditCost || 0,
            initialUsage: currentUsage,
          },
          { lazy: true },
        );

        // Retry tracking
        doResult = await usageMeter.track(feature.slug || feature.id, value);
      }

      // If DO says not allowed, return early
      if (doResult && !doResult.allowed) {
        return c.json({
          success: false,
          allowed: false,
          code: doResult.code,
          balance: doResult.balance,
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
            updatedAt: new Date(),
          })
          .where(eq(schema.credits.customerId, customer.id));
      }
    }

    return c.json({
      success: true,
      allowed: true,
      balance: doResult?.balance,
    });
  } catch (e: any) {
    console.error("Track failed:", e);
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
