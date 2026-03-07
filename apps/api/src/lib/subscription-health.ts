export const PAID_SUBSCRIPTION_PERIOD_GRACE_MS = 72 * 60 * 60 * 1000;

const PLACEHOLDER_SUBSCRIPTION_CODES = new Set([
  "one-time",
  "charge",
  "upgrade",
]);

export interface SubscriptionHealthInput {
  status?: string | null;
  currentPeriodEnd?: number | null;
  providerId?: string | null;
  providerSubscriptionCode?: string | null;
  paystackSubscriptionCode?: string | null;
  planType?: string | null;
}

export interface SubscriptionHealthState {
  pastGracePeriodEnd: boolean;
  providerLinkMissing: boolean;
  requiresAction: boolean;
}

export function isFreePlanType(planType: string | null | undefined): boolean {
  return (planType || "").trim().toLowerCase() === "free";
}

export function isPlaceholderSubscriptionCode(
  code: string | null | undefined,
): boolean {
  if (!code) return false;
  const normalized = code.trim().toLowerCase();
  return (
    PLACEHOLDER_SUBSCRIPTION_CODES.has(normalized) ||
    normalized.startsWith("trial-") ||
    normalized.startsWith("charge")
  );
}

export function resolveSubscriptionCode(
  subscription: Pick<
    SubscriptionHealthInput,
    "providerSubscriptionCode" | "paystackSubscriptionCode"
  >,
): string | null {
  const code =
    subscription.providerSubscriptionCode || subscription.paystackSubscriptionCode;
  if (!code) return null;
  const normalized = code.trim();
  return normalized.length > 0 ? normalized : null;
}

export function isPaidActivePastGracePeriod(
  subscription: SubscriptionHealthInput,
  now: number = Date.now(),
  graceMs: number = PAID_SUBSCRIPTION_PERIOD_GRACE_MS,
): boolean {
  if ((subscription.status || "").toLowerCase() !== "active") return false;
  if (isFreePlanType(subscription.planType)) return false;

  const periodEnd = Number(subscription.currentPeriodEnd || 0);
  if (!Number.isFinite(periodEnd) || periodEnd <= 0) return false;

  return now > periodEnd + Math.max(0, graceMs);
}

export function isPaidSubscriptionProviderLinkMissing(
  subscription: SubscriptionHealthInput,
): boolean {
  if (isFreePlanType(subscription.planType)) return false;
  if ((subscription.status || "").toLowerCase() !== "active") return false;

  const providerId = (subscription.providerId || "").trim();
  const subscriptionCode = resolveSubscriptionCode(subscription);

  return (
    providerId.length === 0 ||
    !subscriptionCode ||
    isPlaceholderSubscriptionCode(subscriptionCode)
  );
}

export function getSubscriptionHealthState(
  subscription: SubscriptionHealthInput,
  now: number = Date.now(),
  graceMs: number = PAID_SUBSCRIPTION_PERIOD_GRACE_MS,
): SubscriptionHealthState {
  const pastGracePeriodEnd = isPaidActivePastGracePeriod(
    subscription,
    now,
    graceMs,
  );
  const providerLinkMissing = isPaidSubscriptionProviderLinkMissing(subscription);

  return {
    pastGracePeriodEnd,
    providerLinkMissing,
    requiresAction: pastGracePeriodEnd || providerLinkMissing,
  };
}
