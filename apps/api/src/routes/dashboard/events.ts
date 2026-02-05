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

  const db = c.get("db");
  const events = await db.query.events.findMany({
    where: eq(schema.events.organizationId, organizationId),
    orderBy: [desc(schema.events.createdAt)],
    limit: 100,
    with: {
      customer: true,
    },
  });

  return c.json({ success: true, data: events });
});

export default app;
