import { beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

const {
  mockChargeAuthorization,
  mockCreateSubscription,
  mockResolveProviderAccount,
  mockProvisionEntitlements,
  mockInvalidateSubscriptionCache,
  mockIntervalToMs,
} = vi.hoisted(() => ({
  mockChargeAuthorization: vi.fn(),
  mockCreateSubscription: vi.fn(),
  mockResolveProviderAccount: vi.fn(),
  mockProvisionEntitlements: vi.fn(async () => undefined),
  mockInvalidateSubscriptionCache: vi.fn(async () => undefined),
  mockIntervalToMs: vi.fn((interval: string) => {
    switch (interval) {
      case "monthly":
        return 30 * 24 * 60 * 60 * 1000;
      default:
        return 30 * 24 * 60 * 60 * 1000;
    }
  }),
}));

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {},
}));

vi.mock("./utils", () => ({
  getAdapter: vi.fn(() => ({
    chargeAuthorization: mockChargeAuthorization,
    createSubscription: mockCreateSubscription,
    supportsNativeTrials: false,
  })),
  resolveProviderAccount: mockResolveProviderAccount,
  provisionEntitlements: mockProvisionEntitlements,
  intervalToMs: mockIntervalToMs,
  invalidateSubscriptionCache: mockInvalidateSubscriptionCache,
}));

import { TrialEndWorkflow } from "./trial-end";

function createStepMock() {
  return {
    sleep: vi.fn(async () => undefined),
    do: vi.fn(async (...args: any[]) => {
      const fn = typeof args[1] === "function" ? args[1] : args[2];
      return fn();
    }),
  };
}

function createDbMock(options: {
  providerDefaultPm?: { token: string; provider_id: string } | null;
  providerPm?: { token: string; provider_id: string } | null;
  customerForAuth?: {
    email: string | null;
    provider_customer_id: string | null;
    paystack_customer_id?: string | null;
  };
  customerForPlan?: {
    id: string;
    email: string;
    provider_customer_id: string | null;
    paystack_customer_id: string | null;
  };
  plan?: {
    id: string;
    billing_type: string;
    interval: string;
    provider_plan_id: string | null;
    paystack_plan_id: string | null;
    currency: string;
  };
  subscriptionStatus?: { id: string; status: string; cancel_at: number | null } | null;
}) {
  const updateBinds: any[] = [];

  return {
    updateBinds,
    DB: {
      prepare(sql: string) {
        return {
          bind(...params: any[]) {
            return {
              async first() {
                if (
                  sql.includes(
                    "SELECT id, status, cancel_at FROM subscriptions",
                  )
                ) {
                  return options.subscriptionStatus ?? null;
                }
                if (
                  sql.includes(
                    "provider_id = ? AND is_valid = 1 AND is_default = 1",
                  )
                ) {
                  return options.providerDefaultPm ?? null;
                }
                if (
                  sql.includes("provider_id = ? AND is_valid = 1 LIMIT 1")
                ) {
                  return options.providerPm ?? null;
                }
                if (
                  sql.includes(
                    "SELECT email, provider_customer_id, paystack_customer_id FROM customers",
                  )
                ) {
                  return options.customerForAuth ?? null;
                }
                if (
                  sql.includes(
                    "SELECT id, billing_type, interval, provider_plan_id, paystack_plan_id, currency FROM plans",
                  )
                ) {
                  return options.plan ?? null;
                }
                if (
                  sql.includes(
                    "SELECT id, email, provider_customer_id, paystack_customer_id FROM customers",
                  )
                ) {
                  return options.customerForPlan ?? null;
                }
                return null;
              },
              async run() {
                if (sql.includes("UPDATE subscriptions")) {
                  updateBinds.push(params);
                }
                return {};
              },
            };
          },
        };
      },
    },
  };
}

describe("TrialEndWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProviderAccount.mockResolvedValue({
      id: "acct_1",
      organizationId: "org_1",
      providerId: "paystack",
      environment: "test",
      credentials: { secretKey: "sk_test" },
      createdAt: 0,
      updatedAt: 0,
    });
    mockChargeAuthorization.mockResolvedValue(Result.ok({ reference: "ref_123" }));
    mockCreateSubscription.mockResolvedValue(
      Result.ok({ id: "SUB_live_123", status: "active", metadata: {} }),
    );
  });

  it("uses a valid payment method for the same provider even when it is not the global default", async () => {
    const now = new Date("2026-03-06T17:00:15.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    const db = createDbMock({
      subscriptionStatus: {
        id: "sub_trial_1",
        status: "trialing",
        cancel_at: null,
      },
      providerDefaultPm: null,
      providerPm: { token: "AUTH_paystack", provider_id: "paystack" },
      customerForAuth: {
        email: "customer@example.com",
        provider_customer_id: "CUS_paystack",
      },
      customerForPlan: {
        id: "cust_1",
        email: "customer@example.com",
        provider_customer_id: "CUS_paystack",
        paystack_customer_id: "CUS_paystack",
      },
      plan: {
        id: "plan_1",
        billing_type: "recurring",
        interval: "monthly",
        provider_plan_id: "PLN_123",
        paystack_plan_id: "PLN_123",
        currency: "NGN",
      },
    });

    const step = createStepMock();

    await TrialEndWorkflow.prototype.run.call(
      { env: { DB: db.DB } },
      {
        payload: {
          subscriptionId: "sub_trial_1",
          customerId: "cust_1",
          planId: "plan_1",
          organizationId: "org_1",
          providerId: "paystack",
          environment: "test",
          trialEndMs: now,
          amount: 3000000,
          currency: "NGN",
          email: "customer@example.com",
        },
      },
      step,
    );

    expect(mockChargeAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationCode: "AUTH_paystack",
      }),
    );
    expect(mockCreateSubscription).toHaveBeenCalledTimes(1);
    expect(db.updateBinds).toHaveLength(1);
    expect(db.updateBinds[0][0]).toBe("SUB_live_123");
    expect(db.updateBinds[0][1]).toBe("SUB_live_123");
    expect(db.updateBinds[0][2]).toBe("SUB_live_123");
    expect(db.updateBinds[0][5]).toBeNull();

    vi.restoreAllMocks();
  });

  it("cuts off at period end when recurring renewal setup fails after the conversion charge", async () => {
    const now = new Date("2026-03-06T17:00:15.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);
    mockCreateSubscription.mockRejectedValueOnce(
      new Error("provider create subscription failed"),
    );

    const db = createDbMock({
      subscriptionStatus: {
        id: "sub_trial_2",
        status: "trialing",
        cancel_at: null,
      },
      providerDefaultPm: { token: "AUTH_paystack", provider_id: "paystack" },
      providerPm: null,
      customerForAuth: {
        email: "customer@example.com",
        provider_customer_id: "CUS_paystack",
      },
      customerForPlan: {
        id: "cust_1",
        email: "customer@example.com",
        provider_customer_id: "CUS_paystack",
        paystack_customer_id: "CUS_paystack",
      },
      plan: {
        id: "plan_1",
        billing_type: "recurring",
        interval: "monthly",
        provider_plan_id: "PLN_123",
        paystack_plan_id: "PLN_123",
        currency: "NGN",
      },
    });

    const step = createStepMock();

    await TrialEndWorkflow.prototype.run.call(
      { env: { DB: db.DB } },
      {
        payload: {
          subscriptionId: "sub_trial_2",
          customerId: "cust_1",
          planId: "plan_1",
          organizationId: "org_1",
          providerId: "paystack",
          environment: "test",
          trialEndMs: now,
          amount: 3000000,
          currency: "NGN",
          email: "customer@example.com",
        },
      },
      step,
    );

    const periodEnd = now + 30 * 24 * 60 * 60 * 1000;
    expect(mockChargeAuthorization).toHaveBeenCalledTimes(1);
    expect(mockCreateSubscription).toHaveBeenCalledTimes(1);
    expect(db.updateBinds).toHaveLength(2);
    expect(db.updateBinds[0][0]).toBeNull();
    expect(db.updateBinds[0][1]).toBeNull();
    expect(db.updateBinds[0][2]).toBeNull();
    expect(db.updateBinds[0][4]).toBe(periodEnd);
    expect(db.updateBinds[0][5]).toBe(periodEnd);
    expect(String(db.updateBinds[1][0])).toContain(
      '"renewal_setup_status":"failed"',
    );

    vi.restoreAllMocks();
  });
});
