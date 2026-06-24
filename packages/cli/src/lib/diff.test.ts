import { describe, expect, it } from "vitest";
import { diffPlans } from "./diff.js";

const basePlan = {
  slug: "pro",
  name: "Pro",
  description: "Pro plan",
  price: 5000,
  currency: "USD",
  interval: "monthly",
  billingType: "recurring",
  planGroup: "main",
  trialDays: 7,
  isAddon: false,
  autoEnable: true,
  provider: "stripe",
  metadata: { checkout: "hosted" },
  features: [
    {
      slug: "api-calls",
      enabled: true,
      limit: 1000,
      trialLimit: 100,
      reset: "monthly",
      usageModel: "included",
      overage: "block",
    },
  ],
};

describe("diffPlans", () => {
  it("reports provider-only plan changes so sync will not be skipped", () => {
    const diff = diffPlans({
      localPlans: [basePlan],
      remotePlans: [{ ...basePlan, provider: "paystack" }],
    });

    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.slug).toBe("pro");
    expect(diff.changed[0]?.details.join("\n")).toContain("provider");
  });

  it("reports metadata-only plan changes so sync will not be skipped", () => {
    const diff = diffPlans({
      localPlans: [basePlan],
      remotePlans: [{ ...basePlan, metadata: { checkout: "embedded" } }],
    });

    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.details.join("\n")).toContain("metadata");
  });

  it("reports feature definition changes even when plan feature limits match", () => {
    const diff = diffPlans({
      localPlans: [],
      remotePlans: [],
      localFeatures: [
        {
          slug: "api-calls",
          name: "API Calls",
          type: "metered",
          meterType: "consumable",
        },
      ],
      remoteFeatures: [
        {
          slug: "api-calls",
          name: "Requests",
          type: "metered",
          meterType: "consumable",
        },
      ],
    });

    expect(diff.features.changed).toHaveLength(1);
    expect(diff.features.changed[0]?.details.join("\n")).toContain("name");
  });

  it("does not treat local top-level features as local-only when the API did not return a feature collection", () => {
    const diff = diffPlans({
      localPlans: [],
      remotePlans: [],
      localFeatures: [
        {
          slug: "api-calls",
          name: "API Calls",
          type: "metered",
          meterType: "consumable",
        },
      ],
    });

    expect(diff.features.onlyLocal).toEqual([]);
    expect(diff.features.changed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });
});
