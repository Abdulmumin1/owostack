import { describe, expect, it } from "vitest";
import {
  buildCustomerAccessSnapshot,
  type CustomerAccessPlanFeature,
} from "../../../src/lib/customer-access";

describe("customer-access trial limit integration", () => {
  const baseSubscription = {
    id: "sub_1",
    status: "trialing",
    planId: "plan_1",
    planName: "Pro",
    planType: "paid",
    currentPeriodStart: Date.now() - 7 * 24 * 60 * 60 * 1000,
    currentPeriodEnd: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };

  const basePlanFeature: CustomerAccessPlanFeature = {
    planId: "plan_1",
    featureId: "feature_credits",
    featureName: "AI Credits",
    featureSlug: "ai-credits",
    featureType: "metered",
    unit: "credits",
    limitValue: 10000,
    resetInterval: "monthly",
    usageModel: "included",
    creditCost: 0,
    resetOnEnable: false,
    rolloverEnabled: false,
    rolloverMaxBalance: null,
  };

  it("uses trial limit when subscription is trialing and trial limit is set", async () => {
    const planFeatures: CustomerAccessPlanFeature[] = [
      {
        ...basePlanFeature,
        limitValue: 10000,
        trialLimitValue: 1000,
      },
    ];

    const subscriptions = [{ ...baseSubscription, status: "trialing" }];

    const snapshot = await buildCustomerAccessSnapshot({
      env: {},
      organizationId: "org_1",
      customerId: "cust_1",
      subscriptions,
      planFeatures,
      planEntitlements: [],
      manualEntitlements: [],
      creditBalances: [],
    });

    const accessItem = snapshot.find(
      (item) => item.featureId === "feature_credits",
    );
    expect(accessItem).toBeDefined();
    expect(accessItem?.limit).toBe(1000);
    expect(accessItem?.isTrialing).toBe(true);
    expect(accessItem?.isTrialLimit).toBe(true);
  });

  it("uses regular limit when subscription is active (not trialing)", async () => {
    const planFeatures: CustomerAccessPlanFeature[] = [
      {
        ...basePlanFeature,
        limitValue: 10000,
        trialLimitValue: 1000,
      },
    ];

    const subscriptions = [{ ...baseSubscription, status: "active" }];

    const snapshot = await buildCustomerAccessSnapshot({
      env: {},
      organizationId: "org_1",
      customerId: "cust_1",
      subscriptions,
      planFeatures,
      planEntitlements: [],
      manualEntitlements: [],
      creditBalances: [],
    });

    const accessItem = snapshot.find(
      (item) => item.featureId === "feature_credits",
    );
    expect(accessItem).toBeDefined();
    expect(accessItem?.limit).toBe(10000);
    expect(accessItem?.isTrialing).toBe(false);
    expect(accessItem?.isTrialLimit).toBe(false);
  });

  it("uses regular limit when trial limit is not set", async () => {
    const planFeatures: CustomerAccessPlanFeature[] = [
      {
        ...basePlanFeature,
        limitValue: 10000,
        trialLimitValue: null,
      },
    ];

    const subscriptions = [{ ...baseSubscription, status: "trialing" }];

    const snapshot = await buildCustomerAccessSnapshot({
      env: {},
      organizationId: "org_1",
      customerId: "cust_1",
      subscriptions,
      planFeatures,
      planEntitlements: [],
      manualEntitlements: [],
      creditBalances: [],
    });

    const accessItem = snapshot.find(
      (item) => item.featureId === "feature_credits",
    );
    expect(accessItem).toBeDefined();
    expect(accessItem?.limit).toBe(10000);
    expect(accessItem?.isTrialing).toBe(true);
    expect(accessItem?.isTrialLimit).toBe(false);
  });

  it("handles unlimited when trial limit is null", async () => {
    const planFeatures: CustomerAccessPlanFeature[] = [
      {
        ...basePlanFeature,
        limitValue: null,
        trialLimitValue: null,
      },
    ];

    const subscriptions = [{ ...baseSubscription, status: "trialing" }];

    const snapshot = await buildCustomerAccessSnapshot({
      env: {},
      organizationId: "org_1",
      customerId: "cust_1",
      subscriptions,
      planFeatures,
      planEntitlements: [],
      manualEntitlements: [],
      creditBalances: [],
    });

    const accessItem = snapshot.find(
      (item) => item.featureId === "feature_credits",
    );
    expect(accessItem).toBeDefined();
    expect(accessItem?.limit).toBeNull();
    expect(accessItem?.isTrialing).toBe(true);
  });

  it("exposes both planLimitValue and planTrialLimitValue in result", async () => {
    const planFeatures: CustomerAccessPlanFeature[] = [
      {
        ...basePlanFeature,
        limitValue: 10000,
        trialLimitValue: 1000,
      },
    ];

    const subscriptions = [{ ...baseSubscription, status: "trialing" }];

    const snapshot = await buildCustomerAccessSnapshot({
      env: {},
      organizationId: "org_1",
      customerId: "cust_1",
      subscriptions,
      planFeatures,
      planEntitlements: [],
      manualEntitlements: [],
      creditBalances: [],
    });

    const accessItem = snapshot.find(
      (item) => item.featureId === "feature_credits",
    );
    expect(accessItem).toBeDefined();
    expect(accessItem?.planLimitValue).toBe(10000);
    expect(accessItem?.planTrialLimitValue).toBe(1000);
  });
});
