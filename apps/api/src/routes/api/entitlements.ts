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
import { appendUsageRecord } from "../../lib/usage-ledger";
import {
  getActiveManualBonusEntitlement,
  resolveManualBonusBalanceState,
} from "../../lib/manual-bonus-balances";
import {
  checkOverageAllowed,
  getOrgOverageSettings,
  getUnbilledOverageAmount,
} from "../../lib/overage-guards";
import { sumScopedUsageAmount } from "../../lib/scoped-usage";
import { evaluateThresholdBillingCandidate } from "../../lib/threshold-billing";
import { isPaidActivePastGracePeriod } from "../../lib/subscription-health";
import {
  getCurrentPricingTier,
  normalizeRatingModel,
} from "../../lib/usage-rating";
import { buildUsagePricingSnapshot } from "../../lib/usage-pricing-snapshot";
import type { UsageCoverageSource } from "../../lib/usage-coverage";
import {
  resolveLegacyUsageLedgerScope,
  resolveUsageLedgerScope,
  resolveUsagePlanScope,
  shouldResetUsageOnPlanEnable,
} from "../../lib/usage-scope";
import {
  MAX_TRIAL_DURATION_MS,
  selectAccessGrantingPlanFeature,
} from "../../lib/customer-access";
import { isCustomerResolutionConflictError } from "../../lib/customer-resolution";
import {
  applyCustomerFeatureBillingOverride,
  resolveCustomerFeatureBillingOverride,
} from "../../lib/customer-billing-config";
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
  coverageSource?: UsageCoverageSource;
  coverageReferenceId?: string | null;
  pricingSnapshot?: ReturnType<typeof buildUsagePricingSnapshot> | null;
}) {
  return {
    featureId: params.featureId,
    featureSlug: params.featureSlug ?? null,
    featureName: params.featureName ?? null,
    subscriptionId: params.subscription?.id ?? null,
    planId: params.subscription?.planId ?? null,
    coverageSource: params.coverageSource ?? "plan",
    coverageReferenceId: params.coverageReferenceId ?? null,
    pricingSnapshot:
      params.pricingSnapshot !== undefined
        ? params.pricingSnapshot
        : params.planFeature
          ? buildUsagePricingSnapshot(params.planFeature)
          : null,
  };
}

interface CreditRuntimeContext {
  creditSystemId: string;
  creditSystemSlug: string;
  costPerUnit: number;
  trackingFeatureId: string;
  trackingFeatureSlug: string;
}

type CreditPlanBalancePayload = {
  used: number;
  limit: number | null;
  balance: number | null;
  resetsAt: string;
};

type CreditsPayload =
  | {
      source: "credit_system";
      systemSlug: string;
      costPerUnit: number;
      bonusBalance: number;
      addonBalance: number;
      totalBalance: number | null;
      plan: CreditPlanBalancePayload;
    }
  | {
      source: "feature";
      bonusBalance: number;
      addonBalance: null;
      totalBalance: number | null;
      plan: CreditPlanBalancePayload;
    }
  | {
      source: "prepaid";
      bonusBalance: number;
      addonBalance: null;
      totalBalance: number | null;
      plan: CreditPlanBalancePayload;
    }
  | null;

function computeTotalAvailableBalance(
  planBalance: number | null,
  bonusBalance: number = 0,
  addonBalance: number = 0,
): number | null {
  if (planBalance === null) {
    return null;
  }

  return Math.max(0, planBalance) + Math.max(0, bonusBalance) + Math.max(0, addonBalance);
}

function computeRemainingAddonBalance(
  startingBalance: number,
  deductedAmount: number,
  reportedRemaining?: number,
): number {
  const expectedRemaining = Math.max(0, startingBalance - deductedAmount);
  if (typeof reportedRemaining !== "number" || !Number.isFinite(reportedRemaining)) {
    return expectedRemaining;
  }

  return Math.min(Math.max(0, reportedRemaining), expectedRemaining);
}

function buildCreditPlanBalance(
  used: number | null,
  limit: number | null,
  resetsAt: string,
): CreditPlanBalancePayload {
  const normalizedUsed = used ?? 0;
  return {
    used: normalizedUsed,
    limit,
    balance: limit === null ? null : Math.max(0, limit - normalizedUsed),
    resetsAt,
  };
}

function buildCreditsPayload(params: {
  creditContext: CreditRuntimeContext | null;
  usageModel: "included" | "usage_based" | "prepaid";
  usage: number | null;
  limit: number | null;
  resetsAt: string;
  manualBonusBalance?: number | null;
  addonBalance?: number | null;
}): CreditsPayload {
  const plan = buildCreditPlanBalance(
    params.usage,
    params.limit,
    params.resetsAt,
  );
  const bonusBalance = Math.max(0, params.manualBonusBalance ?? 0);
  const addonBalance = Math.max(0, params.addonBalance ?? 0);
  const totalBalance = computeTotalAvailableBalance(
    plan.balance,
    bonusBalance,
    params.creditContext ? addonBalance : 0,
  );

  if (params.creditContext) {
    return {
      source: "credit_system" as const,
      systemSlug: params.creditContext.creditSystemSlug,
      costPerUnit: params.creditContext.costPerUnit,
      bonusBalance,
      addonBalance,
      totalBalance,
      plan,
    };
  }

  if (params.usageModel === "prepaid") {
    return {
      source: "prepaid" as const,
      bonusBalance,
      addonBalance: null,
      totalBalance,
      plan,
    };
  }

  if (bonusBalance > 0) {
    return {
      source: "feature" as const,
      bonusBalance,
      addonBalance: null,
      totalBalance,
      plan,
    };
  }

  return null;
}

type UsageCoverageBreakdown = {
  planAmount: number;
  manualBonusAmount: number;
  addonAmount: number;
  remainder: number;
};

function splitUsageCoverage(params: {
  requested: number;
  planBalance: number | null;
  manualBonusBalance: number;
  addonBalance: number;
}): UsageCoverageBreakdown {
  const planBalance = Math.max(0, params.planBalance ?? 0);
  const manualBonusBalance = Math.max(0, params.manualBonusBalance);
  const addonBalance = Math.max(0, params.addonBalance);
  const planAmount = Math.min(params.requested, planBalance);
  const afterPlan = Math.max(0, params.requested - planAmount);
  const manualBonusAmount = Math.min(afterPlan, manualBonusBalance);
  const afterManualBonus = Math.max(0, afterPlan - manualBonusAmount);
  const addonAmount = Math.min(afterManualBonus, addonBalance);

  return {
    planAmount,
    manualBonusAmount,
    addonAmount,
    remainder: Math.max(0, afterManualBonus - addonAmount),
  };
}

function buildUsagePersistSegments(params: {
  planFeature: any;
  planAmount: number;
  manualBonusAmount: number;
  addonAmount: number;
  manualBonusEntitlementId?: string | null;
}) {
  const segments: Array<{
    amount: number;
    coverageSource: UsageCoverageSource;
    coverageReferenceId?: string | null;
    pricingSnapshot?: ReturnType<typeof buildUsagePricingSnapshot> | null;
  }> = [];

  if (params.planAmount > 0) {
    segments.push({
      amount: params.planAmount,
      coverageSource: "plan",
      pricingSnapshot: buildUsagePricingSnapshot(params.planFeature),
    });
  }

  if (params.manualBonusAmount > 0) {
    segments.push({
      amount: params.manualBonusAmount,
      coverageSource: "manual_bonus",
      coverageReferenceId: params.manualBonusEntitlementId ?? null,
      pricingSnapshot: null,
    });
  }

  if (params.addonAmount > 0) {
    segments.push({
      amount: params.addonAmount,
      coverageSource: "addon",
      pricingSnapshot: null,
    });
  }

  return segments;
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
    coverageSource?: UsageCoverageSource | null;
    coverageReferenceId?: string | null;
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
        coverageSource: record.coverageSource ?? "plan",
        coverageReferenceId: record.coverageReferenceId ?? null,
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
    coverageSource?: UsageCoverageSource | null;
    coverageReferenceId?: string | null;
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

function scheduleUsagePersistSegments(
  c: any,
  db: any,
  organizationId: string | null | undefined,
  baseRecord: {
    customerId: string;
    featureId: string;
    featureSlug?: string | null;
    featureName?: string | null;
    entityId?: string | null;
    periodStart: number;
    periodEnd: number;
    subscriptionId?: string | null;
    planId?: string | null;
  },
  segments: Array<{
    amount: number;
    coverageSource: UsageCoverageSource;
    coverageReferenceId?: string | null;
    pricingSnapshot?: ReturnType<typeof buildUsagePricingSnapshot> | null;
  }>,
  label: string,
): Promise<void[]> {
  const writes = segments
    .filter((segment) => segment.amount > 0)
    .map((segment) =>
      scheduleUsagePersist(
        c,
        db,
        organizationId,
        {
          ...baseRecord,
          amount: segment.amount,
          coverageSource: segment.coverageSource,
          coverageReferenceId: segment.coverageReferenceId ?? null,
          pricingSnapshot: segment.pricingSnapshot ?? null,
        },
        `${label}:${segment.coverageSource}`,
      ),
    );

  return Promise.all(writes);
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
    credits: z
      .union([
        z.object({
          source: z.literal("credit_system"),
          systemSlug: z.string(),
          costPerUnit: z.number(),
          bonusBalance: z.number(),
          addonBalance: z.number(),
          totalBalance: z.number().nullable(),
          plan: z.object({
            used: z.number(),
            limit: z.number().nullable(),
            balance: z.number().nullable(),
            resetsAt: z.string().datetime(),
          }),
        }),
        z.object({
          source: z.literal("feature"),
          bonusBalance: z.number(),
          addonBalance: z.null(),
          totalBalance: z.number().nullable(),
          plan: z.object({
            used: z.number(),
            limit: z.number().nullable(),
            balance: z.number().nullable(),
            resetsAt: z.string().datetime(),
          }),
        }),
        z.object({
          source: z.literal("prepaid"),
          bonusBalance: z.number(),
          addonBalance: z.null(),
          totalBalance: z.number().nullable(),
          plan: z.object({
            used: z.number(),
            limit: z.number().nullable(),
            balance: z.number().nullable(),
            resetsAt: z.string().datetime(),
          }),
        }),
        z.null(),
      ])
      .optional(),
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
    "Check whether a customer can use a feature and return the current entitlement state, including the canonical credits balance object for credit-backed features. Optionally track usage atomically if allowed via sendEvent.",
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
    "Track usage for a feature and return the resulting entitlement state after the increment, including the canonical credits balance object for credit-backed features.",
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

async function resolveDirectCreditSystem(
  db: any,
  organizationId: string | null | undefined,
  feature: { id: string; slug?: string | null },
): Promise<CreditRuntimeContext | null> {
  const featureSlug = feature.slug || feature.id;
  const creditSystemsQuery = (db.query as any)?.creditSystems;
  if (!organizationId || !creditSystemsQuery?.findFirst) {
    return null;
  }

  const directCreditSystem = await creditSystemsQuery.findFirst({
    where: and(
      eq(schema.creditSystems.organizationId, organizationId),
      or(
        eq(schema.creditSystems.slug, featureSlug),
        eq(schema.creditSystems.id, feature.id),
      ),
    ),
  });

  if (!directCreditSystem) {
    return null;
  }

  return {
    creditSystemId: directCreditSystem.id,
    creditSystemSlug: directCreditSystem.slug,
    costPerUnit: 1,
    trackingFeatureId: feature.id,
    trackingFeatureSlug: featureSlug,
  };
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
          autoApplyPlansOnCreate: true,
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
            credits: null,
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
          credits: null,
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
          credits: null,
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
          credits: null,
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

    if ((!subscriptions || subscriptions.length === 0) && !manualEntitlement) {
      return c.json(
        {
          allowed: false,
          code: "no_active_subscription",
          usage: null,
          limit: null,
          balance: null,
          resetsAt: null,
          resetInterval: null,
          credits: null,
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
      const accessGrant = selectAccessGrantingPlanFeature(
        subscriptions,
        planFeatures,
        now,
      );
      if (accessGrant) {
        accessGrantingSubscription = accessGrant.subscription;
        accessGrantingPlanFeature = accessGrant.planFeature;
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

    const directCreditContext =
      !creditMapping && accessGrantingSubscription && accessGrantingPlanFeature
        ? await resolveDirectCreditSystem(db, organizationId, feature)
        : null;
    const creditContext: CreditRuntimeContext | null = creditMapping
      ? {
          creditSystemId: creditMapping.creditSystemId,
          creditSystemSlug: creditMapping.creditSystemSlug,
          costPerUnit: creditMapping.costPerUnit,
          trackingFeatureId: creditMapping.creditSystemId,
          trackingFeatureSlug: creditMapping.creditSystemSlug,
        }
      : directCreditContext;

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
          credits: null,
          details: {
            message: `Feature '${feature.slug || feature.id}' is not included in the customer's current plan.`,
          },
        },
        200,
      );
    }

    // Use the granting subscription/feature for the rest of the logic
    const subscription = accessGrantingSubscription;
    const customerFeatureOverride = await resolveCustomerFeatureBillingOverride(
      db,
      organizationId,
      customer.id,
      [feature.id, accessGrantingPlanFeature.featureId],
    );
    const planFeature = applyCustomerFeatureBillingOverride(
      accessGrantingPlanFeature,
      customerFeatureOverride,
    );

    // When resolved via credit system, adjust the effective values:
    // - effectiveFeatureId: track usage against the credit system's feature, not the child
    // - effectiveValue: multiply by cost (e.g., 1 unit of "dfs" = 20 credits)
    // - effectiveFeatureKey: use credit system slug for DO tracking
    const effectiveFeatureId = creditContext
      ? creditContext.trackingFeatureId
      : feature.id;
    const effectiveValue = creditContext
      ? value * creditContext.costPerUnit
      : value;
    const effectiveFeatureSlug = creditContext
      ? creditContext.trackingFeatureSlug
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
        ...(creditContext
          ? {
              creditSystem: creditContext.creditSystemSlug,
              creditCostPerUnit: creditContext.costPerUnit,
            }
          : {}),
        ...(pricing ? { pricing } : {}),
        ...extra,
      };
    }

    // 5. Check Logic based on Type
    // Boolean features get immediate access UNLESS they're part of a credit system
    // (credit system children must go through the metered path to consume credits)
    if (feature.type === "boolean" && !creditContext) {
      return c.json(
        {
          allowed: true,
          code: "access_granted",
          usage: null,
          limit: null,
          balance: null,
          resetsAt: null,
          resetInterval: null,
          credits: null,
          details: buildDetails(
            isTrial
              ? `Feature '${feature.slug || feature.id}' enabled on ${planName} via free trial (ends ${trialEndsAt}).`
              : `Feature '${feature.slug || feature.id}' enabled on ${planName}.`,
          ),
        },
        200,
      );
    }

    if (feature.type === "metered" || creditContext) {
      // Compute reset period once for all response paths
      const resetPeriod = getResetPeriod(
        planFeature.resetInterval,
        subscription.currentPeriodStart,
        subscription.currentPeriodEnd,
      );
      const resetsAt = new Date(resetPeriod.periodEnd).toISOString();
      const resetsOnPlanEnable = shouldResetUsageOnPlanEnable(planFeature);
      const usagePlanScope = resolveUsagePlanScope(planFeature, subscription);
      const usageLedgerScope = resolveUsageLedgerScope(
        planFeature,
        subscription,
      );
      const legacyUsageLedgerScope = resolveLegacyUsageLedgerScope(
        planFeature,
        subscription,
      );
      const currentAddonBalance = creditContext
        ? await getAddonBalance(
            db,
            customer.id,
            creditContext.creditSystemId,
            deps,
          )
        : undefined;
      const manualBonusEntitlement = await getActiveManualBonusEntitlement(
        db,
        customer.id,
        effectiveFeatureId,
        now,
      );
      const manualBonusState = await resolveManualBonusBalanceState({
        usageLedger: c.env.USAGE_LEDGER,
        organizationId: organizationId || null,
        customerId: customer.id,
        featureId: effectiveFeatureId,
        entitlement: manualBonusEntitlement,
        subscription,
        usageLedgerScope,
        legacyUsageLedgerScope,
      });
      const currentManualBonusBalance = manualBonusState.balance ?? 0;
      const usageModel = getUsageModel(planFeature);
      const buildCredits = (
        usage: number | null,
        limit: number | null,
        addonBalance: number | null | undefined = currentAddonBalance,
        manualBonusBalance: number | null | undefined = currentManualBonusBalance,
      ) =>
        buildCreditsPayload({
          creditContext,
          usageModel,
          usage,
          limit,
          resetsAt,
          manualBonusBalance,
          addonBalance,
        });
      const toAvailableBalance = (
        planBalance: number | null,
        addonBalance: number | null | undefined = currentAddonBalance,
        manualBonusBalance: number | null | undefined = currentManualBonusBalance,
      ) =>
        computeTotalAvailableBalance(
          planBalance,
          manualBonusBalance ?? 0,
          addonBalance ?? 0,
        );

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

        // Pass current config inline — single RPC call, no extra round-trip
        const currentConfig = {
          limit: effectiveLimit,
          resetInterval: planFeature.resetInterval,
          resetOnEnable: resetsOnPlanEnable,
          rolloverEnabled: planFeature.rolloverEnabled || false,
          rolloverMaxBalance: planFeature.rolloverMaxBalance,
          usageModel: planFeature.usageModel || "included",
          creditCost: planFeature.creditCost || 0,
          usageScopeKey: usagePlanScope ?? null,
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
          const ledgerUsage = await sumScopedUsageAmount(
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
              coverageSource: "plan",
              scope: usageLedgerScope,
              legacyPlanScope: legacyUsageLedgerScope,
              legacyCreatedAtFloor: subscription.currentPeriodStart,
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
                credits: buildCredits(null, null),
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
              ...usageLedgerScope,
              legacyCreatedAtFloor: subscription.currentPeriodStart,
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
                credits: buildCredits(doResult.usage, null),
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
          const overageSetting = isTrial
            ? "block"
            : planFeature.overage || "block";

          const coverage = splitUsageCoverage({
            requested: effectiveValue,
            planBalance: doResult.balance,
            manualBonusBalance: currentManualBonusBalance,
            addonBalance: currentAddonBalance ?? 0,
          });

          if (coverage.remainder === 0) {
            let responseUsage = doResult.usage;
            let responsePlanBalance = doResult.balance;
            let responseAddonBalance = currentAddonBalance ?? 0;
            let responseManualBonusBalance = currentManualBonusBalance;

            if (sendEvent && coverage.planAmount > 0) {
              const trackResult = await usageMeter.track(
                featureKey,
                coverage.planAmount,
                currentConfig,
              );

              if (!trackResult.allowed) {
                return c.json(
                  {
                    allowed: false,
                    code: "limit_exceeded",
                    usage: doResult.usage,
                    limit: doResult.limit,
                    balance: toAvailableBalance(doResult.balance),
                    resetsAt,
                    resetInterval: planFeature.resetInterval,
                    credits: buildCredits(doResult.usage, doResult.limit),
                    details: buildDetails(
                      `Usage tracking denied — limit changed while processing the request.`,
                      undefined,
                      doResult.usage,
                    ),
                  },
                  200,
                );
              }

              responseUsage = trackResult.usage;
              responsePlanBalance = trackResult.balance;
            }

            if (sendEvent && coverage.addonAmount > 0 && creditContext) {
              const deductResult = await tryDeductAddonCredits(
                db,
                customer.id,
                coverage.addonAmount,
                creditContext.creditSystemId,
                deps,
              );
              if (!deductResult.deducted) {
                return c.json(
                  {
                    allowed: false,
                    code: "limit_exceeded",
                    usage: responseUsage,
                    limit: doResult.limit,
                    balance: toAvailableBalance(responsePlanBalance),
                    resetsAt,
                    resetInterval: planFeature.resetInterval,
                    credits: buildCredits(responseUsage, doResult.limit),
                    details: buildDetails(
                      `Usage tracking denied — add-on credits were no longer available.`,
                      undefined,
                      responseUsage,
                    ),
                  },
                  200,
                );
              }

              responseAddonBalance = computeRemainingAddonBalance(
                currentAddonBalance ?? 0,
                coverage.addonAmount,
                deductResult.remaining,
              );
            }

            if (sendEvent) {
              responseManualBonusBalance = Math.max(
                0,
                currentManualBonusBalance - coverage.manualBonusAmount,
              );
              scheduleUsagePersistSegments(
                c,
                db,
                organizationId,
                {
                  customerId: customer.id,
                  featureId: effectiveFeatureId,
                  featureSlug: effectiveFeatureSlug,
                  featureName: creditContext
                    ? effectiveFeatureSlug
                    : (feature.name ?? effectiveFeatureSlug),
                  subscriptionId: subscription?.id ?? null,
                  planId: subscription?.planId ?? null,
                  entityId: entity || null,
                  periodStart: resetPeriod.periodStart,
                  periodEnd: resetPeriod.periodEnd,
                },
                buildUsagePersistSegments({
                  planFeature,
                  planAmount: coverage.planAmount,
                  manualBonusAmount: coverage.manualBonusAmount,
                  addonAmount: coverage.addonAmount,
                  manualBonusEntitlementId: manualBonusEntitlement?.id ?? null,
                }),
                "check:coverage-fallback",
              );
            }

            const creditCode =
              coverage.manualBonusAmount > 0
                ? "bonus_credits_used"
                : "addon_credits_used";
            return c.json(
              {
                allowed: true,
                code: creditCode,
                usage: responseUsage,
                limit: doResult.limit,
                balance: toAvailableBalance(
                  sendEvent ? responsePlanBalance : doResult.balance,
                  sendEvent ? responseAddonBalance : currentAddonBalance,
                  sendEvent
                    ? responseManualBonusBalance
                    : currentManualBonusBalance,
                ),
                resetsAt,
                resetInterval: planFeature.resetInterval,
                credits: buildCredits(
                  responseUsage,
                  doResult.limit,
                  sendEvent ? responseAddonBalance : currentAddonBalance,
                  sendEvent
                    ? responseManualBonusBalance
                    : currentManualBonusBalance,
                ),
                details: buildDetails(
                  coverage.manualBonusAmount > 0
                    ? `Plan credits exhausted. ${coverage.manualBonusAmount} manual bonus credits ${sendEvent ? "deducted" : "will be deducted"}.`
                    : `Plan credits exhausted. ${coverage.addonAmount} add-on credits ${sendEvent ? "deducted" : "will be deducted"}.`,
                  {
                    ...(coverage.manualBonusAmount > 0
                      ? {
                          bonusCreditsUsed: coverage.manualBonusAmount,
                          bonusCreditsRemaining:
                            sendEvent
                              ? responseManualBonusBalance
                              : currentManualBonusBalance,
                        }
                      : {}),
                    ...(coverage.addonAmount > 0
                      ? {
                          addonCreditsUsed: coverage.addonAmount,
                          addonCreditsRemaining:
                            sendEvent
                              ? responseAddonBalance
                              : currentAddonBalance,
                        }
                      : {}),
                  },
                  responseUsage,
                ),
              },
              200,
            );
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
              coverage.remainder,
              {
                usageLedger: c.env.USAGE_LEDGER,
                organizationId: organizationId || null,
                ...usageLedgerScope,
              },
            );

            if (overageGuard.allowed) {
              return c.json(
                {
                  allowed: true,
                  code: "overage_allowed",
                  usage: doResult.usage,
                  limit: doResult.limit,
                  balance: toAvailableBalance(doResult.balance),
                  resetsAt,
                  resetInterval: planFeature.resetInterval,
                  credits: buildCredits(doResult.usage, doResult.limit),
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
          const blockAddonCredits = creditContext
            ? await getAddonBalance(
                db,
                customer.id,
                creditContext.creditSystemId,
                deps,
              )
            : undefined;
          return c.json(
            {
              allowed: false,
              code: "limit_exceeded",
              usage: doResult.usage,
              limit: doResult.limit,
              balance: toAvailableBalance(
                doResult.limit === null ? null : doResult.limit - doResult.usage,
                blockAddonCredits,
              ),
              resetsAt,
              resetInterval: planFeature.resetInterval,
              credits: buildCredits(
                doResult.usage,
                doResult.limit,
                blockAddonCredits,
              ),
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
            if (creditContext) {
              const deductResult = await tryDeductAddonCredits(
                db,
                customer.id,
                effectiveValue,
                creditContext.creditSystemId,
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
                      featureName: creditContext
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
                    balance: toAvailableBalance(
                      doResult.limit === null
                        ? null
                        : (trackResult.balance ??
                          doResult.limit - doResult.usage),
                      computeRemainingAddonBalance(
                        currentAddonBalance ?? 0,
                        effectiveValue,
                        deductResult.remaining,
                      ),
                    ),
                    resetsAt,
                    resetInterval: planFeature.resetInterval,
                    credits: buildCredits(
                      doResult.usage,
                      doResult.limit,
                      computeRemainingAddonBalance(
                        currentAddonBalance ?? 0,
                        effectiveValue,
                        deductResult.remaining,
                      ),
                    ),
                    details: buildDetails(
                      `Plan credits exhausted. ${effectiveValue} add-on credits deducted.`,
                      {
                        addonCreditsUsed: effectiveValue,
                        addonCreditsRemaining: computeRemainingAddonBalance(
                          currentAddonBalance ?? 0,
                          effectiveValue,
                          deductResult.remaining,
                        ),
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
                balance: toAvailableBalance(
                  doResult.limit === null
                    ? null
                    : (trackResult.balance ?? doResult.limit - doResult.usage),
                ),
                resetsAt,
                resetInterval: planFeature.resetInterval,
                credits: buildCredits(doResult.usage, doResult.limit),
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
                featureName: creditContext
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
            !creditContext &&
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
        return c.json(
          {
            allowed: true,
            code: "access_granted",
            usage: doResult.usage,
            limit: doResult.limit,
            balance: toAvailableBalance(doResult.limit === null ? null : doResult.balance),
            resetsAt,
            resetInterval: planFeature.resetInterval,
            ...(doResult.rolloverBalance > 0
              ? { rolloverBalance: doResult.rolloverBalance }
              : {}),
            credits: buildCredits(doResult.usage, doResult.limit),
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
      const ledgerUsage = await sumScopedUsageAmount(
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
          coverageSource: "plan",
          scope: usageLedgerScope,
          legacyPlanScope: legacyUsageLedgerScope,
          legacyCreatedAtFloor: subscription.currentPeriodStart,
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
            credits: buildCredits(null, effectiveLimit),
            details: {
              message:
                "Billing ledger unavailable. Cannot safely evaluate current metered usage right now.",
            },
          },
          503,
        );
      }

      const currentUsage = ledgerUsage ?? 0;

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
            ...usageLedgerScope,
            legacyCreatedAtFloor: subscription.currentPeriodStart,
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
              credits: buildCredits(currentUsage, null),
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
            credits: buildCredits(currentUsage, null),
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
            credits: buildCredits(currentUsage, null),
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
        const overageSetting = isTrial
          ? "block"
          : planFeature.overage || "block";
        const currentPlanBalance = Math.max(0, effectiveLimit - currentUsage);
        const coverage = splitUsageCoverage({
          requested: effectiveValue,
          planBalance: currentPlanBalance,
          manualBonusBalance: currentManualBonusBalance,
          addonBalance: currentAddonBalance ?? 0,
        });

        if (coverage.remainder === 0) {
          let responseAddonBalance = currentAddonBalance ?? 0;
          let responseManualBonusBalance = currentManualBonusBalance;

          if (sendEvent && coverage.addonAmount > 0 && creditContext) {
            const deductResult = await tryDeductAddonCredits(
              db,
              customer.id,
              coverage.addonAmount,
              creditContext.creditSystemId,
              deps,
            );
            if (!deductResult.deducted) {
              return c.json(
                {
                  allowed: false,
                  code: "limit_exceeded",
                  usage: currentUsage,
                  limit: effectiveLimit,
                  balance: toAvailableBalance(currentPlanBalance),
                  resetsAt,
                  resetInterval: planFeature.resetInterval,
                  credits: buildCredits(currentUsage, effectiveLimit),
                  details: buildDetails(
                    `Usage tracking denied — add-on credits were no longer available.`,
                    undefined,
                    currentUsage,
                  ),
                },
                200,
              );
            }
            responseAddonBalance = computeRemainingAddonBalance(
              currentAddonBalance ?? 0,
              coverage.addonAmount,
              deductResult.remaining,
            );
          }

          if (sendEvent) {
            responseManualBonusBalance = Math.max(
              0,
              currentManualBonusBalance - coverage.manualBonusAmount,
            );
            scheduleUsagePersistSegments(
              c,
              db,
              organizationId,
              {
                customerId: customer.id,
                featureId: effectiveFeatureId,
                featureSlug: effectiveFeatureSlug,
                featureName: creditContext
                  ? effectiveFeatureSlug
                  : (feature.name ?? effectiveFeatureSlug),
                subscriptionId: subscription?.id ?? null,
                planId: subscription?.planId ?? null,
                entityId: entity || null,
                periodStart: currentPeriodStart,
                periodEnd: currentPeriodEnd,
              },
              buildUsagePersistSegments({
                planFeature,
                planAmount: coverage.planAmount,
                manualBonusAmount: coverage.manualBonusAmount,
                addonAmount: coverage.addonAmount,
                manualBonusEntitlementId: manualBonusEntitlement?.id ?? null,
              }),
              "check:track-inline-db-only-coverage",
            );
          }

          return c.json(
            {
              allowed: true,
              code:
                coverage.manualBonusAmount > 0
                  ? "bonus_credits_used"
                  : "addon_credits_used",
              usage: currentUsage + (sendEvent ? coverage.planAmount : 0),
              limit: effectiveLimit,
              balance: toAvailableBalance(
                sendEvent
                  ? Math.max(0, currentPlanBalance - coverage.planAmount)
                  : currentPlanBalance,
                sendEvent ? responseAddonBalance : currentAddonBalance,
                sendEvent
                  ? responseManualBonusBalance
                  : currentManualBonusBalance,
              ),
              resetsAt,
              resetInterval: planFeature.resetInterval,
              credits: buildCredits(
                currentUsage + (sendEvent ? coverage.planAmount : 0),
                effectiveLimit,
                sendEvent ? responseAddonBalance : currentAddonBalance,
                sendEvent
                  ? responseManualBonusBalance
                  : currentManualBonusBalance,
              ),
              details: buildDetails(
                coverage.manualBonusAmount > 0
                  ? `Plan credits exhausted. ${coverage.manualBonusAmount} manual bonus credits ${sendEvent ? "deducted" : "will be deducted"}.`
                  : `Plan credits exhausted. ${coverage.addonAmount} add-on credits ${sendEvent ? "deducted" : "will be deducted"}.`,
                {
                  ...(coverage.manualBonusAmount > 0
                    ? {
                        bonusCreditsUsed: coverage.manualBonusAmount,
                        bonusCreditsRemaining:
                          sendEvent
                            ? responseManualBonusBalance
                            : currentManualBonusBalance,
                      }
                    : {}),
                  ...(coverage.addonAmount > 0
                    ? {
                        addonCreditsUsed: coverage.addonAmount,
                        addonCreditsRemaining:
                          sendEvent
                            ? responseAddonBalance
                            : currentAddonBalance,
                      }
                    : {}),
                },
                currentUsage,
              ),
            },
            200,
          );
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
              coverage.remainder,
              {
                usageLedger: c.env.USAGE_LEDGER,
                organizationId: organizationId || null,
              ...usageLedgerScope,
              legacyCreatedAtFloor: subscription.currentPeriodStart,
            },
          );
          if (overageGuard.allowed) {
            return c.json(
              {
                allowed: true,
                code: "overage_allowed",
                usage: currentUsage,
                limit: effectiveLimit,
                balance: toAvailableBalance(effectiveLimit - currentUsage),
                resetsAt,
                resetInterval: planFeature.resetInterval,
                credits: buildCredits(currentUsage, effectiveLimit),
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
        const dbBlockAddonCredits = creditContext
          ? await getAddonBalance(
              db,
              customer.id,
              creditContext.creditSystemId,
              deps,
            )
          : undefined;
        return c.json(
          {
            allowed: false,
            code: "limit_exceeded",
            usage: currentUsage,
            limit: effectiveLimit,
            balance: toAvailableBalance(
              effectiveLimit - currentUsage,
              dbBlockAddonCredits,
            ),
            resetsAt,
            resetInterval: planFeature.resetInterval,
            credits: buildCredits(
              currentUsage,
              effectiveLimit,
              dbBlockAddonCredits,
            ),
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
        !creditContext &&
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
              balance: toAvailableBalance(effectiveLimit - currentUsage),
              resetsAt,
              resetInterval: planFeature.resetInterval,
              credits: buildCredits(currentUsage, effectiveLimit),
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
              featureName: creditContext
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
          !creditContext &&
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
          balance: toAvailableBalance(effectiveLimit - currentUsage),
          resetsAt,
          resetInterval: planFeature.resetInterval,
          credits: buildCredits(currentUsage, effectiveLimit),
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
        credits: null,
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
          autoApplyPlansOnCreate: true,
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
            credits: null,
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
          credits: null,
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
          credits: null,
          details: { message: `Feature '${featureId}' not found.` },
        },
        404,
      );
    }

    // 3 & 4. Validate Entity and fetch Subscriptions in parallel
    const subsCacheKey = customer.id;
    const trackNow = Date.now();
    const [trackEntityValid, trackSubsResult, trackManualEntitlement] =
      await Promise.all([
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
        getManualEntitlementForFeature(
          c,
          db,
          cache,
          organizationId,
          customer.id,
          feature.id,
          trackNow,
        ),
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
          credits: null,
          details: {
            message: `Entity '${entity}' not found for feature '${featureId}'. Use addEntity() to create it first.`,
          },
        },
        404,
      );
    }

    let subscriptions = trackSubsResult;

    // Filter out expired trialing subscriptions and scheduled cancellations past their effective date
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

    if (subscriptions.length === 0 && !trackManualEntitlement) {
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
          credits: null,
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

    if (trackManualEntitlement) {
      accessGrantingSubscription = subscriptions[0] || {
        id: "manual",
        status: "active",
        currentPeriodStart: trackNow - 30 * 24 * 60 * 60 * 1000,
        currentPeriodEnd: trackNow + 30 * 24 * 60 * 60 * 1000,
        plan: { name: "Manual Override" },
      };
      accessGrantingPlanFeature = {
        ...trackManualEntitlement,
        planId: (accessGrantingSubscription as any).planId || "manual",
        usageModel: "included",
      } as (typeof planFeatures)[number];
    } else {
      const accessGrant = selectAccessGrantingPlanFeature(
        subscriptions,
        planFeatures,
        trackNow,
      );
      if (accessGrant) {
        accessGrantingSubscription = accessGrant.subscription;
        accessGrantingPlanFeature = accessGrant.planFeature;
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
    }

    const directTrackCreditContext =
      !trackCreditMapping &&
      accessGrantingSubscription &&
      accessGrantingPlanFeature
        ? await resolveDirectCreditSystem(db, organizationId, feature)
        : null;
    const trackCreditContext: CreditRuntimeContext | null = trackCreditMapping
      ? {
          creditSystemId: trackCreditMapping.creditSystemId,
          creditSystemSlug: trackCreditMapping.creditSystemSlug,
          costPerUnit: trackCreditMapping.costPerUnit,
          trackingFeatureId: trackCreditMapping.creditSystemId,
          trackingFeatureSlug: trackCreditMapping.creditSystemSlug,
        }
      : directTrackCreditContext;

    const subscription = accessGrantingSubscription;
    const basePlanFeature = accessGrantingPlanFeature;

    if (!subscription || !basePlanFeature) {
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
          credits: null,
          details: {
            message: `Feature '${feature.slug || feature.id}' is not included in the customer's current plan.`,
          },
        },
        400,
      );
    }

    const customerFeatureOverride = await resolveCustomerFeatureBillingOverride(
      db,
      organizationId,
      customer.id,
      [feature.id, basePlanFeature.featureId],
    );
    const planFeature = applyCustomerFeatureBillingOverride(
      basePlanFeature,
      customerFeatureOverride,
    );

    // Credit system effective values
    const trackEffectiveFeatureId = trackCreditContext
      ? trackCreditContext.trackingFeatureId
      : feature.id;
    const trackEffectiveValue = trackCreditContext
      ? value * trackCreditContext.costPerUnit
      : value;
    const trackEffectiveSlug = trackCreditContext
      ? trackCreditContext.trackingFeatureSlug
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
        ...(trackCreditContext
          ? {
              creditSystem: trackCreditContext.creditSystemSlug,
              creditCostPerUnit: trackCreditContext.costPerUnit,
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
    const resetsOnPlanEnable = shouldResetUsageOnPlanEnable(planFeature);
    const usagePlanScope = resolveUsagePlanScope(planFeature, subscription);
    const usageLedgerScope = resolveUsageLedgerScope(planFeature, subscription);
    const legacyUsageLedgerScope = resolveLegacyUsageLedgerScope(
      planFeature,
      subscription,
    );
    const currentTrackAddonBalance = trackCreditContext
      ? await getAddonBalance(
          db,
          customer.id,
          trackCreditContext.creditSystemId,
          deps,
        )
      : undefined;
    const trackManualBonusEntitlement = await getActiveManualBonusEntitlement(
      db,
      customer.id,
      trackEffectiveFeatureId,
      now,
    );
    const trackManualBonusState = await resolveManualBonusBalanceState({
      usageLedger: c.env.USAGE_LEDGER,
      organizationId: organizationId || null,
      customerId: customer.id,
      featureId: trackEffectiveFeatureId,
      entitlement: trackManualBonusEntitlement,
      subscription,
      usageLedgerScope,
      legacyUsageLedgerScope,
    });
    const currentTrackManualBonusBalance = trackManualBonusState.balance ?? 0;
    const buildTrackCredits = (
      usage: number | null,
      limit: number | null,
      addonBalance: number | null | undefined = currentTrackAddonBalance,
      manualBonusBalance:
        | number
        | null
        | undefined = currentTrackManualBonusBalance,
    ) =>
      buildCreditsPayload({
        creditContext: trackCreditContext,
        usageModel,
        usage,
        limit,
        resetsAt: new Date(periodEnd).toISOString(),
        manualBonusBalance,
        addonBalance,
      });
    const toTrackAvailableBalance = (
      planBalance: number | null,
      addonBalance: number | null | undefined = currentTrackAddonBalance,
      manualBonusBalance:
        | number
        | null
        | undefined = currentTrackManualBonusBalance,
    ) =>
      computeTotalAvailableBalance(
        planBalance,
        manualBonusBalance ?? 0,
        addonBalance ?? 0,
      );

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
      let persistedPlanAmount = trackEffectiveValue;
      let persistedManualBonusAmount = 0;
      let persistedAddonAmount = 0;
      let trackAddonBalanceAfter = currentTrackAddonBalance ?? 0;
      let trackSuccessCode: "tracked" | "tracked_overage" | "addon_credits_used" | "bonus_credits_used" =
        "tracked";
      let trackSuccessDetail:
        | {
            message: string;
            extra?: Record<string, unknown>;
          }
        | null = null;

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
          resetOnEnable: resetsOnPlanEnable,
          rolloverEnabled: planFeature.rolloverEnabled || false,
          rolloverMaxBalance: planFeature.rolloverMaxBalance,
          usageModel: planFeature.usageModel || "included",
          creditCost: planFeature.creditCost || 0,
          usageScopeKey: usagePlanScope ?? null,
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
              ...usageLedgerScope,
              legacyCreatedAtFloor: subscription.currentPeriodStart,
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
                credits: buildTrackCredits(null, null),
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
          const ledgerUsage = await sumScopedUsageAmount(
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
              coverageSource: "plan",
              scope: usageLedgerScope,
              legacyPlanScope: legacyUsageLedgerScope,
              legacyCreatedAtFloor: subscription.currentPeriodStart,
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
                credits: buildTrackCredits(null, effectiveLimit),
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

        // If DO says not allowed, spend remaining plan balance first, then
        // manual bonus credits, then add-on credits, then overage.
        if (doResult && !doResult.allowed) {
          const overageSetting = isTrial
            ? "block"
            : planFeature.overage || "block";
          const coverage = splitUsageCoverage({
            requested: trackEffectiveValue,
            planBalance: doResult.balance,
            manualBonusBalance: currentTrackManualBonusBalance,
            addonBalance: currentTrackAddonBalance ?? 0,
          });

          if (coverage.planAmount > 0) {
            const consumeIncludedResult = await usageMeter.track(
              trackFeatureKey,
              coverage.planAmount,
              currentConfig,
            );

            if (!consumeIncludedResult.allowed) {
              return c.json(
                {
                  success: false,
                  allowed: false,
                  code: "limit_exceeded",
                  usage: doResult.usage ?? null,
                  limit: effectiveLimit,
                  balance: toTrackAvailableBalance(doResult.balance),
                  resetsAt: new Date(periodEnd).toISOString(),
                  resetInterval: planFeature.resetInterval,
                  ...(doResult.rolloverBalance > 0
                    ? { rolloverBalance: doResult.rolloverBalance }
                    : {}),
                  credits: buildTrackCredits(
                    doResult.usage ?? null,
                    effectiveLimit,
                  ),
                  details: buildTrackDetails(
                    `Usage tracking denied — limit changed while processing the request.`,
                    undefined,
                    doResult.usage ?? null,
                  ),
                },
                200,
              );
            }

            doResult = consumeIncludedResult;
          }

          if (coverage.remainder === 0) {
            if (coverage.addonAmount > 0 && trackCreditContext) {
              const deductResult = await tryDeductAddonCredits(
                db,
                customer.id,
                coverage.addonAmount,
                trackCreditContext.creditSystemId,
                deps,
              );
              if (!deductResult.deducted) {
                return c.json(
                  {
                    success: false,
                    allowed: false,
                    code: "limit_exceeded",
                    usage: doResult.usage ?? null,
                    limit: effectiveLimit,
                    balance: toTrackAvailableBalance(doResult.balance),
                    resetsAt: new Date(periodEnd).toISOString(),
                    resetInterval: planFeature.resetInterval,
                    ...(doResult.rolloverBalance > 0
                      ? { rolloverBalance: doResult.rolloverBalance }
                      : {}),
                    credits: buildTrackCredits(
                      doResult.usage ?? null,
                      effectiveLimit,
                    ),
                    details: buildTrackDetails(
                      `Usage tracking denied — add-on credits were no longer available.`,
                      undefined,
                      doResult.usage ?? null,
                    ),
                  },
                  200,
                );
              }
              trackAddonBalanceAfter = computeRemainingAddonBalance(
                currentTrackAddonBalance ?? 0,
                coverage.addonAmount,
                deductResult.remaining,
              );
            }

            persistedPlanAmount = coverage.planAmount;
            persistedManualBonusAmount = coverage.manualBonusAmount;
            persistedAddonAmount = coverage.addonAmount;
            trackSuccessCode =
              coverage.manualBonusAmount > 0
                ? "bonus_credits_used"
                : "addon_credits_used";
            trackSuccessDetail =
              coverage.manualBonusAmount > 0
                ? {
                    message: `Plan credits exhausted. ${coverage.manualBonusAmount} manual bonus credits deducted.`,
                    extra: {
                      bonusCreditsUsed: coverage.manualBonusAmount,
                      bonusCreditsRemaining: Math.max(
                        0,
                        currentTrackManualBonusBalance -
                          coverage.manualBonusAmount,
                      ),
                      ...(coverage.addonAmount > 0
                        ? {
                            addonCreditsUsed: coverage.addonAmount,
                            addonCreditsRemaining: trackAddonBalanceAfter,
                          }
                        : {}),
                    },
                  }
                : {
                    message: `Plan credits exhausted. ${coverage.addonAmount} add-on credits deducted.`,
                    extra: {
                      addonCreditsUsed: coverage.addonAmount,
                      addonCreditsRemaining: trackAddonBalanceAfter,
                    },
                  };
          } else if (overageSetting === "charge") {
            const overageGuard = await deps.checkOverageAllowed(
              db,
              customer.id,
              trackEffectiveFeatureId,
              periodStart,
              periodEnd,
              planFeature.limitValue,
              planFeature.maxOverageUnits,
              coverage.remainder,
              {
                usageLedger: c.env.USAGE_LEDGER,
                organizationId: organizationId || null,
                ...usageLedgerScope,
                legacyCreatedAtFloor: subscription.currentPeriodStart,
              },
            );

            if (!overageGuard.allowed) {
              return c.json(
                {
                  success: false,
                  allowed: false,
                  code: "limit_exceeded",
                  usage: doResult.usage ?? null,
                  limit: effectiveLimit,
                  balance: toTrackAvailableBalance(doResult.balance),
                  resetsAt: new Date(periodEnd).toISOString(),
                  resetInterval: planFeature.resetInterval,
                  ...(doResult.rolloverBalance > 0
                    ? { rolloverBalance: doResult.rolloverBalance }
                    : {}),
                  credits: buildTrackCredits(
                    doResult.usage ?? null,
                    effectiveLimit,
                  ),
                  details: buildTrackDetails(
                    overageGuard.reason ||
                      `Overage not allowed. ${coverage.remainder} overage units requested.`,
                    undefined,
                    doResult.usage ?? null,
                  ),
                },
                200,
              );
            }

            if (coverage.addonAmount > 0 && trackCreditContext) {
              const deductResult = await tryDeductAddonCredits(
                db,
                customer.id,
                coverage.addonAmount,
                trackCreditContext.creditSystemId,
                deps,
              );
              if (!deductResult.deducted) {
                return c.json(
                  {
                    success: false,
                    allowed: false,
                    code: "limit_exceeded",
                    usage: doResult.usage ?? null,
                    limit: effectiveLimit,
                    balance: toTrackAvailableBalance(doResult.balance),
                    resetsAt: new Date(periodEnd).toISOString(),
                    resetInterval: planFeature.resetInterval,
                    ...(doResult.rolloverBalance > 0
                      ? { rolloverBalance: doResult.rolloverBalance }
                      : {}),
                    credits: buildTrackCredits(
                      doResult.usage ?? null,
                      effectiveLimit,
                    ),
                    details: buildTrackDetails(
                      `Usage tracking denied — add-on credits were no longer available.`,
                      undefined,
                      doResult.usage ?? null,
                    ),
                  },
                  200,
                );
              }
              trackAddonBalanceAfter = computeRemainingAddonBalance(
                currentTrackAddonBalance ?? 0,
                coverage.addonAmount,
                deductResult.remaining,
              );
            }

            trackedAsOverage = true;
            persistedPlanAmount = coverage.planAmount + coverage.remainder;
            persistedManualBonusAmount = coverage.manualBonusAmount;
            persistedAddonAmount = coverage.addonAmount;
          } else {
            const blockUsage = doResult.usage ?? null;
            return c.json(
              {
                success: false,
                allowed: false,
                code: "limit_exceeded",
                usage: blockUsage,
                limit: effectiveLimit,
                balance: toTrackAvailableBalance(doResult.balance),
                resetsAt: new Date(periodEnd).toISOString(),
                resetInterval: planFeature.resetInterval,
                ...(doResult.rolloverBalance > 0
                  ? { rolloverBalance: doResult.rolloverBalance }
                  : {}),
                credits: buildTrackCredits(blockUsage, effectiveLimit),
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
            ...usageLedgerScope,
            legacyCreatedAtFloor: subscription.currentPeriodStart,
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
              credits: buildTrackCredits(null, null),
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
      const usagePersistPromise = scheduleUsagePersistSegments(
        c,
        db,
        organizationId,
        {
          customerId: customer.id,
          featureId: trackEffectiveFeatureId,
          featureSlug: trackEffectiveSlug,
          featureName: trackCreditContext
            ? trackEffectiveSlug
            : (feature.name ?? trackEffectiveSlug),
          subscriptionId: subscription?.id ?? null,
          planId: subscription?.planId ?? null,
          entityId: entity || null,
          periodStart,
          periodEnd,
        },
        buildUsagePersistSegments({
          planFeature,
          planAmount: persistedPlanAmount,
          manualBonusAmount: persistedManualBonusAmount,
          addonAmount: persistedAddonAmount,
          manualBonusEntitlementId: trackManualBonusEntitlement?.id ?? null,
        }),
        "track:main",
      );

      // Deduct Credits if applicable (prepaid balance model)
      // NOTE: Credit systems do NOT use credits.balance — they enforce via usage_records pool.
      // This runs regardless of DO availability — credits.balance is a separate DB counter.
      if (
        subscription &&
        !trackCreditContext &&
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
      const isOverage = trackedAsOverage;

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
      const remainingTrackManualBonusBalance = Math.max(
        0,
        currentTrackManualBonusBalance - persistedManualBonusAmount,
      );

      const responseCode =
        trackedAsOverage ? "tracked_overage" : trackSuccessCode;
      return c.json(
        {
          success: true,
          allowed: true,
          code: responseCode,
          usage: successUsage,
          limit: effectiveLimit,
          balance: toTrackAvailableBalance(
            doResult?.balance ?? null,
            trackAddonBalanceAfter,
            remainingTrackManualBonusBalance,
          ),
          resetsAt: new Date(periodEnd).toISOString(),
          resetInterval: planFeature.resetInterval,
          ...(doResult && doResult.rolloverBalance > 0
            ? { rolloverBalance: doResult.rolloverBalance }
            : {}),
          credits: buildTrackCredits(
            successUsage,
            effectiveLimit,
            trackAddonBalanceAfter,
            remainingTrackManualBonusBalance,
          ),
          details: isOverage
            ? buildTrackDetails(
                `Usage tracked as overage (will be billed).`,
                {
                  overage: { type: planFeature.overage, willBeBilled: true },
                },
                successUsage,
              )
            : trackSuccessDetail
              ? buildTrackDetails(
                  trackSuccessDetail.message,
                  trackSuccessDetail.extra,
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
          credits: null,
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
