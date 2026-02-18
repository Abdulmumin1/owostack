import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { generateApiKey, hashApiKey } from "../../lib/api-keys";
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

const createKeySchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1),
});

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createKeySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { organizationId, name } = parsed.data;
  const db = c.get("authDb");

  // Generate Key
  const finalKey = generateApiKey();
  const keyHash = await hashApiKey(finalKey);

  try {
    const [key] = await db
      .insert(schema.apiKeys)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        name,
        prefix: "owo_sk_",
        hash: keyHash,
      })
      .returning();

    // Return the raw key ONLY ONCE
    return c.json({
      success: true,
      data: {
        ...key,
        secretKey: finalKey, // This is the only time the user sees this
      },
    });
  } catch (e: any) {
    console.error("Failed to create key:", e);
    return c.json(
      { success: false, error: e.message || "Database error" },
      500,
    );
  }
});

app.get("/", async (c) => {
  const organizationId = c.req.query("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const db = c.get("authDb");
  const keys = await db.query.apiKeys.findMany({
    where: eq(schema.apiKeys.organizationId, organizationId),
    orderBy: (keys: any, { desc }: any) => [desc(keys.createdAt)],
    columns: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      createdAt: true,
      // Never return hash
    },
  });

  return c.json({ success: true, data: keys });
});

app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const organizationId = c.req.query("organizationId");

  if (!organizationId) {
    return c.json({ success: false, error: "Organization ID required" }, 400);
  }

  const db = c.get("authDb");

  try {
    await db
      .delete(schema.apiKeys)
      .where(
        and(
          eq(schema.apiKeys.id, id),
          eq(schema.apiKeys.organizationId, organizationId),
        ),
      );

    return c.json({ success: true });
  } catch (e: any) {
    console.error("Failed to delete key:", e);
    return c.json(
      { success: false, error: e.message || "Database error" },
      500,
    );
  }
});

export default app;
