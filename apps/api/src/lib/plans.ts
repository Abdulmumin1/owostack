export function sanitizeOneTimePlanFlags<
  T extends {
    billingType?: string | null;
    trialDays?: number;
    trialCardRequired?: boolean;
    autoEnable?: boolean;
  },
>(data: T, billingTypeOverride?: string | null): T {
  const billingType = billingTypeOverride ?? data.billingType;
  if (billingType !== "one_time") return data;

  return {
    ...data,
    trialDays: 0,
    trialCardRequired: false,
    autoEnable: false,
  };
}

export function normalizeOneTimePlan<
  T extends {
    billingType?: string | null;
    trialDays?: number | null;
    trialCardRequired?: boolean | null;
    autoEnable?: boolean | null;
  },
>(plan: T): T {
  if (plan.billingType !== "one_time") {
    return {
      ...plan,
      trialDays: plan.trialDays ?? 0,
      autoEnable: plan.autoEnable ?? false,
      trialCardRequired: plan.trialCardRequired ?? false,
    };
  }

  return {
    ...plan,
    trialDays: 0,
    trialCardRequired: false,
    autoEnable: false,
  };
}
