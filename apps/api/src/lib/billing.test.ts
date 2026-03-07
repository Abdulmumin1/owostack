import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSumUnbilledByFeaturePeriod } = vi.hoisted(() => ({
  mockSumUnbilledByFeaturePeriod: vi.fn(),
}));

vi.mock("./usage-ledger", () => ({
  sumUnbilledByFeaturePeriod: mockSumUnbilledByFeaturePeriod,
  markUsageInvoiced: vi.fn(),
}));

import { BillingService } from "./billing";

function createDbMock() {
  return {
    query: {
      customers: {
        findFirst: vi.fn().mockResolvedValue({
          id: "cust_1",
          organizationId: "org_1",
        }),
      },
      subscriptions: {
        findFirst: vi.fn().mockResolvedValue({
          id: "sub_1",
          customerId: "cust_1",
          currentPeriodStart: 2_000,
          currentPeriodEnd: 3_000,
          plan: {
            currency: "USD",
            planFeatures: [
              {
                featureId: "feature_1",
                usageModel: "included",
                overage: "charge",
                limitValue: 1000,
                overagePrice: 500,
                billingUnits: 100,
                ratingModel: "package",
                pricePerUnit: null,
                tiers: null,
                feature: {
                  slug: "api-calls",
                  name: "API Calls",
                },
              },
            ],
          },
        }),
      },
    },
  };
}

describe("BillingService.getUnbilledUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the just-finished reset window invoiceable after a rollover", async () => {
    mockSumUnbilledByFeaturePeriod.mockResolvedValue([
      {
        featureId: "feature_1",
        periodStart: 1_000,
        periodEnd: 1_999,
        totalUsage: 1_200,
      },
    ]);

    const service = new BillingService(createDbMock() as any, {});
    const result = await service.getUnbilledUsage("cust_1", "org_1");

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.customerId).toBe("cust_1");
    expect(result.value.currency).toBe("USD");
    expect(result.value.totalEstimated).toBe(1000);
    expect(result.value.features).toEqual([
      expect.objectContaining({
        featureId: "feature_1",
        usage: 1200,
        billableQuantity: 200,
        estimatedAmount: 1000,
        periodStart: 1_000,
        periodEnd: 1_999,
      }),
    ]);
  });

  it("keeps uninvoiced usage split by recorded period instead of collapsing to the current window", async () => {
    mockSumUnbilledByFeaturePeriod.mockResolvedValue([
      {
        featureId: "feature_1",
        periodStart: 1_000,
        periodEnd: 1_999,
        totalUsage: 1_200,
      },
      {
        featureId: "feature_1",
        periodStart: 2_000,
        periodEnd: 2_999,
        totalUsage: 1_100,
      },
    ]);

    const service = new BillingService(createDbMock() as any, {});
    const result = await service.getUnbilledUsage("cust_1", "org_1");

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.totalEstimated).toBe(1500);
    expect(result.value.features).toEqual([
      expect.objectContaining({
        periodStart: 1_000,
        periodEnd: 1_999,
        billableQuantity: 200,
        estimatedAmount: 1000,
      }),
      expect.objectContaining({
        periodStart: 2_000,
        periodEnd: 2_999,
        billableQuantity: 100,
        estimatedAmount: 500,
      }),
    ]);
  });
});
