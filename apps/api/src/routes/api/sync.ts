import { Hono } from "hono";
import { z } from "zod";
import { schema } from "@owostack/db";
import { eq, and, or } from "drizzle-orm";
import { verifyApiKey } from "../../lib/api-keys";
import {
  normalizePlanFeatureLimitValue,
  normalizePlanFeaturePricingConfig,
  normalizePlanFeatureOverage,
  normalizePlanFeatureResetInterval,
  validatePlanFeaturePricingConfig,
} from "../../lib/plan-feature-normalization";
import { getMinimumChargeAmount } from "../../lib/provider-minimums";
import { sanitizeOneTimePlanFlags } from "../../lib/plans";
import { syncProviderPlan } from "../../lib/plan-provider-sync";
import { syncCreditPackProduct } from "../../lib/credit-pack-provider-sync";
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
  meterType: z.enum(["consumable", "non_consumable"]).optional(),
});

const syncPlanFeatureSchema = z.object({
  slug: z.string().min(1),
  enabled: z.boolean(),
  limit: z.number().nullable().optional(),
  reset: z.string().optional(),
  usageModel: z.enum(["included", "usage_based", "prepaid"]).optional(),
  pricePerUnit: z.number().optional(),
  ratingModel: z.enum(["package", "graduated", "volume"]).optional(),
  tiers: z
    .array(
      z
        .object({
          upTo: z.number().nullable(),
          unitPrice: z.number().optional(),
          flatFee: z.number().optional(),
        })
        .refine(
          (tier) => tier.unitPrice !== undefined || tier.flatFee !== undefined,
          {
            message: "Each tier must define unitPrice, flatFee, or both",
          },
        ),
    )
    .optional(),
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
  billingType: z.enum(["recurring", "one_time"]).default("recurring"),
  planGroup: z.string().optional(),
  trialDays: z.number().optional(),
  provider: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  autoEnable: z.boolean().optional(),
  isAddon: z.boolean().optional(),
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

const syncCreditPackSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  credits: z.number().int().min(1),
  price: z.number().int().min(0),
  currency: z.string().min(3),
  creditSystem: z.string().min(1),
  provider: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const syncPayloadSchema = z.object({
  defaultProvider: z.string().optional(),
  features: z.array(syncFeatureSchema),
  creditSystems: z.array(syncCreditSystemSchema).optional(),
  creditPacks: z.array(syncCreditPackSchema).optional(),
  plans: z.array(syncPlanSchema),
});

type SyncPlanDefinition = z.infer<typeof syncPlanSchema>;

/**
 * POST /sync
 *
 * Reconciles features and plans from the SDK catalog with the database.
 */
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = syncPayloadSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.format() }, 400);
  }

  const {
    features: featureDefs,
    creditSystems: creditSystemDefs,
    creditPacks: creditPackDefs,
    plans: rawPlanDefs,
    defaultProvider,
  } = parsed.data;
  const planDefs = rawPlanDefs.map((planDef) =>
    sanitizeOneTimePlanFlags(planDef, planDef.billingType),
  );
  const organizationId = c.get("organizationId")!;
  const db = c.get("db");
  const featureTypeBySlug = new Map(
    featureDefs.map((featureDef) => [featureDef.slug, featureDef.type]),
  );

  for (const planDef of planDefs) {
    for (const featureDef of planDef.features) {
      if (featureTypeBySlug.get(featureDef.slug) === "boolean") continue;

      const normalizedFeatureConfig = normalizePlanFeaturePricingConfig({
        limitValue: featureDef.limit ?? null,
        resetInterval:
          normalizePlanFeatureResetInterval(featureDef.reset ?? "monthly") ??
          "monthly",
        usageModel: featureDef.usageModel ?? "included",
        pricePerUnit: featureDef.pricePerUnit ?? null,
        billingUnits: featureDef.billingUnits ?? 1,
        ratingModel: featureDef.ratingModel ?? "package",
        tiers: featureDef.tiers ?? null,
        overage: normalizePlanFeatureOverage(
          featureDef.usageModel ?? "included",
          featureDef.overage,
        ),
        overagePrice: featureDef.overagePrice ?? null,
        maxOverageUnits: featureDef.maxOverageUnits ?? null,
        creditCost: featureDef.creditCost ?? 0,
      });
      const pricingValidationError = validatePlanFeaturePricingConfig(
        normalizedFeatureConfig,
      );

      if (pricingValidationError) {
        return c.json(
          {
            success: false,
            error: `Invalid pricing config for plan '${planDef.slug}' feature '${featureDef.slug}': ${pricingValidationError}`,
          },
          400,
        );
      }
    }
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
    creditPacks: {
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

  const syncPlanWithProvider = async (
    plan: typeof schema.plans.$inferSelect,
    planDef: SyncPlanDefinition,
    hasPlanChanges: boolean,
  ) => {
    const providerSync = await syncProviderPlan({
      context: {
        db,
        organizationId,
        environment: c.env.ENVIRONMENT,
        encryptionKey: c.env.ENCRYPTION_KEY,
      },
      plan: {
        slug: planDef.slug,
        name: planDef.name,
        description: planDef.description ?? null,
        price: planDef.price,
        currency: planDef.currency,
        interval: planDef.interval,
        type: plan.type,
        billingType: plan.billingType,
        providerId: plan.providerId ?? null,
        providerPlanId: plan.providerPlanId ?? null,
        metadata: planDef.metadata ?? null,
      },
      preferredProviderId: planDef.provider ?? defaultProvider ?? plan.providerId,
      allowUpdate: hasPlanChanges,
    });

    if (providerSync.issue) {
      result.warnings.push(
        `Plan '${planDef.slug}' provider sync skipped: ${providerSync.issue.message}`,
      );
      return;
    }

    if (
      providerSync.providerId !== plan.providerId ||
      providerSync.providerPlanId !== plan.providerPlanId ||
      providerSync.paystackPlanId !== plan.paystackPlanId
    ) {
      await db
        .update(schema.plans)
        .set({
          providerId: providerSync.providerId,
          providerPlanId: providerSync.providerPlanId,
          paystackPlanId: providerSync.paystackPlanId,
          updatedAt: Date.now(),
        })
        .where(eq(schema.plans.id, plan.id));
    }
  };

  // 1. Sync Features
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
      const nameChanged = existing.name !== featureDef.name;
      const typeChanged = existing.type !== featureDef.type;
      const meterTypeChanged =
        existing.meterType !== (featureDef.meterType || "consumable");

      if (nameChanged || typeChanged || meterTypeChanged) {
        await db
          .update(schema.features)
          .set({
            name: featureDef.name,
            type: featureDef.type,
            meterType: featureDef.meterType || "consumable",
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
        if (existing.source !== "sdk") {
          await db
            .update(schema.features)
            .set({ source: "sdk" })
            .where(eq(schema.features.id, existing.id));
        }
        result.features.unchanged.push(featureDef.slug);
      }
    } else {
      await db.insert(schema.features).values({
        id: crypto.randomUUID(),
        organizationId,
        name: featureDef.name,
        slug: featureDef.slug,
        type: featureDef.type,
        meterType: featureDef.meterType || "consumable",
        source: "sdk",
      });
      result.features.created.push(featureDef.slug);
    }
  }

  // 2. Sync Credit Systems
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

        await reconcileCreditSystemFeatures(
          db,
          organizationId,
          existing.id,
          csDef.features,
        );
      } else {
        const csId = crypto.randomUUID();
        await db.insert(schema.creditSystems).values({
          id: csId,
          organizationId,
          name: csDef.name,
          slug: csDef.slug,
          description: csDef.description ?? null,
        });
        await reconcileCreditSystemFeatures(
          db,
          organizationId,
          csId,
          csDef.features,
        );
        result.creditSystems.created.push(csDef.slug as string);
      }

      // Ensure a corresponding feature exists for this credit system
      // This allows plans to include this credit system as a "feature" (e.g. 50 credits/month)
      const existingFeature = await db.query.features.findFirst({
        where: and(
          eq(schema.features.organizationId, organizationId),
          eq(schema.features.slug, csDef.slug),
        ),
      });

      if (existingFeature) {
        if (
          existingFeature.name !== csDef.name ||
          existingFeature.type !== "metered" ||
          existingFeature.meterType !== "consumable"
        ) {
          await db
            .update(schema.features)
            .set({
              name: csDef.name,
              type: "metered",
              meterType: "consumable",
              source: "sdk",
            })
            .where(eq(schema.features.id, existingFeature.id));
        }
      } else {
        await db.insert(schema.features).values({
          id: crypto.randomUUID(),
          organizationId,
          name: csDef.name,
          slug: csDef.slug,
          type: "metered",
          meterType: "consumable",
          source: "sdk",
        });
      }
    }
  }

  // 3. Sync Credit Packs
  if (creditPackDefs && creditPackDefs.length > 0) {
    for (const packDef of creditPackDefs) {
      // First, resolve the credit system by slug
      const creditSystem = await db.query.creditSystems.findFirst({
        where: and(
          eq(schema.creditSystems.organizationId, organizationId),
          eq(schema.creditSystems.slug, packDef.creditSystem),
        ),
      });

      if (!creditSystem) {
        result.warnings.push(
          `Credit pack '${packDef.slug}' references unknown credit system '${packDef.creditSystem}'. Skipping.`,
        );
        continue;
      }

      const existing = await db.query.creditPacks.findFirst({
        where: and(
          eq(schema.creditPacks.organizationId, organizationId),
          eq(schema.creditPacks.slug, packDef.slug),
        ),
      });

      if (existing) {
        const desiredProviderId =
          packDef.provider ?? defaultProvider ?? existing.providerId ?? null;
        const providerProductChanged =
          existing.name !== packDef.name ||
          existing.price !== packDef.price ||
          existing.currency !== packDef.currency ||
          existing.description !== (packDef.description ?? null) ||
          existing.providerId !== desiredProviderId;
        const changed =
          existing.name !== packDef.name ||
          existing.credits !== packDef.credits ||
          existing.price !== packDef.price ||
          existing.currency !== packDef.currency ||
          existing.creditSystemId !== creditSystem.id ||
          existing.description !== (packDef.description ?? null) ||
          existing.providerId !== desiredProviderId ||
          (providerProductChanged &&
            (existing.providerProductId !== null ||
              existing.providerPriceId !== null));

        if (changed) {
          await db
            .update(schema.creditPacks)
            .set({
              name: packDef.name,
              description: packDef.description ?? null,
              credits: packDef.credits,
              price: packDef.price,
              currency: packDef.currency,
              creditSystemId: creditSystem.id,
              providerId: desiredProviderId,
              ...(providerProductChanged
                ? {
                    providerProductId: null,
                    providerPriceId: null,
                  }
                : {}),
              metadata: packDef.metadata ?? null,
              updatedAt: Date.now(),
            })
            .where(eq(schema.creditPacks.id, existing.id));
          result.creditPacks.updated.push(packDef.slug);

          const providerSync = await syncCreditPackProduct({
            context: {
              db,
              organizationId,
              environment: c.env.ENVIRONMENT,
              encryptionKey: c.env.ENCRYPTION_KEY,
            },
            pack: {
              id: existing.id,
              slug: packDef.slug,
              name: packDef.name,
              description: packDef.description ?? null,
              price: packDef.price,
              currency: packDef.currency,
              providerId: desiredProviderId,
              providerProductId: providerProductChanged
                ? null
                : existing.providerProductId,
              providerPriceId: providerProductChanged
                ? null
                : existing.providerPriceId,
              metadata: packDef.metadata ?? null,
            },
            preferredProviderId: desiredProviderId,
            forceResync: providerProductChanged,
          });

          if (providerSync.issue) {
            result.warnings.push(
              `Credit pack '${packDef.slug}' provider sync skipped: ${providerSync.issue.message}`,
            );
          } else if (
            providerSync.providerProductId !==
              (providerProductChanged ? null : existing.providerProductId) ||
            providerSync.providerPriceId !==
              (providerProductChanged ? null : existing.providerPriceId) ||
            providerSync.providerId !== desiredProviderId
          ) {
            await db
              .update(schema.creditPacks)
              .set({
                providerId: providerSync.providerId,
                providerProductId: providerSync.providerProductId,
                providerPriceId: providerSync.providerPriceId,
                updatedAt: Date.now(),
              })
              .where(eq(schema.creditPacks.id, existing.id));
          }
        } else {
          result.creditPacks.unchanged.push(packDef.slug);

          if (!existing.providerProductId || !existing.providerPriceId) {
            const providerSync = await syncCreditPackProduct({
              context: {
                db,
                organizationId,
                environment: c.env.ENVIRONMENT,
                encryptionKey: c.env.ENCRYPTION_KEY,
              },
              pack: {
                id: existing.id,
                slug: packDef.slug,
                name: packDef.name,
                description: packDef.description ?? null,
                price: packDef.price,
                currency: packDef.currency,
                providerId: desiredProviderId,
                providerProductId: existing.providerProductId,
                providerPriceId: existing.providerPriceId,
                metadata: packDef.metadata ?? null,
              },
              preferredProviderId: desiredProviderId,
            });

            if (providerSync.issue) {
              result.warnings.push(
                `Credit pack '${packDef.slug}' provider sync skipped: ${providerSync.issue.message}`,
              );
            } else if (
              providerSync.providerProductId !== existing.providerProductId ||
              providerSync.providerPriceId !== existing.providerPriceId ||
              providerSync.providerId !== desiredProviderId
            ) {
              await db
                .update(schema.creditPacks)
                .set({
                  providerId: providerSync.providerId,
                  providerProductId: providerSync.providerProductId,
                  providerPriceId: providerSync.providerPriceId,
                  updatedAt: Date.now(),
                })
                .where(eq(schema.creditPacks.id, existing.id));
            }
          }
        }
      } else {
        const packId = crypto.randomUUID();
        const desiredProviderId = packDef.provider ?? defaultProvider ?? null;
        await db.insert(schema.creditPacks).values({
          id: packId,
          organizationId,
          name: packDef.name,
          slug: packDef.slug,
          description: packDef.description ?? null,
          credits: packDef.credits,
          price: packDef.price,
          currency: packDef.currency,
          creditSystemId: creditSystem.id,
          providerId: desiredProviderId,
          metadata: packDef.metadata ?? null,
          isActive: true,
        });

        const providerSync = await syncCreditPackProduct({
          context: {
            db,
            organizationId,
            environment: c.env.ENVIRONMENT,
            encryptionKey: c.env.ENCRYPTION_KEY,
          },
          pack: {
            id: packId,
            slug: packDef.slug,
            name: packDef.name,
            description: packDef.description ?? null,
            price: packDef.price,
            currency: packDef.currency,
            providerId: desiredProviderId,
            providerProductId: null,
            providerPriceId: null,
            metadata: packDef.metadata ?? null,
          },
          preferredProviderId: desiredProviderId,
        });

        if (providerSync.issue) {
          result.warnings.push(
            `Credit pack '${packDef.slug}' provider sync skipped: ${providerSync.issue.message}`,
          );
        } else if (
          providerSync.providerProductId ||
          providerSync.providerPriceId ||
          providerSync.providerId !== desiredProviderId
        ) {
          await db
            .update(schema.creditPacks)
            .set({
              providerId: providerSync.providerId,
              providerProductId: providerSync.providerProductId,
              providerPriceId: providerSync.providerPriceId,
              updatedAt: Date.now(),
            })
            .where(eq(schema.creditPacks.id, packId));
        }
        result.creditPacks.created.push(packDef.slug);
      }
    }
  }

  // 4. Sync Plans
  for (const planDef of planDefs) {
    const existing = await db.query.plans.findFirst({
      where: and(
        eq(schema.plans.organizationId, organizationId),
        eq(schema.plans.slug, planDef.slug),
      ),
    });

    if (existing) {
      const desiredProviderId =
        planDef.provider ?? defaultProvider ?? existing.providerId ?? null;
      const shouldClearProviderPlanIds =
        planDef.billingType === "one_time" &&
        (existing.providerPlanId !== null || existing.paystackPlanId !== null);
      const changed =
        existing.name !== planDef.name ||
        existing.price !== planDef.price ||
        existing.currency !== planDef.currency ||
        existing.interval !== planDef.interval ||
        existing.billingType !== planDef.billingType ||
        existing.description !== (planDef.description ?? null) ||
        existing.planGroup !== (planDef.planGroup ?? null) ||
        existing.trialDays !== (planDef.trialDays ?? 0) ||
        existing.autoEnable !== (planDef.autoEnable ?? false) ||
        existing.isAddon !== (planDef.isAddon ?? false) ||
        shouldClearProviderPlanIds;
      const currentPlan = {
        ...existing,
        name: planDef.name,
        price: planDef.price,
        currency: planDef.currency,
        interval: planDef.interval,
        description: planDef.description ?? null,
        planGroup: planDef.planGroup ?? null,
        trialDays: planDef.trialDays ?? 0,
        type: planDef.price === 0 ? "free" : "paid",
        billingType: planDef.billingType,
        providerId: desiredProviderId,
        providerPlanId: planDef.billingType === "one_time" ? null : existing.providerPlanId,
        paystackPlanId: planDef.billingType === "one_time" ? null : existing.paystackPlanId,
        metadata: planDef.metadata ?? null,
        autoEnable: planDef.autoEnable ?? false,
        isAddon: planDef.isAddon ?? false,
        source: "sdk" as const,
      };

      if (changed) {
        if (
          existing.price !== planDef.price &&
          planDef.price > 0 &&
          desiredProviderId &&
          planDef.billingType === "recurring"
        ) {
          const minimumAmount = getMinimumChargeAmount(
            desiredProviderId,
            planDef.currency,
          );

          if (minimumAmount > 0 && planDef.price < minimumAmount) {
            const minDisplay = minimumAmount / 100;
            result.warnings.push(
              `Plan '${planDef.slug}' price ${planDef.price / 100} ${planDef.currency} is below the minimum charge amount of ${minDisplay} ${planDef.currency} for ${desiredProviderId}. Price update skipped.`,
            );
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
                billingType: planDef.billingType,
                providerId: desiredProviderId,
                metadata: planDef.metadata ?? null,
                autoEnable: planDef.autoEnable ?? false,
                isAddon: planDef.isAddon ?? false,
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
            billingType: planDef.billingType,
            providerId: desiredProviderId,
            ...(planDef.billingType === "one_time"
              ? {
                  providerPlanId: null,
                  paystackPlanId: null,
                }
              : {}),
            metadata: planDef.metadata ?? null,
            autoEnable: planDef.autoEnable ?? false,
            isAddon: planDef.isAddon ?? false,
            source: "sdk",
            updatedAt: Date.now(),
          })
          .where(eq(schema.plans.id, existing.id));

        if (existing.source === "dashboard") {
          result.warnings.push(
            `Plan '${planDef.slug}' was managed by dashboard — now managed by SDK.`,
          );
        }
        result.plans.updated.push(planDef.slug);
      } else {
        if (existing.source !== "sdk") {
          await db
            .update(schema.plans)
            .set({ source: "sdk" })
            .where(eq(schema.plans.id, existing.id));
        }
      }

      const featuresChanged = await reconcilePlanFeatures(
        db,
        organizationId,
        existing.id,
        planDef.features,
      );

      if (changed || featuresChanged) {
        const unchangedIndex = result.plans.unchanged.indexOf(planDef.slug);
        if (unchangedIndex > -1) {
          result.plans.unchanged.splice(unchangedIndex, 1);
        }
        if (!result.plans.updated.includes(planDef.slug)) {
          result.plans.updated.push(planDef.slug);
        }
      } else {
        result.plans.unchanged.push(planDef.slug);
      }

      await syncPlanWithProvider(currentPlan, planDef, changed);
    } else {
      const planId = crypto.randomUUID();
      const effectiveProvider = planDef.provider ?? defaultProvider ?? null;
      const createdAt = Date.now();

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
        billingType: planDef.billingType,
        providerId: effectiveProvider,
        metadata: planDef.metadata ?? null,
        autoEnable: planDef.autoEnable ?? false,
        isAddon: planDef.isAddon ?? false,
        source: "sdk",
        createdAt,
        updatedAt: createdAt,
      });

      await reconcilePlanFeatures(db, organizationId, planId, planDef.features);
      await syncPlanWithProvider(
        {
          id: planId,
          organizationId,
          providerId: effectiveProvider,
          providerPlanId: null,
          providerMetadata: null,
          paystackPlanId: null,
          name: planDef.name,
          slug: planDef.slug,
          description: planDef.description ?? null,
          price: planDef.price,
          currency: planDef.currency,
          interval: planDef.interval,
          type: planDef.price === 0 ? "free" : "paid",
          billingModel: "base",
          billingType: planDef.billingType,
          autoEnable: planDef.autoEnable ?? false,
          isAddon: planDef.isAddon ?? false,
          planGroup: planDef.planGroup ?? null,
          trialDays: planDef.trialDays ?? 0,
          trialCardRequired: false,
          isActive: true,
          version: 1,
          source: "sdk",
          metadata: planDef.metadata ?? null,
          createdAt,
          updatedAt: createdAt,
        },
        planDef,
        true,
      );
      result.plans.created.push(planDef.slug);
    }
  }

  return c.json(result);
});

async function reconcilePlanFeatures(
  db: any,
  organizationId: string,
  planId: string,
  featureDefs: z.infer<typeof syncPlanFeatureSchema>[],
): Promise<boolean> {
  let hasChanges = false;
  const orgFeatures = await db.query.features.findMany({
    where: eq(schema.features.organizationId, organizationId),
  });
  const featureBySlug = new Map<string, any>();
  for (const f of orgFeatures) featureBySlug.set(f.slug, f);

  const existingPlanFeatures = await db.query.planFeatures.findMany({
    where: eq(schema.planFeatures.planId, planId),
  });
  const existingByFeatureId = new Map<string, any>();
  for (const pf of existingPlanFeatures)
    existingByFeatureId.set(pf.featureId, pf);

  const seenFeatureIds = new Set<string>();

  for (const fd of featureDefs) {
    const feature = featureBySlug.get(fd.slug);
    if (!feature) continue;

    seenFeatureIds.add(feature.id);

    if (!fd.enabled) {
      const existing = existingByFeatureId.get(feature.id);
      if (existing) {
        await db
          .delete(schema.planFeatures)
          .where(eq(schema.planFeatures.id, existing.id));
        hasChanges = true;
      }
      continue;
    }

    const existing = existingByFeatureId.get(feature.id);
    const isBoolean = feature.type === "boolean";
    const usageModel = isBoolean ? "included" : (fd.usageModel ?? "included");
    const values = isBoolean
      ? {
          limitValue: null,
          resetInterval: "never",
          usageModel,
          pricePerUnit: null,
          ratingModel: "package" as const,
          tiers: null,
          overage: "block" as const,
          overagePrice: null,
          maxOverageUnits: null,
          billingUnits: 1,
          creditCost: fd.creditCost ?? 0,
        }
      : normalizePlanFeaturePricingConfig({
          limitValue: normalizePlanFeatureLimitValue(
            usageModel,
            fd.limit ?? null,
          ),
          resetInterval:
            normalizePlanFeatureResetInterval(fd.reset ?? "monthly") ??
            "monthly",
          usageModel,
          pricePerUnit: fd.pricePerUnit ?? null,
          ratingModel: fd.ratingModel ?? "package",
          tiers: fd.tiers ?? null,
          overage: normalizePlanFeatureOverage(usageModel, fd.overage),
          overagePrice: fd.overagePrice ?? null,
          maxOverageUnits: fd.maxOverageUnits ?? null,
          billingUnits: fd.billingUnits ?? 1,
          creditCost: fd.creditCost ?? 0,
        });

    if (existing) {
      const isChanged =
        existing.limitValue !== values.limitValue ||
        existing.resetInterval !== values.resetInterval ||
        existing.usageModel !== values.usageModel ||
        existing.pricePerUnit !== values.pricePerUnit ||
        existing.ratingModel !== values.ratingModel ||
        JSON.stringify(existing.tiers ?? null) !==
          JSON.stringify(values.tiers ?? null) ||
        existing.overage !== values.overage ||
        existing.overagePrice !== values.overagePrice ||
        existing.maxOverageUnits !== values.maxOverageUnits ||
        existing.billingUnits !== values.billingUnits ||
        existing.creditCost !== values.creditCost;

      if (isChanged) {
        await db
          .update(schema.planFeatures)
          .set(values)
          .where(eq(schema.planFeatures.id, existing.id));
        hasChanges = true;
      }
    } else {
      await db.insert(schema.planFeatures).values({
        id: crypto.randomUUID(),
        planId,
        featureId: feature.id,
        ...values,
      });
      hasChanges = true;
    }
  }

  // Cleanup: Remove features that were missing from config
  for (const [featureId, pf] of existingByFeatureId.entries()) {
    if (!seenFeatureIds.has(featureId)) {
      await db
        .delete(schema.planFeatures)
        .where(eq(schema.planFeatures.id, pf.id));
      hasChanges = true;
    }
  }

  return hasChanges;
}

async function reconcileCreditSystemFeatures(
  db: any,
  organizationId: string,
  creditSystemId: string,
  featureDefs: z.infer<typeof syncCreditSystemFeatureSchema>[],
) {
  const orgFeatures = await db.query.features.findMany({
    where: eq(schema.features.organizationId, organizationId),
  });
  const featureBySlug = new Map<string, any>();
  for (const f of orgFeatures) featureBySlug.set(f.slug, f);

  const existingCsFeatures = await db.query.creditSystemFeatures.findMany({
    where: eq(schema.creditSystemFeatures.creditSystemId, creditSystemId),
  });
  const existingByFeatureId = new Map<string, any>();
  for (const csf of existingCsFeatures)
    existingByFeatureId.set(csf.featureId, csf);

  const seenFeatureIds = new Set<string>();

  for (const fd of featureDefs) {
    const feature = featureBySlug.get(fd.feature);
    if (!feature) continue;

    seenFeatureIds.add(feature.id);
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

  // Cleanup
  for (const [featureId, csf] of existingByFeatureId.entries()) {
    if (!seenFeatureIds.has(featureId)) {
      await db
        .delete(schema.creditSystemFeatures)
        .where(eq(schema.creditSystemFeatures.id, csf.id));
    }
  }
}

export default app;
