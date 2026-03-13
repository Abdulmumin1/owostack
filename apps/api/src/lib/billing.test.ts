import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingService } from "./billing";

function createDbMock(overrides?: {
  overagePrice?: number;
  billingUnits?: number;
}) {
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
                overagePrice: overrides?.overagePrice ?? 500,
                billingUnits: overrides?.billingUnits ?? 100,
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
  const sumUnbilledByFeaturePeriodMock = vi.fn();
  const markUsageInvoicedMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the just-finished reset window invoiceable after a rollover", async () => {
    sumUnbilledByFeaturePeriodMock.mockResolvedValue([
      {
        featureId: "feature_1",
        periodStart: 1_000,
        periodEnd: 1_999,
        totalUsage: 1_200,
        lastCreatedAt: 1_900,
      },
    ]);

    const service = new BillingService(createDbMock() as any, {
      deps: {
        sumUnbilledByFeaturePeriod:
          sumUnbilledByFeaturePeriodMock as any,
        markUsageInvoiced: markUsageInvoicedMock as any,
      },
    });
    const result = await service.getUnbilledUsage("cust_1", "org_1");

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.customerId).toBe("cust_1");
    expect(result.value.currency).toBe("USD");
    expect(result.value.totalEstimated).toBe(1000);
    expect(result.value.usageWindowEnd).toBe(1_900);
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
    sumUnbilledByFeaturePeriodMock.mockResolvedValue([
      {
        featureId: "feature_1",
        periodStart: 1_000,
        periodEnd: 1_999,
        totalUsage: 1_200,
        lastCreatedAt: 1_900,
      },
      {
        featureId: "feature_1",
        periodStart: 2_000,
        periodEnd: 2_999,
        totalUsage: 1_100,
        lastCreatedAt: 2_900,
      },
    ]);

    const service = new BillingService(createDbMock() as any, {
      deps: {
        sumUnbilledByFeaturePeriod:
          sumUnbilledByFeaturePeriodMock as any,
        markUsageInvoiced: markUsageInvoicedMock as any,
      },
    });
    const result = await service.getUnbilledUsage("cust_1", "org_1");

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.totalEstimated).toBe(1500);
    expect(result.value.usageWindowEnd).toBe(2_900);
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

  it("rates usage from the recorded pricing snapshot instead of the customer's current plan", async () => {
    sumUnbilledByFeaturePeriodMock.mockResolvedValue([
      {
        featureId: "feature_1",
        featureSlug: "api-calls",
        featureName: "API Calls",
        planId: "plan_old",
        subscriptionId: "sub_old",
        periodStart: 1_000,
        periodEnd: 1_999,
        totalUsage: 1_200,
        lastCreatedAt: 1_900,
        pricingSnapshot: {
          usageModel: "included",
          ratingModel: "package",
          included: 1_000,
          pricePerUnit: null,
          billingUnits: 100,
          overagePrice: 500,
          tiers: null,
        },
      },
    ]);

    const service = new BillingService(
      createDbMock({ overagePrice: 900, billingUnits: 100 }) as any,
      {
        deps: {
          sumUnbilledByFeaturePeriod:
            sumUnbilledByFeaturePeriodMock as any,
          markUsageInvoiced: markUsageInvoicedMock as any,
        },
      },
    );
    const result = await service.getUnbilledUsage("cust_1", "org_1");

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.totalEstimated).toBe(1000);
    expect(result.value.features).toEqual([
      expect.objectContaining({
        featureId: "feature_1",
        featureSlug: "api-calls",
        featureName: "API Calls",
        planId: "plan_old",
        subscriptionId: "sub_old",
        usage: 1200,
        billableQuantity: 200,
        estimatedAmount: 1000,
      }),
    ]);
  });

  it("forwards a fixed usage cutoff when previewing a billing slice", async () => {
    sumUnbilledByFeaturePeriodMock.mockResolvedValue([
      {
        featureId: "feature_1",
        periodStart: 1_000,
        periodEnd: 1_999,
        totalUsage: 1_200,
        lastCreatedAt: 1_850,
      },
    ]);

    const service = new BillingService(createDbMock() as any, {
      deps: {
        sumUnbilledByFeaturePeriod:
          sumUnbilledByFeaturePeriodMock as any,
        markUsageInvoiced: markUsageInvoicedMock as any,
      },
    });
    const result = await service.getUnbilledUsage("cust_1", "org_1", {
      usageCutoffAt: 1_900,
    });

    expect(result.isOk()).toBe(true);
    expect(sumUnbilledByFeaturePeriodMock).toHaveBeenCalledWith(
      expect.anything(),
      "cust_1",
      1_900,
    );
    if (result.isErr()) return;
    expect(result.value.usageWindowEnd).toBe(1_900);
  });

  it("fails closed when the authoritative usage ledger is unavailable", async () => {
    sumUnbilledByFeaturePeriodMock.mockResolvedValue(null);

    const service = new BillingService(createDbMock() as any, {
      deps: {
        sumUnbilledByFeaturePeriod:
          sumUnbilledByFeaturePeriodMock as any,
        markUsageInvoiced: markUsageInvoicedMock as any,
      },
    });
    const result = await service.getUnbilledUsage("cust_1", "org_1");

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.message).toContain("UsageLedgerDO unavailable");
  });
});
