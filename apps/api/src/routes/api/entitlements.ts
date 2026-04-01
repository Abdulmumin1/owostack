import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { eq, and, sql, or, inArray } from "drizzle-orm";
import { schema } from "@owostack/db";
import { verifyApiKey } from "../../lib/api-keys";
import { EntitlementCache } from "../../lib/cache";
import { resolveOrCreateCustomer } from "../../lib/customers";
import type { Env, Variables } from "../../index";
import { getResetPeriod } from "../../lib/reset-period";
import { zodErrorToResponse } from "../../lib/validation";
import { getScopedBalance, deductScopedBalance } from "../../lib/addon-credits";
import { trackUsageEvent } from "../../lib/analytics-engine";
import { appendUsageRecord, sumUsageAmount } from "../../lib/usage-ledger";
import {
  checkOverageAllowed,
  getOrgOverageSettings,
  getUnbilledOverageAmount,
} from "../../lib/overage-guards";
import { evaluateThresholdBillingCandidate } from "../../lib/threshold-billing";
import { isPaidActivePastGracePeriod } from "../../lib/subscription-health";
import {
  getCurrentPricingTier,
  normalizeRatingModel,
} from "../../lib/usage-rating";
import { buildUsagePricingSnapshot } from "../../lib/usage-pricing-snapshot";
import { isCustomerResolutionConflictError } from "../../lib/customer-resolution";
import {
  apiKeySecurity,
  badRequestResponse,
  billingTierBreakdownSchema,
  conflictResponse,
  customerDataSchema as customerDataOpenAPISchema,
  errorResponseSchema,
  internalServerErrorResponse,
  jsonContent,
  metadataSchema,
  pricingDetailsSchema,
  unauthorizedResponse,
} from "../../openapi/common";

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

export type EntitlementsDependencies = {
  verifyApiKey: typeof verifyApiKey;
  resolveOrCreateCustomer: typeof resolveOrCreateCustomer;
  getScopedBalance: typeof getScopedBalance;
  deductScopedBalance: typeof deductScopedBalance;
  checkOverageAllowed: typeof checkOverageAllowed;
  getOrgOverageSettings: typeof getOrgOverageSettings;
  getUnbilledOverageAmount: typeof getUnbilledOverageAmount;
};

const defaultDependencies: EntitlementsDependencies = {
  verifyApiKey,
  resolveOrCreateCustomer,
  getScopedBalance,
  deductScopedBalance,
  checkOverageAllowed,
  getOrgOverageSettings,
  getUnbilledOverageAmount,
};

const jsonContentTypePattern = /^application\/([a-z-]+\+)?json\b/i;

function getEntitlementsDependencies(c: any): EntitlementsDependencies {
  return c.get?.("entitlementsDeps") ?? defaultDependencies;
}

const MAX_TRIAL_DURATION_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

function getUsageModel(
  planFeature: any,
): "included" | "usage_based" | "prepaid" {
  if (planFeature?.usageModel === "usage_based") return "usage_based";
  if (planFeature?.usageModel === "prepaid") return "prepaid";
  return "included";
}

function getGuardIncluded(
  planFeature: any,
  isTrial: boolean = false,
): number | null {
  if (getUsageModel(planFeature) === "usage_based") {
    return 0;
  }
  // Use trialLimitValue when on trial, fall back to limitValue
  if (isTrial && planFeature.trialLimitValue !== undefined) {
    return planFeature.trialLimitValue;
  }
  return planFeature.limitValue;
}

function buildPricingDetails(
  planFeature: any,
  usage?: number | null,
):
  | {
      usageModel: "included" | "usage_based" | "prepaid";
      ratingModel: "package" | "graduated" | "volume";
      pricePerUnit?: number | null;
      billingUnits?: number | null;
      currentTier?: {
        index: number;
        startsAt: number;
        endsAt: number | null;
        unitPrice: number;
        flatFee?: number;
      };
    }
  | undefined {
  if (!planFeature) return undefined;

  const usageModel = getUsageModel(planFeature);
  const ratingModel = normalizeRatingModel(planFeature.ratingModel);
  const pricing: {
    usageModel: "included" | "usage_based" | "prepaid";
    ratingModel: "package" | "graduated" | "volume";
    pricePerUnit?: number | null;
    billingUnits?: number | null;
    currentTier?: {
      index: number;
      startsAt: number;
      endsAt: number | null;
      unitPrice: number;
      flatFee?: number;
    };
  } = {
    usageModel,
    ratingModel,
  };

  if (ratingModel === "package") {
    const pricePerUnit =
      usageModel === "included"
        ? (planFeature.overagePrice ?? planFeature.pricePerUnit ?? null)
        : (planFeature.pricePerUnit ?? planFeature.overagePrice ?? null);
    if (pricePerUnit !== null && pricePerUnit !== undefined) {
      pricing.pricePerUnit = pricePerUnit;
    }
    if (
      planFeature.billingUnits !== null &&
      planFeature.billingUnits !== undefined
    ) {
      pricing.billingUnits = planFeature.billingUnits;
    }
  }

  if (usage !== null && usage !== undefined) {
    const currentTier = getCurrentPricingTier({
      usage,
      included: getGuardIncluded(planFeature),
      usageModel,
      ratingModel,
      tiers: planFeature.tiers,
    });
    if (currentTier) {
      pricing.currentTier = currentTier;
    }
  }

  return pricing;
}

function buildUsageLedgerContext(params: {
  featureId: string;
  featureSlug?: string | null;
  featureName?: string | null;
  subscription?: { id?: string | null; planId?: string | null } | null;
  planFeature?: any;
}) {
  return {
    featureId: params.featureId,
    featureSlug: params.featureSlug ?? null,
    featureName: params.featureName ?? null,
    subscriptionId: params.subscription?.id ?? null,
    planId: params.subscription?.planId ?? null,
    pricingSnapshot: params.planFeature
      ? buildUsagePricingSnapshot(params.planFeature)
      : null,
  };
}

function scheduleCacheOp(c: any, op: Promise<unknown>, label: string) {
  c.executionCtx.waitUntil(
    op.catch((error) => {
      console.warn(`[entitlements] cache ${label} failed:`, error);
    }),
  );
}

async function persistUsageRecord(
  c: any,
  db: any,
  organizationId: string | null | undefined,
  record: {
    customerId: string;
    featureId: string;
    featureSlug?: string | null;
    featureName?: string | null;
    entityId?: string | null;
    amount: number;
    periodStart: number;
    periodEnd: number;
    subscriptionId?: string | null;
    planId?: string | null;
    pricingSnapshot?: ReturnType<typeof buildUsagePricingSnapshot> | null;
  },
) {
  const orgId = organizationId || "unknown";
  const dateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const requireAuthoritativeLedger = Boolean(
    c.env.USAGE_LEDGER && organizationId,
  );

  // Dispatch all logging tasks in parallel for maximum background efficiency
  const [d1Result, doResult, aeResult] = await Promise.allSettled([
    // 1. Update Daily Aggregate (Sensible D1 Cleanup)
    db
      .insert(schema.usageDailySummaries)
      .values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        customerId: record.customerId,
        featureId: record.featureId,
        date: dateStr,
        amount: record.amount,
      })
      .onConflictDoUpdate({
        target: [
          schema.usageDailySummaries.customerId,
          schema.usageDailySummaries.featureId,
          schema.usageDailySummaries.date,
        ],
        set: {
          amount: sql`${schema.usageDailySummaries.amount} + ${record.amount}`,
          updatedAt: Date.now(),
        },
      }),

    // 2. Write to Pulse (Durable Object)
    appendUsageRecord(
      {
        usageLedger: c.env.USAGE_LEDGER,
        organizationId: organizationId || null,
      },
      {
        customerId: record.customerId,
        featureId: record.featureId,
        featureSlug: record.featureSlug ?? null,
        featureName: record.featureName ?? null,
        entityId: record.entityId ?? null,
        amount: record.amount,
        periodStart: record.periodStart,
        periodEnd: record.periodEnd,
        subscriptionId: record.subscriptionId ?? null,
        planId: record.planId ?? null,
        pricingSnapshot: record.pricingSnapshot ?? null,
        createdAt: Date.now(),
      },
    ),

    // 3. Write to Analytics Engine
    (async () => {
      try {
        trackUsageEvent(c.env, {
          customerId: record.customerId,
          featureId: record.featureId,
          amount: record.amount,
          organizationId: orgId,
          periodStart: record.periodStart,
          periodEnd: record.periodEnd,
          entityId: record.entityId ?? null,
        });
      } catch (e) {
        console.error("[entitlements] Analytics Engine log failed:", e);
      }
    })(),
  ]);

  // Check results and handle failures
  // D1 aggregate failure - log but don't throw (it's our backup)
  if (d1Result.status === "rejected") {
    console.error(
      `[persist] D1 aggregate update failed for customer=${record.customerId}, ` +
        `feature=${record.featureId}:`,
      d1Result.reason,
    );
  }

  // DO failure - CRITICAL, throw to trigger retry
  if (doResult.status === "rejected") {
    console.error(
      `[persist] UsageLedgerDO persist failed for customer=${record.customerId}, ` +
        `feature=${record.featureId}:`,
      doResult.reason,
    );
    throw new Error(`UsageLedgerDO persist failed: ${doResult.reason}`);
  }
  if (requireAuthoritativeLedger && doResult.value !== true) {
    console.error(
      `[persist] UsageLedgerDO persist returned a failed result for customer=${record.customerId}, ` +
        `feature=${record.featureId}.`,
    );
    throw new Error("UsageLedgerDO persist returned false");
  }

  // Analytics Engine failure - log but not critical
  if (aeResult.status === "rejected") {
    console.warn(
      `[persist] Analytics Engine log failed for customer=${record.customerId}, ` +
        `feature=${record.featureId}:`,
      aeResult.reason,
    );
    // Don't throw - AE is for analytics only, not billing
  }
}

function scheduleUsagePersist(
  c: any,
  db: any,
  organizationId: string | null | undefined,
  record: {
    customerId: string;
    featureId: string;
    featureSlug?: string | null;
    featureName?: string | null;
    entityId?: string | null;
    amount: number;
    periodStart: number;
    periodEnd: number;
    subscriptionId?: string | null;
    planId?: string | null;
    pricingSnapshot?: ReturnType<typeof buildUsagePricingSnapshot> | null;
  },
  label: string,
): Promise<void> {
  // Retry configuration
  const MAX_RETRIES = 3;
  const INITIAL_DELAY_MS = 1000; // 1 second

  async function persistWithRetry(attempt: number = 1): Promise<void> {
    try {
      await persistUsageRecord(c, db, organizationId, record);
      if (attempt > 1) {
        console.log(
          `[entitlements] usage persist ${label} succeeded on attempt ${attempt}`,
        );
      }
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        const delayMs = INITIAL_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff: 1s, 2s, 4s
        console.warn(
          `[entitlements] usage persist ${label} failed (attempt ${attempt}/${MAX_RETRIES}), ` +
            `retrying in ${delayMs}ms:`,
          error,
        );

        // Use setTimeout for delay, then retry
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return persistWithRetry(attempt + 1);
      } else {
        // All retries exhausted - this is critical
        console.error(
          `[entitlements] CRITICAL: usage persist ${label} failed after ${MAX_RETRIES} attempts. ` +
            `Data loss risk - customer=${record.customerId}, feature=${record.featureId}, amount=${record.amount}. ` +
            `Error:`,
          error,
        );
        // Don't throw - we don't want to crash the request, but we've logged prominently
      }
    }
  }

  const persistPromise = persistWithRetry(1);
  c.executionCtx.waitUntil(persistPromise);
  return persistPromise;
}

function hasAuthoritativeUsageLedger(
  c: any,
  organizationId: string | null | undefined,
): boolean {
  return Boolean(c.env.USAGE_LEDGER && organizationId);
}

const ensureJsonContentType: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const contentType = c.req.header("Content-Type");
  if (
    c.req.raw.body !== null &&
    (!contentType || !jsonContentTypePattern.test(contentType))
  ) {
    const headers = new Headers(c.req.raw.headers);
    headers.set("Content-Type", "application/json");
    c.req.raw = new Request(c.req.raw, { headers });
  }

  await next();
};

const requireApiKey: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const deps = getEntitlementsDependencies(c);
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "Missing API Key" }, 401);
  }

  const apiKey = authHeader.split(" ")[1];
  const authDb = c.get("authDb");

  const keyRecord = await deps.verifyApiKey(authDb, apiKey, {
    cache: c.env.CACHE_SHARED ?? c.env.CACHE,
    waitUntil: (promise) => c.executionCtx.waitUntil(promise),
  });
  if (!keyRecord) {
    return c.json({ success: false, error: "Invalid API Key" }, 401);
  }

  c.set("organizationId", keyRecord.organizationId);
  return await next();
};

const customerDataSchema = customerDataOpenAPISchema;

const checkSchema = z.object({
  customer: z.string(),
  feature: z.string(),
  value: z.number().min(0).default(1),
  customerData: customerDataSchema.optional(),
  sendEvent: z.boolean().default(false),
  entity: z.string().optional(),
});

const trackSchema = z.object({
  customer: z.string(),
  feature: z.string(),
  value: z.number().min(0).default(1),
  customerData: customerDataSchema.optional(),
  entity: z.string().optional(),
  metadata: metadataSchema.optional(),
});

const entitlementResultSchema = z
  .object({
    allowed: z.boolean(),
    code: z.string(),
    usage: z.number().nullable().optional(),
    limit: z.number().nullable().optional(),
    balance: z.number().nullable().optional(),
    resetsAt: z.string().datetime().nullable().optional(),
    resetInterval: z.string().nullable().optional(),
    addonCredits: z.number().optional(),
    details: z
      .object({
        message: z.string().optional(),
        pricing: pricingDetailsSchema.optional(),
        tierBreakdown: z.array(billingTierBreakdownSchema).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const entitlementOrErrorSchema = z.union([
  entitlementResultSchema,
  errorResponseSchema,
]);

const checkRoute = createRoute({
  method: "post",
  path: "/check",
  operationId: "check",
  tags: ["Entitlements"],
  summary: "Check feature entitlements",
  description:
    "Check whether a customer is allowed to use a feature and get current usage and limits. Optionally track usage atomically if allowed via sendEvent.",
  security: apiKeySecurity,
  middleware: [requireApiKey, ensureJsonContentType],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: checkSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Entitlement result",
      ...jsonContent(entitlementResultSchema),
    },
    400: badRequestResponse,
    401: unauthorizedResponse,
    409: conflictResponse,
    500: internalServerErrorResponse,
    503: {
      description: "Billing state unavailable",
      ...jsonContent(entitlementResultSchema),
    },
  },
});

const trackRoute = createRoute({
  method: "post",
  path: "/track",
  operationId: "track",
  tags: ["Entitlements"],
  summary: "Record metered usage",
  description:
    "Track usage for a feature and return the resulting entitlement state after the increment.",
  security: apiKeySecurity,
  middleware: [requireApiKey, ensureJsonContentType],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: trackSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Tracked usage result",
      ...jsonContent(entitlementResultSchema),
    },
    400: {
      description: "Invalid request or tracking denied",
      ...jsonContent(entitlementOrErrorSchema),
    },
    401: unauthorizedResponse,
    404: {
      description: "Tracked resource not found",
      ...jsonContent(entitlementResultSchema),
    },
    409: {
      description: "Tracked request conflicts with current customer resolution",
      ...jsonContent(entitlementResultSchema),
    },
    500: {
      description: "Tracking failed",
      ...jsonContent(entitlementOrErrorSchema),
    },
    503: {
      description: "Billing state unavailable",
      ...jsonContent(entitlementResultSchema),
    },
  },
});

// ---------------------------------------------------------------------------
// Add-on Credit Helpers (scoped to credit system — no global pool)
// Every add-on pack must be attached to a credit system.
// When plan credits exhausted, check credit_system_balances for that system.
// ---------------------------------------------------------------------------

/**
 * Try to deduct add-on credits from the scoped credit system balance.
 * Returns { deducted: true, remaining } or { deducted: false }.
 */
async function tryDeductAddonCredits(
  db: any,
  customerId: string,
  amount: number,
  creditSystemId: string,
  deps: EntitlementsDependencies = defaultDependencies,
): Promise<{ deducted: boolean; remaining?: number }> {
  // Atomic deduct with WHERE balance >= amount guard (prevents negative balance under concurrency)
  const success = await deps.deductScopedBalance(
    db,
    customerId,
    creditSystemId,
    amount,
  );
  if (success) {
    const remaining = await deps.getScopedBalance(
      db,
      customerId,
      creditSystemId,
    );
    return { deducted: true, remaining };
  }
  return { deducted: false };
}

/**
 * Get addon balance for a credit system (scoped only).
 */
async function getAddonBalance(
  db: any,
  customerId: string,
  creditSystemId: string,
  deps: EntitlementsDependencies = defaultDependencies,
): Promise<number> {
  return deps.getScopedBalance(db, customerId, creditSystemId);
}

// ---------------------------------------------------------------------------
// Credit System Resolution Helper
// ---------------------------------------------------------------------------
// When a feature (e.g. "dfs") isn't directly in plan_features, it may belong
// to a credit system (e.g. "support-credits"). This helper resolves the
// mapping: feature → credit_system_features → parent credit system → plan_features.
// ---------------------------------------------------------------------------

interface CreditSystemMapping {
  creditSystemId: string; // ID of the credit system (= feature ID of the pool)
  creditSystemSlug: string; // Slug of the credit system feature
  costPerUnit: number; // How many credits one unit of the child feature costs
  planFeature: any; // The plan_feature row for the credit system
  subscription: any; // The subscription granting access
}

async function resolveCreditSystem(
  db: any,
  featureId: string,
  planIds: string[],
  subscriptions: any[],
  customerId: string,
  now: number,
): Promise<CreditSystemMapping | null> {
  if (planIds.length === 0) return null;

  // 1. Find credit systems that contain this feature
  const mappedSystems = await db
    .select({
      creditSystemId: schema.creditSystemFeatures.creditSystemId,
      cost: schema.creditSystemFeatures.cost,
      creditSystemSlug: schema.creditSystems.slug,
    })
    .from(schema.creditSystemFeatures)
    .innerJoin(
      schema.creditSystems,
      eq(schema.creditSystems.id, schema.creditSystemFeatures.creditSystemId),
    )
    .where(eq(schema.creditSystemFeatures.featureId, featureId));

  if (mappedSystems.length === 0) return null;

  const creditSystemIds = [
    ...new Set(
      mappedSystems.map((ms: { creditSystemId: string }) => ms.creditSystemId),
    ),
  ];
  const subscriptionByPlanId = new Map(
    subscriptions.map((sub: { planId: string }) => [sub.planId, sub]),
  );

  // 2. Fetch all manual overrides for mapped credit systems in one query
  const manualEntitlements = await db.query.entitlements.findMany({
    where: and(
      eq(schema.entitlements.customerId, customerId),
      eq(schema.entitlements.source, "manual"),
      inArray(schema.entitlements.featureId, creditSystemIds),
      or(
        sql`${schema.entitlements.expiresAt} IS NULL`,
        sql`${schema.entitlements.expiresAt} > ${now}`,
      ),
    ),
  });
  const manualByCreditSystemId = new Map(
    manualEntitlements.map((row: { featureId: string }) => [
      row.featureId,
      row,
    ]),
  );

  // 3. Fetch all plan_features for mapped credit systems in one query
  const csPlanFeatures = await db.query.planFeatures.findMany({
    where: and(
      inArray(schema.planFeatures.planId, planIds),
      inArray(schema.planFeatures.featureId, creditSystemIds),
    ),
  });
  const planFeaturesByCreditSystemId = new Map<string, any[]>();
  for (const pf of csPlanFeatures) {
    const featurePlanFeatures = planFeaturesByCreditSystemId.get(pf.featureId);
    if (featurePlanFeatures) {
      featurePlanFeatures.push(pf);
      continue;
    }
    planFeaturesByCreditSystemId.set(pf.featureId, [pf]);
  }

  // 4. Preserve deterministic order from mapped systems
  for (const ms of mappedSystems) {
    const csFeatureId = ms.creditSystemId; // credit system ID = feature ID (same row)

    // Check for manual override on the credit system feature FIRST
    const manualEntitlement = manualByCreditSystemId.get(csFeatureId);

    if (manualEntitlement) {
      // Found a manual override on the credit system!
      const sub = subscriptions[0] || {
        id: "manual",
        status: "active",
        currentPeriodStart: now - 30 * 24 * 60 * 60 * 1000,
        currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1000,
        plan: { name: "Manual Override" },
      };
      return {
        creditSystemId: csFeatureId,
        creditSystemSlug: ms.creditSystemSlug,
        costPerUnit: ms.cost,
        planFeature: {
          ...manualEntitlement,
          planId: (sub as any).planId || "manual",
          usageModel: "included",
        },
        subscription: sub,
      };
    }

    // No manual override, check plan features
    const featurePlanFeatures =
      planFeaturesByCreditSystemId.get(csFeatureId) ?? [];

    for (const pf of featurePlanFeatures) {
      const sub = subscriptionByPlanId.get(pf.planId);
      if (sub) {
        return {
          creditSystemId: csFeatureId,
          creditSystemSlug: ms.creditSystemSlug,
          costPerUnit: ms.cost,
          planFeature: pf,
          subscription: sub,
        };
      }
    }
  }

  return null;
}

async function getManualEntitlementForFeature(
  c: any,
  db: any,
  cache: EntitlementCache | null,
  organizationId: string,
  customerId: string,
  featureId: string,
  now: number,
) {
  if (cache) {
    const cached = await cache.getManualEntitlement<
      typeof schema.entitlements.$inferSelect
    >(organizationId, customerId, featureId);
    if (cached !== undefined) {
      return cached;
    }
  }

  const manualEntitlement =
    (await db.query.entitlements.findFirst({
      where: and(
        eq(schema.entitlements.customerId, customerId),
        eq(schema.entitlements.featureId, featureId),
        eq(schema.entitlements.source, "manual"),
        or(
          sql`${schema.entitlements.expiresAt} IS NULL`,
          sql`${schema.entitlements.expiresAt} > ${now}`,
        ),
      ),
    })) ?? null;

  if (cache) {
    scheduleCacheOp(
      c,
      cache.setManualEntitlement(
        organizationId,
        customerId,
        featureId,
        manualEntitlement,
      ),
      "setManualEntitlement(/check)",
    );
  }

  return manualEntitlement;
}

// Check Access
app.openapi(
  checkRoute,
  async (c) => {
    const deps = getEntitlementsDependencies(c);
    const {
      customer: customerId,
      feature: featureId,
      value,
      customerData,
      sendEvent,
      entity,
    } = c.req.valid("json");
    const db = c.get("db");
    const organizationId = c.get("organizationId");
    const cache = c.env.CACHE ? new EntitlementCache(c.env.CACHE) : null;

    if (!organizationId) {
      return c.json(
        { success: false, error: "Organization Context Missing" },
        500,
      );
    }

    // 1 & 2. Resolve Customer and Feature in parallel
    let customer;
    let featureResult;
    try {
      [customer, featureResult] = await Promise.all([
        deps.resolveOrCreateCustomer({
          db,
          organizationId,
          customerId,
          customerData,
          cache,
          waitUntil: (p) => c.executionCtx.waitUntil(p),
        }),
        (async () => {
          let f = cache
            ? await cache.getFeature<typeof schema.features.$inferSelect>(
                organizationId,
                featureId,
              )
            : null;

          if (!f) {
            f =
              (await db.query.features.findFirst({
                where: and(
                  eq(schema.features.organizationId, organizationId),
                  or(
                    eq(schema.features.id, featureId),
                    eq(schema.features.slug, featureId),
                  ),
                ),
              })) ?? null;

            if (f && cache) {
              const featureCacheKeys = [featureId, f.id, f.slug].filter(
                (key): key is string => !!key && key.length > 0,
              );
              const uniqueFeatureCacheKeys = [...new Set(featureCacheKeys)];
              scheduleCacheOp(
                c,
                Promise.all(
                  uniqueFeatureCacheKeys.map((key) =>
                    cache.setFeature(organizationId, key, f),
                  ),
                ),
                "setFeature(/check)",
              );
            }
          }
          return f;
        })(),
      ]);
    } catch (error) {
      if (isCustomerResolutionConflictError(error)) {
        return c.json(
          {
            allowed: false,
            code: "customer_ambiguous",
            usage: null,
            limit: null,
            balance: null,
            resetsAt: null,
            resetInterval: null,
            details: {
              message: error.message,
            },
          },
          200,
        );
      }
      throw error;
    }

    if (!customer) {
      return c.json(
        {
          allowed: false,
          code: "customer_not_found",
          usage: null,
          limit: null,
          balance: null,
          resetsAt: null,
          resetInterval: null,
          details: {
            message: `Customer '${customerId}' not found in this organization.`,
          },
        },
        200,
      );
    }

    const feature = featureResult;

    if (!feature) {
      return c.json(
        {
          allowed: false,
          code: "feature_not_found",
          usage: null,
          limit: null,
          balance: null,
          resetsAt: null,
          resetInterval: null,
          details: { message: `Feature '${featureId}' not found.` },
        },
        200,
      );
    }

    // ---------------------------------------------------------------------------
    // 3 & 4. Check for Manual Overrides FIRST, then fetch Subscriptions
    // ---------------------------------------------------------------------------
    // Overrides take precedence over plan features - check them first
    const now = Date.now();
    const subsCacheKey = customer.id;

    const [entityValid, subscriptionsResult, manualEntitlement] =
      await Promise.all([
        // Validate Entity (if provided, must exist)
        entity
          ? db.query.entities.findFirst({
              where: and(
                eq(schema.entities.customerId, customer.id),
                eq(schema.entities.featureId, feature.id),
                eq(schema.entities.entityId, entity),
                or(
                  eq(schema.entities.status, "active"),
                  eq(schema.entities.status, "pending_removal"),
                ),
              ),
            })
          : true,
        // Check Subscription & Plans (cache-first, then DB)
        (async () => {
          let subs = cache
            ? await cache.getSubscriptions<
                Awaited<ReturnType<typeof db.query.subscriptions.findMany>>
              >(organizationId, subsCacheKey)
            : null;

          if (!subs) {
            subs = await db.query.subscriptions.findMany({
              where: and(
                eq(schema.subscriptions.customerId, customer.id),
                inArray(schema.subscriptions.status, [
                  "active",
                  "trialing",
                  "pending_cancel",
                ]),
              ),
              with: {
                plan: true,
              },
            });

            if (cache) {
              scheduleCacheOp(
                c,
                cache.setSubscriptions(organizationId, subsCacheKey, subs),
                "setSubscriptions(/check)",
              );
            }
          }
          return subs;
        })(),
        // Check for manual entitlement override (runs in parallel)
        getManualEntitlementForFeature(
          c,
          db,
          cache,
          organizationId,
          customer.id,
          feature.id,
          now,
        ),
      ]);

    if (entity && !entityValid) {
      return c.json(
        {
          allowed: false,
          code: "entity_not_found",
          usage: null,
          limit: null,
          balance: null,
          resetsAt: null,
          resetInterval: null,
          details: {
            message: `Entity '${entity}' not found for feature '${featureId}'. Use addEntity() to create it first.`,
          },
        },
        200,
      );
    }

    let subscriptions = subscriptionsResult;

    // Filter out expired trialing subscriptions and scheduled cancellations past their effective date
    const expiredTrialIds: string[] = [];
    const expiredCancelIds: string[] = [];
    const stalePaidPeriodIds: string[] = [];
    subscriptions = subscriptions.filter((s: any) => {
      if (s.status === "trialing") {
        const trialEnd = s.currentPeriodEnd;
        const trialEndValid =
          typeof trialEnd === "number" &&
          trialEnd > 0 &&
          trialEnd <= now + MAX_TRIAL_DURATION_MS;
        if (!trialEndValid || trialEnd < now) {
          expiredTrialIds.push(s.id);
          return false;
        }
      }
      // Scheduled cancellation past effective date — customer should lose access
      if (s.cancelAt && s.cancelAt < now && !s.canceledAt) {
        expiredCancelIds.push(s.id);
        return false;
      }
      if (
        isPaidActivePastGracePeriod(
          {
            status: s.status,
            currentPeriodEnd: s.currentPeriodEnd,
            planType: s.plan?.type,
          },
          now,
        )
      ) {
        stalePaidPeriodIds.push(s.id);
        return false;
      }
      return true;
    });
    if (expiredTrialIds.length > 0) {
      // Fire-and-forget: mark expired trials in DB
      c.executionCtx.waitUntil(
        db
          .update(schema.subscriptions)
          .set({ status: "expired", updatedAt: now })
          .where(inArray(schema.subscriptions.id, expiredTrialIds)),
      );
    }
    if (expiredCancelIds.length > 0) {
      // Fire-and-forget: mark scheduled cancellations as canceled in DB
      c.executionCtx.waitUntil(
        db
          .update(schema.subscriptions)
          .set({ status: "canceled", canceledAt: now, updatedAt: now })
          .where(inArray(schema.subscriptions.id, expiredCancelIds)),
      );
    }
    if (stalePaidPeriodIds.length > 0) {
      // Fire-and-forget: force stale paid subscriptions out of the active set
      c.executionCtx.waitUntil(
        db
          .update(schema.subscriptions)
          .set({ status: "past_due", updatedAt: now })
          .where(inArray(schema.subscriptions.id, stalePaidPeriodIds)),
      );
    }
    if (
      expiredTrialIds.length > 0 ||
      expiredCancelIds.length > 0 ||
      stalePaidPeriodIds.length > 0
    ) {
      // Invalidate cache so next request gets fresh data
      if (cache) {
        scheduleCacheOp(
          c,
          cache.invalidateSubscriptions(organizationId, subsCacheKey),
          "invalidateSubscriptions(/check)",
        );
      }
    }

    if (!subscriptions || subscriptions.length === 0) {
      return c.json(
        {
          allowed: false,
          code: "no_active_subscription",
          usage: null,
          limit: null,
          balance: null,
          resetsAt: null,
          resetInterval: null,
          details: {
            message:
              "No active or trialing subscription found for this customer.",
          },
        },
        200,
      );
    }

    // 4. Check Plan Features (cache-first, then batch DB query)
    const planIds = subscriptions.map((s: { planId: string }) => s.planId);
    const pfCacheKey = `${planIds.sort().join(",")}:${feature.id}`;
    let planFeatures = cache
      ? await cache.getPlanFeatures<
          Awaited<ReturnType<typeof db.query.planFeatures.findMany>>
        >(organizationId, pfCacheKey)
      : null;

    if (!planFeatures) {
      planFeatures = await db.query.planFeatures.findMany({
        where: and(
          inArray(schema.planFeatures.planId, planIds),
          eq(schema.planFeatures.featureId, feature.id),
        ),
      });

      if (cache) {
        scheduleCacheOp(
          c,
          cache.setPlanFeatures(organizationId, pfCacheKey, planFeatures),
          "setPlanFeatures(/check)",
        );
      }
    }

    // Find the first subscription that has a matching planFeature
    let accessGrantingSubscription: (typeof subscriptions)[number] | null =
      null;
    let accessGrantingPlanFeature: any = null;
    let creditMapping: CreditSystemMapping | null = null;

    // Check for manual override FIRST - it takes precedence over plan features
    if (manualEntitlement) {
      // Found a manual override! Use it instead of plan feature
      accessGrantingSubscription = subscriptions[0] || {
        id: "manual",
        status: "active",
        currentPeriodStart: now - 30 * 24 * 60 * 60 * 1000,
        currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1000,
        plan: { name: "Manual Override" },
      };
      accessGrantingPlanFeature = {
        ...manualEntitlement,
        planId: (accessGrantingSubscription as any).planId || "manual",
        usageModel: "included",
      };
    } else {
      // No manual override, check plan features
      for (const pf of planFeatures) {
        const sub = subscriptions.find(
          (s: { planId: string }) => s.planId === pf.planId,
        );
        if (sub) {
          accessGrantingSubscription = sub;
          accessGrantingPlanFeature = pf;
          break;
        }
      }

      // Credit system fallback: feature may belong to a credit system pool
      if (!accessGrantingSubscription || !accessGrantingPlanFeature) {
        creditMapping = await resolveCreditSystem(
          db,
          feature.id,
          planIds,
          subscriptions,
          customer.id,
          now,
        );
        if (creditMapping) {
          accessGrantingSubscription = creditMapping.subscription;
          accessGrantingPlanFeature = creditMapping.planFeature;
        }
      }
    }

    if (!accessGrantingSubscription || !accessGrantingPlanFeature) {
      return c.json(
        {
          allowed: false,
          code: "feature_not_in_plan",
          usage: null,
          limit: null,
          balance: null,
          resetsAt: null,
          resetInterval: null,
          details: {
            message: `Feature '${feature.slug || feature.id}' is not included in the customer's current plan.`,
          },
        },
        200,
      );
    }

    // Use the granting subscription/feature for the rest of the logic
    const subscription = accessGrantingSubscription;
    const planFeature = accessGrantingPlanFeature;

    // When resolved via credit system, adjust the effective values:
    // - effectiveFeatureId: track usage against the credit system's feature, not the child
    // - effectiveValue: multiply by cost (e.g., 1 unit of "dfs" = 20 credits)
    // - effectiveFeatureKey: use credit system slug for DO tracking
    const effectiveFeatureId = creditMapping
      ? creditMapping.creditSystemId
      : feature.id;
    const effectiveValue = creditMapping
      ? value * creditMapping.costPerUnit
      : value;
    const effectiveFeatureSlug = creditMapping
      ? creditMapping.creditSystemSlug
      : feature.slug || feature.id;

    // Build reusable details context
    const isTrial = subscription.status === "trialing";
    const trialEndsAt =
      isTrial && subscription.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).toISOString()
        : null;
    const planName = (subscription as any).plan?.name || "current plan";

    // Calculate effective limit considering trial status
    const effectiveLimit =
      isTrial && planFeature.trialLimitValue != null
        ? planFeature.trialLimitValue
        : planFeature.limitValue;

    // Helper to build the details object — only includes truthy optional fields
    function buildDetails(
      message: string,
      extra?: Record<string, unknown>,
      usageForPricing?: number | null,
    ) {
      const pricing = buildPricingDetails(planFeature, usageForPricing);
      return {
        message,
        planName,
        ...(isTrial ? { trial: true, trialEndsAt } : {}),
        ...(creditMapping
          ? {
              creditSystem: creditMapping.creditSystemSlug,
              creditCostPerUnit: creditMapping.costPerUnit,
            }
          : {}),
        ...(pricing ? { pricing } : {}),
        ...extra,
      };
    }

    // 5. Check Logic based on Type
    // Boolean features get immediate access UNLESS they're part of a credit system
    // (credit system children must go through the metered path to consume credits)
    if (feature.type === "boolean" && !creditMapping) {
      return c.json(
        {
          allowed: true,
          code: "access_granted",
          usage: null,
          limit: null,
          balance: null,
          resetsAt: null,
          resetInterval: null,
          details: buildDetails(
            isTrial
              ? `Feature '${feature.slug || feature.id}' enabled on ${planName} via free trial (ends ${trialEndsAt}).`
              : `Feature '${feature.slug || feature.id}' enabled on ${planName}.`,
          ),
        },
        200,
      );
    }

    if (feature.type === "metered" || creditMapping) {
      // Compute reset period once for all response paths
      const resetPeriod = getResetPeriod(
        planFeature.resetInterval,
        subscription.currentPeriodStart,
        subscription.currentPeriodEnd,
      );
      const resetsAt = new Date(resetPeriod.periodEnd).toISOString();

      // ===========================================================================
      // DO Check (Preferred for atomicity)
      // ===========================================================================
      // When credit system resolved, use the credit system slug for DO key
      // When entity is provided, scope DO feature key and DB queries by entity
      const featureKey = entity
        ? `${effectiveFeatureSlug}:${entity}`
        : effectiveFeatureSlug;

      if (c.env.USAGE_METER && organizationId) {
        const doId = c.env.USAGE_METER.idFromName(
          `${organizationId}:${customer.id}`,
        );
        const usageMeter = c.env.USAGE_METER.get(doId);
        const usageModel = getUsageModel(planFeature);

        // Pass current config inline — single RPC call, no extra round-trip
        const currentConfig = {
          limit: effectiveLimit,
          resetInterval: planFeature.resetInterval,
          resetOnEnable: planFeature.resetOnEnable || false,
          rolloverEnabled: planFeature.rolloverEnabled || false,
          rolloverMaxBalance: planFeature.rolloverMaxBalance,
          usageModel: planFeature.usageModel || "included",
          creditCost: planFeature.creditCost || 0,
        };

        let doResult = await usageMeter.check(
          featureKey,
          effectiveValue,
          currentConfig,
        );

        // If DO has no state yet (fresh/restart), migrate usage from UsageLedgerDO and configure
        if (doResult.code === "feature_not_found") {
          const { periodStart: migPeriodStart, periodEnd: migPeriodEnd } =
            resetPeriod;

          // Query UsageLedgerDO for historical usage (not D1 - DO is source of truth)
          const ledgerUsage = await sumUsageAmount(
            {
              usageLedger: c.env.USAGE_LEDGER,
              organizationId: organizationId || null,
            },
            {
              customerId: customer.id,
              featureId: effectiveFeatureId,
              entityId: entity || undefined,
              createdAtFrom: migPeriodStart,
              createdAtTo: migPeriodEnd,
            },
          );
          if (
            ledgerUsage === null &&
            hasAuthoritativeUsageLedger(c, organizationId)
          ) {
            return c.json(
              {
                allowed: false,
                code: "billing_unavailable",
                usage: null,
                limit: null,
                balance: null,
                resetsAt,
                resetInterval: planFeature.resetInterval,
                details: {
                  message:
                    "Billing ledger unavailable. Cannot safely initialize metered usage right now.",
                },
              },
              503,
            );
          }

          const currentUsage = ledgerUsage ?? 0;

          await usageMeter.configureFeature(featureKey, {
            ...currentConfig,
            initialUsage: currentUsage,
          });

          doResult = await usageMeter.check(featureKey, effectiveValue);
        }

        if (usageModel === "usage_based") {
          const usageBasedGuard = await deps.checkOverageAllowed(
            db,
            customer.id,
            effectiveFeatureId,
            resetPeriod.periodStart,
            resetPeriod.periodEnd,
            0,
            planFeature.maxOverageUnits,
            effectiveValue,
            {
              usageLedger: c.env.USAGE_LEDGER,
              organizationId: organizationId || null,
            },
          );

          if (!usageBasedGuard.allowed) {
            return c.json(
              {
                allowed: false,
                code: "limit_exceeded",
                usage: doResult.usage,
                limit: null,
                balance: null,
                resetsAt,
                resetInterval: planFeature.resetInterval,
                details: buildDetails(
                  usageBasedGuard.reason ||
                    "Usage-based billing is not allowed.",
                  undefined,
                  doResult.usage,
                ),
              },
              200,
            );
          }
        }

        if (!doResult.allowed) {
          // During trials, always block at limit — no overage billing for free trials
          const overageSetting = isTrial
            ? "block"
            : planFeature.overage || "block";

          // Add-on credits FIRST — consume purchased credits before overage billing
          if (creditMapping) {
            const addonBalance = await getAddonBalance(
              db,
              customer.id,
              creditMapping.creditSystemId,
              deps,
            );
            if (addonBalance >= effectiveValue) {
              if (sendEvent) {
                await tryDeductAddonCredits(
                  db,
                  customer.id,
                  effectiveValue,
                  creditMapping.creditSystemId,
                  deps,
                );
                scheduleUsagePersist(
                  c,
                  db,
                  organizationId,
                  {
                    customerId: customer.id,
                    ...buildUsageLedgerContext({
                      featureId: effectiveFeatureId,
                      featureSlug: effectiveFeatureSlug,
                      featureName: creditMapping
                        ? effectiveFeatureSlug
                        : (feature.name ?? effectiveFeatureSlug),
                      subscription,
                      planFeature,
                    }),
                    entityId: entity || null,
                    amount: effectiveValue,
                    periodStart: resetPeriod.periodStart,
                    periodEnd: resetPeriod.periodEnd,
                  },
                  "check:addon-fallback",
                );
              }
              const remaining = addonBalance - (sendEvent ? effectiveValue : 0);
              return c.json(
                {
                  allowed: true,
                  code: "addon_credits_used",
                  usage: doResult.usage,
                  limit: doResult.limit,
                  balance:
                    doResult.limit === null
                      ? null
                      : doResult.limit - doResult.usage,
                  resetsAt,
                  resetInterval: planFeature.resetInterval,
                  addonCredits: remaining,
                  planCredits: {
                    used: doResult.usage,
                    limit: doResult.limit,
                    resetsAt,
                  },
                  details: buildDetails(
                    `Plan credits exhausted. ${effectiveValue} add-on credits ${sendEvent ? "deducted" : "will be deducted"}.`,
                    {
                      addonCreditsUsed: effectiveValue,
                      addonCreditsRemaining: remaining,
                    },
                    doResult.usage,
                  ),
                },
                200,
              );
            }
          }

          // If overage is "charge", check guards before allowing
          if (overageSetting === "charge") {
            const overageGuard = await deps.checkOverageAllowed(
              db,
              customer.id,
              effectiveFeatureId,
              resetPeriod.periodStart,
              resetPeriod.periodEnd,
              planFeature.limitValue,
              planFeature.maxOverageUnits,
              effectiveValue,
              {
                usageLedger: c.env.USAGE_LEDGER,
                organizationId: organizationId || null,
              },
            );

            if (overageGuard.allowed) {
              return c.json(
                {
                  allowed: true,
                  code: "overage_allowed",
                  usage: doResult.usage,
                  limit: doResult.limit,
                  balance:
                    doResult.limit === null
                      ? null
                      : doResult.limit - doResult.usage,
                  resetsAt,
                  resetInterval: planFeature.resetInterval,
                  details: buildDetails(
                    `Usage exceeds limit (${doResult.usage}/${doResult.limit}), overage will be billed.`,
                    {
                      overage: {
                        type: overageSetting,
                        willBeBilled: true,
                        pricePerUnit:
                          planFeature.overagePrice || planFeature.pricePerUnit,
                        billingUnits: planFeature.billingUnits,
                      },
                    },
                    doResult.usage,
                  ),
                },
                200,
              );
            }
            // Guard failed — fall through to block
          }

          // Otherwise block
          const blockAddonCredits = creditMapping
            ? await getAddonBalance(
                db,
                customer.id,
                creditMapping.creditSystemId,
                deps,
              )
            : undefined;
          return c.json(
            {
              allowed: false,
              code: "limit_exceeded",
              usage: doResult.usage,
              limit: doResult.limit,
              balance:
                doResult.limit === null
                  ? null
                  : doResult.limit - doResult.usage,
              resetsAt,
              resetInterval: planFeature.resetInterval,
              ...(blockAddonCredits !== undefined
                ? { addonCredits: blockAddonCredits }
                : {}),
              details: buildDetails(
                `Usage limit reached (${doResult.usage}/${doResult.limit}). Resets at ${resetsAt}.`,
                undefined,
                doResult.usage,
              ),
            },
            200,
          );
        }

        // sendEvent: atomically track usage if check passed
        if (sendEvent) {
          const trackResult = await usageMeter.track(
            featureKey,
            effectiveValue,
            currentConfig,
          );
          if (trackResult && !trackResult.allowed) {
            // Add-on credit fallback for race condition (check passed but track failed)
            if (creditMapping) {
              const deductResult = await tryDeductAddonCredits(
                db,
                customer.id,
                effectiveValue,
                creditMapping.creditSystemId,
              );
              if (deductResult.deducted) {
                scheduleUsagePersist(
                  c,
                  db,
                  organizationId,
                  {
                    customerId: customer.id,
                    ...buildUsageLedgerContext({
                      featureId: effectiveFeatureId,
                      featureSlug: effectiveFeatureSlug,
                      featureName: creditMapping
                        ? effectiveFeatureSlug
                        : (feature.name ?? effectiveFeatureSlug),
                      subscription,
                      planFeature,
                    }),
                    entityId: entity || null,
                    amount: effectiveValue,
                    periodStart: resetPeriod.periodStart,
                    periodEnd: resetPeriod.periodEnd,
                  },
                  "check:track-race-addon",
                );
                return c.json(
                  {
                    allowed: true,
                    code: "addon_credits_used",
                    usage:
                      trackResult.balance !== undefined
                        ? doResult.limit !== null
                          ? doResult.limit - trackResult.balance
                          : null
                        : doResult.usage,
                    limit: doResult.limit,
                    balance:
                      doResult.limit === null
                        ? null
                        : (trackResult.balance ??
                          doResult.limit - doResult.usage),
                    resetsAt,
                    resetInterval: planFeature.resetInterval,
                    addonCredits: deductResult.remaining ?? 0,
                    planCredits: {
                      used: doResult.usage,
                      limit: doResult.limit,
                      resetsAt,
                    },
                    details: buildDetails(
                      `Plan credits exhausted. ${effectiveValue} add-on credits deducted.`,
                      {
                        addonCreditsUsed: effectiveValue,
                        addonCreditsRemaining: deductResult.remaining ?? 0,
                      },
                      doResult.usage,
                    ),
                  },
                  200,
                );
              }
            }
            return c.json(
              {
                allowed: false,
                code: "limit_exceeded",
                usage:
                  trackResult.balance !== undefined
                    ? doResult.limit !== null
                      ? doResult.limit - trackResult.balance
                      : null
                    : doResult.usage,
                limit: doResult.limit,
                balance:
                  doResult.limit === null
                    ? null
                    : (trackResult.balance ?? doResult.limit - doResult.usage),
                resetsAt,
                resetInterval: planFeature.resetInterval,
                details: buildDetails(
                  `Usage tracking denied — insufficient balance (${trackResult.balance} remaining). Resets at ${resetsAt}.`,
                  undefined,
                  doResult.usage,
                ),
              },
              200,
            );
          }
          // Also persist to DB for audit trail
          scheduleUsagePersist(
            c,
            db,
            organizationId,
            {
              customerId: customer.id,
              ...buildUsageLedgerContext({
                featureId: effectiveFeatureId,
                featureSlug: effectiveFeatureSlug,
                featureName: creditMapping
                  ? effectiveFeatureSlug
                  : (feature.name ?? effectiveFeatureSlug),
                subscription,
                planFeature,
              }),
              entityId: entity || null,
              amount: effectiveValue,
              periodStart: resetPeriod.periodStart,
              periodEnd: resetPeriod.periodEnd,
            },
            "check:track-inline",
          );

          // Deduct from credits.balance for prepaid model (not credit systems)
          if (
            !creditMapping &&
            planFeature.creditCost &&
            planFeature.creditCost > 0
          ) {
            const cost = value * planFeature.creditCost;
            c.executionCtx.waitUntil(
              db
                .update(schema.credits)
                .set({
                  balance: sql`${schema.credits.balance} - ${cost}`,
                  updatedAt: Date.now(),
                })
                .where(eq(schema.credits.customerId, customer.id)),
            );
          }
        }

        // Include add-on credit balance in response for credit system features
        const addonCreditsBalance = creditMapping
          ? await getAddonBalance(db, customer.id, creditMapping.creditSystemId)
          : undefined;

        return c.json(
          {
            allowed: true,
            code: "access_granted",
            usage: doResult.usage,
            limit: doResult.limit,
            balance: doResult.limit === null ? null : doResult.balance,
            resetsAt,
            resetInterval: planFeature.resetInterval,
            ...(doResult.rolloverBalance > 0
              ? { rolloverBalance: doResult.rolloverBalance }
              : {}),
            ...(addonCreditsBalance !== undefined
              ? { addonCredits: addonCreditsBalance }
              : {}),
            ...(creditMapping && doResult.limit !== null
              ? {
                  planCredits: {
                    used: doResult.usage,
                    limit: doResult.limit,
                    resetsAt,
                  },
                }
              : {}),
            details: buildDetails(
              usageModel === "usage_based"
                ? `Usage-based access granted for '${feature.slug || feature.id}'. Usage will be billed.`
                : doResult.limit === null
                  ? `Unlimited access to '${feature.slug || feature.id}' on ${planName}.`
                  : `Access granted — used ${doResult.usage} of ${doResult.limit}.`,
              undefined,
              doResult.usage,
            ),
          },
          200,
        );
      }
      // Calculate current usage for this period using the feature's reset interval
      const { periodStart: currentPeriodStart, periodEnd: currentPeriodEnd } =
        getResetPeriod(
          planFeature.resetInterval,
          subscription.currentPeriodStart,
          subscription.currentPeriodEnd,
        );

      // Sum usage from UsageLedgerDO (source of truth) - not D1
      const ledgerUsage = await sumUsageAmount(
        {
          usageLedger: c.env.USAGE_LEDGER,
          organizationId: organizationId || null,
        },
        {
          customerId: customer.id,
          featureId: effectiveFeatureId,
          entityId: entity || undefined,
          createdAtFrom: currentPeriodStart,
          createdAtTo: currentPeriodEnd,
        },
      );
      if (
        ledgerUsage === null &&
        hasAuthoritativeUsageLedger(c, organizationId)
      ) {
        return c.json(
          {
            allowed: false,
            code: "billing_unavailable",
            usage: null,
            limit: effectiveLimit,
            balance: null,
            resetsAt,
            resetInterval: planFeature.resetInterval,
            details: {
              message:
                "Billing ledger unavailable. Cannot safely evaluate current metered usage right now.",
            },
          },
          503,
        );
      }

      const currentUsage = ledgerUsage ?? 0;
      const usageModel = getUsageModel(planFeature);

      if (usageModel === "usage_based") {
        const usageBasedGuard = await deps.checkOverageAllowed(
          db,
          customer.id,
          effectiveFeatureId,
          currentPeriodStart,
          currentPeriodEnd,
          0,
          planFeature.maxOverageUnits,
          effectiveValue,
          {
            usageLedger: c.env.USAGE_LEDGER,
            organizationId: organizationId || null,
          },
        );

        if (!usageBasedGuard.allowed) {
          return c.json(
            {
              allowed: false,
              code: "limit_exceeded",
              usage: currentUsage,
              limit: null,
              balance: null,
              resetsAt,
              resetInterval: planFeature.resetInterval,
              details: buildDetails(
                usageBasedGuard.reason || "Usage-based billing is not allowed.",
                undefined,
                currentUsage,
              ),
            },
            200,
          );
        }

        return c.json(
          {
            allowed: true,
            code: "access_granted",
            usage: currentUsage,
            limit: null,
            balance: null,
            resetsAt,
            resetInterval: planFeature.resetInterval,
            details: buildDetails(
              `Usage-based access granted for '${feature.slug || feature.id}'. Usage will be billed.`,
              undefined,
              currentUsage,
            ),
          },
          200,
        );
      }

      // Check Usage Limit
      // If limitValue is null, it's unlimited
      if (effectiveLimit === null) {
        return c.json(
          {
            allowed: true,
            code: "access_granted",
            usage: currentUsage,
            limit: null,
            balance: null,
            resetsAt,
            resetInterval: planFeature.resetInterval,
            details: buildDetails(
              `Unlimited access to '${feature.slug || feature.id}' on ${planName}.`,
              undefined,
              currentUsage,
            ),
          },
          200,
        );
      }

      if (currentUsage + effectiveValue > effectiveLimit) {
        // During trials, always block at limit — no overage billing for free trials
        const overageSetting = isTrial
          ? "block"
          : planFeature.overage || "block";

        // Add-on credits FIRST — consume purchased credits before overage billing
        if (creditMapping) {
          const addonBalance = await getAddonBalance(
            db,
            customer.id,
            creditMapping.creditSystemId,
            deps,
          );
          if (addonBalance >= effectiveValue) {
            return c.json(
              {
                allowed: true,
                code: "addon_credits_used",
                usage: currentUsage,
                limit: effectiveLimit,
                balance: effectiveLimit - currentUsage,
                resetsAt,
                resetInterval: planFeature.resetInterval,
                addonCredits: addonBalance,
                planCredits: {
                  used: currentUsage,
                  limit: effectiveLimit,
                  resetsAt,
                },
                details: buildDetails(
                  `Plan credits exhausted. ${effectiveValue} add-on credits will be deducted.`,
                  {
                    addonCreditsUsed: effectiveValue,
                    addonCreditsRemaining: addonBalance,
                  },
                  currentUsage,
                ),
              },
              200,
            );
          }
        }

        // If overage is "charge", check guards before allowing
        if (overageSetting === "charge") {
          const overageGuard = await deps.checkOverageAllowed(
            db,
            customer.id,
            effectiveFeatureId,
            currentPeriodStart,
            currentPeriodEnd,
            planFeature.limitValue,
            planFeature.maxOverageUnits,
            effectiveValue,
            {
              usageLedger: c.env.USAGE_LEDGER,
              organizationId: organizationId || null,
            },
          );

          if (overageGuard.allowed) {
            return c.json(
              {
                allowed: true,
                code: "overage_allowed",
                usage: currentUsage,
                limit: effectiveLimit,
                balance: effectiveLimit - currentUsage,
                resetsAt,
                resetInterval: planFeature.resetInterval,
                details: buildDetails(
                  `Usage exceeds limit (${currentUsage}/${planFeature.limitValue}), overage will be billed.`,
                  {
                    overage: {
                      type: overageSetting,
                      willBeBilled: true,
                      pricePerUnit:
                        planFeature.overagePrice || planFeature.pricePerUnit,
                      billingUnits: planFeature.billingUnits,
                    },
                  },
                  currentUsage,
                ),
              },
              200,
            );
          }
          // Guard failed — fall through to block
        }

        // Block — unified path
        const dbBlockAddonCredits = creditMapping
          ? await getAddonBalance(db, customer.id, creditMapping.creditSystemId)
          : undefined;
        return c.json(
          {
            allowed: false,
            code: "limit_exceeded",
            usage: currentUsage,
            limit: effectiveLimit,
            balance: effectiveLimit - currentUsage,
            resetsAt,
            resetInterval: planFeature.resetInterval,
            ...(dbBlockAddonCredits !== undefined
              ? { addonCredits: dbBlockAddonCredits }
              : {}),
            details: buildDetails(
              `Usage limit exceeded (${currentUsage}/${planFeature.limitValue}). Resets at ${resetsAt}.`,
              undefined,
              currentUsage,
            ),
          },
          200,
        );
      }

      // If it costs credits (prepaid balance model), check balance.
      // NOTE: Credit systems do NOT use credits.balance — they enforce via usage_records pool.
      // Only planFeature.creditCost triggers the prepaid balance check.
      if (
        !creditMapping &&
        planFeature.creditCost &&
        planFeature.creditCost > 0
      ) {
        const cost = value * planFeature.creditCost;
        const creditRecord = await db.query.credits.findFirst({
          where: eq(schema.credits.customerId, customer.id),
        });
        const creditBalance = creditRecord?.balance || 0;

        if (creditBalance < cost) {
          return c.json(
            {
              allowed: false,
              code: "insufficient_credits",
              usage: currentUsage,
              limit: effectiveLimit,
              balance: effectiveLimit - currentUsage,
              resetsAt,
              resetInterval: planFeature.resetInterval,
              details: buildDetails(
                `Insufficient credits — balance: ${creditBalance}, required: ${cost}.`,
                undefined,
                currentUsage,
              ),
            },
            200,
          );
        }
      }

      // sendEvent: track usage inline (DB-only path, no DO)
      if (sendEvent) {
        scheduleUsagePersist(
          c,
          db,
          organizationId,
          {
            customerId: customer.id,
            ...buildUsageLedgerContext({
              featureId: effectiveFeatureId,
              featureSlug: effectiveFeatureSlug,
              featureName: creditMapping
                ? effectiveFeatureSlug
                : (feature.name ?? effectiveFeatureSlug),
              subscription,
              planFeature,
            }),
            entityId: entity || null,
            amount: effectiveValue,
            periodStart: currentPeriodStart,
            periodEnd: currentPeriodEnd,
          },
          "check:track-inline-db-only",
        );

        // Deduct from credits.balance for prepaid model (not credit systems)
        if (
          !creditMapping &&
          planFeature.creditCost &&
          planFeature.creditCost > 0
        ) {
          const cost = value * planFeature.creditCost;
          await db
            .update(schema.credits)
            .set({
              balance: sql`${schema.credits.balance} - ${cost}`,
              updatedAt: Date.now(),
            })
            .where(eq(schema.credits.customerId, customer.id));
        }
      }

      return c.json(
        {
          allowed: true,
          code: "access_granted",
          usage: currentUsage,
          limit: effectiveLimit,
          balance: effectiveLimit - currentUsage,
          resetsAt,
          resetInterval: planFeature.resetInterval,
          details: buildDetails(
            `Access granted — used ${currentUsage} of ${planFeature.limitValue}.`,
            undefined,
            currentUsage,
          ),
        },
        200,
      );
    }

    return c.json(
      {
        allowed: false,
        code: "unknown_feature_type",
        usage: null,
        limit: null,
        balance: null,
        resetsAt: null,
        resetInterval: null,
        details: { message: `Unrecognized feature type '${feature.type}'.` },
      },
      200,
    );
  },
  (result, c) => {
    if (!result.success) {
      return c.json(zodErrorToResponse(result.error), 400);
    }

    return undefined;
  },
);

// Track Usage
app.openapi(
  trackRoute,
  async (c) => {
    const deps = getEntitlementsDependencies(c);
    const {
      customer: customerId,
      feature: featureId,
      value,
      customerData,
      entity,
    } = c.req.valid("json");
    const db = c.get("db");
    const organizationId = c.get("organizationId");
    const cache = c.env.CACHE ? new EntitlementCache(c.env.CACHE) : null;
    const now = Date.now();

    if (!organizationId) {
      return c.json(
        { success: false, error: "Organization Context Missing" },
        500,
      );
    }

    // 1 & 2. Resolve Customer and Feature in parallel
    let trackCustomer;
    let trackFeatureResult;
    try {
      [trackCustomer, trackFeatureResult] = await Promise.all([
        deps.resolveOrCreateCustomer({
          db,
          organizationId,
          customerId,
          customerData,
          cache,
          waitUntil: (p) => c.executionCtx.waitUntil(p),
        }),
        (async () => {
          let f = cache
            ? await cache.getFeature<typeof schema.features.$inferSelect>(
                organizationId,
                featureId,
              )
            : null;

          if (!f) {
            f =
              (await db.query.features.findFirst({
                where: and(
                  eq(schema.features.organizationId, organizationId),
                  or(
                    eq(schema.features.id, featureId),
                    eq(schema.features.slug, featureId),
                  ),
                ),
              })) ?? null;

            if (f && cache) {
              const featureCacheKeys = [featureId, f.id, f.slug].filter(
                (key): key is string => !!key && key.length > 0,
              );
              const uniqueFeatureCacheKeys = [...new Set(featureCacheKeys)];
              scheduleCacheOp(
                c,
                Promise.all(
                  uniqueFeatureCacheKeys.map((key) =>
                    cache.setFeature(organizationId, key, f),
                  ),
                ),
                "setFeature(/track)",
              );
            }
          }
          return f;
        })(),
      ]);
    } catch (error) {
      if (isCustomerResolutionConflictError(error)) {
        return c.json(
          {
            success: false,
            allowed: false,
            code: "customer_ambiguous",
            usage: null,
            limit: null,
            balance: null,
            resetsAt: null,
            resetInterval: null,
            details: {
              message: error.message,
            },
          },
          409,
        );
      }
      throw error;
    }

    const customer = trackCustomer;

    if (!customer) {
      return c.json(
        {
          success: false,
          allowed: false,
          code: "customer_not_found",
          usage: null,
          limit: null,
          balance: null,
          resetsAt: null,
          resetInterval: null,
          details: {
            message: `Customer '${customerId}' not found in this organization.`,
          },
        },
        404,
      );
    }

    const feature = trackFeatureResult;

    if (!feature) {
      return c.json(
        {
          success: false,
          allowed: false,
          code: "feature_not_found",
          usage: null,
          limit: null,
          balance: null,
          resetsAt: null,
          resetInterval: null,
          details: { message: `Feature '${featureId}' not found.` },
        },
        404,
      );
    }

    // 3 & 4. Validate Entity and fetch Subscriptions in parallel
    const subsCacheKey = customer.id;
    const [trackEntityValid, trackSubsResult] = await Promise.all([
      entity
        ? db.query.entities.findFirst({
            where: and(
              eq(schema.entities.customerId, customer.id),
              eq(schema.entities.featureId, feature.id),
              eq(schema.entities.entityId, entity),
              eq(schema.entities.status, "active"),
            ),
          })
        : true,
      (async () => {
        let subs = cache
          ? await cache.getSubscriptions<
              Awaited<ReturnType<typeof db.query.subscriptions.findMany>>
            >(organizationId, subsCacheKey)
          : null;

        if (!subs) {
          subs = await db.query.subscriptions.findMany({
            where: and(
              eq(schema.subscriptions.customerId, customer.id),
              inArray(schema.subscriptions.status, [
                "active",
                "trialing",
                "pending_cancel",
              ]),
            ),
            with: {
              plan: true,
            },
          });

          if (cache) {
            scheduleCacheOp(
              c,
              cache.setSubscriptions(organizationId, subsCacheKey, subs),
              "setSubscriptions(/track)",
            );
          }
        }
        return subs;
      })(),
    ]);

    if (entity && !trackEntityValid) {
      return c.json(
        {
          success: false,
          allowed: false,
          code: "entity_not_found",
          usage: null,
          limit: null,
          balance: null,
          resetsAt: null,
          resetInterval: null,
          details: {
            message: `Entity '${entity}' not found for feature '${featureId}'. Use addEntity() to create it first.`,
          },
        },
        404,
      );
    }

    let subscriptions = trackSubsResult;

    // Filter out expired trialing subscriptions and scheduled cancellations past their effective date
    const trackNow = Date.now();
    const trackExpiredTrialIds: string[] = [];
    const trackExpiredCancelIds: string[] = [];
    const trackStalePaidPeriodIds: string[] = [];
    subscriptions = subscriptions.filter((s: any) => {
      if (s.status === "trialing") {
        const trialEnd = s.currentPeriodEnd;
        const trialEndValid =
          typeof trialEnd === "number" &&
          trialEnd > 0 &&
          trialEnd <= trackNow + MAX_TRIAL_DURATION_MS;
        if (!trialEndValid || trialEnd < trackNow) {
          trackExpiredTrialIds.push(s.id);
          return false;
        }
      }
      if (s.cancelAt && s.cancelAt < trackNow && !s.canceledAt) {
        trackExpiredCancelIds.push(s.id);
        return false;
      }
      if (
        isPaidActivePastGracePeriod(
          {
            status: s.status,
            currentPeriodEnd: s.currentPeriodEnd,
            planType: s.plan?.type,
          },
          trackNow,
        )
      ) {
        trackStalePaidPeriodIds.push(s.id);
        return false;
      }
      return true;
    });
    if (trackExpiredTrialIds.length > 0) {
      c.executionCtx.waitUntil(
        db
          .update(schema.subscriptions)
          .set({ status: "expired", updatedAt: trackNow })
          .where(inArray(schema.subscriptions.id, trackExpiredTrialIds)),
      );
    }
    if (trackExpiredCancelIds.length > 0) {
      c.executionCtx.waitUntil(
        db
          .update(schema.subscriptions)
          .set({
            status: "canceled",
            canceledAt: trackNow,
            updatedAt: trackNow,
          })
          .where(inArray(schema.subscriptions.id, trackExpiredCancelIds)),
      );
    }
    if (trackStalePaidPeriodIds.length > 0) {
      c.executionCtx.waitUntil(
        db
          .update(schema.subscriptions)
          .set({ status: "past_due", updatedAt: trackNow })
          .where(inArray(schema.subscriptions.id, trackStalePaidPeriodIds)),
      );
    }
    if (
      trackExpiredTrialIds.length > 0 ||
      trackExpiredCancelIds.length > 0 ||
      trackStalePaidPeriodIds.length > 0
    ) {
      if (cache) {
        scheduleCacheOp(
          c,
          cache.invalidateSubscriptions(organizationId, subsCacheKey),
          "invalidateSubscriptions(/track)",
        );
      }
    }

    if (subscriptions.length === 0) {
      return c.json(
        {
          success: false,
          allowed: false,
          code: "no_active_subscription",
          usage: null,
          limit: null,
          balance: null,
          resetsAt: null,
          resetInterval: null,
          details: {
            message:
              "No active or trialing subscription found for this customer.",
          },
        },
        400,
      );
    }

    // 4. Find planFeatures (cache-first, then batch DB query)
    const planIds = subscriptions.map((s: { planId: string }) => s.planId);
    const pfCacheKey = `${planIds.sort().join(",")}:${feature.id}`;
    let planFeatures = cache
      ? await cache.getPlanFeatures<
          Awaited<ReturnType<typeof db.query.planFeatures.findMany>>
        >(organizationId, pfCacheKey)
      : null;

    if (!planFeatures) {
      planFeatures = await db.query.planFeatures.findMany({
        where: and(
          inArray(schema.planFeatures.planId, planIds),
          eq(schema.planFeatures.featureId, feature.id),
        ),
      });

      if (cache) {
        scheduleCacheOp(
          c,
          cache.setPlanFeatures(organizationId, pfCacheKey, planFeatures),
          "setPlanFeatures(/track)",
        );
      }
    }

    let accessGrantingSubscription: (typeof subscriptions)[number] | null =
      null;
    let accessGrantingPlanFeature: (typeof planFeatures)[number] | null = null;
    let trackCreditMapping: CreditSystemMapping | null = null;

    for (const pf of planFeatures) {
      const sub = subscriptions.find(
        (s: { planId: string }) => s.planId === pf.planId,
      );
      if (sub) {
        accessGrantingSubscription = sub;
        accessGrantingPlanFeature = pf;
        break;
      }
    }

    // Credit system fallback
    if (!accessGrantingSubscription || !accessGrantingPlanFeature) {
      trackCreditMapping = await resolveCreditSystem(
        db,
        feature.id,
        planIds,
        subscriptions,
        customer.id,
        now,
      );
      if (trackCreditMapping) {
        accessGrantingSubscription = trackCreditMapping.subscription;
        accessGrantingPlanFeature = trackCreditMapping.planFeature;
      }
    }

    const subscription = accessGrantingSubscription;
    const planFeature = accessGrantingPlanFeature;

    if (!subscription || !planFeature) {
      return c.json(
        {
          success: false,
          allowed: false,
          code: "feature_not_in_plan",
          usage: null,
          limit: null,
          balance: null,
          resetsAt: null,
          resetInterval: null,
          details: {
            message: `Feature '${feature.slug || feature.id}' is not included in the customer's current plan.`,
          },
        },
        400,
      );
    }

    // Credit system effective values
    const trackEffectiveFeatureId = trackCreditMapping
      ? trackCreditMapping.creditSystemId
      : feature.id;
    const trackEffectiveValue = trackCreditMapping
      ? value * trackCreditMapping.costPerUnit
      : value;
    const trackEffectiveSlug = trackCreditMapping
      ? trackCreditMapping.creditSystemSlug
      : feature.slug || feature.id;

    // Build reusable details context for track responses
    const isTrial = subscription.status === "trialing";
    const trialEndsAt =
      isTrial && subscription.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).toISOString()
        : null;

    const trackPlanName = (subscription as any).plan?.name || "current plan";

    // Calculate effective limit considering trial status
    const effectiveLimit =
      isTrial && planFeature.trialLimitValue != null
        ? planFeature.trialLimitValue
        : planFeature.limitValue;

    function buildTrackDetails(
      message: string,
      extra?: Record<string, unknown>,
      usageForPricing?: number | null,
    ) {
      const pricing = buildPricingDetails(planFeature, usageForPricing);
      return {
        message,
        planName: trackPlanName,
        ...(isTrial ? { trial: true, trialEndsAt } : {}),
        ...(trackCreditMapping
          ? {
              creditSystem: trackCreditMapping.creditSystemSlug,
              creditCostPerUnit: trackCreditMapping.costPerUnit,
            }
          : {}),
        ...(pricing ? { pricing } : {}),
        ...extra,
      };
    }

    // Use the feature's resetInterval to determine the correct usage period
    const { periodStart, periodEnd } = getResetPeriod(
      planFeature.resetInterval,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
    );
    const usageModel = getUsageModel(planFeature);

    try {
      // ===========================================================================
      // Use Durable Object for atomic real-time tracking (if available)
      // ===========================================================================
      let doResult: {
        allowed: boolean;
        balance: number;
        usage: number;
        limit: number | null;
        code: string;
        rolloverBalance: number;
      } | null = null;
      let trackedAsOverage = false;

      // When credit system resolved, use credit system slug for DO key
      // When entity is provided, scope DO feature key and DB queries by entity
      const trackFeatureKey = entity
        ? `${trackEffectiveSlug}:${entity}`
        : trackEffectiveSlug;

      if (c.env.USAGE_METER && planFeature) {
        // Get customer's DO instance by their ID (scoped to org)
        const doId = c.env.USAGE_METER.idFromName(
          `${organizationId}:${customer.id}`,
        );

        const usageMeter = c.env.USAGE_METER.get(doId);

        // Pass current config inline — single RPC call, no extra round-trip
        const currentConfig = {
          limit: effectiveLimit,
          resetInterval: planFeature.resetInterval,
          resetOnEnable: planFeature.resetOnEnable || false,
          rolloverEnabled: planFeature.rolloverEnabled || false,
          rolloverMaxBalance: planFeature.rolloverMaxBalance,
          usageModel: planFeature.usageModel || "included",
          creditCost: planFeature.creditCost || 0,
        };

        if (usageModel === "usage_based") {
          const usageBasedGuard = await deps.checkOverageAllowed(
            db,
            customer.id,
            trackEffectiveFeatureId,
            periodStart,
            periodEnd,
            0,
            planFeature.maxOverageUnits,
            trackEffectiveValue,
            {
              usageLedger: c.env.USAGE_LEDGER,
              organizationId: organizationId || null,
            },
          );

          if (!usageBasedGuard.allowed) {
            return c.json(
              {
                success: false,
                allowed: false,
                code: "limit_exceeded",
                usage: null,
                limit: null,
                balance: null,
                resetsAt: new Date(periodEnd).toISOString(),
                resetInterval: planFeature.resetInterval,
                details: buildTrackDetails(
                  usageBasedGuard.reason ||
                    "Usage-based billing is not allowed.",
                ),
              },
              200,
            );
          }
        }

        // Track usage atomically via RPC (config synced inline)
        doResult = await usageMeter.track(
          trackFeatureKey,
          trackEffectiveValue,
          currentConfig,
        );
        if (!doResult) {
          throw new Error("Usage meter returned no result");
        }

        // If DO has no state yet (fresh/restart), migrate usage from UsageLedgerDO and configure
        if (doResult.code === "feature_not_found") {
          // Query UsageLedgerDO for historical usage (source of truth)
          const ledgerUsage = await sumUsageAmount(
            {
              usageLedger: c.env.USAGE_LEDGER,
              organizationId: organizationId || null,
            },
            {
              customerId: customer.id,
              featureId: trackEffectiveFeatureId,
              entityId: entity || undefined,
              createdAtFrom: periodStart,
              createdAtTo: periodEnd,
            },
          );
          if (
            ledgerUsage === null &&
            hasAuthoritativeUsageLedger(c, organizationId)
          ) {
            return c.json(
              {
                success: false,
                allowed: false,
                code: "billing_unavailable",
                usage: null,
                limit: effectiveLimit,
                balance: null,
                resetsAt: new Date(periodEnd).toISOString(),
                resetInterval: planFeature.resetInterval,
                details: buildTrackDetails(
                  "Billing ledger unavailable. Cannot safely initialize tracked usage right now.",
                ),
              },
              503,
            );
          }

          const currentUsage = ledgerUsage ?? 0;

          await usageMeter.configureFeature(trackFeatureKey, {
            ...currentConfig,
            initialUsage: currentUsage,
          });

          doResult = await usageMeter.track(
            trackFeatureKey,
            trackEffectiveValue,
          );
        }

        // If DO says not allowed, try addon credits first, then overage
        if (doResult && !doResult.allowed) {
          // During trials, always block at limit — no overage billing for free trials
          const overageSetting = isTrial
            ? "block"
            : planFeature.overage || "block";

          // Add-on credits FIRST — consume purchased credits before overage billing
          if (trackCreditMapping) {
            const deductResult = await tryDeductAddonCredits(
              db,
              customer.id,
              trackEffectiveValue,
              trackCreditMapping.creditSystemId,
              deps,
            );
            if (deductResult.deducted) {
              scheduleUsagePersist(
                c,
                db,
                organizationId,
                {
                  customerId: customer.id,
                  ...buildUsageLedgerContext({
                    featureId: trackEffectiveFeatureId,
                    featureSlug: trackEffectiveSlug,
                    featureName: trackCreditMapping
                      ? trackEffectiveSlug
                      : (feature.name ?? trackEffectiveSlug),
                    subscription,
                    planFeature,
                  }),
                  entityId: entity || null,
                  amount: trackEffectiveValue,
                  periodStart,
                  periodEnd,
                },
                "track:addon-fallback",
              );
              const addonDoUsage = doResult.usage ?? null;
              return c.json(
                {
                  success: true,
                  allowed: true,
                  code: "addon_credits_used",
                  usage: addonDoUsage,
                  limit: effectiveLimit,
                  balance: doResult.balance,
                  resetsAt: new Date(periodEnd).toISOString(),
                  resetInterval: planFeature.resetInterval,
                  ...(doResult.rolloverBalance > 0
                    ? { rolloverBalance: doResult.rolloverBalance }
                    : {}),
                  addonCredits: deductResult.remaining ?? 0,
                  planCredits: {
                    used: addonDoUsage ?? 0,
                    limit: effectiveLimit,
                    resetsAt: new Date(periodEnd).toISOString(),
                  },
                  details: buildTrackDetails(
                    `Plan credits exhausted. ${trackEffectiveValue} add-on credits deducted.`,
                    {
                      addonCreditsUsed: trackEffectiveValue,
                      addonCreditsRemaining: deductResult.remaining ?? 0,
                    },
                    addonDoUsage,
                  ),
                },
                200,
              );
            }
          }

          // If overage is "charge", check guards before allowing
          if (overageSetting === "charge") {
            const includedBalanceBeforeOverage = Math.max(
              0,
              Math.min(trackEffectiveValue, Number(doResult.balance || 0)),
            );
            const requestedOverageUnits = Math.max(
              0,
              trackEffectiveValue - includedBalanceBeforeOverage,
            );

            const overageGuard = await deps.checkOverageAllowed(
              db,
              customer.id,
              trackEffectiveFeatureId,
              periodStart,
              periodEnd,
              planFeature.limitValue,
              planFeature.maxOverageUnits,
              requestedOverageUnits,
              {
                usageLedger: c.env.USAGE_LEDGER,
                organizationId: organizationId || null,
              },
            );

            if (!overageGuard.allowed) {
              const guardUsage = doResult.usage ?? null;
              return c.json(
                {
                  success: false,
                  allowed: false,
                  code: "limit_exceeded",
                  usage: guardUsage,
                  limit: effectiveLimit,
                  balance: doResult.balance,
                  resetsAt: new Date(periodEnd).toISOString(),
                  resetInterval: planFeature.resetInterval,
                  ...(doResult.rolloverBalance > 0
                    ? { rolloverBalance: doResult.rolloverBalance }
                    : {}),
                  details: buildTrackDetails(
                    overageGuard.reason ||
                      `Overage not allowed. ${requestedOverageUnits} overage units requested.`,
                    undefined,
                    guardUsage,
                  ),
                },
                200,
              );
            }

            trackedAsOverage = true;

            // Guard passed: consume any remaining included/rollover balance first.
            if (includedBalanceBeforeOverage > 0) {
              const consumeIncludedResult = await usageMeter.track(
                trackFeatureKey,
                includedBalanceBeforeOverage,
                currentConfig,
              );

              if (consumeIncludedResult.allowed) {
                doResult = consumeIncludedResult;
              } else {
                // If balance changed concurrently, re-check guard for full request as overage.
                const raceOverageGuard = await deps.checkOverageAllowed(
                  db,
                  customer.id,
                  trackEffectiveFeatureId,
                  periodStart,
                  periodEnd,
                  planFeature.limitValue,
                  planFeature.maxOverageUnits,
                  trackEffectiveValue,
                  {
                    usageLedger: c.env.USAGE_LEDGER,
                    organizationId: organizationId || null,
                  },
                );

                if (!raceOverageGuard.allowed) {
                  return c.json(
                    {
                      success: false,
                      allowed: false,
                      code: "limit_exceeded",
                      usage: doResult.usage ?? null,
                      limit: effectiveLimit,
                      balance: doResult.balance,
                      resetsAt: new Date(periodEnd).toISOString(),
                      resetInterval: planFeature.resetInterval,
                      ...(doResult.rolloverBalance > 0
                        ? { rolloverBalance: doResult.rolloverBalance }
                        : {}),
                      details: buildTrackDetails(
                        raceOverageGuard.reason ||
                          `Overage not allowed. ${trackEffectiveValue} overage units requested.`,
                        undefined,
                        doResult.usage ?? null,
                      ),
                    },
                    200,
                  );
                }
              }
            }
            // Continue to persist full usage record below.
          } else {
            // overage is "block" and addon credits insufficient — block
            const blockUsage = doResult.usage ?? null;
            const trackBlockAddonCredits = trackCreditMapping
              ? await getAddonBalance(
                  db,
                  customer.id,
                  trackCreditMapping.creditSystemId,
                  deps,
                )
              : undefined;
            return c.json(
              {
                success: false,
                allowed: false,
                code: "limit_exceeded",
                usage: blockUsage,
                limit: effectiveLimit,
                balance: doResult.balance,
                resetsAt: new Date(periodEnd).toISOString(),
                resetInterval: planFeature.resetInterval,
                ...(doResult.rolloverBalance > 0
                  ? { rolloverBalance: doResult.rolloverBalance }
                  : {}),
                ...(trackBlockAddonCredits !== undefined
                  ? { addonCredits: trackBlockAddonCredits }
                  : {}),
                details: buildTrackDetails(
                  `Usage tracking denied — limit reached (${doResult.balance} remaining). Resets at ${new Date(periodEnd).toISOString()}.`,
                  undefined,
                  blockUsage,
                ),
              },
              200,
            );
          }
        }
      }

      if (usageModel === "usage_based" && !doResult) {
        const usageBasedGuard = await deps.checkOverageAllowed(
          db,
          customer.id,
          trackEffectiveFeatureId,
          periodStart,
          periodEnd,
          0,
          planFeature.maxOverageUnits,
          trackEffectiveValue,
          {
            usageLedger: c.env.USAGE_LEDGER,
            organizationId: organizationId || null,
          },
        );

        if (!usageBasedGuard.allowed) {
          return c.json(
            {
              success: false,
              allowed: false,
              code: "limit_exceeded",
              usage: null,
              limit: null,
              balance: null,
              resetsAt: new Date(periodEnd).toISOString(),
              resetInterval: planFeature.resetInterval,
              details: buildTrackDetails(
                usageBasedGuard.reason || "Usage-based billing is not allowed.",
              ),
            },
            200,
          );
        }
      }

      // ===========================================================================
      // Persist to DB asynchronously (for audit trail and backup)
      // Using waitUntil to avoid blocking the response
      // ===========================================================================
      const usagePersistPromise = scheduleUsagePersist(
        c,
        db,
        organizationId,
        {
          customerId: customer.id,
          ...buildUsageLedgerContext({
            featureId: trackEffectiveFeatureId,
            featureSlug: trackEffectiveSlug,
            featureName: trackCreditMapping
              ? trackEffectiveSlug
              : (feature.name ?? trackEffectiveSlug),
            subscription,
            planFeature,
          }),
          entityId: entity || null,
          amount: trackEffectiveValue,
          periodStart,
          periodEnd,
        },
        "track:main",
      );

      // Deduct Credits if applicable (prepaid balance model)
      // NOTE: Credit systems do NOT use credits.balance — they enforce via usage_records pool.
      // This runs regardless of DO availability — credits.balance is a separate DB counter.
      if (
        subscription &&
        !trackCreditMapping &&
        planFeature.creditCost &&
        planFeature.creditCost > 0
      ) {
        const cost = value * planFeature.creditCost;
        c.executionCtx.waitUntil(
          db
            .update(schema.credits)
            .set({
              balance: sql`${schema.credits.balance} - ${cost}`,
              updatedAt: Date.now(),
            })
            .where(eq(schema.credits.customerId, customer.id)),
        );
      }

      // Determine if this was an overage usage
      const isOverage =
        trackedAsOverage ||
        !!(doResult && !doResult.allowed && planFeature.overage === "charge");

      const isChargeableUsage = isOverage || usageModel === "usage_based";

      // Threshold trigger: if this usage is chargeable, check if unbilled amount crosses org threshold
      if (isChargeableUsage && organizationId) {
        c.executionCtx.waitUntil(
          usagePersistPromise.then(async () => {
            try {
              await evaluateThresholdBillingCandidate({
                db,
                organizationId,
                customerId: customer.id,
                usageLedger: c.env.USAGE_LEDGER,
                workflow: c.env.OVERAGE_BILLING_WORKFLOW,
              });
            } catch (e) {
              console.error("[track] Threshold check failed:", e);
            }
          }),
        );
      }

      const successUsage = doResult ? doResult.usage : null;

      return c.json(
        {
          success: true,
          allowed: true,
          code: isOverage ? "tracked_overage" : "tracked",
          usage: successUsage,
          limit: effectiveLimit,
          balance: doResult?.balance ?? null,
          resetsAt: new Date(periodEnd).toISOString(),
          resetInterval: planFeature.resetInterval,
          ...(doResult && doResult.rolloverBalance > 0
            ? { rolloverBalance: doResult.rolloverBalance }
            : {}),
          details: isOverage
            ? buildTrackDetails(
                `Usage tracked as overage (will be billed).`,
                {
                  overage: { type: planFeature.overage, willBeBilled: true },
                },
                successUsage,
              )
            : usageModel === "usage_based"
              ? buildTrackDetails(
                  `Usage tracked successfully. This usage is billable.`,
                  undefined,
                  successUsage,
                )
              : buildTrackDetails(
                  `Usage tracked successfully (${doResult?.balance ?? "n/a"} remaining).`,
                  undefined,
                  successUsage,
                ),
        },
        200,
      );
    } catch (e: any) {
      console.error("Track failed:", e);
      return c.json(
        {
          success: false,
          allowed: false,
          code: "internal_error",
          usage: null,
          limit: null,
          balance: null,
          resetsAt: null,
          resetInterval: null,
          details: {
            message: "An internal error occurred while tracking usage.",
          },
        },
        500,
      );
    }
  },
  (result, c) => {
    if (!result.success) {
      return c.json(zodErrorToResponse(result.error), 400);
    }

    return undefined;
  },
);

export default app;
