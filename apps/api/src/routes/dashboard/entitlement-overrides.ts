import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { schema } from "@owostack/db";
import { EntitlementCache } from "../../lib/cache";
import type { Env, Variables } from "../../index";
import { errorToResponse, ValidationError } from "../../lib/errors";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function zodErrorToResponse(zodError: z.ZodError) {
  const flattened = zodError.flatten();
  const fieldErrors = Object.entries(flattened.fieldErrors);

  if (fieldErrors.length > 0) {
    const errorEntry = fieldErrors[0];
    if (errorEntry) {
      const [field, messages] = errorEntry;
      return errorToResponse(
        new ValidationError({
          field,
          details: messages?.[0] || "Invalid value",
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
  limitValue: z.number().nullable(),
  expiresAt: z.number().nullable().optional(),
  resetInterval: z
    .enum(["daily", "weekly", "monthly", "yearly", "never"])
    .default("monthly"),
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

    // 3. Upsert override
    const now = Date.now();
    const id = crypto.randomUUID();

    // Remove any existing manual overrides for this feature to avoid duplicates
    await db
      .delete(schema.entitlements)
      .where(
        and(
          eq(schema.entitlements.customerId, customerId),
          eq(schema.entitlements.featureId, featureId),
          eq(schema.entitlements.source, "manual"),
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
        source: "manual",
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
      eq(schema.entitlements.source, "manual"),
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
          cache.invalidateSubscriptions(organizationId!, entitlement.customerId),
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
