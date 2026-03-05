import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
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

// GET /credit-packs — list all credit packs for the organization
app.get("/", async (c) => {
  const organizationId = c.get("organizationId")!;
  const db = c.get("db");

  try {
    const creditPacks = await db.query.creditPacks.findMany({
      where: and(
        eq(schema.creditPacks.organizationId, organizationId),
        eq(schema.creditPacks.isActive, true),
      ),
      orderBy: [desc(schema.creditPacks.createdAt)],
      with: {
        creditSystem: true,
      },
    });

    // Transform to match the expected format
    const transformedPacks = creditPacks.map(
      (
        pack: typeof schema.creditPacks.$inferSelect & {
          creditSystem?: typeof schema.creditSystems.$inferSelect;
        },
      ) => ({
        id: pack.id,
        slug: pack.slug,
        name: pack.name,
        description: pack.description,
        credits: pack.credits,
        price: pack.price,
        currency: pack.currency,
        creditSystemId: pack.creditSystem?.slug || pack.creditSystemId,
        creditSystem: pack.creditSystem?.slug,
        provider: pack.providerId,
        metadata: pack.metadata,
        isActive: pack.isActive,
        createdAt: pack.createdAt,
        updatedAt: pack.updatedAt,
      }),
    );

    return c.json({
      success: true,
      data: transformedPacks,
    });
  } catch (error) {
    console.error("[credit-packs] Error fetching credit packs:", error);
    return c.json(
      { success: false, error: "Failed to fetch credit packs" },
      500,
    );
  }
});

export default app;
