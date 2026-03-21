import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
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
import {
  apiKeySecurity,
  jsonContent,
  notFoundResponse,
  pricingTierSchema,
  unauthorizedResponse,
} from "../../openapi/common";

export type ApiPlansDependencies = {
  verifyApiKey: typeof verifyApiKey;
};

const defaultDependencies: ApiPlansDependencies = {
  verifyApiKey,
};

const planFeatureSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    type: z.string(),
    meterType: z.string(),
    enabled: z.boolean(),
    limit: z.number().nullable(),
    resetInterval: z.string().nullable(),
    unit: z.string().nullable(),
    usageModel: z.enum(["included", "usage_based", "prepaid"]).optional(),
    pricePerUnit: z.number().optional(),
    billingUnits: z.number().optional(),
    ratingModel: z.enum(["package", "graduated", "volume"]).optional(),
    tiers: z.array(pricingTierSchema).optional(),
    overage: z.string().optional(),
    overagePrice: z.number().optional(),
  })
  .passthrough();

const publicPlanSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    price: z.number(),
    currency: z.string(),
    interval: z.string(),
    type: z.string(),
    billingType: z.string(),
    isAddon: z.boolean(),
    planGroup: z.string().nullable(),
    trialDays: z.number().nullable().optional(),
    provider: z.string().nullable().optional(),
    features: z.array(planFeatureSchema),
  })
  .passthrough();

const listPlansRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "listPlans",
  tags: ["Plans"],
  summary: "List plans",
  description:
    "Lists plans for the authenticated organization, with optional filtering by group, interval, currency, and active status.",
  security: apiKeySecurity,
  request: {
    query: z.object({
      group: z.string().optional(),
      interval: z.string().optional(),
      currency: z.string().optional(),
      includeInactive: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Plans returned successfully",
      ...jsonContent(
        z.object({
          success: z.literal(true),
          plans: z.array(publicPlanSchema),
        }),
      ),
    },
    401: unauthorizedResponse,
  },
});

const getPlanRoute = createRoute({
  method: "get",
  path: "/{slug}",
  operationId: "getPlan",
  tags: ["Plans"],
  summary: "Get a plan",
  description:
    "Retrieves a single plan by slug, including its public feature pricing and entitlement configuration.",
  security: apiKeySecurity,
  request: {
    params: z.object({
      slug: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Plan returned successfully",
      ...jsonContent(
        z.object({
          success: z.literal(true),
          plan: publicPlanSchema,
        }),
      ),
    },
    401: unauthorizedResponse,
    404: notFoundResponse,
  },
});

export function createApiPlansRoute(
  overrides: Partial<ApiPlansDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...overrides };
  const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

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

  app.openapi(listPlansRoute, async (c) => {
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

  app.openapi(getPlanRoute, async (c) => {
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
