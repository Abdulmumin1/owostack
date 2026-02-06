import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { PaystackClient } from "../../lib/paystack";
import { decrypt } from "../../lib/encryption";
import {
  createProviderRegistry,
  paystackAdapter,
  resolveProvider,
} from "@owostack/adapters";
import {
  buildProviderContext,
  deriveProviderEnvironment,
  loadProviderAccounts,
  loadProviderRules,
} from "../../lib/providers";
import { schema } from "@owostack/db";
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

const createPlanSchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1),
  price: z.number().min(0),
  interval: z
    .enum(["monthly", "yearly", "quarterly", "weekly", "annually"])
    .default("monthly"),
  currency: z.string().default("NGN"),
  description: z.string().optional(),
  type: z.enum(["free", "paid"]).default("paid"),
  billingModel: z.enum(["base", "per_unit", "variable"]).default("base"),
  billingType: z.enum(["recurring", "one_time"]).default("recurring"),
  trialDays: z.number().min(0).default(0),
  trialCardRequired: z.boolean().default(false),
  // New Autumn-style fields
  isAddon: z.boolean().default(false),
  autoEnable: z.boolean().default(false),
  planGroup: z.string().optional(),
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

  const {
    organizationId,
    name,
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
  } = parsed.data;
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
  // Sync with Paystack
  // ===========================================================================
  let paystackPlanId: string | null = null;
  let providerId: string | null = null;
  let providerPlanId: string | null = null;
  let providerAccountSecret: string | null = null;

  // Only sync if it's a paid, recurring plan
  if (type === "paid" && billingType === "recurring") {
    try {
      const authDb = c.get("authDb");
      const project = await authDb.query.projects.findFirst({
        where: eq(schema.projects.organizationId, organizationId),
      });

      const registry = createProviderRegistry();
      registry.register(paystackAdapter);
      const providerEnv = deriveProviderEnvironment(
        c.env.ENVIRONMENT,
        project?.activeEnvironment,
      );
      const providerRules = await loadProviderRules(db, organizationId);
      const providerAccounts = await loadProviderAccounts(
        db,
        organizationId,
        c.env.ENCRYPTION_KEY,
      );
      const providerContext = buildProviderContext({
        currency,
      });

      const selectionResult = resolveProvider(registry, {
        organizationId,
        environment: providerEnv,
        context: providerContext,
        rules: providerRules,
        accounts: providerAccounts,
      });

      if (selectionResult.isOk()) {
        providerId = selectionResult.value.adapter.id;
        providerPlanId = null;
        providerAccountSecret =
          typeof selectionResult.value.account.credentials?.secretKey ===
          "string"
            ? selectionResult.value.account.credentials.secretKey
            : null;
      } else if (providerAccounts.length > 0) {
        console.warn(
          "Provider rules exist but no provider matched for plan creation",
        );
      }

      if (project) {
        const activeEnv = project.activeEnvironment || "test";
        const encryptedKey =
          activeEnv === "live" ? project.liveSecretKey : project.testSecretKey;

        let secretKey = providerAccountSecret;

        if (!secretKey && encryptedKey) {
          secretKey = await decrypt(encryptedKey, c.env.ENCRYPTION_KEY);
        }

        if (secretKey) {
          const paystack = new PaystackClient({ secretKey });

          const result = await paystack.createPlan({
            name,
            amount: price, // stored in kobo/cents
            interval: interval as any,
            description: description || undefined,
            currency,
          });

          if (result.isOk()) {
            paystackPlanId = result.value.plan_code;
            providerPlanId = result.value.plan_code;
          } else {
            console.warn("Failed to create Paystack plan:", result.error);
          }
        }
      }
    } catch (e) {
      console.warn("Paystack sync error:", e);
    }
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
      })
      .returning();

    return c.json({ success: true, data: plan });
  } catch (e: any) {
    console.error("Failed to create plan:", e);
    return c.json({ success: false, error: e.message }, 500);
  }
});

app.get("/", async (c) => {
  const organizationId = c.req.query("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const db = c.get("db");
  const plans = await db.query.plans.findMany({
    where: eq(schema.plans.organizationId, organizationId),
    orderBy: [desc(schema.plans.createdAt)],
    with: {
      planFeatures: {
        with: {
          feature: true,
        },
      },
    },
  });

  return c.json({ success: true, data: plans });
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

  return c.json({ success: true, data: plan });
});

app.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = updatePlanSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const db = c.get("db");

  try {
    const [updated] = await db
      .update(schema.plans)
      .set({
        ...parsed.data,
        updatedAt: Date.now(),
      })
      .where(eq(schema.plans.id, id))
      .returning();

    if (!updated) {
      return c.json({ error: "Plan not found" }, 404);
    }

    return c.json({ success: true, data: updated });
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
    const [updated] = await db
      .update(schema.planFeatures)
      .set(parsed.data)
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
  usageModel: z.literal("included").default("included"),
  pricePerUnit: z.number().optional().nullable(),
  billingUnits: z.number().default(1),
  maxPurchaseLimit: z.number().optional().nullable(),

  // Credit system
  creditCost: z.number().default(0),

  // Overage
  overage: z.enum(["block", "charge", "notify"]).default("block"),
  overagePrice: z.number().optional().nullable(),
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
    pricePerUnit,
    billingUnits,
    maxPurchaseLimit,
    creditCost,
    overage,
    overagePrice,
  } = parsed.data;
  const db = c.get("db");

  try {
    const [planFeature] = await db
      .insert(schema.planFeatures)
      .values({
        id: crypto.randomUUID(),
        planId,
        featureId,
        limitValue,
        resetInterval,
        resetOnEnable,
        rolloverEnabled,
        rolloverMaxBalance,
        usageModel: "included",
        pricePerUnit,
        billingUnits,
        maxPurchaseLimit,
        creditCost,
        overage,
        overagePrice,
      })
      .returning();

    return c.json({ success: true, data: planFeature });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
