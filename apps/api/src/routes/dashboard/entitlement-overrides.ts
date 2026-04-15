import { Hono } from "hono";
import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { schema } from "@owostack/db";
import { EntitlementCache } from "../../lib/cache";
import type { Env, Variables } from "../../index";
import { errorToResponse, ValidationError } from "../../lib/errors";
import { normalizeResetInterval } from "../../lib/reset-interval";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function zodErrorToResponse(zodError: z.ZodError) {
  const flattened = zodError.flatten();
  const fieldErrors = Object.entries(flattened.fieldErrors);

  if (fieldErrors.length > 0) {
    const errorEntry = fieldErrors[0];
    if (errorEntry) {
      const [field, messages] = errorEntry;
      const firstMessage = Array.isArray(messages) ? messages[0] : undefined;
      return errorToResponse(
        new ValidationError({
          field,
          details: firstMessage || "Invalid value",
        }),
      );
    }
  }

  const formError = flattened.formErrors[0];
  return errorToResponse(
    new ValidationError({
      field: "input",
      details: formError || "Invalid request body",
    }),
  );
}

const grantOverrideSchema = z.object({
  customerId: z.string(),
  featureId: z.string(),
  mode: z.enum(["replace", "bonus"]).default("replace"),
  limitValue: z.number().nullable(),
  expiresAt: z.number().nullable().optional(),
  resetInterval: z
    .enum(["daily", "weekly", "monthly", "yearly", "never", "none"])
    .default("monthly")
    .transform((value) => normalizeResetInterval(value)),
  reason: z.string().optional(),
});

// POST /api/dashboard/entitlement-overrides - Grant an override
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = grantOverrideSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const {
    customerId,
    featureId,
    mode,
    limitValue,
    expiresAt,
    resetInterval,
    reason,
  } = parsed.data;
  const organizationId = c.get("organizationId");
  const user = c.get("user");
  const db = c.get("db");

  try {
    // 1. Check if feature exists
    const feature = await db.query.features.findFirst({
      where: and(
        eq(schema.features.id, featureId),
        eq(schema.features.organizationId, organizationId!),
      ),
    });

    if (!feature) {
      return c.json({ success: false, error: "Feature not found" }, 404);
    }

    // 2. Check if customer exists
    const customer = await db.query.customers.findFirst({
      where: and(
        eq(schema.customers.id, customerId),
        eq(schema.customers.organizationId, organizationId!),
      ),
    });

    if (!customer) {
      return c.json({ success: false, error: "Customer not found" }, 404);
    }

    if (mode === "bonus" && feature.type !== "metered") {
      return c.json(
        {
          success: false,
          error: "Bonus credits are only supported for metered features",
        },
        400,
      );
    }

    if (mode === "bonus" && limitValue === null) {
      return c.json(
        {
          success: false,
          error: "Bonus credits require a finite credit amount",
        },
        400,
      );
    }

    // 3. Upsert override
    const now = Date.now();
    const id = crypto.randomUUID();
    const source = mode === "bonus" ? "manual_bonus" : "manual";

    // Remove any existing grant for this feature/source to avoid duplicates
    await db
      .delete(schema.entitlements)
      .where(
        and(
          eq(schema.entitlements.customerId, customerId),
          eq(schema.entitlements.featureId, featureId),
          eq(schema.entitlements.source, source),
        ),
      );

    const [override] = await db
      .insert(schema.entitlements)
      .values({
        id,
        customerId,
        featureId,
        limitValue,
        resetInterval,
        expiresAt: expiresAt || null,
        source,
        grantedBy: user?.id || "system",
        grantedReason: reason || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // 4. Invalidate cache
    if (c.env.CACHE) {
      const cache = new EntitlementCache(c.env.CACHE);
      c.executionCtx.waitUntil(
        Promise.all([
          cache.invalidateSubscriptions(organizationId!, customerId),
          cache.invalidateCustomer(organizationId!, customerId),
          cache.invalidateManualEntitlement(
            organizationId!,
            customerId,
            featureId,
          ),
        ]),
      );
    }

    return c.json({ success: true, data: override });
  } catch (e: any) {
    console.error("Failed to grant override:", e);
    return c.json({ success: false, error: e.message }, 500);
  }
});

// GET /api/dashboard/entitlement-overrides - List overrides for a customer
app.get("/", async (c) => {
  const customerId = c.req.query("customerId");
  const organizationId = c.get("organizationId");
  const db = c.get("db");

  if (!customerId) {
    return c.json({ error: "Customer ID required" }, 400);
  }

  // Ensure customer belongs to organization
  const customer = await db.query.customers.findFirst({
    where: and(
      eq(schema.customers.id, customerId),
      eq(schema.customers.organizationId, organizationId!),
    ),
  });

  if (!customer) {
    return c.json({ success: false, error: "Customer not found" }, 404);
  }

  const overrides = await db.query.entitlements.findMany({
    where: and(
      eq(schema.entitlements.customerId, customerId),
      inArray(schema.entitlements.source, ["manual", "manual_bonus"]),
    ),
    with: {
      feature: true,
    },
  });

  return c.json({ success: true, data: overrides });
});

// DELETE /api/dashboard/entitlement-overrides/:id - Remove an override
app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const organizationId = c.get("organizationId");
  const db = c.get("db");

  try {
    const entitlement = await db.query.entitlements.findFirst({
      where: eq(schema.entitlements.id, id),
      with: {
        customer: true,
      },
    });

    if (
      !entitlement ||
      entitlement.customer.organizationId !== organizationId
    ) {
      return c.json({ success: false, error: "Override not found" }, 404);
    }

    await db.delete(schema.entitlements).where(eq(schema.entitlements.id, id));

    // Invalidate cache
    if (c.env.CACHE) {
      const cache = new EntitlementCache(c.env.CACHE);
      c.executionCtx.waitUntil(
        Promise.all([
          cache.invalidateSubscriptions(
            organizationId!,
            entitlement.customerId,
          ),
          cache.invalidateCustomer(organizationId!, entitlement.customerId),
          cache.invalidateManualEntitlement(
            organizationId!,
            entitlement.customerId,
            entitlement.featureId,
          ),
        ]),
      );
    }

    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
