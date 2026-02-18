import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { schema } from "@owostack/db";
import type { Env, Variables } from "../../index";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get("/", async (c) => {
  const organizationId = c.req.query("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const limit = Number(c.req.query("limit")) || 20;
  const offset = Number(c.req.query("offset")) || 0;

  const db = c.get("db");
  const events = await db.query.events.findMany({
    where: eq(schema.events.organizationId, organizationId),
    orderBy: [desc(schema.events.createdAt)],
    limit: limit,
    offset: offset,
    with: {
      customer: true,
    },
  });

  // Get total count for pagination metadata if needed, usually nice to have but not strictly required for infinite scroll if we just check if return length < limit
  // For now, simple array return is fine as per current contract

  return c.json({ success: true, data: events });
});

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, id),
    with: {
      customer: true,
    },
  });

  if (!event) {
    return c.json({ success: false, error: "Event not found" }, 404);
  }

  return c.json({ success: true, data: event });
});

export default app;
