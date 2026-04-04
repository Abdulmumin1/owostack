type UsageScopeConfig = {
  usageModel?: string | null;
  resetOnEnable?: boolean | null;
};

export type UsageScopeSubscription = {
  id?: string | null;
  planId?: string | null;
  currentPeriodStart?: number | null;
};

export type UsageLedgerScope = {
  subscriptionId?: string | null;
  planId?: string | null;
};

export function shouldResetUsageOnPlanEnable(
  config: UsageScopeConfig,
): boolean {
  if (config.usageModel === "usage_based") {
    return config.resetOnEnable ?? false;
  }

  return true;
}

export function resolveUsagePlanScope(
  config: UsageScopeConfig,
  subscription?: UsageScopeSubscription | null,
): string | undefined {
  if (!shouldResetUsageOnPlanEnable(config)) return undefined;

  const segments: string[] = [];
  if (subscription?.id) {
    segments.push(`subscription:${subscription.id}`);
  }
  if (subscription?.planId) {
    segments.push(`plan:${subscription.planId}`);
  }

  return segments.length > 0 ? `v2|${segments.join("|")}` : undefined;
}

export function resolveUsageLedgerScope(
  config: UsageScopeConfig,
  subscription?: UsageScopeSubscription | null,
): UsageLedgerScope {
  if (!shouldResetUsageOnPlanEnable(config)) return {};

  return {
    ...(subscription?.id ? { subscriptionId: subscription.id } : {}),
    ...(subscription?.planId ? { planId: subscription.planId } : {}),
  };
}

export function resolveLegacyUsageLedgerScope(
  config: UsageScopeConfig,
  subscription?: UsageScopeSubscription | null,
): UsageLedgerScope {
  if (!shouldResetUsageOnPlanEnable(config)) return {};
  if (!subscription?.id || !subscription.planId) return {};

  return {
    subscriptionId: null,
    planId: subscription.planId,
  };
}
