import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
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
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

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
    orderBy: (plans, { desc }) => [desc(plans.createdAt)],
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

const addFeatureSchema = z.object({
  featureId: z.string(),
  // Included feature config
  limitValue: z.number().optional().nullable(),

  // Reset config
  resetInterval: z
    .enum([
      "none",
      "hour",
      "day",
      "week",
      "month",
      "quarter",
      "semi_annual",
      "year",
      "monthly",
      "yearly",
      "weekly",
      "daily",
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
    usageModel,
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
        usageModel,
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
