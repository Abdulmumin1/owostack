type ScopeMatchParams = {
  planId: string;
  subscriptionIds?: Iterable<string>;
};

function normalizeScopeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isPlanScopeKey(key: string): boolean {
  const normalized = normalizeScopeKey(key);
  return (
    normalized === "planid" ||
    normalized === "newplanid" ||
    normalized === "oldplanid"
  );
}

function isSubscriptionScopeKey(key: string): boolean {
  return normalizeScopeKey(key) === "subscriptionid";
}

function collectScopedValues(
  value: unknown,
  keyMatcher: (key: string) => boolean,
  acc: string[] = [],
): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectScopedValues(item, keyMatcher, acc);
    }
    return acc;
  }

  if (!value || typeof value !== "object") {
    return acc;
  }

  for (const [key, nestedValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (keyMatcher(key)) {
      if (typeof nestedValue === "string" && nestedValue.length > 0) {
        acc.push(nestedValue);
      } else if (typeof nestedValue === "number") {
        acc.push(String(nestedValue));
      }
    }

    collectScopedValues(nestedValue, keyMatcher, acc);
  }

  return acc;
}

export function eventMatchesCustomerPlanScope(
  data: Record<string, unknown> | null | undefined,
  params: ScopeMatchParams,
): boolean {
  if (!data) return false;

  const planIds = collectScopedValues(data, isPlanScopeKey);
  if (planIds.includes(params.planId)) {
    return true;
  }

  const subscriptionIdSet = new Set(params.subscriptionIds ?? []);
  if (subscriptionIdSet.size === 0) {
    return false;
  }

  const subscriptionIds = collectScopedValues(data, isSubscriptionScopeKey);
  return subscriptionIds.some((subscriptionId) =>
    subscriptionIdSet.has(subscriptionId),
  );
}

export function filterDashboardEventsToPlanScope<
  T extends { data?: Record<string, unknown> | null },
>(events: T[], params: ScopeMatchParams & { limit?: number }): T[] {
  const filtered = events.filter((event) =>
    eventMatchesCustomerPlanScope(event.data, params),
  );

  return filtered.slice(0, params.limit ?? filtered.length);
}

export function invoiceMatchesCustomerPlanScope(
  invoice: {
    subscriptionPlanId?: string | null;
    featureIds?: Array<string | null | undefined>;
    metadata?: Record<string, unknown> | null;
  },
  params: ScopeMatchParams & { scopedFeatureIds?: Iterable<string> },
): boolean {
  if (invoice.subscriptionPlanId === params.planId) {
    return true;
  }

  const scopedFeatureIdSet = new Set(params.scopedFeatureIds ?? []);
  if (
    scopedFeatureIdSet.size > 0 &&
    (invoice.featureIds ?? []).some(
      (featureId): featureId is string =>
        typeof featureId === "string" && scopedFeatureIdSet.has(featureId),
    )
  ) {
    return true;
  }

  return eventMatchesCustomerPlanScope(invoice.metadata, params);
}
