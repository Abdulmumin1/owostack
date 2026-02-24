import { Hono } from "hono";
import type { Env, Variables } from "../../index";
import { listRecentEvents, getEventById } from "../../lib/analytics-engine";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampInt(
  value: string | undefined,
  fallback: number,
  { min = 0, max = Number.MAX_SAFE_INTEGER } = {},
): number {
  const n = Number.parseInt(value || "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

app.get("/", async (c) => {
  const organizationId = c.req.query("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const limit = clampInt(c.req.query("limit"), DEFAULT_LIMIT, {
    min: 1,
    max: MAX_LIMIT,
  });
  const offset = clampInt(c.req.query("offset"), 0, { min: 0 });

  const result = await listRecentEvents(c.env, {
    organizationId,
    limit,
    offset,
  });

  if (!result.success) {
    // Analytics unavailable - return 503 Service Unavailable
    return c.json(
      {
        success: false,
        error: "Service unavailable",
        message: result.message,
      },
      503,
    );
  }

  return c.json({ success: true, data: result.data });
});

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const organizationId = c.req.query("organizationId");

  const result = await getEventById(c.env, id, organizationId);

  if (!result.success) {
    // Analytics unavailable - return 503 Service Unavailable
    return c.json(
      {
        success: false,
        error: "Service unavailable",
        message: result.message,
      },
      503,
    );
  }

  if (!result.data) {
    return c.json({ success: false, error: "Event not found" }, 404);
  }

  return c.json({ success: true, data: result.data });
});

export default app;
