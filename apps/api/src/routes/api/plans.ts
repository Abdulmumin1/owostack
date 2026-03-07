import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { schema } from "@owostack/db";
import { verifyApiKey } from "../../lib/api-keys";
import {
  normalizePlanFeatureLimitValue,
  normalizePlanFeatureOverage,
  normalizePlanFeatureResetInterval,
} from "../../lib/plan-feature-normalization";
import type { Env, Variables } from "../../index";

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

// GET /plans — list all plans for the organization
app.get("/", async (c) => {
  const organizationId = c.get("organizationId")!;
  const db = c.get("db");

  // Query params for filtering
  const group = c.req.query("group");
  const interval = c.req.query("interval");
  const currency = c.req.query("currency");
  const includeInactive = c.req.query("includeInactive") === "true";

  // Build where conditions
  const conditions = [eq(schema.plans.organizationId, organizationId)];

  if (!includeInactive) {
    conditions.push(eq(schema.plans.isActive, true));
  }

  const allPlans = await db.query.plans.findMany({
    where: and(...conditions),
    orderBy: [desc(schema.plans.createdAt)],
    with: {
      planFeatures: {
        with: {
          feature: true,
        },
      },
    },
  });

  // Apply additional filters that drizzle doesn't handle as cleanly inline
  let filtered = allPlans;

  if (group) {
    filtered = filtered.filter((p: any) => p.planGroup === group);
  }
  if (interval) {
    filtered = filtered.filter((p: any) => p.interval === interval);
  }
  if (currency) {
    filtered = filtered.filter(
      (p: any) => p.currency.toLowerCase() === currency.toLowerCase(),
    );
  }

  // Map to public shape — strip internal IDs, keep provider for SDK sync.
  const plans = filtered.map((p: any) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description || null,
    price: p.price,
    currency: p.currency,
    interval: p.interval,
    type: p.type,
    billingType: p.billingType,
    isAddon: p.isAddon ?? false,
    planGroup: p.planGroup || null,
    trialDays: p.trialDays ?? 0,
    provider: p.providerId || null,
    autoEnable: p.autoEnable ?? false,
    features: (p.planFeatures || []).map((pf: any) => {
      const featureType = pf.feature?.type ?? "metered";
      const isBoolean = featureType === "boolean";
      const usageModel = isBoolean ? undefined : pf.usageModel || "included";
      const overage = isBoolean
        ? undefined
        : normalizePlanFeatureOverage(usageModel, pf.overage);

      return {
        slug: pf.feature?.slug ?? pf.featureId,
        name: pf.feature?.name ?? pf.featureId,
        type: featureType,
        meterType: pf.feature?.meterType || "consumable",
        enabled: isBoolean ? pf.limitValue !== 0 : true,
        // For boolean features, limit is always null. For metered, use the actual value.
        limit: isBoolean
          ? null
          : (normalizePlanFeatureLimitValue(
              usageModel,
              pf.limitValue ?? null,
            ) ?? null),
        resetInterval: isBoolean
          ? null
          : normalizePlanFeatureResetInterval(pf.resetInterval || null),
        unit: pf.feature?.unit || null,
        usageModel,
        pricePerUnit: pf.pricePerUnit ?? undefined,
        billingUnits: pf.billingUnits ?? undefined,
        ratingModel: pf.ratingModel ?? undefined,
        tiers: pf.tiers ?? undefined,
        overage: overage !== "block" ? overage : undefined,
        overagePrice: pf.overagePrice ?? undefined,
      };
    }),
  }));

  return c.json({ success: true, plans });
});

// GET /plans/:slug — get a single plan by slug
app.get("/:slug", async (c) => {
  const organizationId = c.get("organizationId")!;
  const slug = c.req.param("slug");
  const db = c.get("db");

  const plan = await db.query.plans.findFirst({
    where: and(
      eq(schema.plans.organizationId, organizationId),
      eq(schema.plans.slug, slug),
    ),
    with: {
      planFeatures: {
        with: {
          feature: true,
        },
      },
    },
  });

  if (!plan) {
    return c.json({ success: false, error: "Plan not found" }, 404);
  }

  const p = plan as any;
  const publicPlan = {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description || null,
    price: p.price,
    currency: p.currency,
    interval: p.interval,
    type: p.type,
    billingType: p.billingType,
    isAddon: p.isAddon ?? false,
    planGroup: p.planGroup || null,
    trialDays: p.trialDays ?? 0,
    features: (p.planFeatures || []).map((pf: any) => {
      const featureType = pf.feature?.type ?? "metered";
      const isBoolean = featureType === "boolean";
      const usageModel = isBoolean ? undefined : pf.usageModel || "included";
      const overage = isBoolean
        ? undefined
        : normalizePlanFeatureOverage(usageModel, pf.overage);

      return {
        slug: pf.feature?.slug ?? pf.featureId,
        name: pf.feature?.name ?? pf.featureId,
        type: featureType,
        meterType: pf.feature?.meterType || "consumable",
        enabled: isBoolean ? pf.limitValue !== 0 : true,
        limit: isBoolean
          ? null
          : (normalizePlanFeatureLimitValue(
              usageModel,
              pf.limitValue ?? null,
            ) ?? null),
        resetInterval: isBoolean
          ? null
          : normalizePlanFeatureResetInterval(pf.resetInterval || null),
        unit: pf.feature?.unit || null,
        usageModel,
        pricePerUnit: pf.pricePerUnit ?? undefined,
        billingUnits: pf.billingUnits ?? undefined,
        ratingModel: pf.ratingModel ?? undefined,
        tiers: pf.tiers ?? undefined,
        overage: overage !== "block" ? overage : undefined,
        overagePrice: pf.overagePrice ?? undefined,
      };
    }),
  };

  return c.json({ success: true, plan: publicPlan });
});

export default app;
