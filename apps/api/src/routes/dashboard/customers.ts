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

const createCustomerSchema = z.object({
  organizationId: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  externalId: z.string().optional(),
});

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createCustomerSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { organizationId, email, name, externalId } = parsed.data;
  const db = c.get("db");

  try {
    const [customer] = await db
      .insert(schema.customers)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        email,
        name,
        externalId,
      })
      .returning();

    return c.json({ success: true, data: customer });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

app.get("/", async (c) => {
  const organizationId = c.req.query("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const db = c.get("db");
  const customers = await db.query.customers.findMany({
    where: eq(schema.customers.organizationId, organizationId),
    orderBy: (customers, { desc }) => [desc(customers.createdAt)],
  });

  return c.json({ success: true, data: customers });
});

app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  try {
    await db.delete(schema.customers).where(eq(schema.customers.id, id));
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
