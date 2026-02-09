import { Hono } from "hono";
import { z } from "zod";
import { schema } from "@owostack/db";
import { eq, and, or } from "drizzle-orm";
import { verifyApiKey } from "../../lib/api-keys";
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

// Zod schema for sync payload validation
const syncFeatureSchema = z.object({
  slug: z.string().min(1),
  type: z.enum(["metered", "boolean"]),
  name: z.string().min(1),
});

const syncPlanFeatureSchema = z.object({
  slug: z.string().min(1),
  enabled: z.boolean(),
  limit: z.number().nullable().optional(),
  reset: z.string().optional(),
  overage: z.enum(["block", "charge"]).optional(),
  overagePrice: z.number().optional(),
  maxOverageUnits: z.number().optional(),
  billingUnits: z.number().optional(),
  creditCost: z.number().optional(),
});

const syncPlanSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number(),
  currency: z.string(),
  interval: z.string(),
  planGroup: z.string().optional(),
  trialDays: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  features: z.array(syncPlanFeatureSchema),
});

const syncPayloadSchema = z.object({
  features: z.array(syncFeatureSchema),
  plans: z.array(syncPlanSchema),
});

/**
 * POST /sync
 *
 * Reconciles features and plans from the SDK catalog with the database.
 * - Creates missing features and plans
 * - Updates existing SDK-managed features and plans
 * - Never deletes anything
 * - Tags created/updated resources with source: "sdk"
 */
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = syncPayloadSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid sync payload", details: parsed.error.flatten() }, 400);
  }

  const { features: featureDefs, plans: planDefs } = parsed.data;
  const db = c.get("db");
  const organizationId = c.get("organizationId");

  if (!organizationId) {
    return c.json({ success: false, error: "Organization context missing" }, 500);
  }

  const result = {
    success: true,
    features: { created: [] as string[], updated: [] as string[], unchanged: [] as string[] },
    plans: { created: [] as string[], updated: [] as string[], unchanged: [] as string[] },
    warnings: [] as string[],
  };

  // =========================================================================
  // 1. Sync Features
  // =========================================================================
  for (const featureDef of featureDefs) {
    const existing = await db.query.features.findFirst({
      where: and(
        eq(schema.features.organizationId, organizationId),
        or(
          eq(schema.features.slug, featureDef.slug),
          eq(schema.features.id, featureDef.slug),
        ),
      ),
    });

    if (existing) {
      // Check if anything changed
      const nameChanged = existing.name !== featureDef.name;
      const typeChanged = existing.type !== featureDef.type;

      if (nameChanged || typeChanged) {
        await db.update(schema.features)
          .set({
            name: featureDef.name,
            type: featureDef.type,
            source: "sdk",
          })
          .where(eq(schema.features.id, existing.id));
        result.features.updated.push(featureDef.slug);

        if (existing.source === "dashboard") {
          result.warnings.push(`Feature '${featureDef.slug}' was managed by dashboard — now managed by SDK.`);
        }
      } else {
        // Mark as SDK-managed even if nothing changed
        if (existing.source !== "sdk") {
          await db.update(schema.features)
            .set({ source: "sdk" })
            .where(eq(schema.features.id, existing.id));
        }
        result.features.unchanged.push(featureDef.slug);
      }
    } else {
      // Create new feature
      await db.insert(schema.features).values({
        id: crypto.randomUUID(),
        organizationId,
        name: featureDef.name,
        slug: featureDef.slug,
        type: featureDef.type,
        source: "sdk",
      });
      result.features.created.push(featureDef.slug);
    }
  }

  // =========================================================================
  // 2. Sync Plans
  // =========================================================================
  for (const planDef of planDefs) {
    const existing = await db.query.plans.findFirst({
      where: and(
        eq(schema.plans.organizationId, organizationId),
        or(
          eq(schema.plans.slug, planDef.slug),
          eq(schema.plans.id, planDef.slug),
        ),
      ),
    });

    if (existing) {
      // Check if core properties changed
      const changed =
        existing.name !== planDef.name ||
        existing.price !== planDef.price ||
        existing.currency !== planDef.currency ||
        existing.interval !== planDef.interval ||
        existing.description !== (planDef.description ?? null) ||
        existing.planGroup !== (planDef.planGroup ?? null) ||
        existing.trialDays !== (planDef.trialDays ?? 0);

      if (changed) {
        await db.update(schema.plans)
          .set({
            name: planDef.name,
            price: planDef.price,
            currency: planDef.currency,
            interval: planDef.interval,
            description: planDef.description ?? null,
            planGroup: planDef.planGroup ?? null,
            trialDays: planDef.trialDays ?? 0,
            type: planDef.price === 0 ? "free" : "paid",
            metadata: planDef.metadata ?? null,
            source: "sdk",
            updatedAt: Date.now(),
          })
          .where(eq(schema.plans.id, existing.id));

        if (existing.source === "dashboard") {
          result.warnings.push(`Plan '${planDef.slug}' was managed by dashboard — now managed by SDK.`);
        }
        result.plans.updated.push(planDef.slug);
      } else {
        // Mark as SDK-managed
        if (existing.source !== "sdk") {
          await db.update(schema.plans)
            .set({ source: "sdk" })
            .where(eq(schema.plans.id, existing.id));
        }
        result.plans.unchanged.push(planDef.slug);
      }

      // Reconcile plan features
      await reconcilePlanFeatures(db, organizationId, existing.id, planDef.features);
    } else {
      // Create new plan
      const planId = crypto.randomUUID();
      await db.insert(schema.plans).values({
        id: planId,
        organizationId,
        name: planDef.name,
        slug: planDef.slug,
        price: planDef.price,
        currency: planDef.currency,
        interval: planDef.interval,
        description: planDef.description ?? null,
        planGroup: planDef.planGroup ?? null,
        trialDays: planDef.trialDays ?? 0,
        type: planDef.price === 0 ? "free" : "paid",
        metadata: planDef.metadata ?? null,
        source: "sdk",
      });

      // Create plan features
      await reconcilePlanFeatures(db, organizationId, planId, planDef.features);
      result.plans.created.push(planDef.slug);
    }
  }

  return c.json(result);
});

/**
 * Reconcile plan features — upsert plan_features entries for a given plan.
 * Matches features by slug, creates missing plan_feature rows, updates existing ones.
 */
async function reconcilePlanFeatures(
  db: any,
  organizationId: string,
  planId: string,
  featureDefs: z.infer<typeof syncPlanFeatureSchema>[],
) {
  // Load all features for this org to resolve slugs → IDs
  const orgFeatures = await db.query.features.findMany({
    where: eq(schema.features.organizationId, organizationId),
  });
  const featureBySlug = new Map<string, any>();
  for (const f of orgFeatures) {
    featureBySlug.set(f.slug, f);
  }

  // Load existing plan features
  const existingPlanFeatures = await db.query.planFeatures.findMany({
    where: eq(schema.planFeatures.planId, planId),
  });
  const existingByFeatureId = new Map<string, any>();
  for (const pf of existingPlanFeatures) {
    existingByFeatureId.set(pf.featureId, pf);
  }

  for (const fd of featureDefs) {
    const feature = featureBySlug.get(fd.slug);
    if (!feature) continue; // Feature should exist from step 1

    if (!fd.enabled) {
      // If feature is disabled, remove the plan_feature if it exists
      const existing = existingByFeatureId.get(feature.id);
      if (existing) {
        await db.delete(schema.planFeatures)
          .where(eq(schema.planFeatures.id, existing.id));
      }
      continue;
    }

    const existing = existingByFeatureId.get(feature.id);
    const values = {
      limitValue: fd.limit !== undefined ? fd.limit : null,
      resetInterval: fd.reset ?? "monthly",
      overage: fd.overage ?? "block",
      overagePrice: fd.overagePrice ?? null,
      maxOverageUnits: fd.maxOverageUnits ?? null,
      billingUnits: fd.billingUnits ?? 1,
      creditCost: fd.creditCost ?? 0,
    };

    if (existing) {
      // Update existing plan feature
      await db.update(schema.planFeatures)
        .set(values)
        .where(eq(schema.planFeatures.id, existing.id));
    } else {
      // Create new plan feature
      await db.insert(schema.planFeatures).values({
        id: crypto.randomUUID(),
        planId,
        featureId: feature.id,
        ...values,
      });
    }
  }
}

export default app;
