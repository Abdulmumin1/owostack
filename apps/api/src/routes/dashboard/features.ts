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

  const { organizationId, name, type, meterType, unit } = parsed.data;
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
  const organizationId = c.req.query("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const db = c.get("db");
  const features = await db.query.features.findMany({
    where: eq(schema.features.organizationId, organizationId),
    orderBy: (features, { desc }) => [desc(features.createdAt)],
  });

  return c.json({ success: true, data: features });
});

app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  try {
    await db.delete(schema.features).where(eq(schema.features.id, id));
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
