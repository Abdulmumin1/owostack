import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { EntitlementCache } from "../../lib/cache";
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

const createFeatureSchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1),
  type: z.enum(["metered", "boolean", "static"]).default("metered"),
  meterType: z.enum(["consumable", "non_consumable"]).default("consumable"),
  unit: z.string().optional(),
});

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createFeatureSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const {
    organizationId: orgIdFromData,
    name,
    type,
    meterType,
    unit,
  } = parsed.data;
  const organizationId = c.get("organizationId") || orgIdFromData;
  const db = c.get("db");

  // Generate slug
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  try {
    const [feature] = await db
      .insert(schema.features)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        name,
        slug,
        type,
        meterType,
        unit,
      })
      .returning();

    return c.json({ success: true, data: feature });
  } catch (e: any) {
    console.error("Failed to create feature:", e);
    return c.json({ success: false, error: e.message }, 500);
  }
});

app.get("/", async (c) => {
  const organizationId = c.get("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const db = c.get("db");
  const features = await db.query.features.findMany({
    where: eq(schema.features.organizationId, organizationId),
    orderBy: (f, { desc }) => [desc(f.createdAt)],
  });

  return c.json({ success: true, data: features });
});

const updateFeatureSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  unit: z.string().optional(),
});

app.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = updateFeatureSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const db = c.get("db");

  try {
    const [feature] = await db
      .update(schema.features)
      .set({
        ...parsed.data,
        updatedAt: new Date(),
      })
      .where(eq(schema.features.id, id))
      .returning();

    if (!feature) {
      return c.json({ success: false, error: "Feature not found" }, 404);
    }

    // Invalidate cache
    if (c.env.CACHE) {
      const cache = new EntitlementCache(c.env.CACHE);
      await Promise.all([
        cache.invalidateFeature(feature.organizationId, feature.id),
        cache.invalidateFeature(feature.organizationId, feature.slug),
      ]);
    }

    return c.json({ success: true, data: feature });
  } catch (e: any) {
    console.error("Failed to update feature:", e);
    return c.json({ success: false, error: e.message }, 500);
  }
});

app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  try {
    // Get feature before delete for cache invalidation
    const feature = await db.query.features.findFirst({
      where: eq(schema.features.id, id),
    });

    await db.delete(schema.features).where(eq(schema.features.id, id));

    // Invalidate cache
    if (feature && c.env.CACHE) {
      const cache = new EntitlementCache(c.env.CACHE);
      await Promise.all([
        cache.invalidateFeature(feature.organizationId, feature.id),
        cache.invalidateFeature(feature.organizationId, feature.slug),
      ]);
    }

    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
