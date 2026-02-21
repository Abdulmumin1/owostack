import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { verifyApiKey } from "../../lib/api-keys";
import type { Env, Variables } from "../../index";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Middleware for API Key Auth
app.use("*", async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "Missing API Key" }, 401);
  }

  const apiKey = authHeader.split(" ")[1];
  const authDb = c.get("authDb");

  const keyRecord = await verifyApiKey(authDb, apiKey);
  if (!keyRecord) {
    return c.json({ success: false, error: "Invalid API Key" }, 401);
  }

  c.set("organizationId", keyRecord.organizationId);
  return await next();
});

// GET /credit-systems — list all credit systems for the organization
app.get("/", async (c) => {
  const organizationId = c.get("organizationId")!;
  const db = c.get("db");

  try {
    // Query credit systems with their features
    const systems = await (db as any)
      .select()
      .from((schema as any).creditSystems)
      .where(eq((schema as any).creditSystems.organizationId, organizationId));

    const results = [];

    for (const sys of systems) {
      const features = await (db as any)
        .select()
        .from((schema as any).creditSystemFeatures)
        .innerJoin(
          schema.features,
          eq(
            schema.features.id,
            (schema as any).creditSystemFeatures.featureId,
          ),
        )
        .where(eq((schema as any).creditSystemFeatures.creditSystemId, sys.id));

      results.push({
        slug: sys.slug,
        name: sys.name,
        description: sys.description || null,
        features: features.map((f: any) => ({
          feature: f.features.slug,
          creditCost: f.credit_system_features.cost,
        })),
      });
    }

    return c.json({ success: true, creditSystems: results });
  } catch (e: any) {
    console.error("Credit systems load error:", e);
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
