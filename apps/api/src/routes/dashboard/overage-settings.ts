import { Hono } from "hono";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
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

  try {
    const settings = await (db.query as any).overageSettings?.findFirst?.({
      where: eq((schema as any).overageSettings.organizationId, organizationId),
    });

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
  billingInterval: z.enum(["end_of_period", "daily", "weekly", "monthly", "threshold"]).default("end_of_period"),
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

  const { organizationId, billingInterval, thresholdAmount, autoCollect, gracePeriodHours } = parsed.data;
  const db = c.get("db");
  const now = Date.now();

  try {
    await db.run(sql`
      INSERT INTO overage_settings (id, organization_id, billing_interval, threshold_amount, auto_collect, grace_period_hours, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${organizationId}, ${billingInterval}, ${thresholdAmount ?? null}, ${autoCollect ? 1 : 0}, ${gracePeriodHours}, ${now}, ${now})
      ON CONFLICT (organization_id) DO UPDATE SET
        billing_interval = excluded.billing_interval,
        threshold_amount = excluded.threshold_amount,
        auto_collect = excluded.auto_collect,
        grace_period_hours = excluded.grace_period_hours,
        updated_at = excluded.updated_at
    `);

    return c.json({ success: true });
  } catch (e: any) {
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
    return c.json({ success: false, error: "customerId and organizationId required" }, 400);
  }

  const db = c.get("db");

  try {
    const limit = await (db.query as any).customerOverageLimits?.findFirst?.({
      where: and(
        eq((schema as any).customerOverageLimits.customerId, customerId),
        eq((schema as any).customerOverageLimits.organizationId, organizationId),
      ),
    });

    return c.json({ success: true, data: limit || null });
  } catch (e: any) {
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

  const { customerId, organizationId, maxOverageAmount, onLimitReached } = parsed.data;
  const db = c.get("db");
  const now = Date.now();

  try {
    await db.run(sql`
      INSERT INTO customer_overage_limits (id, customer_id, organization_id, max_overage_amount, on_limit_reached, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${customerId}, ${organizationId}, ${maxOverageAmount ?? null}, ${onLimitReached}, ${now}, ${now})
      ON CONFLICT (customer_id) DO UPDATE SET
        max_overage_amount = excluded.max_overage_amount,
        on_limit_reached = excluded.on_limit_reached,
        updated_at = excluded.updated_at
    `);

    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
