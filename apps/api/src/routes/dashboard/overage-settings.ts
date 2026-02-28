import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { schema } from "@owostack/db";
import type { Env, Variables } from "../../index";
import { zodErrorToResponse } from "../../lib/validation";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET / — Get overage settings for an organization
// ---------------------------------------------------------------------------
app.get("/", async (c) => {
  const organizationId = c.get("organizationId");
  if (!organizationId) {
    return c.json({ success: false, error: "organizationId required" }, 400);
  }

  const db = c.get("db");

  console.log("organizationId", organizationId);

  try {
    // Use proper schema typing
    const settings = await db.query.overageSettings.findFirst({
      where: eq(schema.overageSettings.organizationId, organizationId),
    });

    console.log("settings", settings);

    return c.json({
      success: true,
      data: settings || {
        billingInterval: "end_of_period",
        thresholdAmount: null,
        autoCollect: false,
        gracePeriodHours: 0,
      },
    });
  } catch (e: any) {
    console.error("[overage-settings] GET error:", e);
    if (e?.message?.includes("no such table")) {
      return c.json({
        success: true,
        data: {
          billingInterval: "end_of_period",
          thresholdAmount: null,
          autoCollect: false,
          gracePeriodHours: 0,
        },
      });
    }
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ---------------------------------------------------------------------------
// PUT / — Create or update overage settings
// ---------------------------------------------------------------------------
const upsertSchema = z.object({
  organizationId: z.string(),
  billingInterval: z
    .enum(["end_of_period", "daily", "weekly", "monthly", "threshold"])
    .default("end_of_period"),
  thresholdAmount: z.number().nullable().optional(),
  autoCollect: z.boolean().default(false),
  gracePeriodHours: z.number().min(0).default(0),
});

app.put("/", async (c) => {
  const body = await c.req.json();
  const parsed = upsertSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { billingInterval, thresholdAmount, autoCollect, gracePeriodHours } =
    parsed.data;

  // Use resolved organization ID from context (middleware resolves slug to UUID)
  const organizationId = c.get("organizationId") ?? parsed.data.organizationId;

  const db = c.get("db");
  const now = Date.now();

  try {
    // Upsert using Drizzle
    await db
      .insert(schema.overageSettings)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        billingInterval,
        thresholdAmount: thresholdAmount ?? null,
        autoCollect,
        gracePeriodHours,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.overageSettings.organizationId,
        set: {
          billingInterval,
          thresholdAmount: thresholdAmount ?? null,
          autoCollect,
          gracePeriodHours,
          updatedAt: now,
        },
      });

    return c.json({ success: true });
  } catch (e: any) {
    console.error("[overage-settings] PUT error:", e);
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /customer-limits — Get a customer's overage spending cap
// ---------------------------------------------------------------------------
app.get("/customer-limits", async (c) => {
  const customerId = c.req.query("customerId");
  const organizationId = c.get("organizationId");
  if (!customerId || !organizationId) {
    return c.json(
      { success: false, error: "customerId and organizationId required" },
      400,
    );
  }

  const db = c.get("db");

  try {
    const limit = await db.query.customerOverageLimits.findFirst({
      where: and(
        eq(schema.customerOverageLimits.customerId, customerId),
        eq(schema.customerOverageLimits.organizationId, organizationId),
      ),
    });

    return c.json({ success: true, data: limit || null });
  } catch (e: any) {
    console.error("[overage-settings] GET customer-limits error:", e);
    if (e?.message?.includes("no such table")) {
      return c.json({ success: true, data: null });
    }
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ---------------------------------------------------------------------------
// PUT /customer-limits — Set a customer's overage spending cap
// ---------------------------------------------------------------------------
const customerLimitSchema = z.object({
  customerId: z.string(),
  organizationId: z.string(),
  maxOverageAmount: z.number().nullable().optional(),
  onLimitReached: z.enum(["block", "notify"]).default("block"),
});

app.put("/customer-limits", async (c) => {
  const body = await c.req.json();
  const parsed = customerLimitSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { customerId, organizationId, maxOverageAmount, onLimitReached } =
    parsed.data;
  const db = c.get("db");
  const now = Date.now();

  try {
    await db
      .insert(schema.customerOverageLimits)
      .values({
        id: crypto.randomUUID(),
        customerId,
        organizationId,
        maxOverageAmount: maxOverageAmount ?? null,
        onLimitReached,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.customerOverageLimits.customerId,
        set: {
          maxOverageAmount: maxOverageAmount ?? null,
          onLimitReached,
          updatedAt: now,
        },
      });

    return c.json({ success: true });
  } catch (e: any) {
    console.error("[overage-settings] PUT customer-limits error:", e);
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
