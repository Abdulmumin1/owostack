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

const createSubscriptionSchema = z.object({
  customerId: z.string(),
  planId: z.string(),
  status: z
    .enum(["active", "canceled", "incomplete", "past_due"])
    .default("active"),
  currentPeriodStart: z.string().optional(), // ISO Date
  currentPeriodEnd: z.string().optional(), // ISO Date
});

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createSubscriptionSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { customerId, planId, status, currentPeriodStart, currentPeriodEnd } =
    parsed.data;
  const db = c.get("db");

  // Default dates
  const start = currentPeriodStart ? new Date(currentPeriodStart) : new Date();
  const end = currentPeriodEnd
    ? new Date(currentPeriodEnd)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  try {
    const [subscription] = await db
      .insert(schema.subscriptions)
      .values({
        id: crypto.randomUUID(),
        customerId,
        planId,
        status,
        currentPeriodStart: start,
        currentPeriodEnd: end,
      })
      .returning();

    return c.json({ success: true, data: subscription });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
