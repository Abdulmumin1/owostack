import type { PricingTier, RatingModel } from "@owostack/types";
import { normalizeRatingModel } from "./usage-rating";

export interface UsagePricingSnapshot {
  usageModel: "included" | "usage_based" | "prepaid";
  ratingModel: RatingModel;
  included: number | null;
  pricePerUnit: number | null;
  billingUnits: number | null;
  overagePrice: number | null;
  tiers: PricingTier[] | null;
}

export function buildUsagePricingSnapshot(planFeature: any): UsagePricingSnapshot {
  const usageModel =
    planFeature?.usageModel === "usage_based"
      ? "usage_based"
      : planFeature?.usageModel === "prepaid"
        ? "prepaid"
        : "included";

  return {
    usageModel,
    ratingModel: normalizeRatingModel(planFeature?.ratingModel),
    included: usageModel === "usage_based" ? 0 : (planFeature?.limitValue ?? null),
    pricePerUnit: planFeature?.pricePerUnit ?? null,
    billingUnits: planFeature?.billingUnits ?? null,
    overagePrice: planFeature?.overagePrice ?? null,
    tiers: Array.isArray(planFeature?.tiers) ? planFeature.tiers : null,
  };
}
