import { describe, expect, it, vi, type Mock } from "vitest";
import {
  calculateAlignedPeriodEnd,
  calculateProration,
  detectSwitchType,
  executeSwitch,
  getUpgradeCheckoutMinimum,
  provisionEntitlements,
} from "./plan-switch";

interface PlanFeature {
  featureId: string;
  limitValue?: number;
  resetInterval?: string;
  resetOnEnable?: boolean;
  feature?: { id: string };
}

interface MockDb {
  query: {
    planFeatures: {
      findMany: Mock;
    };
  };
  transaction: Mock;
  delete: Mock;
  insert: Mock;
}

describe("detectSwitchType", () => {
  it("returns new when there is no current plan", () => {
    const result = detectSwitchType(null, { price: 5000, interval: "monthly" });
    expect(result).toBe("new");
  });

  it("returns upgrade when normalized monthly price increases", () => {
    const result = detectSwitchType(
      { price: 12000, interval: "yearly" },
      { price: 1500, interval: "monthly" },
    );

    expect(result).toBe("upgrade");
  });

  it("returns downgrade when normalized monthly price decreases", () => {
    const result = detectSwitchType(
      { price: 1500, interval: "monthly" },
      { price: 12000, interval: "yearly" },
    );

    expect(result).toBe("downgrade");
  });

  it("returns lateral when normalized monthly prices are equal", () => {
    const result = detectSwitchType(
      { price: 3000, interval: "quarterly" },
      { price: 1000, interval: "monthly" },
    );

    expect(result).toBe("lateral");
  });
});

describe("calculateProration", () => {
  const hour = 60 * 60 * 1000;

  it("returns full new plan price when period bounds are invalid", () => {
    const result = calculateProration(
      { price: 10000 },
      { price: 20000 },
      2000,
      1000,
      1500,
    );

    expect(result).toBe(20000);
  });

  it("charges full price difference at period start", () => {
    const periodStart = 10 * hour;
    const periodEnd = 20 * hour;

    const result = calculateProration(
      { price: 10000 },
      { price: 16000 },
      periodStart,
      periodEnd,
      periodStart,
    );

    expect(result).toBe(6000);
  });

  it("computes prorated difference in the middle of period", () => {
    const periodStart = 0;
    const periodEnd = 10 * hour;
    const now = 6 * hour; // 40% remaining

    const result = calculateProration(
      { price: 10000 },
      { price: 15000 },
      periodStart,
      periodEnd,
      now,
    );

    expect(result).toBe(2000);
  });

  it("returns zero when period is already over", () => {
    const periodStart = 0;
    const periodEnd = 10 * hour;
    const now = 12 * hour;

    const result = calculateProration(
      { price: 10000 },
      { price: 15000 },
      periodStart,
      periodEnd,
      now,
    );

    expect(result).toBe(0);
  });
});

describe("upgrade checkout helpers", () => {
  it("uses provider transaction minimums instead of hard-coded checkout floors", () => {
    expect(getUpgradeCheckoutMinimum("paystack", "NGN")).toBe(5000);
    expect(getUpgradeCheckoutMinimum("paystack", "usd")).toBe(200);
    expect(getUpgradeCheckoutMinimum("stripe", "USD")).toBeNull();
  });

  it("rolls to a fresh cycle when the preserved period already ended", () => {
    const startMs = new Date("2026-04-05T12:00:00.000Z").getTime();
    const periodMs = 30 * 24 * 60 * 60 * 1000;

    expect(calculateAlignedPeriodEnd(startMs - 1000, startMs, periodMs)).toBe(
      startMs + periodMs,
    );
    expect(calculateAlignedPeriodEnd(startMs + 1000, startMs, periodMs)).toBe(
      startMs + 1000,
    );
  });
});

describe("provisionEntitlements", () => {
  it("falls back when db.transaction is unsupported in D1", async () => {
    const whereMock = vi.fn(async () => []);
    const deleteMock = vi.fn(() => ({ where: whereMock }));
    const valuesMock = vi.fn(async () => []);
    const insertMock = vi.fn(() => ({ values: valuesMock }));

    const db: MockDb = {
      query: {
        planFeatures: {
          findMany: vi
            .fn()
            .mockResolvedValueOnce([
              {
                featureId: "feat_new_1",
                limitValue: 100,
                resetInterval: "monthly",
                resetOnEnable: true,
                feature: { id: "feat_new_1" },
              },
            ])
            .mockResolvedValueOnce([{ featureId: "feat_old_1" }]),
        },
      },
      transaction: vi.fn(async () => {
        throw new Error(
          "D1_ERROR: To execute a transaction, please use the state.storage.transaction() APIs instead of SQL BEGIN TRANSACTION.",
        );
      }),
      delete: deleteMock,
      insert: insertMock,
    };

    await provisionEntitlements(db, "cus_1", "plan_new", "plan_old");

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(whereMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledTimes(1);
  });
});

describe("executeSwitch", () => {
  it("fails Dodo upgrades when native change-plan fails instead of falling back to raw-amount checkout", async () => {
    const now = new Date("2026-04-05T12:00:00.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    const createCheckoutSession = vi.fn();
    const provider = {
      adapter: {
        id: "dodopayments",
        displayName: "Dodo Payments",
        defaultCurrency: "USD",
        supportsNativeTrials: true,
        createCheckoutSession,
        changePlan: vi.fn(async () => ({
          isOk: () => false,
          isErr: () => true,
          error: {
            code: "request_failed",
            message: "provider refused plan change",
            providerId: "dodopayments",
          },
        })),
      },
      account: {
        id: "acct_1",
        providerId: "dodopayments",
        environment: "test",
        credentials: {},
      },
    } as any;

    const db = {
      query: {
        plans: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({
              id: "plan_pro",
              name: "Pro",
              slug: "pro",
              price: 3000,
              interval: "monthly",
              billingType: "recurring",
              type: "paid",
              planGroup: "main",
              providerPlanId: "prod_remote_pro",
              paystackPlanId: null,
              currency: "USD",
            }),
        },
        customers: {
          findFirst: vi.fn().mockResolvedValue({
            id: "cust_1",
            email: "customer@example.com",
            providerAuthorizationCode: "sub_card_123",
            paystackAuthorizationCode: null,
            providerCustomerId: "cus_remote_1",
            paystackCustomerId: null,
          }),
        },
        subscriptions: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "sub_old",
              customerId: "cust_1",
              planId: "plan_starter",
              providerId: "dodopayments",
              providerSubscriptionCode: "sub_remote_old",
              paystackSubscriptionCode: null,
              currentPeriodStart: now - 10 * 24 * 60 * 60 * 1000,
              currentPeriodEnd: now + 20 * 24 * 60 * 60 * 1000,
              status: "active",
              plan: {
                id: "plan_starter",
                name: "Starter",
                slug: "starter",
                price: 1000,
                interval: "monthly",
                planGroup: "main",
                isAddon: false,
              },
              metadata: {},
            },
          ]),
        },
      },
    } as any;

    const result = await executeSwitch(db, "cust_1", "plan_pro", provider);

    expect(result).toMatchObject({
      success: false,
      type: "upgrade",
      requiresCheckout: false,
      subscriptionId: "sub_old",
      message: "Failed to upgrade to Pro: provider refused plan change",
    });
    expect(createCheckoutSession).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("schedules a downgrade to a free plan at period end instead of switching immediately", async () => {
    const now = new Date("2026-03-13T12:00:00.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    const currentPeriodEnd = now + 4 * 24 * 60 * 60 * 1000;
    const trialSub = {
      id: "sub_trial_1",
      customerId: "cust_1",
      planId: "plan_paid",
      providerId: "dodo",
      providerSubscriptionCode: "trial-sub-123",
      paystackSubscriptionCode: null,
      status: "trialing",
      currentPeriodEnd,
      plan: {
        id: "plan_paid",
        name: "Paid Trial",
        price: 1000,
        interval: "monthly",
        planGroup: "base",
        isAddon: false,
      },
      metadata: { source: "trial" },
    };

    let updatedValues: Record<string, unknown> | undefined;
    const whereMock = vi.fn(async () => undefined);
    const setMock = vi.fn((values: Record<string, unknown>) => {
      updatedValues = values;
      return { where: whereMock };
    });
    const updateMock = vi.fn(() => ({ set: setMock }));
    const downgradeWorkflow = {
      create: vi.fn(async () => ({ id: "wf_123" })),
    };

    const db = {
      query: {
        plans: {
          findFirst: vi.fn().mockResolvedValueOnce({
            id: "plan_free",
            name: "Free",
            slug: "free",
            price: 0,
            interval: "monthly",
            billingType: "recurring",
            planGroup: "base",
            isAddon: false,
          }),
        },
        customers: {
          findFirst: vi.fn().mockResolvedValue({
            id: "cust_1",
            email: "customer@example.com",
          }),
        },
        subscriptions: {
          findMany: vi.fn().mockResolvedValue([trialSub]),
        },
      },
      update: updateMock,
    } as any;

    const result = await executeSwitch(db, "cust_1", "plan_free", null, {
      downgradeWorkflow,
      organizationId: "org_1",
      environment: "test",
    });

    expect(result.success).toBe(true);
    expect(result.type).toBe("downgrade");
    expect(result.subscriptionId).toBe("sub_trial_1");
    expect(result.scheduledAt).toBe(currentPeriodEnd);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updatedValues).toMatchObject({
      status: "trialing",
      cancelAt: currentPeriodEnd,
      metadata: {
        source: "trial",
        scheduled_downgrade: {
          new_plan_id: "plan_free",
          scheduled_at: now,
          effective_at: currentPeriodEnd,
        },
      },
    });
    expect(downgradeWorkflow.create).toHaveBeenCalledWith({
      params: expect.objectContaining({
        subscriptionId: "sub_trial_1",
        customerId: "cust_1",
        newPlanId: "plan_free",
        executeAt: currentPeriodEnd,
      }),
    });

    vi.restoreAllMocks();
  });
});
