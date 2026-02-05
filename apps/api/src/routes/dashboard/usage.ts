import { Hono } from "hono";
import { eq, sql, desc } from "drizzle-orm";
import { schema } from "@owostack/db";
import type { Env, Variables } from "../../index";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get("/", async (c) => {
  const organizationId = c.req.query("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const db = c.get("db");

  // Get total events count
  const [{ count: eventCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.events)
    .where(eq(schema.events.organizationId, organizationId));

  // Get counts per event type
  const eventsByType = await db
    .select({
      type: schema.events.type,
      count: sql<number>`count(*)`,
    })
    .from(schema.events)
    .where(eq(schema.events.organizationId, organizationId))
    .groupBy(schema.events.type);

  // Get active customers count
  const [{ count: customerCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.customers)
    .where(eq(schema.customers.organizationId, organizationId));

  return c.json({
    success: true,
    data: {
      totalEvents: eventCount,
      eventsByType,
      totalCustomers: customerCount,
      // For now, these are the basics. In a real app we'd add time-series data
    },
  });
});

export default app;
