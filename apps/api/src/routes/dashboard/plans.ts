import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import {
  normalizePlanFeaturePricingConfig,
  normalizePlanFeatureOverage,
  normalizePlanFeatureResetInterval,
  type PlanFeaturePricingConfigInput,
  validatePlanFeaturePricingConfig,
} from "../../lib/plan-feature-normalization";
import { normalizeOneTimePlan, sanitizeOneTimePlanFlags } from "../../lib/plans";
import { syncProviderPlan } from "../../lib/plan-provider-sync";
import type { Env, Variables } from "../../index";
import { errorToResponse, ValidationError } from "../../lib/errors";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function normalizePlanFeaturePayload(
  data: PlanFeaturePricingConfigInput,
  usageModel: string,
): PlanFeaturePricingConfigInput {
  return normalizePlanFeaturePricingConfig({
    ...data,
    usageModel,
    resetInterval:
      "resetInterval" in data
        ? (normalizePlanFeatureResetInterval(
            (data.resetInterval as string | null | undefined) ?? null,
          ) ?? "monthly")
        : undefined,
    overage:
      "overage" in data || usageModel === "usage_based"
        ? normalizePlanFeatureOverage(
            usageModel,
            (data.overage as string | null | undefined) ?? null,
          )
        : undefined,
  });
}

function buildPlanFeatureConfigSnapshot(
  data: Partial<PlanFeaturePricingConfigInput>,
  usageModel: string,
): PlanFeaturePricingConfigInput {
  return normalizePlanFeaturePayload(
    {
      limitValue: data.limitValue ?? null,
      resetInterval: data.resetInterval ?? "monthly",
      resetOnEnable: data.resetOnEnable ?? true,
      rolloverEnabled: data.rolloverEnabled ?? false,
      rolloverMaxBalance: data.rolloverMaxBalance ?? null,
      usageModel,
      pricePerUnit: data.pricePerUnit ?? null,
      billingUnits: data.billingUnits ?? 1,
      ratingModel: data.ratingModel ?? "package",
      tiers: data.tiers ?? null,
      maxPurchaseLimit: data.maxPurchaseLimit ?? null,
      creditCost: data.creditCost ?? 0,
      overage: data.overage ?? normalizePlanFeatureOverage(usageModel, null),
      overagePrice: data.overagePrice ?? null,
      maxOverageUnits: data.maxOverageUnits ?? null,
    },
    usageModel,
  );
}

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

const createPlanSchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1),
  price: z.number().min(0),
  interval: z
    .enum(["monthly", "yearly", "quarterly", "weekly", "annually"])
    .default("monthly"),
  currency: z.string().default("USD"),
  description: z.string().optional(),
  type: z.enum(["free", "paid"]).default("paid"),
  billingModel: z.enum(["base", "per_unit", "variable"]).default("base"),
  billingType: z.enum(["recurring", "one_time"]).default("recurring"),
  trialDays: z.number().min(0).default(0),
  trialUnit: z.enum(["minutes", "days"]).default("days"),
  trialCardRequired: z.boolean().default(false),
  // New Autumn-style fields
  isAddon: z.boolean().default(false),
  autoEnable: z.boolean().default(false),
  planGroup: z.string().optional(),
  providerId: z.string().optional(),
});

const updatePlanSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  price: z.number().min(0).optional(),
  currency: z.string().optional(),
  interval: z
    .enum(["monthly", "yearly", "quarterly", "weekly", "annually"])
    .optional(),
  type: z.enum(["free", "paid"]).optional(),
  billingModel: z.enum(["base", "per_unit", "variable"]).optional(),
  billingType: z.enum(["recurring", "one_time"]).optional(),
  trialDays: z.number().min(0).optional(),
  trialUnit: z.enum(["minutes", "days"]).optional(),
  trialCardRequired: z.boolean().optional(),
  isAddon: z.boolean().optional(),
  autoEnable: z.boolean().optional(),
  planGroup: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createPlanSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const normalizedInput = sanitizeOneTimePlanFlags(parsed.data);
  const {
    name,
    price,
    interval,
    currency,
    description,
    type,
    billingModel,
    billingType,
    trialDays,
    trialUnit,
    trialCardRequired,
    isAddon,
    autoEnable,
    planGroup,
    providerId: requestedProviderId,
  } = normalizedInput;
  // Use resolved organization ID from context (middleware resolves slug to UUID)
  const organizationId =
    c.get("organizationId") ?? normalizedInput.organizationId;
  const db = c.get("db");

  // Generate a slug from the name
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Ensure slug uniqueness within the organization
  let counter = 0;
  let originalSlug = slug;
  while (true) {
    const existingInOrg = await db.query.plans.findFirst({
      where: and(
        eq(schema.plans.organizationId, organizationId),
        eq(schema.plans.slug, slug),
      ),
    });

    if (!existingInOrg) break;

    counter++;
    slug = `${originalSlug}-${counter}`;
  }

  // ===========================================================================
  // Sync plan with payment provider
  // ===========================================================================
  let paystackPlanId: string | null = null;
  let providerId: string | null = requestedProviderId || null;
  let providerPlanId: string | null = null;

  try {
    const providerSync = await syncProviderPlan({
      context: {
        db,
        organizationId,
        environment: c.env.ENVIRONMENT,
        encryptionKey: c.env.ENCRYPTION_KEY,
      },
      plan: {
        slug,
        name,
        description: description ?? null,
        price,
        currency,
        interval,
        type,
        billingType,
        providerId: requestedProviderId ?? null,
      },
      preferredProviderId: requestedProviderId ?? null,
    });

    if (providerSync.issue?.code === "minimum_charge") {
      return c.json(
        {
          success: false,
          error: `${providerSync.issue.message} Please increase the price or choose a different currency.`,
        },
        400,
      );
    }

    if (providerSync.issue) {
      console.warn(
        `[plans] Provider sync skipped for ${slug}: ${providerSync.issue.message}`,
      );
    } else if (providerSync.action === "created") {
      console.log(
        `[plans] Created plan on ${providerSync.providerId}: ${providerSync.providerPlanId}`,
      );
    }

    providerId = providerSync.providerId;
    providerPlanId = providerSync.providerPlanId;
    paystackPlanId = providerSync.paystackPlanId;
  } catch (e) {
    console.warn("Provider sync error:", e);
  }

  try {
    const [plan] = await db
      .insert(schema.plans)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        name,
        slug,
        price,
        interval,
        currency,
        description,
        type,
        billingModel,
        billingType,
        trialDays,
        trialCardRequired,
        isAddon,
        autoEnable,
        planGroup,
        paystackPlanId, // Now populated!
        providerId: providerId || (paystackPlanId ? "paystack" : null),
        providerPlanId: providerPlanId || paystackPlanId,
        metadata:
          billingType === "recurring" &&
          trialDays > 0 &&
          trialUnit === "minutes"
            ? { trialUnit: "minutes" }
            : undefined,
      })
      .returning();

    return c.json({ success: true, data: plan });
  } catch (e: any) {
    console.error("Failed to create plan:", e);
    return c.json({ success: false, error: e.message }, 500);
  }
});

app.get("/", async (c) => {
  const organizationId = c.get("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const db = c.get("db");
  const plans = await db.query.plans.findMany({
    where: eq(schema.plans.organizationId, organizationId),
    orderBy: [desc(schema.plans.createdAt)],
    with: {
      subscriptions: true,
      planFeatures: {
        with: {
          feature: true,
        },
      },
    },
  });

  return c.json({
    success: true,
    data: plans.map((plan) => normalizeOneTimePlan(plan)),
  });
});

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  const plan = await db.query.plans.findFirst({
    where: eq(schema.plans.id, id),
    with: {
      planFeatures: {
        with: {
          feature: true,
        },
      },
    },
  });

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  return c.json({ success: true, data: normalizeOneTimePlan(plan) });
});

app.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = updatePlanSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const db = c.get("db");
  const existingPlan = await db.query.plans.findFirst({
    where: eq(schema.plans.id, id),
  });
  if (!existingPlan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  const finalBillingType =
    parsed.data.billingType ?? existingPlan.billingType ?? "recurring";
  const normalizedUpdate = sanitizeOneTimePlanFlags(
    parsed.data,
    finalBillingType,
  );
  // trialUnit is not a DB column — store in metadata
  const { trialUnit, ...dbFields } = normalizedUpdate;

  try {
    // If trialUnit was provided, merge it into existing metadata
    let metadataUpdate: Record<string, unknown> | undefined;
    const existingMeta =
      (existingPlan.metadata as Record<string, unknown>) || {};
    if (finalBillingType === "one_time") {
      metadataUpdate = { ...existingMeta, trialUnit: undefined };
    } else if (trialUnit !== undefined) {
      metadataUpdate =
        trialUnit === "minutes"
          ? { ...existingMeta, trialUnit: "minutes" }
          : { ...existingMeta, trialUnit: undefined };
    }

    const [updated] = await db
      .update(schema.plans)
      .set({
        ...dbFields,
        ...(finalBillingType === "one_time"
          ? { providerPlanId: null, paystackPlanId: null }
          : {}),
        ...(metadataUpdate ? { metadata: metadataUpdate } : {}),
        updatedAt: Date.now(),
      })
      .where(eq(schema.plans.id, id))
      .returning();

    if (!updated) {
      return c.json({ error: "Plan not found" }, 404);
    }

    // =========================================================================
    // Sync plan update with payment provider
    // =========================================================================
    const providerFields = [
      "name",
      "price",
      "interval",
      "currency",
      "description",
    ] as const;
    const hasProviderChange = providerFields.some(
      (f) => normalizedUpdate[f] !== undefined,
    );

    let responsePlan = updated;

    if (hasProviderChange && updated.providerPlanId && updated.providerId) {
      try {
        const providerSync = await syncProviderPlan({
          context: {
            db,
            organizationId: updated.organizationId,
            environment: c.env.ENVIRONMENT,
            encryptionKey: c.env.ENCRYPTION_KEY,
          },
          plan: {
            slug: updated.slug ?? existingPlan.slug,
            name: updated.name,
            description: updated.description ?? null,
            price: updated.price,
            currency: updated.currency,
            interval: updated.interval,
            type: updated.type ?? existingPlan.type ?? "paid",
            billingType: updated.billingType ?? finalBillingType,
            providerId: updated.providerId,
            providerPlanId: updated.providerPlanId,
            metadata: (updated.metadata as Record<string, unknown> | null) ?? null,
          },
          preferredProviderId: updated.providerId,
          allowUpdate: true,
        });

        if (providerSync.issue?.code === "minimum_charge") {
          return c.json(
            {
              success: false,
              error: `${providerSync.issue.message} Please increase the price or choose a different currency.`,
            },
            400,
          );
        }

        if (providerSync.issue) {
          console.warn(
            `[plans] Failed to sync plan on ${updated.providerId}: ${providerSync.issue.message}`,
          );
        } else if (
          providerSync.providerPlanId &&
          (providerSync.providerPlanId !== updated.providerPlanId ||
            providerSync.paystackPlanId !== updated.paystackPlanId)
        ) {
          const [providerSynced] = await db
            .update(schema.plans)
            .set({
              providerPlanId: providerSync.providerPlanId,
              paystackPlanId: providerSync.paystackPlanId,
              updatedAt: Date.now(),
            })
            .where(eq(schema.plans.id, updated.id))
            .returning();

          if (providerSynced) {
            responsePlan = providerSynced;
          }
        }

        if (providerSync.action === "updated") {
          console.log(
            `[plans] Updated plan on ${providerSync.providerId}: ${providerSync.providerPlanId}`,
          );
        }
      } catch (e) {
        console.warn("[plans] Provider sync error during update:", e);
      }
    }

    return c.json({ success: true, data: responsePlan });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  try {
    await db.delete(schema.plans).where(eq(schema.plans.id, id));
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

app.patch("/features/:planFeatureId", async (c) => {
  const planFeatureId = c.req.param("planFeatureId");
  const body = await c.req.json();
  const parsed = addFeatureSchema.partial().safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const db = c.get("db");

  try {
    const existing = await db.query.planFeatures.findFirst({
      where: eq(schema.planFeatures.id, planFeatureId),
    });

    if (!existing) {
      return c.json({ success: false, error: "Plan feature not found" }, 404);
    }

    const usageModel =
      parsed.data.usageModel ?? existing.usageModel ?? "included";
    const normalizedData = buildPlanFeatureConfigSnapshot(
      {
        limitValue: existing.limitValue,
        resetInterval: existing.resetInterval,
        resetOnEnable: existing.resetOnEnable,
        rolloverEnabled: existing.rolloverEnabled,
        rolloverMaxBalance: existing.rolloverMaxBalance,
        usageModel: existing.usageModel,
        pricePerUnit: existing.pricePerUnit,
        billingUnits: existing.billingUnits,
        ratingModel: existing.ratingModel,
        tiers: existing.tiers,
        maxPurchaseLimit: existing.maxPurchaseLimit,
        creditCost: existing.creditCost,
        overage: existing.overage,
        overagePrice: existing.overagePrice,
        maxOverageUnits: existing.maxOverageUnits,
        ...parsed.data,
      },
      usageModel,
    );
    const pricingValidationError =
      validatePlanFeaturePricingConfig(normalizedData);
    if (pricingValidationError) {
      return c.json(
        errorToResponse(
          new ValidationError({
            field: "pricing",
            details: pricingValidationError,
          }),
        ),
        400,
      );
    }

    const [updated] = await db
      .update(schema.planFeatures)
      .set(normalizedData)
      .where(eq(schema.planFeatures.id, planFeatureId))
      .returning();

    return c.json({ success: true, data: updated });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

app.delete("/features/:planFeatureId", async (c) => {
  const planFeatureId = c.req.param("planFeatureId");
  const db = c.get("db");

  try {
    await db
      .delete(schema.planFeatures)
      .where(eq(schema.planFeatures.id, planFeatureId));
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

const addFeatureSchema = z.object({
  featureId: z.string(),
  // Included feature config
  limitValue: z.number().optional().nullable(),

  // Reset config
  resetInterval: z
    .enum([
      "none",
      "5min",
      "15min",
      "30min",
      "hour",
      "hourly",
      "day",
      "daily",
      "week",
      "weekly",
      "month",
      "monthly",
      "quarter",
      "quarterly",
      "semi_annual",
      "year",
      "yearly",
    ])
    .default("monthly"),
  resetOnEnable: z.boolean().default(true),

  // Rollover config
  rolloverEnabled: z.boolean().default(false),
  rolloverMaxBalance: z.number().optional().nullable(),

  // Priced feature config
  usageModel: z
    .enum(["included", "usage_based", "prepaid"])
    .default("included"),
  pricePerUnit: z.number().optional().nullable(),
  billingUnits: z.number().default(1),
  ratingModel: z.enum(["package", "graduated", "volume"]).default("package"),
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
    .optional()
    .nullable(),
  maxPurchaseLimit: z.number().optional().nullable(),

  // Credit system
  creditCost: z.number().default(0),

  // Overage
  overage: z.enum(["block", "charge"]).default("block"),
  overagePrice: z.number().optional().nullable(),
  maxOverageUnits: z.number().optional().nullable(),
});

app.post("/:planId/features", async (c) => {
  const planId = c.req.param("planId");
  const body = await c.req.json();
  const parsed = addFeatureSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const {
    featureId,
    limitValue,
    resetInterval,
    resetOnEnable,
    rolloverEnabled,
    rolloverMaxBalance,
    usageModel,
    pricePerUnit,
    billingUnits,
    ratingModel,
    tiers,
    maxPurchaseLimit,
    creditCost,
    overage,
    overagePrice,
    maxOverageUnits,
  } = parsed.data;
  const db = c.get("db");

  try {
    const normalizedValues = buildPlanFeatureConfigSnapshot(
      {
        limitValue,
        resetInterval,
        resetOnEnable,
        rolloverEnabled,
        rolloverMaxBalance,
        usageModel,
        pricePerUnit,
        billingUnits,
        ratingModel,
        tiers,
        maxPurchaseLimit,
        creditCost,
        overage,
        overagePrice,
        maxOverageUnits,
      },
      usageModel,
    );
    const pricingValidationError =
      validatePlanFeaturePricingConfig(normalizedValues);
    if (pricingValidationError) {
      return c.json(
        errorToResponse(
          new ValidationError({
            field: "pricing",
            details: pricingValidationError,
          }),
        ),
        400,
      );
    }

    const [planFeature] = await db
      .insert(schema.planFeatures)
      .values({
        id: crypto.randomUUID(),
        planId,
        featureId,
        ...normalizedValues,
      })
      .returning();

    return c.json({ success: true, data: planFeature });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
