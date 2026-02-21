import { Hono } from "hono";
import { z } from "zod";
import { schema } from "@owostack/db";
import { eq, and, or } from "drizzle-orm";
import { verifyApiKey } from "../../lib/api-keys";
import {
  getProviderRegistry,
  deriveProviderEnvironment,
  loadProviderAccounts,
} from "../../lib/providers";
import { getMinimumChargeAmount } from "../../lib/provider-minimums";
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

const syncCreditSystemFeatureSchema = z.object({
  feature: z.string().min(1),
  creditCost: z.number().min(0),
});

const syncCreditSystemSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  features: z.array(syncCreditSystemFeatureSchema),
});

const syncPayloadSchema = z.object({
  features: z.array(syncFeatureSchema),
  creditSystems: z.array(syncCreditSystemSchema).optional(),
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
    return c.json(
      {
        success: false,
        error: "Invalid sync payload",
        details: parsed.error.flatten(),
      },
      400,
    );
  }

  const {
    features: featureDefs,
    creditSystems: creditSystemDefs,
    plans: planDefs,
  } = parsed.data;
  const db = c.get("db");
  const organizationId = c.get("organizationId");

  if (!organizationId) {
    return c.json(
      { success: false, error: "Organization context missing" },
      500,
    );
  }

  const result = {
    success: true,
    features: {
      created: [] as string[],
      updated: [] as string[],
      unchanged: [] as string[],
    },
    creditSystems: {
      created: [] as string[],
      updated: [] as string[],
      unchanged: [] as string[],
    },
    plans: {
      created: [] as string[],
      updated: [] as string[],
      unchanged: [] as string[],
    },
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
        await db
          .update(schema.features)
          .set({
            name: featureDef.name,
            type: featureDef.type,
            source: "sdk",
          })
          .where(eq(schema.features.id, existing.id));
        result.features.updated.push(featureDef.slug);

        if (existing.source === "dashboard") {
          result.warnings.push(
            `Feature '${featureDef.slug}' was managed by dashboard — now managed by SDK.`,
          );
        }
      } else {
        // Mark as SDK-managed even if nothing changed
        if (existing.source !== "sdk") {
          await db
            .update(schema.features)
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
  // 2. Sync Credit Systems
  // =========================================================================
  if (creditSystemDefs && creditSystemDefs.length > 0) {
    for (const csDef of creditSystemDefs) {
      const existing = await db.query.creditSystems.findFirst({
        where: and(
          eq(schema.creditSystems.organizationId, organizationId),
          eq(schema.creditSystems.slug, csDef.slug),
        ),
      });

      if (existing) {
        const nameChanged = existing.name !== csDef.name;
        const descChanged =
          existing.description !== (csDef.description ?? null);

        if (nameChanged || descChanged) {
          await db
            .update(schema.creditSystems)
            .set({
              name: csDef.name,
              description: csDef.description ?? null,
              updatedAt: Date.now(),
            })
            .where(eq(schema.creditSystems.id, existing.id));
          result.creditSystems.updated.push(csDef.slug);
        } else {
          result.creditSystems.unchanged.push(csDef.slug);
        }

        // Sync credit system features
        await reconcileCreditSystemFeatures(
          db,
          organizationId,
          existing.id,
          csDef.features,
        );
      } else {
        // Create new credit system
        const csId = crypto.randomUUID();
        await db.insert(schema.creditSystems).values({
          id: csId,
          organizationId,
          name: csDef.name,
          slug: csDef.slug,
          description: csDef.description ?? null,
        });

        // Sync credit system features
        await reconcileCreditSystemFeatures(
          db,
          organizationId,
          csId,
          csDef.features,
        );
        result.creditSystems.created.push(csDef.slug);
      }
    }
  }

  // =========================================================================
  // 3. Sync Plans
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
        // Validate minimum charge amount if price changed and plan has a provider
        if (
          existing.price !== planDef.price &&
          planDef.price > 0 &&
          existing.providerId
        ) {
          const minimumAmount = getMinimumChargeAmount(
            existing.providerId,
            planDef.currency,
          );

          if (minimumAmount > 0 && planDef.price < minimumAmount) {
            const minDisplay = minimumAmount / 100;
            result.warnings.push(
              `Plan '${planDef.slug}' price ${planDef.price / 100} ${planDef.currency} is below the minimum charge amount of ${minDisplay} ${planDef.currency} for ${existing.providerId}. Price update skipped.`,
            );
            // Skip price update but continue with other changes
            await db
              .update(schema.plans)
              .set({
                name: planDef.name,
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
            result.plans.updated.push(planDef.slug);
            await reconcilePlanFeatures(
              db,
              organizationId,
              existing.id,
              planDef.features,
            );
            continue;
          }
        }

        await db
          .update(schema.plans)
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
          result.warnings.push(
            `Plan '${planDef.slug}' was managed by dashboard — now managed by SDK.`,
          );
        }

        // Sync price/name changes with payment provider
        if (existing.providerPlanId && existing.providerId) {
          try {
            const registry = getProviderRegistry();
            const adapter = registry.get(existing.providerId);
            const authDb = c.get("authDb");
            const project = await authDb.query.projects.findFirst({
              where: eq(schema.projects.organizationId, organizationId),
            });
            const providerEnv = deriveProviderEnvironment(
              c.env.ENVIRONMENT,
              project?.activeEnvironment,
            );
            const providerAccounts = await loadProviderAccounts(
              db,
              organizationId,
              c.env.ENCRYPTION_KEY,
            );
            const account = providerAccounts.find(
              (a) => a.providerId === existing.providerId,
            );

            if (adapter?.updatePlan && account) {
              const updateResult = await adapter.updatePlan({
                planId: existing.providerPlanId,
                name: planDef.name,
                amount: planDef.price,
                interval: planDef.interval,
                currency: planDef.currency,
                description: planDef.description ?? null,
                environment: providerEnv,
                account,
              });

              if (updateResult.isOk()) {
                console.log(
                  `[sync] Updated plan on ${existing.providerId}: ${existing.providerPlanId}`,
                );
              } else {
                console.warn(
                  `[sync] Failed to update plan on ${existing.providerId}:`,
                  updateResult.error,
                );
              }
            }
          } catch (e) {
            console.warn("[sync] Provider sync error during plan update:", e);
          }
        }

        result.plans.updated.push(planDef.slug);
      } else {
        // Mark as SDK-managed
        if (existing.source !== "sdk") {
          await db
            .update(schema.plans)
            .set({ source: "sdk" })
            .where(eq(schema.plans.id, existing.id));
        }
        result.plans.unchanged.push(planDef.slug);
      }

      // Reconcile plan features
      await reconcilePlanFeatures(
        db,
        organizationId,
        existing.id,
        planDef.features,
      );
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
        await db
          .delete(schema.planFeatures)
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
      await db
        .update(schema.planFeatures)
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

/**
 * Reconcile credit system features — upsert credit_system_features entries.
 * Links features to a credit system with their credit cost.
 */
async function reconcileCreditSystemFeatures(
  db: any,
  organizationId: string,
  creditSystemId: string,
  featureDefs: z.infer<typeof syncCreditSystemFeatureSchema>[],
) {
  // Load all features for this org to resolve slugs → IDs
  const orgFeatures = await db.query.features.findMany({
    where: eq(schema.features.organizationId, organizationId),
  });
  const featureBySlug = new Map<string, any>();
  for (const f of orgFeatures) {
    featureBySlug.set(f.slug, f);
  }

  // Load existing credit system features
  const existingCsFeatures = await db.query.creditSystemFeatures.findMany({
    where: eq(schema.creditSystemFeatures.creditSystemId, creditSystemId),
  });
  const existingByFeatureId = new Map<string, any>();
  for (const csf of existingCsFeatures) {
    existingByFeatureId.set(csf.featureId, csf);
  }

  for (const fd of featureDefs) {
    const feature = featureBySlug.get(fd.feature);
    if (!feature) continue;

    const existing = existingByFeatureId.get(feature.id);

    if (existing) {
      if (existing.cost !== fd.creditCost) {
        await db
          .update(schema.creditSystemFeatures)
          .set({ cost: fd.creditCost })
          .where(eq(schema.creditSystemFeatures.id, existing.id));
      }
    } else {
      await db.insert(schema.creditSystemFeatures).values({
        id: crypto.randomUUID(),
        creditSystemId,
        featureId: feature.id,
        cost: fd.creditCost,
      });
    }
  }
}

export default app;
