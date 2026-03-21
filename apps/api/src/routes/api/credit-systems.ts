import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { verifyApiKey } from "../../lib/api-keys";
import type { Env, Variables } from "../../index";
import {
  apiKeySecurity,
  internalServerErrorResponse,
  jsonContent,
  unauthorizedResponse,
} from "../../openapi/common";

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

const creditSystemSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    features: z.array(
      z.object({
        feature: z.string(),
        creditCost: z.number(),
      }),
    ),
  })
  .passthrough();

const listCreditSystemsRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "listCreditSystems",
  tags: ["Credit Systems"],
  summary: "List credit systems",
  description:
    "Lists credit systems and their feature-to-credit-cost mappings for the authenticated organization.",
  security: apiKeySecurity,
  responses: {
    200: {
      description: "Credit systems returned successfully",
      ...jsonContent(
        z.object({
          success: z.literal(true),
          creditSystems: z.array(creditSystemSchema),
        }),
      ),
    },
    401: unauthorizedResponse,
    500: internalServerErrorResponse,
  },
});

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
app.openapi(listCreditSystemsRoute, async (c) => {
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
