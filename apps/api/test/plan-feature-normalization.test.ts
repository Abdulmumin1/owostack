import { describe, expect, it } from "vitest";
import {
  normalizePlanFeatureLimitValue,
  normalizePlanFeatureOverage,
  normalizePlanFeaturePricingConfig,
  normalizePlanFeatureResetInterval,
  validatePlanFeaturePricingConfig,
} from "../src/lib/plan-feature-normalization";

describe("plan-feature-normalization", () => {
  it("canonicalizes reset interval aliases", () => {
    expect(normalizePlanFeatureResetInterval("hour")).toBe("hourly");
    expect(normalizePlanFeatureResetInterval("day")).toBe("daily");
    expect(normalizePlanFeatureResetInterval("week")).toBe("weekly");
    expect(normalizePlanFeatureResetInterval("month")).toBe("monthly");
    expect(normalizePlanFeatureResetInterval("quarter")).toBe("quarterly");
    expect(normalizePlanFeatureResetInterval("year")).toBe("yearly");
    expect(normalizePlanFeatureResetInterval("none")).toBe("none");
  });

  it("forces charge overage for usage-based features", () => {
    expect(normalizePlanFeatureOverage("usage_based", "block")).toBe("charge");
    expect(normalizePlanFeatureOverage("usage_based", undefined)).toBe(
      "charge",
    );
    expect(normalizePlanFeatureOverage("included", "charge")).toBe("charge");
    expect(normalizePlanFeatureOverage("included", undefined)).toBe("block");
  });

  it("clears included limits for usage-based features", () => {
    expect(normalizePlanFeatureLimitValue("usage_based", 1000)).toBeNull();
    expect(normalizePlanFeatureLimitValue("included", 1000)).toBe(1000);
  });

  it("normalizes stale package fields when switching to tiered usage-based pricing", () => {
    expect(
      normalizePlanFeaturePricingConfig({
        usageModel: "usage_based",
        ratingModel: "volume",
        limitValue: 5000,
        pricePerUnit: 99,
        billingUnits: 1000,
        overage: "block",
        overagePrice: 500,
        tiers: [{ upTo: null, flatFee: 10000 }],
      }),
    ).toEqual({
      usageModel: "usage_based",
      ratingModel: "volume",
      limitValue: null,
      trialLimitValue: null,
      pricePerUnit: null,
      billingUnits: 1,
      overage: "charge",
      overagePrice: null,
      tiers: [{ upTo: null, flatFee: 10000 }],
    });
  });

  it("rejects invalid tier ordering", () => {
    expect(
      validatePlanFeaturePricingConfig({
        usageModel: "usage_based",
        ratingModel: "graduated",
        tiers: [
          { upTo: 1000, unitPrice: 5 },
          { upTo: 500, unitPrice: 4 },
        ],
      }),
    ).toBe("Tier 2 must end above tier 1.");
  });

  it("requires package pricing to define a charge amount", () => {
    expect(
      validatePlanFeaturePricingConfig({
        usageModel: "usage_based",
        ratingModel: "package",
        pricePerUnit: null,
      }),
    ).toBe("Usage-based package pricing requires pricePerUnit.");
  });

  describe("trialLimitValue", () => {
    it("clears trialLimitValue for usage-based features", () => {
      expect(
        normalizePlanFeaturePricingConfig({
          usageModel: "usage_based",
          limitValue: 1000,
          trialLimitValue: 500,
        }),
      ).toEqual({
        usageModel: "usage_based",
        limitValue: null,
        trialLimitValue: null,
        overage: "charge",
      });
    });

    it("preserves trialLimitValue for included features", () => {
      expect(
        normalizePlanFeaturePricingConfig({
          usageModel: "included",
          limitValue: 10000,
          trialLimitValue: 1000,
        }),
      ).toEqual({
        usageModel: "included",
        limitValue: 10000,
        trialLimitValue: 1000,
      });
    });

    it("handles null trialLimitValue", () => {
      expect(
        normalizePlanFeaturePricingConfig({
          usageModel: "included",
          limitValue: 10000,
          trialLimitValue: null,
        }),
      ).toEqual({
        usageModel: "included",
        limitValue: 10000,
        trialLimitValue: null,
      });
    });

    it("preserves trialLimitValue when not explicitly set", () => {
      const result = normalizePlanFeaturePricingConfig({
        usageModel: "included",
        limitValue: 10000,
      });
      expect(result.limitValue).toBe(10000);
      expect(result.trialLimitValue).toBeUndefined();
    });
  });
});
