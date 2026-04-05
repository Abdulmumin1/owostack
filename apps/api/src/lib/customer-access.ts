import { getResetPeriod } from "./reset-period";
import { sumScopedUsageAmount } from "./scoped-usage";
import { isPaidActivePastGracePeriod } from "./subscription-health";
import {
  resolveLegacyUsageLedgerScope,
  resolveUsageLedgerScope,
  resolveUsagePlanScope,
  shouldResetUsageOnPlanEnable,
} from "./usage-scope";

export type CustomerAccessSubscription = {
  id: string;
  status: string;
  planId: string | null;
  planName?: string | null;
  planType?: string | null;
  currentPeriodStart?: number | null;
  currentPeriodEnd?: number | null;
  cancelAt?: number | null;
  canceledAt?: number | null;
};

export type CustomerAccessPlanFeature = {
  planId: string;
  featureId: string;
  featureName: string;
  featureSlug: string | null;
  featureType: string;
  unit: string | null;
  limitValue: number | null;
  trialLimitValue?: number | null;
  resetInterval: string;
  usageModel: string | null;
  creditCost: number | null;
  resetOnEnable: boolean | null;
  rolloverEnabled: boolean | null;
  rolloverMaxBalance: number | null;
};

export type CustomerAccessEntitlement = {
  id: string;
  featureId: string;
  featureName: string;
  featureSlug: string | null;
  featureType: string;
  unit: string | null;
  limitValue: number | null;
  resetInterval: string;
  expiresAt: number | null;
  source: string;
  grantedReason?: string | null;
};

export type CustomerAccessCreditBalance = {
  creditSystemId: string;
  balance: number;
};

export type CustomerAccessItem = {
  featureId: string;
  featureName: string;
  featureSlug: string | null;
  featureType: string;
  unit: string | null;
  planId: string | null;
  planName: string | null;
  planLimitValue: number | null;
  planTrialLimitValue?: number | null;
  planResetInterval: string | null;
  entitlementLimitValue: number | null;
  entitlementResetInterval: string | null;
  entitlementExpiresAt: number | null;
  entitlementSource: "plan" | "manual";
  grantedReason: string | null;
  balance: number | null;
  usage: number | null;
  limit: number | null;
  isTrialing?: boolean;
  isTrialLimit?: boolean;
  rolloverBalance: number;
  addonBalance: number | null;
};

type UsageMeterConfig = {
  limit: number | null;
  resetInterval: string;
  resetOnEnable: boolean;
  rolloverEnabled: boolean;
  rolloverMaxBalance: number | null;
  usageModel: string;
  creditCost: number;
  initialUsage?: number;
  usageScopeKey?: string | null;
};

type UsageMeterResult = {
  allowed: boolean;
  balance: number;
  usage: number;
  limit: number | null;
  code: string;
  rolloverBalance: number;
};

type CustomerAccessEnv = {
  USAGE_METER?: any;
  USAGE_LEDGER?: any;
};

type BuildCustomerAccessSnapshotParams = {
  env: CustomerAccessEnv;
  organizationId: string | null;
  customerId: string;
  subscriptions: CustomerAccessSubscription[];
  planFeatures: CustomerAccessPlanFeature[];
  planEntitlements: CustomerAccessEntitlement[];
  manualEntitlements: CustomerAccessEntitlement[];
  creditBalances: CustomerAccessCreditBalance[];
  now?: number;
};

function defaultWindowStart(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function defaultWindowEnd(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getTime();
}

export function filterAccessGrantingSubscriptions(
  subscriptions: CustomerAccessSubscription[],
  now: number = Date.now(),
): CustomerAccessSubscription[] {
  return subscriptions.filter((subscription) => {
    if (
      !["active", "trialing", "pending_cancel"].includes(subscription.status)
    ) {
      return false;
    }

    if (subscription.status === "trialing") {
      const trialEnd = Number(subscription.currentPeriodEnd || 0);
      if (!Number.isFinite(trialEnd) || trialEnd <= now) {
        return false;
      }
    }

    if (
      subscription.cancelAt &&
      subscription.cancelAt < now &&
      !subscription.canceledAt
    ) {
      return false;
    }

    if (
      isPaidActivePastGracePeriod(
        {
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          planType: subscription.planType,
        },
        now,
      )
    ) {
      return false;
    }

    return true;
  });
}

export function composeCustomerAccessEntries(params: {
  subscriptions: CustomerAccessSubscription[];
  planFeatures: CustomerAccessPlanFeature[];
  planEntitlements: CustomerAccessEntitlement[];
  manualEntitlements: CustomerAccessEntitlement[];
}): Array<{
  featureId: string;
  featureName: string;
  featureSlug: string | null;
  featureType: string;
  unit: string | null;
  planFeature: CustomerAccessPlanFeature | null;
  planEntitlement: CustomerAccessEntitlement | null;
  manualEntitlement: CustomerAccessEntitlement | null;
  effectiveEntitlement: CustomerAccessPlanFeature | CustomerAccessEntitlement;
  subscription: CustomerAccessSubscription | null;
}> {
  const subscriptionOrder = new Map(
    params.subscriptions.map((subscription, index) => [
      subscription.planId,
      index,
    ]),
  );

  const planFeatureByFeatureId = new Map<string, CustomerAccessPlanFeature>();
  for (const planFeature of params.planFeatures) {
    const existing = planFeatureByFeatureId.get(planFeature.featureId);
    if (!existing) {
      planFeatureByFeatureId.set(planFeature.featureId, planFeature);
      continue;
    }

    const existingIndex = subscriptionOrder.get(existing.planId) ?? Infinity;
    const currentIndex = subscriptionOrder.get(planFeature.planId) ?? Infinity;
    if (currentIndex < existingIndex) {
      planFeatureByFeatureId.set(planFeature.featureId, planFeature);
    }
  }

  const planEntitlementByFeatureId = new Map<
    string,
    CustomerAccessEntitlement
  >();
  for (const entitlement of params.planEntitlements) {
    if (!planEntitlementByFeatureId.has(entitlement.featureId)) {
      planEntitlementByFeatureId.set(entitlement.featureId, entitlement);
    }
  }

  const manualEntitlementByFeatureId = new Map<
    string,
    CustomerAccessEntitlement
  >();
  for (const entitlement of params.manualEntitlements) {
    if (!manualEntitlementByFeatureId.has(entitlement.featureId)) {
      manualEntitlementByFeatureId.set(entitlement.featureId, entitlement);
    }
  }

  const featureIds = [
    ...new Set([
      ...params.planFeatures.map((feature) => feature.featureId),
      ...params.planEntitlements.map((entitlement) => entitlement.featureId),
      ...params.manualEntitlements.map((entitlement) => entitlement.featureId),
    ]),
  ];

  return featureIds
    .map((featureId) => {
      const planFeature = planFeatureByFeatureId.get(featureId) ?? null;
      const planEntitlement = planEntitlementByFeatureId.get(featureId) ?? null;
      const manualEntitlement =
        manualEntitlementByFeatureId.get(featureId) ?? null;
      const effectiveEntitlement =
        manualEntitlement ?? planEntitlement ?? planFeature;

      if (!effectiveEntitlement) {
        return null;
      }

      const subscription = planFeature
        ? (params.subscriptions.find(
            (candidate) => candidate.planId === planFeature.planId,
          ) ?? null)
        : (params.subscriptions[0] ?? null);

      return {
        featureId,
        featureName: effectiveEntitlement.featureName,
        featureSlug: effectiveEntitlement.featureSlug,
        featureType: effectiveEntitlement.featureType,
        unit: effectiveEntitlement.unit,
        planFeature,
        planEntitlement,
        manualEntitlement,
        effectiveEntitlement,
        subscription,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => {
      const leftIndex =
        left.planFeature &&
        left.subscription?.planId === left.planFeature.planId
          ? (subscriptionOrder.get(left.planFeature.planId) ?? Infinity)
          : Infinity;
      const rightIndex =
        right.planFeature &&
        right.subscription?.planId === right.planFeature.planId
          ? (subscriptionOrder.get(right.planFeature.planId) ?? Infinity)
          : Infinity;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      return left.featureName.localeCompare(right.featureName);
    });
}

async function resolveMeteredBalance(params: {
  env: CustomerAccessEnv;
  organizationId: string | null;
  customerId: string;
  featureId: string;
  featureSlug: string | null;
  limitValue: number | null;
  trialLimitValue?: number | null;
  resetInterval: string | null;
  usageModel: string | null;
  creditCost: number | null;
  resetOnEnable: boolean | null;
  rolloverEnabled: boolean | null;
  rolloverMaxBalance: number | null;
  subscription: CustomerAccessSubscription | null;
}): Promise<{
  balance: number | null;
  usage: number | null;
  limit: number | null;
  rolloverBalance: number;
}> {
  const isTrialing = params.subscription?.status === "trialing";
  const activeLimit =
    isTrialing && params.trialLimitValue != null
      ? params.trialLimitValue
      : params.limitValue;

  const resetInterval = params.resetInterval || "monthly";
  const resetsOnPlanEnable = shouldResetUsageOnPlanEnable({
    usageModel: params.usageModel,
    resetOnEnable: params.resetOnEnable,
  });
  const usagePlanScope = resolveUsagePlanScope(
    {
      usageModel: params.usageModel,
      resetOnEnable: params.resetOnEnable,
    },
    params.subscription,
  );
  const usageLedgerScope = resolveUsageLedgerScope(
    {
      usageModel: params.usageModel,
      resetOnEnable: params.resetOnEnable,
    },
    params.subscription,
  );
  const legacyUsageLedgerScope = resolveLegacyUsageLedgerScope(
    {
      usageModel: params.usageModel,
      resetOnEnable: params.resetOnEnable,
    },
    params.subscription,
  );
  const currentConfig: UsageMeterConfig = {
    limit: activeLimit,
    resetInterval,
    resetOnEnable: resetsOnPlanEnable,
    rolloverEnabled: params.rolloverEnabled ?? false,
    rolloverMaxBalance: params.rolloverMaxBalance ?? null,
    usageModel: params.usageModel || "included",
    creditCost: params.creditCost ?? 0,
    usageScopeKey: usagePlanScope ?? null,
  };

  const featureKey = params.featureSlug || params.featureId;
  if (params.env.USAGE_METER && params.organizationId) {
    try {
      const doId = params.env.USAGE_METER.idFromName(
        `${params.organizationId}:${params.customerId}`,
      );
      const usageMeter = params.env.USAGE_METER.get(doId) as {
        check: (
          featureId: string,
          requiredBalance?: number,
          currentConfig?: UsageMeterConfig,
        ) => Promise<UsageMeterResult>;
        configureFeature: (
          featureId: string,
          config: UsageMeterConfig,
          options?: { lazy?: boolean },
        ) => Promise<{ success: boolean }>;
      };
      let result = await usageMeter.check(featureKey, 0, currentConfig);

      if (result.code === "feature_not_found") {
        const subscriptionWindowStart =
          params.subscription?.currentPeriodStart ??
          defaultWindowStart(Date.now());
        const subscriptionWindowEnd =
          params.subscription?.currentPeriodEnd ?? defaultWindowEnd(Date.now());
        const resetWindow = getResetPeriod(
          resetInterval,
          subscriptionWindowStart,
          subscriptionWindowEnd,
        );

        const ledgerUsage = await sumScopedUsageAmount(
          {
            usageLedger: params.env.USAGE_LEDGER,
            organizationId: params.organizationId,
          },
          {
            customerId: params.customerId,
            featureId: params.featureId,
            createdAtFrom: resetWindow.periodStart,
            createdAtTo: resetWindow.periodEnd,
            scope: usageLedgerScope,
            legacyPlanScope: legacyUsageLedgerScope,
            legacyCreatedAtFloor: params.subscription?.currentPeriodStart ?? null,
          },
        );

        await usageMeter.configureFeature(featureKey, {
          ...currentConfig,
          initialUsage: ledgerUsage ?? 0,
        });
        result = await usageMeter.check(featureKey, 0);
      }

      return {
        balance: result.limit === null ? null : result.balance,
        usage: result.usage,
        limit: result.limit,
        rolloverBalance: result.rolloverBalance || 0,
      };
    } catch (error) {
      console.error("[customer-access] usage meter lookup failed:", error);
    }
  }

  if (params.limitValue === null) {
    return {
      balance: null,
      usage: null,
      limit: null,
      rolloverBalance: 0,
    };
  }

  const subscriptionWindowStart =
    params.subscription?.currentPeriodStart ?? defaultWindowStart(Date.now());
  const subscriptionWindowEnd =
    params.subscription?.currentPeriodEnd ?? defaultWindowEnd(Date.now());
  const resetWindow = getResetPeriod(
    resetInterval,
    subscriptionWindowStart,
    subscriptionWindowEnd,
  );
  const ledgerUsage = await sumScopedUsageAmount(
    {
      usageLedger: params.env.USAGE_LEDGER,
      organizationId: params.organizationId,
    },
    {
      customerId: params.customerId,
      featureId: params.featureId,
      createdAtFrom: resetWindow.periodStart,
      createdAtTo: resetWindow.periodEnd,
      scope: usageLedgerScope,
      legacyPlanScope: legacyUsageLedgerScope,
      legacyCreatedAtFloor: params.subscription?.currentPeriodStart ?? null,
    },
  );
  const usage = ledgerUsage ?? 0;

  return {
    balance: activeLimit !== null ? Math.max(0, activeLimit - usage) : null,
    usage,
    limit: activeLimit,
    rolloverBalance: 0,
  };
}

export async function buildCustomerAccessSnapshot(
  params: BuildCustomerAccessSnapshotParams,
): Promise<CustomerAccessItem[]> {
  const validSubscriptions = filterAccessGrantingSubscriptions(
    params.subscriptions,
    params.now,
  );
  const entries = composeCustomerAccessEntries({
    subscriptions: validSubscriptions,
    planFeatures: params.planFeatures.filter((planFeature) =>
      validSubscriptions.some(
        (subscription) => subscription.planId === planFeature.planId,
      ),
    ),
    planEntitlements: params.planEntitlements,
    manualEntitlements: params.manualEntitlements,
  });

  const addonBalanceByFeatureId = new Map(
    params.creditBalances.map((row) => [row.creditSystemId, row.balance]),
  );

  return Promise.all(
    entries.map(async (entry) => {
      const balanceState =
        entry.featureType === "metered"
          ? await resolveMeteredBalance({
              env: params.env,
              organizationId: params.organizationId,
              customerId: params.customerId,
              featureId: entry.featureId,
              featureSlug: entry.featureSlug,
              limitValue: entry.effectiveEntitlement.limitValue ?? null,
              trialLimitValue: entry.planFeature?.trialLimitValue ?? null,
              resetInterval:
                entry.manualEntitlement?.resetInterval ??
                entry.planEntitlement?.resetInterval ??
                entry.planFeature?.resetInterval ??
                "monthly",
              usageModel: entry.planFeature?.usageModel ?? "included",
              creditCost: entry.planFeature?.creditCost ?? 0,
              resetOnEnable: entry.planFeature?.resetOnEnable ?? false,
              rolloverEnabled: entry.planFeature?.rolloverEnabled ?? false,
              rolloverMaxBalance: entry.planFeature?.rolloverMaxBalance ?? null,
              subscription: entry.subscription,
            })
          : null;

      const isTrialing = entry.subscription?.status === "trialing";
      const planTrialLimitValue = entry.planFeature?.trialLimitValue ?? null;
      const effectiveLimit =
        balanceState?.limit ?? entry.effectiveEntitlement.limitValue ?? null;

      return {
        featureId: entry.featureId,
        featureName: entry.featureName,
        featureSlug: entry.featureSlug,
        featureType: entry.featureType,
        unit: entry.unit,
        planId: entry.planFeature?.planId ?? null,
        planName: entry.subscription?.planName ?? null,
        planLimitValue: entry.planFeature?.limitValue ?? null,
        planTrialLimitValue,
        planResetInterval: entry.planFeature?.resetInterval ?? null,
        entitlementLimitValue: entry.effectiveEntitlement.limitValue ?? null,
        entitlementResetInterval:
          entry.manualEntitlement?.resetInterval ??
          entry.planEntitlement?.resetInterval ??
          entry.planFeature?.resetInterval ??
          null,
        entitlementExpiresAt:
          "expiresAt" in entry.effectiveEntitlement
            ? (entry.effectiveEntitlement.expiresAt ?? null)
            : null,
        entitlementSource: entry.manualEntitlement ? "manual" : "plan",
        grantedReason: entry.manualEntitlement?.grantedReason ?? null,
        balance: balanceState?.balance ?? null,
        usage: balanceState?.usage ?? null,
        limit: effectiveLimit,
        isTrialing,
        isTrialLimit:
          isTrialing &&
          planTrialLimitValue !== null &&
          effectiveLimit === planTrialLimitValue,
        rolloverBalance: balanceState?.rolloverBalance ?? 0,
        addonBalance: addonBalanceByFeatureId.get(entry.featureId) ?? null,
      };
    }),
  );
}
