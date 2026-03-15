import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { schema } from "@owostack/db";
import { verifyApiKey } from "../../lib/api-keys";
import {
  normalizePlanFeatureLimitValue,
  normalizePlanFeatureOverage,
  normalizePlanFeatureResetInterval,
} from "../../lib/plan-feature-normalization";
import { normalizeOneTimePlan } from "../../lib/plans";
import type { Env, Variables } from "../../index";

export type ApiPlansDependencies = {
  verifyApiKey: typeof verifyApiKey;
};

const defaultDependencies: ApiPlansDependencies = {
  verifyApiKey,
};

export function createApiPlansRoute(
  overrides: Partial<ApiPlansDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...overrides };
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use("*", async (c, next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ success: false, error: "Missing API Key" }, 401);
    }

    const apiKey = authHeader.split(" ")[1];
    const authDb = c.get("authDb");

    const keyRecord = await deps.verifyApiKey(authDb, apiKey);
    if (!keyRecord) {
      return c.json({ success: false, error: "Invalid API Key" }, 401);
    }

    c.set("organizationId", keyRecord.organizationId);
    return await next();
  });

  app.get("/", async (c) => {
    const organizationId = c.get("organizationId")!;
    const db = c.get("db");

    const group = c.req.query("group");
    const interval = c.req.query("interval");
    const currency = c.req.query("currency");
    const includeInactive = c.req.query("includeInactive") === "true";

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

    const plans = filtered.map((rawPlan: any) => {
      const p = normalizeOneTimePlan(rawPlan);
      return {
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
        trialDays: p.trialDays,
        provider: p.providerId || null,
        autoEnable: p.autoEnable,
        features: (p.planFeatures || []).map((pf: any) => {
          const featureType = pf.feature?.type ?? "metered";
          const isBoolean = featureType === "boolean";
          const usageModel = isBoolean
            ? undefined
            : pf.usageModel || "included";
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
    });

    return c.json({ success: true, plans });
  });

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

    const p = normalizeOneTimePlan(plan as any);
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
      trialDays: p.trialDays,
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

  return app;
}

export default createApiPlansRoute();
