import type { PricingTier, RatingModel } from "@owostack/types";

type UsageModel = "included" | "usage_based" | "prepaid";

function normalizeUsageModel(usageModel?: string | null): UsageModel {
  if (usageModel === "usage_based" || usageModel === "prepaid") {
    return usageModel;
  }

  return "included";
}

function normalizeRatingModel(ratingModel?: string | null): RatingModel {
  if (ratingModel === "graduated" || ratingModel === "volume") {
    return ratingModel;
  }

  return "package";
}

export function normalizePlanFeatureResetInterval(
  resetInterval?: string | null,
): string | null {
  if (!resetInterval) return null;

  switch (resetInterval) {
    case "hour":
      return "hourly";
    case "day":
      return "daily";
    case "week":
      return "weekly";
    case "month":
      return "monthly";
    case "quarter":
      return "quarterly";
    case "year":
    case "annually":
      return "yearly";
    default:
      return resetInterval;
  }
}

export function normalizePlanFeatureOverage(
  usageModel?: string | null,
  overage?: string | null,
): "block" | "charge" {
  if (usageModel === "usage_based") return "charge";
  return overage === "charge" ? "charge" : "block";
}

export function normalizePlanFeatureLimitValue(
  usageModel?: string | null,
  limitValue?: number | null,
): number | null | undefined {
  if (usageModel === "usage_based") return null;
  return limitValue;
}

export interface PlanFeaturePricingConfigInput {
  limitValue?: number | null;
  trialLimitValue?: number | null;
  resetInterval?: string | null;
  usageModel?: string | null;
  pricePerUnit?: number | null;
  billingUnits?: number | null;
  ratingModel?: string | null;
  tiers?: PricingTier[] | null;
  overage?: string | null;
  overagePrice?: number | null;
  maxOverageUnits?: number | null;
  maxPurchaseLimit?: number | null;
  creditCost?: number | null;
  resetOnEnable?: boolean;
  rolloverEnabled?: boolean;
  rolloverMaxBalance?: number | null;
}

export function normalizePlanFeaturePricingConfig<
  T extends PlanFeaturePricingConfigInput,
>(config: T): T {
  const normalized = { ...config } as T;
  const usageModel = normalizeUsageModel(config.usageModel);
  const ratingModel = normalizeRatingModel(config.ratingModel);

  if ("resetInterval" in normalized) {
    normalized.resetInterval =
      normalizePlanFeatureResetInterval(config.resetInterval ?? null) ?? null;
  }

  if ("limitValue" in normalized || usageModel === "usage_based") {
    normalized.limitValue = normalizePlanFeatureLimitValue(
      usageModel,
      config.limitValue,
    );
  }

  if ("trialLimitValue" in normalized || usageModel === "usage_based") {
    normalized.trialLimitValue = normalizePlanFeatureLimitValue(
      usageModel,
      config.trialLimitValue,
    );
  }

  if ("overage" in normalized || usageModel === "usage_based") {
    normalized.overage = normalizePlanFeatureOverage(
      usageModel,
      config.overage,
    );
  }

  if (usageModel === "usage_based" && "overagePrice" in normalized) {
    normalized.overagePrice = null;
  }

  if (ratingModel === "package") {
    if ("tiers" in normalized) {
      normalized.tiers = null;
    }
  } else {
    if ("pricePerUnit" in normalized) {
      normalized.pricePerUnit = null;
    }
    if ("billingUnits" in normalized) {
      normalized.billingUnits = 1;
    }
  }

  return normalized;
}

export function validatePlanFeaturePricingConfig(
  config: PlanFeaturePricingConfigInput,
): string | null {
  const usageModel = normalizeUsageModel(config.usageModel);
  const ratingModel = normalizeRatingModel(config.ratingModel);
  const tiers = config.tiers ?? [];

  const numericFields: Array<[string, number | null | undefined]> = [
    ["limitValue", config.limitValue],
    ["pricePerUnit", config.pricePerUnit],
    ["overagePrice", config.overagePrice],
    ["billingUnits", config.billingUnits],
    ["maxOverageUnits", config.maxOverageUnits],
    ["maxPurchaseLimit", config.maxPurchaseLimit],
    ["creditCost", config.creditCost],
    ["rolloverMaxBalance", config.rolloverMaxBalance],
  ];

  for (const [field, value] of numericFields) {
    if (value == null) continue;
    if (!Number.isFinite(value) || value < 0) {
      return `${field} must be a non-negative number.`;
    }
  }

  if (config.billingUnits != null && config.billingUnits <= 0) {
    return "billingUnits must be greater than 0.";
  }

  if (ratingModel === "package") {
    if (tiers.length > 0) {
      return 'Package pricing cannot define "tiers".';
    }

    if (usageModel === "usage_based" && config.pricePerUnit == null) {
      return "Usage-based package pricing requires pricePerUnit.";
    }

    if (
      usageModel === "included" &&
      normalizePlanFeatureOverage(usageModel, config.overage) === "charge" &&
      config.overagePrice == null &&
      config.pricePerUnit == null
    ) {
      return "Charge overage pricing requires overagePrice or pricePerUnit.";
    }

    return null;
  }

  if (tiers.length === 0) {
    return `${ratingModel} pricing requires at least one tier.`;
  }

  let previousUpTo = 0;
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    const hasUnitPrice = tier.unitPrice !== undefined;
    const hasFlatFee = tier.flatFee !== undefined;

    if (!hasUnitPrice && !hasFlatFee) {
      return `Tier ${index + 1} must define unitPrice, flatFee, or both.`;
    }

    if (
      hasUnitPrice &&
      (!Number.isFinite(tier.unitPrice) || (tier.unitPrice as number) < 0)
    ) {
      return `Tier ${index + 1} must have a non-negative unitPrice.`;
    }

    if (
      hasFlatFee &&
      (!Number.isFinite(tier.flatFee) || (tier.flatFee as number) < 0)
    ) {
      return `Tier ${index + 1} must have a non-negative flatFee.`;
    }

    if (tier.upTo === null) {
      if (index !== tiers.length - 1) {
        return "Only the last tier can be open-ended.";
      }
      continue;
    }

    if (!Number.isFinite(tier.upTo) || tier.upTo <= previousUpTo) {
      return `Tier ${index + 1} must end above tier ${index}.`;
    }

    previousUpTo = tier.upTo;
  }

  return null;
}
