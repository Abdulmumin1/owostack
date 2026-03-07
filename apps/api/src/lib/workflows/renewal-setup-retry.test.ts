import { beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

const {
  mockCreateSubscription,
  mockResolveProviderAccount,
  mockInvalidateSubscriptionCache,
} = vi.hoisted(() => ({
  mockCreateSubscription: vi.fn(),
  mockResolveProviderAccount: vi.fn(),
  mockInvalidateSubscriptionCache: vi.fn(async () => undefined),
}));

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {},
}));

vi.mock("./utils", () => ({
  getAdapter: vi.fn(() => ({
    createSubscription: mockCreateSubscription,
  })),
  resolveProviderAccount: mockResolveProviderAccount,
  invalidateSubscriptionCache: mockInvalidateSubscriptionCache,
}));

import { RenewalSetupRetryWorkflow } from "./renewal-setup-retry";

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
  subscription: any;
  plan: any;
  customer: any;
  providerDefaultPm?: any;
  providerPm?: any;
}) {
  const updates: Array<{ sql: string; params: any[] }> = [];

  return {
    updates,
    DB: {
      prepare(sql: string) {
        return {
          bind(...params: any[]) {
            return {
              async first() {
                if (sql.includes("FROM subscriptions")) {
                  return options.subscription;
                }
                if (sql.includes("FROM plans")) {
                  return options.plan;
                }
                if (
                  sql.includes("FROM customers") &&
                  sql.includes("provider_customer_id")
                ) {
                  return options.customer;
                }
                if (
                  sql.includes("provider_id = ? AND is_valid = 1 AND is_default = 1")
                ) {
                  return options.providerDefaultPm ?? null;
                }
                if (sql.includes("provider_id = ? AND is_valid = 1")) {
                  return options.providerPm ?? null;
                }
                return null;
              },
              async run() {
                updates.push({ sql, params });
                return {};
              },
            };
          },
        };
      },
    },
  };
}

describe("RenewalSetupRetryWorkflow", () => {
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
  });

  it("creates the missing provider subscription and clears cancel_at", async () => {
    const periodEnd = new Date("2026-04-05T17:00:15.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-03-06T17:00:15.000Z").getTime(),
    );
    mockCreateSubscription.mockResolvedValue(
      Result.ok({ id: "SUB_retry_1", status: "active", metadata: {} }),
    );

    const db = createDbMock({
      subscription: {
        id: "sub_1",
        status: "active",
        customer_id: "cust_1",
        plan_id: "plan_1",
        provider_id: "paystack",
        provider_subscription_code: "trial-abc",
        paystack_subscription_code: "trial-abc",
        current_period_end: periodEnd,
        cancel_at: periodEnd,
        metadata: {
          renewal_setup_status: "scheduled",
          renewal_setup_retry_count: 0,
        },
      },
      plan: {
        id: "plan_1",
        type: "paid",
        billing_type: "recurring",
        interval: "monthly",
        provider_plan_id: "PLN_123",
        paystack_plan_id: "PLN_123",
      },
      customer: {
        id: "cust_1",
        email: "customer@example.com",
        provider_customer_id: "CUS_123",
        paystack_customer_id: "CUS_123",
      },
      providerDefaultPm: {
        token: "AUTH_123",
        provider_id: "paystack",
      },
    });

    await RenewalSetupRetryWorkflow.prototype.run.call(
      { env: { DB: db.DB } },
      {
        payload: {
          subscriptionId: "sub_1",
          customerId: "cust_1",
          organizationId: "org_1",
          providerId: "paystack",
          source: "dashboard_manual",
          immediate: true,
        },
      },
      createStepMock(),
    );

    expect(mockCreateSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: new Date(periodEnd).toISOString(),
        authorizationCode: "AUTH_123",
      }),
    );
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].params[0]).toBe("SUB_retry_1");
    expect(db.updates[0].params[2]).toBe("SUB_retry_1");
    expect(db.updates[0].params[3]).toContain(
      '"renewal_setup_status":"complete"',
    );
    expect(db.updates[0].params[4]).toBeTypeOf("number");
    expect(mockInvalidateSubscriptionCache).toHaveBeenCalledWith(
      expect.anything(),
      "org_1",
      "cust_1",
    );

    vi.restoreAllMocks();
  });

  it("marks the setup failed after exhausting retries", async () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-03-06T17:00:15.000Z").getTime(),
    );
    mockCreateSubscription.mockResolvedValue(
      Result.err({
        code: "request_failed",
        message: "provider temporarily unavailable",
        providerId: "paystack",
      }),
    );

    const db = createDbMock({
      subscription: {
        id: "sub_2",
        status: "active",
        customer_id: "cust_1",
        plan_id: "plan_1",
        provider_id: "paystack",
        provider_subscription_code: "trial-abc",
        paystack_subscription_code: "trial-abc",
        current_period_end: new Date("2026-04-05T17:00:15.000Z").getTime(),
        cancel_at: new Date("2026-04-05T17:00:15.000Z").getTime(),
        metadata: {
          renewal_setup_status: "scheduled",
          renewal_setup_retry_count: 0,
        },
      },
      plan: {
        id: "plan_1",
        type: "paid",
        billing_type: "recurring",
        interval: "monthly",
        provider_plan_id: "PLN_123",
        paystack_plan_id: "PLN_123",
      },
      customer: {
        id: "cust_1",
        email: "customer@example.com",
        provider_customer_id: "CUS_123",
        paystack_customer_id: "CUS_123",
      },
      providerDefaultPm: {
        token: "AUTH_123",
        provider_id: "paystack",
      },
    });

    await RenewalSetupRetryWorkflow.prototype.run.call(
      { env: { DB: db.DB } },
      {
        payload: {
          subscriptionId: "sub_2",
          customerId: "cust_1",
          organizationId: "org_1",
          providerId: "paystack",
          source: "trial_end",
          immediate: false,
        },
      },
      createStepMock(),
    );

    expect(mockCreateSubscription).toHaveBeenCalledTimes(3);
    expect(db.updates.at(-1)?.params[0]).toContain('"renewal_setup_status":"failed"');

    vi.restoreAllMocks();
  });
});
