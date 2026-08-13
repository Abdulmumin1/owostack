import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { eq, and, or, count, desc, inArray, sql } from "drizzle-orm";
import { schema } from "@owostack/db";
import { verifyApiKey } from "../../lib/api-keys";
import { resolveOrCreateCustomer } from "../../lib/customers";
import {
  isCustomerResolutionConflictError,
  resolveCustomerByIdentifier,
} from "../../lib/customer-resolution";
import {
  getCustomerBillingConfig,
  setCustomerFeatureBillingConfig,
  setCustomerOverageLimitConfig,
} from "../../lib/customer-billing-config";
import { buildCustomerUsageHistory } from "../../lib/customer-usage-history";
import { selectAccessGrantingPlanFeature } from "../../lib/customer-access";
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

const customerFeatureConfigSchema = z.object({
  feature: z.object({
    id: z.string(),
    slug: z.string().nullable(),
    name: z.string(),
  }),
  overage: z.enum(["block", "charge"]).nullable(),
  maxOverageUnits: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const customerOverageLimitSchema = z.object({
  maxOverageAmount: z.number().nullable(),
  onLimitReached: z.enum(["block", "notify"]),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const customerBillingSchema = z.object({
  overageLimit: customerOverageLimitSchema.nullable(),
  featureConfigs: z.array(customerFeatureConfigSchema),
});

const setCustomerFeatureConfigSchema = z
  .object({
    customer: z.string(),
    feature: z.string(),
    overage: z.enum(["block", "charge"]).nullable().optional(),
    maxOverageUnits: z.number().int().positive().nullable().optional(),
  })
  .refine(
    (value) =>
      value.overage !== undefined || value.maxOverageUnits !== undefined,
    {
      message: "Provide overage or maxOverageUnits",
      path: ["feature"],
    },
  );

const setCustomerOverageLimitSchema = z.object({
  customer: z.string(),
  maxOverageAmount: z.number().int().positive().nullable(),
  onLimitReached: z.enum(["block", "notify"]).default("block"),
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
    billing: customerBillingSchema,
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

const usageHistoryQuerySchema = z
  .object({
    range: z.enum(["7d", "30d", "90d", "custom"]).default("30d"),
    granularity: z.enum(["day", "week", "month"]).default("day"),
    feature: z.string().optional(),
    groupBy: z.enum(["total", "feature"]).default("total"),
    timezone: z.string().default("UTC"),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine(
    (value) =>
      value.range !== "custom" ||
      (typeof value.from === "string" && typeof value.to === "string"),
    {
      message: "Custom range requires from and to",
      path: ["from"],
    },
  );

const usageHistorySeriesPointSchema = z.object({
  bucket: z.string(),
  value: z.number(),
});

const usageHistoryFeatureSchema = z.object({
  id: z.string(),
  slug: z.string().nullable(),
  name: z.string(),
  unit: z.string().nullable(),
});

const usageHistoryBreakdownSchema = z.object({
  feature: usageHistoryFeatureSchema,
  totals: z.object({
    usage: z.number(),
    records: z.number(),
  }),
  series: z.array(usageHistorySeriesPointSchema),
});

const usageHistoryResponseSchema = z.object({
  customer: z.object({
    id: z.string(),
  }),
  query: z.object({
    range: z.object({
      from: z.string(),
      to: z.string(),
    }),
    granularity: z.enum(["day", "week", "month"]),
    feature: z.string().nullable(),
    groupBy: z.enum(["total", "feature"]),
    timezone: z.string(),
  }),
  totals: z.object({
    usage: z.number(),
    records: z.number(),
  }),
  series: z.array(usageHistorySeriesPointSchema),
  breakdown: z.array(usageHistoryBreakdownSchema),
});

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

const getCustomerUsageHistoryRoute = createRoute({
  method: "get",
  path: "/customers/{id}/usage/history",
  operationId: "getCustomerUsageHistory",
  tags: ["Customers"],
  summary: "Get customer usage history",
  description:
    "Returns aggregated usage history for a customer, optionally filtered by feature and grouped for breakdown views.",
  security: apiKeySecurity,
  request: {
    params: z.object({
      id: z.string(),
    }),
    query: usageHistoryQuerySchema,
  },
  responses: {
    200: {
      description: "Customer usage history returned successfully",
      ...jsonContent(usageHistoryResponseSchema),
    },
    400: badRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    500: internalServerErrorResponse,
  },
});

const setCustomerFeatureConfigRoute = createRoute({
  method: "post",
  path: "/customers/feature-config",
  operationId: "setCustomerFeatureConfig",
  tags: ["Customers"],
  summary: "Set customer feature billing config",
  description:
    "Sets or clears customer-specific overage behavior for a single feature.",
  security: apiKeySecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: setCustomerFeatureConfigSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Customer config updated successfully",
      ...jsonContent(customerResponseSchema),
    },
    400: badRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalServerErrorResponse,
  },
});

const setCustomerOverageLimitRoute = createRoute({
  method: "post",
  path: "/customers/overage-limit",
  operationId: "setCustomerOverageLimit",
  tags: ["Customers"],
  summary: "Set customer overage limit",
  description:
    "Sets or clears the customer-wide overage spend cap and breach behavior.",
  security: apiKeySecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: setCustomerOverageLimitSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Customer overage limit updated successfully",
      ...jsonContent(customerResponseSchema),
    },
    400: badRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
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

async function resolveFeature(
  db: any,
  organizationId: string,
  feature: string,
) {
  return db.query.features.findFirst({
    where: and(
      eq(schema.features.organizationId, organizationId),
      or(eq(schema.features.id, feature), eq(schema.features.slug, feature)),
    ),
  });
}

async function resolveEntityLimit(
  db: any,
  customerId: string,
  featureId: string,
): Promise<number | null | undefined> {
  const subscriptions = await db.query.subscriptions.findMany({
    where: and(
      eq(schema.subscriptions.customerId, customerId),
      inArray(schema.subscriptions.status, [
        "active",
        "trialing",
        "pending_cancel",
      ]),
    ),
    with: { plan: true },
    orderBy: [
      desc(schema.subscriptions.currentPeriodEnd),
      desc(schema.subscriptions.currentPeriodStart),
      desc(schema.subscriptions.id),
    ],
  });
  const planIds = [
    ...new Set(subscriptions.map((subscription: any) => subscription.planId)),
  ];
  if (planIds.length === 0) return undefined;

  const planFeatures: Array<{
    id: string;
    planId: string;
    limitValue: number | null;
    trialLimitValue: number | null;
  }> = await db.query.planFeatures.findMany({
    where: and(
      inArray(schema.planFeatures.planId, planIds),
      eq(schema.planFeatures.featureId, featureId),
    ),
    orderBy: [desc(schema.planFeatures.planId), desc(schema.planFeatures.id)],
  });
  const accessGrant = selectAccessGrantingPlanFeature(
    subscriptions.map((subscription: any) => ({
      ...subscription,
      planType: subscription.plan?.type,
    })),
    planFeatures,
  );
  if (!accessGrant) return undefined;

  return accessGrant.subscription.status === "trialing" &&
    accessGrant.planFeature.trialLimitValue !== null
    ? accessGrant.planFeature.trialLimitValue
    : accessGrant.planFeature.limitValue;
}

async function buildCustomerResponse(
  db: any,
  organizationId: string,
  customer: {
    id: string;
    email: string;
    name?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt: number;
    updatedAt: number;
  },
) {
  const billing = await getCustomerBillingConfig(
    db,
    organizationId,
    customer.id,
  );

  return {
    success: true as const,
    id: customer.id,
    email: customer.email,
    name: customer.name ?? null,
    metadata: customer.metadata ?? null,
    billing,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
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
        await buildCustomerResponse(db, organizationId, customer),
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
        await buildCustomerResponse(db, organizationId, customer),
        200,
      );
    } catch (error) {
      console.error("[customers] error:", error);
      return c.json({ success: false, error: "Failed to get customer" }, 500);
    }
  });

  app.openapi(getCustomerUsageHistoryRoute, async (c) => {
    const db = c.get("db");
    const organizationId = c.get("organizationId")!;

    try {
      const customerId = c.req.param("id");
      const query = usageHistoryQuerySchema.safeParse({
        range: c.req.query("range"),
        granularity: c.req.query("granularity"),
        feature: c.req.query("feature"),
        groupBy: c.req.query("groupBy"),
        timezone: c.req.query("timezone"),
        from: c.req.query("from"),
        to: c.req.query("to"),
      });

      if (!query.success) {
        return c.json(zodErrorToResponse(query.error), 400);
      }

      const customer = await db.query.customers.findFirst({
        where: and(
          eq(schema.customers.organizationId, organizationId),
          eq(schema.customers.id, customerId),
        ),
        columns: { id: true },
      });

      if (!customer) {
        return c.json({ success: false, error: "Customer not found" }, 404);
      }

      const feature = query.data.feature
        ? await resolveFeature(db, organizationId, query.data.feature)
        : null;

      if (query.data.feature && !feature) {
        return c.json({ success: false, error: "Feature not found" }, 404);
      }

      const data = await buildCustomerUsageHistory({
        db,
        env: c.env,
        organizationId,
        customerId,
        query: {
          range: query.data.range,
          granularity: query.data.granularity,
          groupBy: query.data.groupBy,
          timezone: query.data.timezone,
          from: query.data.from,
          to: query.data.to,
          featureId: feature?.id ?? null,
          featureRef: feature?.slug ?? feature?.id ?? null,
        },
      });

      return c.json(data, 200);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("Custom range requires from and to") ||
          error.message.includes("Custom range must have from <= to") ||
          error.message.includes("Invalid time zone"))
      ) {
        return c.json({ success: false, error: error.message }, 400);
      }
      console.error("[customers] usage-history error:", error);
      return c.json(
        { success: false, error: "Failed to get customer usage history" },
        500,
      );
    }
  });

  app.openapi(setCustomerFeatureConfigRoute, async (c) => {
    const db = c.get("db");
    const organizationId = c.get("organizationId")!;

    try {
      const body = await c.req.json();
      const parsed = setCustomerFeatureConfigSchema.safeParse(body);

      if (!parsed.success) {
        return c.json(zodErrorToResponse(parsed.error), 400);
      }

      const customer = await resolveCustomer(
        db,
        organizationId,
        parsed.data.customer,
      );

      if (!customer) {
        return c.json({ success: false, error: "Customer not found" }, 404);
      }

      const feature = await resolveFeature(
        db,
        organizationId,
        parsed.data.feature,
      );

      if (!feature) {
        return c.json({ success: false, error: "Feature not found" }, 404);
      }

      await setCustomerFeatureBillingConfig({
        db,
        organizationId,
        customerId: customer.id,
        featureId: feature.id,
        overage: parsed.data.overage,
        maxOverageUnits: parsed.data.maxOverageUnits,
      });

      const refreshedCustomer = await db.query.customers.findFirst({
        where: and(
          eq(schema.customers.organizationId, organizationId),
          eq(schema.customers.id, customer.id),
        ),
      });

      if (!refreshedCustomer) {
        return c.json({ success: false, error: "Customer not found" }, 404);
      }

      return c.json(
        await buildCustomerResponse(db, organizationId, refreshedCustomer),
        200,
      );
    } catch (error) {
      if (isCustomerResolutionConflictError(error)) {
        return c.json({ success: false, error: error.message }, 409);
      }
      console.error("[customers] feature-config error:", error);
      return c.json(
        { success: false, error: "Failed to update customer feature config" },
        500,
      );
    }
  });

  app.openapi(setCustomerOverageLimitRoute, async (c) => {
    const db = c.get("db");
    const organizationId = c.get("organizationId")!;

    try {
      const body = await c.req.json();
      const parsed = setCustomerOverageLimitSchema.safeParse(body);

      if (!parsed.success) {
        return c.json(zodErrorToResponse(parsed.error), 400);
      }

      const customer = await resolveCustomer(
        db,
        organizationId,
        parsed.data.customer,
      );

      if (!customer) {
        return c.json({ success: false, error: "Customer not found" }, 404);
      }

      await setCustomerOverageLimitConfig({
        db,
        organizationId,
        customerId: customer.id,
        maxOverageAmount: parsed.data.maxOverageAmount,
        onLimitReached: parsed.data.onLimitReached,
      });

      const refreshedCustomer = await db.query.customers.findFirst({
        where: and(
          eq(schema.customers.organizationId, organizationId),
          eq(schema.customers.id, customer.id),
        ),
      });

      if (!refreshedCustomer) {
        return c.json({ success: false, error: "Customer not found" }, 404);
      }

      return c.json(
        await buildCustomerResponse(db, organizationId, refreshedCustomer),
        200,
      );
    } catch (error) {
      if (isCustomerResolutionConflictError(error)) {
        return c.json({ success: false, error: error.message }, 409);
      }
      console.error("[customers] overage-limit error:", error);
      return c.json(
        { success: false, error: "Failed to update customer overage limit" },
        500,
      );
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

      const limit = await resolveEntityLimit(db, customer.id, feature.id);
      if (limit === undefined) {
        return c.json(
          {
            success: false,
            error: "Feature is not included in the customer's current plan",
            code: "feature_not_in_plan",
          },
          400,
        );
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

      const now = Date.now();
      let insert;
      try {
        insert = await db.run(
          sql`INSERT INTO entities (id, customer_id, feature_id, entity_id, name, email, metadata, status, created_at, updated_at)
              SELECT ${crypto.randomUUID()}, ${customer.id}, ${feature.id}, ${entityId}, ${entityName || null}, ${entityEmail || null}, ${entityMetadata ? JSON.stringify(entityMetadata) : null}, 'active', ${now}, ${now}
              WHERE ${limit} IS NULL OR (
                SELECT COUNT(*) FROM entities
                WHERE customer_id = ${customer.id}
                  AND feature_id = ${feature.id}
                  AND status IN ('active', 'pending_removal')
              ) < ${limit}`,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("UNIQUE constraint")
        ) {
          return c.json(
            { success: false, error: "Entity already exists" },
            409,
          );
        }
        throw error;
      }

      if ((insert.meta?.changes ?? 0) !== 1) {
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
            success: false,
            error: `Limit exceeded: ${currentCount}/${limit} ${featureSlug} used`,
            code: "limit_exceeded",
            current: currentCount,
            limit,
            feature: featureSlug,
          },
          400,
        );
      }

      const finalCount = await db
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
          featureId: featureSlug,
          count: finalCount[0]?.count || 0,
          limit,
          remaining:
            limit !== null ? limit - (finalCount[0]?.count || 0) : null,
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
