import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { eq, and, or, count } from "drizzle-orm";
import { schema } from "@owostack/db";
import { verifyApiKey } from "../../lib/api-keys";
import { resolveOrCreateCustomer } from "../../lib/customers";
import {
  isCustomerResolutionConflictError,
  resolveCustomerByIdentifier,
} from "../../lib/customer-resolution";
import type { Env, Variables } from "../../index";
import { zodErrorToResponse } from "../../lib/validation";
import {
  apiKeySecurity,
  badRequestResponse,
  conflictResponse,
  internalServerErrorResponse,
  jsonContent,
  metadataSchema,
  notFoundResponse,
  unauthorizedResponse,
} from "../../openapi/common";

export type ApiCustomersDependencies = {
  verifyApiKey: typeof verifyApiKey;
};

const defaultDependencies: ApiCustomersDependencies = {
  verifyApiKey,
};

const customerSchema = z.object({
  id: z.string().optional(),
  email: z.string().email(),
  name: z.string().optional(),
  metadata: metadataSchema.optional(),
});

const addEntitySchema = z.object({
  customer: z.string(),
  feature: z.string(),
  entity: z.string(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  metadata: metadataSchema.optional(),
});

const removeEntitySchema = z.object({
  customer: z.string(),
  feature: z.string(),
  entity: z.string(),
});

const listEntitiesSchema = z.object({
  customer: z.string(),
  feature: z.string().optional(),
});

const customerResponseSchema = z
  .object({
    success: z.literal(true),
    id: z.string(),
    email: z.string().email(),
    name: z.string().nullable().optional(),
    metadata: metadataSchema.nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough();

const addEntityResponseSchema = z
  .object({
    success: z.literal(true),
    entityId: z.string(),
    featureId: z.string(),
    count: z.number(),
    limit: z.number().nullable().optional(),
    remaining: z.number().nullable().optional(),
    restored: z.boolean().optional(),
  })
  .passthrough();

const removeEntityResponseSchema = z
  .object({
    success: z.literal(true),
    entityId: z.string(),
    count: z.number(),
  })
  .passthrough();

const entitySchema = z
  .object({
    id: z.string(),
    featureId: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    metadata: metadataSchema.nullable(),
    status: z.string(),
    createdAt: z.string().datetime(),
  })
  .passthrough();

const createCustomerRoute = createRoute({
  method: "post",
  path: "/customers",
  operationId: "createCustomer",
  tags: ["Customers"],
  summary: "Create or resolve a customer",
  description:
    "Creates a customer if needed, or resolves and updates an existing customer by ID or email.",
  security: apiKeySecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: customerSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Customer returned successfully",
      ...jsonContent(customerResponseSchema),
    },
    400: badRequestResponse,
    401: unauthorizedResponse,
    409: conflictResponse,
    500: internalServerErrorResponse,
  },
});

const getCustomerRoute = createRoute({
  method: "get",
  path: "/customers/{id}",
  operationId: "getCustomer",
  tags: ["Customers"],
  summary: "Get a customer",
  description: "Retrieves a customer by ID for the authenticated organization.",
  security: apiKeySecurity,
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Customer returned successfully",
      ...jsonContent(customerResponseSchema),
    },
    401: unauthorizedResponse,
    404: notFoundResponse,
    500: internalServerErrorResponse,
  },
});

const addEntityRoute = createRoute({
  method: "post",
  path: "/entities",
  operationId: "addEntity",
  tags: ["Entities"],
  summary: "Add an entity",
  description:
    "Adds or restores a billable entity such as a seat or licensed member for a feature.",
  security: apiKeySecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: addEntitySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Entity added or restored successfully",
      ...jsonContent(addEntityResponseSchema),
    },
    400: badRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalServerErrorResponse,
  },
});

const removeEntityRoute = createRoute({
  method: "post",
  path: "/entities/remove",
  operationId: "removeEntity",
  tags: ["Entities"],
  summary: "Remove an entity",
  description:
    "Marks an entity for removal at period end. Pending removals still count toward billing until then.",
  security: apiKeySecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: removeEntitySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Entity marked for removal successfully",
      ...jsonContent(removeEntityResponseSchema),
    },
    400: badRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalServerErrorResponse,
  },
});

const listEntitiesRoute = createRoute({
  method: "get",
  path: "/entities",
  operationId: "listEntities",
  tags: ["Entities"],
  summary: "List entities",
  description:
    "Lists active and pending-removal entities for a customer, optionally filtered by feature.",
  security: apiKeySecurity,
  request: {
    query: z.object({
      customer: z.string().optional(),
      feature: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Entities returned successfully",
      ...jsonContent(
        z.object({
          success: z.literal(true),
          entities: z.array(entitySchema),
          total: z.number(),
        }),
      ),
    },
    400: badRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalServerErrorResponse,
  },
});

async function resolveCustomer(
  db: any,
  organizationId: string,
  customerId: string,
) {
  const resolved = await resolveCustomerByIdentifier({
    db,
    organizationId,
    customerId,
  });
  return resolved?.customer ?? null;
}

export function createApiCustomersRoute(
  overrides: Partial<ApiCustomersDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...overrides };
  const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

  // Middleware for API Key Auth
  app.use("*", async (c, next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ success: false, error: "Missing API Key" }, 401);
    }

    const apiKey = authHeader.split(" ")[1];
    const authDb = c.get("authDb");

    const keyRecord = await deps.verifyApiKey(authDb, apiKey);
    if (!keyRecord) {
      return c.json({ success: false, error: "Invalid API Key" }, 401);
    }

    c.set("organizationId", keyRecord.organizationId);
    return await next();
  });

  // POST /v1/customers - Create or resolve a customer
  app.openapi(createCustomerRoute, async (c) => {
    const db = c.get("db");
    const organizationId = c.get("organizationId")!;

    try {
      const body = await c.req.json();
      const parsed = customerSchema.safeParse(body);

      if (!parsed.success) {
        return c.json(zodErrorToResponse(parsed.error), 400);
      }

      const { id, email, name, metadata } = parsed.data;
      const customerEmail = email!;

      // Try to resolve existing customer
      const customerId: string = id || customerEmail;
      let customer;
      try {
        customer = await resolveOrCreateCustomer({
          db,
          organizationId,
          customerId,
          customerData: { email: customerEmail, name, metadata },
          autoApplyPlansOnCreate: true,
        });
      } catch (error) {
        if (isCustomerResolutionConflictError(error)) {
          return c.json({ success: false, error: error.message }, 409);
        }
        throw error;
      }

      if (!customer) {
        // If we couldn't resolve/create, create with explicit ID
        const newCustomer = {
          id: id || crypto.randomUUID(),
          organizationId,
          email: customerEmail.toLowerCase(),
          name: name || customerEmail.split("@")[0],
          metadata: metadata || null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        await db.insert(schema.customers).values(newCustomer);
        customer = newCustomer as typeof schema.customers.$inferSelect;
      } else {
        // Customer exists - update metadata if provided
        if (metadata !== undefined) {
          const mergedMetadata = {
            ...(customer.metadata || {}),
            ...metadata,
          };

          await db
            .update(schema.customers)
            .set({
              metadata: mergedMetadata,
              updatedAt: Date.now(),
            })
            .where(eq(schema.customers.id, customer.id));

          customer = {
            ...customer,
            metadata: mergedMetadata,
            updatedAt: Date.now(),
          };
        }

        // Update name if provided
        if (name !== undefined) {
          await db
            .update(schema.customers)
            .set({
              name,
              updatedAt: Date.now(),
            })
            .where(eq(schema.customers.id, customer.id));

          customer = {
            ...customer,
            name,
            updatedAt: Date.now(),
          };
        }
      }

      return c.json(
        {
          success: true,
          id: customer.id,
          email: customer.email,
          name: customer.name,
          metadata: customer.metadata,
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,
        },
        200,
      );
    } catch (error) {
      if (isCustomerResolutionConflictError(error)) {
        return c.json({ success: false, error: error.message }, 409);
      }
      console.error("[customers] error:", error);
      return c.json(
        { success: false, error: "Failed to create customer" },
        500,
      );
    }
  });

  // GET /v1/customers/:id - Get a customer by ID
  app.openapi(getCustomerRoute, async (c) => {
    const db = c.get("db");
    const organizationId = c.get("organizationId")!;

    try {
      const customerId = c.req.param("id");

      const customer = await db.query.customers.findFirst({
        where: and(
          eq(schema.customers.organizationId, organizationId),
          eq(schema.customers.id, customerId),
        ),
      });

      if (!customer) {
        return c.json({ success: false, error: "Customer not found" }, 404);
      }

      return c.json(
        {
          success: true,
          id: customer.id,
          email: customer.email,
          name: customer.name,
          metadata: customer.metadata,
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,
        },
        200,
      );
    } catch (error) {
      console.error("[customers] error:", error);
      return c.json({ success: false, error: "Failed to get customer" }, 500);
    }
  });

  // POST /v1/entities - Add a new entity
  app.openapi(addEntityRoute, async (c) => {
    const db = c.get("db");
    const organizationId = c.get("organizationId")!;

    try {
      const body = await c.req.json();
      const parsed = addEntitySchema.safeParse(body);

      if (!parsed.success) {
        return c.json(zodErrorToResponse(parsed.error), 400);
      }

      const customerId = parsed.data.customer;
      const featureSlug = parsed.data.feature;
      const entityId = parsed.data.entity;
      const entityName = parsed.data.name;
      const entityEmail = parsed.data.email;
      const entityMetadata = parsed.data.metadata;

      // Resolve customer
      let customer;
      try {
        customer = await resolveOrCreateCustomer({
          db,
          organizationId,
          customerId: customerId as string,
        });
      } catch (error) {
        if (isCustomerResolutionConflictError(error)) {
          return c.json({ success: false, error: error.message }, 409);
        }
        throw error;
      }

      if (!customer) {
        return c.json({ success: false, error: "Customer not found" }, 404);
      }

      // Resolve feature
      const feature = await db.query.features.findFirst({
        where: and(
          eq(schema.features.organizationId, organizationId),
          eq(schema.features.slug, featureSlug),
        ),
      });

      if (!feature) {
        return c.json({ success: false, error: "Feature not found" }, 404);
      }

      // Check against limit from active subscription
      const subscription = await db.query.subscriptions.findFirst({
        where: and(
          eq(schema.subscriptions.customerId, customer.id),
          eq(schema.subscriptions.status, "active"),
        ),
        with: {
          plan: true,
        },
      });

      let limit: number | null = null;
      if (subscription) {
        const planFeature = await db.query.planFeatures.findFirst({
          where: and(
            eq(schema.planFeatures.planId, subscription.planId),
            eq(schema.planFeatures.featureId, feature.id),
          ),
        });

        if (planFeature) {
          limit = planFeature.limitValue ?? null;
        }
      }

      // Check for existing entity
      const existingEntity = await db.query.entities.findFirst({
        where: and(
          eq(schema.entities.customerId, customer.id),
          eq(schema.entities.featureId, feature.id),
          eq(schema.entities.entityId, entityId),
        ),
      });

      if (existingEntity) {
        if (existingEntity.status === "active") {
          return c.json(
            { success: false, error: "Entity already exists" },
            409,
          );
        }

        if (existingEntity.status === "pending_removal") {
          // Restore entity (it already counts toward limit, so no limit check needed)
          await db
            .update(schema.entities)
            .set({
              status: "active",
              removedAt: null,
              updatedAt: Date.now(),
              // Update metadata if provided
              name: entityName ?? existingEntity.name,
              email: entityEmail ?? existingEntity.email,
              metadata: entityMetadata ?? existingEntity.metadata,
            })
            .where(eq(schema.entities.id, existingEntity.id));

          // Get current count for response
          const entityCount = await db
            .select({ count: count() })
            .from(schema.entities)
            .where(
              and(
                eq(schema.entities.customerId, customer.id),
                eq(schema.entities.featureId, feature.id),
                or(
                  eq(schema.entities.status, "active"),
                  eq(schema.entities.status, "pending_removal"),
                ),
              ),
            );

          const currentCount = entityCount[0]?.count || 0;

          return c.json(
            {
              success: true,
              entityId: existingEntity.entityId,
              featureId: featureSlug,
              count: currentCount,
              limit,
              remaining: limit !== null ? limit - currentCount : null,
              restored: true,
            },
            200,
          );
        }
      }

      // Atomically check count and insert to prevent race conditions
      // Use a transaction or rely on unique constraint for idempotency
      let finalCount = 0;
      try {
        const insertEntityWithLimitCheck = async (executor: any) => {
          // Count both active and pending_removal entities for billing accuracy
          // (pending_removal entities are still billed until period end)
          const entityCount = await executor
            .select({ count: count() })
            .from(schema.entities)
            .where(
              and(
                eq(schema.entities.customerId, customer.id),
                eq(schema.entities.featureId, feature.id),
                or(
                  eq(schema.entities.status, "active"),
                  eq(schema.entities.status, "pending_removal"),
                ),
              ),
            );

          const currentCount = entityCount[0]?.count || 0;

          // Validate limit (if limit is set and we would exceed it)
          if (limit !== null && currentCount >= limit) {
            throw new Error(
              `Limit exceeded: ${currentCount}/${limit} ${featureSlug} used`,
            );
          }

          // Create entity (will fail with unique constraint if race condition occurred)
          await executor.insert(schema.entities).values({
            id: crypto.randomUUID(),
            customerId: customer.id,
            featureId: feature.id,
            entityId,
            name: entityName || null,
            email: entityEmail || null,
            metadata: entityMetadata || null,
            status: "active",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          finalCount = currentCount + 1;
        };

        try {
          await db.transaction(async (tx: any) => {
            await insertEntityWithLimitCheck(tx);
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const isD1TransactionUnsupported =
            message.includes("state.storage.transaction") ||
            message.includes("BEGIN TRANSACTION") ||
            message.includes("SAVEPOINT");

          if (!isD1TransactionUnsupported) {
            throw error;
          }

          console.warn(
            "[customers] DB transaction unsupported; adding entity without transaction",
          );
          await insertEntityWithLimitCheck(db);
        }
      } catch (err: any) {
        // Check if it's a limit exceeded error we threw
        if (err.message?.includes("Limit exceeded")) {
          const match = err.message.match(/(\d+)\/(\d+)/);
          const current = match ? parseInt(match[1]) : 0;
          const limitVal = match ? parseInt(match[2]) : null;
          return c.json(
            {
              success: false,
              error: err.message,
              code: "limit_exceeded",
              current: current,
              limit: limitVal,
              feature: featureSlug,
            },
            400,
          );
        }

        if (err.message?.includes("UNIQUE constraint")) {
          return c.json(
            { success: false, error: "Entity already exists" },
            409,
          );
        }

        // Re-throw other errors
        throw err;
      }

      return c.json(
        {
          success: true,
          entityId,
          featureId: featureSlug,
          count: finalCount,
          limit,
          remaining: limit !== null ? limit - finalCount : null,
        },
        200,
      );
    } catch (error) {
      if (isCustomerResolutionConflictError(error)) {
        return c.json({ success: false, error: error.message }, 409);
      }
      console.error("[entities] error:", error);
      return c.json({ success: false, error: "Failed to add entity" }, 500);
    }
  });

  // POST /v1/entities/remove - Remove an entity
  app.openapi(removeEntityRoute, async (c) => {
    const db = c.get("db");
    const organizationId = c.get("organizationId")!;

    try {
      const body = await c.req.json();
      const parsed = removeEntitySchema.safeParse(body);

      if (!parsed.success) {
        return c.json(zodErrorToResponse(parsed.error), 400);
      }

      const {
        customer: customerId,
        feature: featureSlug,
        entity: entityId,
      } = parsed.data;

      // Resolve customer (supports ID or email)
      const customer = await resolveCustomer(db, organizationId, customerId);

      if (!customer) {
        return c.json({ success: false, error: "Customer not found" }, 404);
      }

      // Resolve feature
      const feature = await db.query.features.findFirst({
        where: and(
          eq(schema.features.organizationId, organizationId),
          eq(schema.features.slug, featureSlug),
        ),
      });

      if (!feature) {
        return c.json({ success: false, error: "Feature not found" }, 404);
      }

      // Find and update entity
      const entity = await db.query.entities.findFirst({
        where: and(
          eq(schema.entities.customerId, customer.id),
          eq(schema.entities.featureId, feature.id),
          eq(schema.entities.entityId, entityId),
          eq(schema.entities.status, "active"),
        ),
      });

      if (!entity) {
        return c.json({ success: false, error: "Entity not found" }, 404);
      }

      await db
        .update(schema.entities)
        .set({
          status: "pending_removal",
          removedAt: Date.now(),
          updatedAt: Date.now(),
        })
        .where(eq(schema.entities.id, entity.id));

      // Count remaining entities (both active and pending_removal are still billed)
      const entityCount = await db
        .select({ count: count() })
        .from(schema.entities)
        .where(
          and(
            eq(schema.entities.customerId, customer.id),
            eq(schema.entities.featureId, feature.id),
            or(
              eq(schema.entities.status, "active"),
              eq(schema.entities.status, "pending_removal"),
            ),
          ),
        );

      return c.json(
        {
          success: true,
          entityId,
          count: entityCount[0]?.count || 0,
        },
        200,
      );
    } catch (error) {
      if (isCustomerResolutionConflictError(error)) {
        return c.json({ success: false, error: error.message }, 409);
      }
      console.error("[entities] error:", error);
      return c.json({ success: false, error: "Failed to remove entity" }, 500);
    }
  });

  // GET /v1/entities - List entities
  app.openapi(listEntitiesRoute, async (c) => {
    const db = c.get("db");
    const organizationId = c.get("organizationId")!;

    try {
      const customerId = c.req.query("customer");
      const featureSlug = c.req.query("feature");

      if (!customerId) {
        return c.json(
          { success: false, error: "Customer parameter required" },
          400,
        );
      }

      const parsed = listEntitiesSchema.safeParse({
        customer: customerId,
        feature: featureSlug,
      });
      if (!parsed.success) {
        return c.json(zodErrorToResponse(parsed.error), 400);
      }

      // Resolve customer
      const customer = await resolveCustomer(db, organizationId, customerId);

      if (!customer) {
        return c.json({ success: false, error: "Customer not found" }, 404);
      }

      // Build query - show both active and pending_removal entities
      // (pending_removal entities are still billed until period end)
      let whereClause = and(
        eq(schema.entities.customerId, customer.id),
        or(
          eq(schema.entities.status, "active"),
          eq(schema.entities.status, "pending_removal"),
        ),
      );

      if (featureSlug) {
        const feature = await db.query.features.findFirst({
          where: and(
            eq(schema.features.organizationId, organizationId),
            eq(schema.features.slug, featureSlug),
          ),
        });

        if (!feature) {
          return c.json({ success: false, error: "Feature not found" }, 404);
        }

        whereClause = and(
          whereClause,
          eq(schema.entities.featureId, feature.id),
        );
      }

      const entities = await db.query.entities.findMany({
        where: whereClause,
        with: {
          feature: true,
        },
      });

      const result = entities.map(
        (
          entity: typeof schema.entities.$inferSelect & {
            feature: typeof schema.features.$inferSelect;
          },
        ) => ({
          id: entity.entityId,
          featureId: entity.feature.slug,
          name: entity.name,
          email: entity.email,
          metadata: entity.metadata,
          status: entity.status,
          createdAt: new Date(entity.createdAt).toISOString(),
        }),
      );

      return c.json(
        {
          success: true,
          entities: result,
          total: result.length,
        },
        200,
      );
    } catch (error) {
      if (isCustomerResolutionConflictError(error)) {
        return c.json({ success: false, error: error.message }, 409);
      }
      console.error("[entities] error:", error);
      return c.json({ success: false, error: "Failed to list entities" }, 500);
    }
  });

  return app;
}

export default createApiCustomersRoute();
