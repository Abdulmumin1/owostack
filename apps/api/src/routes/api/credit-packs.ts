import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { eq, and, desc } from "drizzle-orm";
import { schema } from "@owostack/db";
import { verifyApiKey } from "../../lib/api-keys";
import type { Env, Variables } from "../../index";
import {
  apiKeySecurity,
  internalServerErrorResponse,
  jsonContent,
  metadataSchema,
  notFoundResponse,
  unauthorizedResponse,
} from "../../openapi/common";

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

const creditPackSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    credits: z.number(),
    price: z.number(),
    currency: z.string(),
    creditSystemId: z.string().nullable().optional(),
    creditSystem: z.string().nullable().optional(),
    provider: z.string().nullable().optional(),
    metadata: metadataSchema.nullable().optional(),
    isActive: z.boolean(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough();

const listCreditPacksRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "listCreditPacks",
  tags: ["Credit Systems"],
  summary: "List credit packs",
  description:
    "Lists active credit packs available to the authenticated organization.",
  security: apiKeySecurity,
  responses: {
    200: {
      description: "Credit packs returned successfully",
      ...jsonContent(
        z.object({
          success: z.literal(true),
          data: z.array(creditPackSchema),
        }),
      ),
    },
    401: unauthorizedResponse,
    500: internalServerErrorResponse,
  },
});

const getCreditPackRoute = createRoute({
  method: "get",
  path: "/{slug}",
  operationId: "getCreditPack",
  tags: ["Credit Systems"],
  summary: "Get a credit pack",
  description:
    "Returns the current server-side price and provider for an active credit pack.",
  security: apiKeySecurity,
  request: {
    params: z.object({ slug: z.string().min(1) }),
  },
  responses: {
    200: {
      description: "Credit pack returned successfully",
      ...jsonContent(
        z.object({ success: z.literal(true), data: creditPackSchema }),
      ),
    },
    401: unauthorizedResponse,
    404: notFoundResponse,
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

// GET /credit-packs — list all credit packs for the organization
app.openapi(listCreditPacksRoute, async (c) => {
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

app.openapi(getCreditPackRoute, async (c) => {
  const organizationId = c.get("organizationId")!;
  const slug = c.req.valid("param").slug;
  const db = c.get("db");
  const pack = await db.query.creditPacks.findFirst({
    where: and(
      eq(schema.creditPacks.organizationId, organizationId),
      eq(schema.creditPacks.slug, slug),
      eq(schema.creditPacks.isActive, true),
    ),
    with: { creditSystem: true },
  });

  if (!pack) {
    return c.json({ success: false, error: "Credit pack not found" }, 404);
  }

  return c.json({
    success: true as const,
    data: {
      id: pack.id,
      slug: pack.slug,
      name: pack.name,
      description: pack.description,
      credits: pack.credits,
      price: pack.price,
      currency: pack.currency,
      creditSystemId: pack.creditSystem?.slug || pack.creditSystemId,
      creditSystem: pack.creditSystem?.slug ?? null,
      provider: pack.providerId,
      metadata: pack.metadata,
      isActive: pack.isActive,
      createdAt: pack.createdAt,
      updatedAt: pack.updatedAt,
    },
  });
});

export default app;
