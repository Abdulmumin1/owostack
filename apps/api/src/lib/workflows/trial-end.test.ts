import { beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {},
}));

import {
  TrialEndWorkflow,
  type TrialEndWorkflowDependencies,
} from "./trial-end";
import {
  createWorkflowInstance,
  createWorkflowStepMock,
} from "./test-helpers";

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
  const chargeAuthorizationMock = vi.fn();
  const createSubscriptionMock = vi.fn();
  const resolveProviderAccountMock = vi.fn();
  const provisionEntitlementsMock = vi.fn(async () => undefined);
  const invalidateSubscriptionCacheMock = vi.fn(async () => undefined);
  const intervalToMsMock = vi.fn((interval: string) => {
    switch (interval) {
      case "monthly":
        return 30 * 24 * 60 * 60 * 1000;
      default:
        return 30 * 24 * 60 * 60 * 1000;
    }
  });
  const deps: TrialEndWorkflowDependencies = {
    getAdapter: vi.fn(() => ({
      chargeAuthorization: chargeAuthorizationMock,
      createSubscription: createSubscriptionMock,
      supportsNativeTrials: false,
    })) as unknown as TrialEndWorkflowDependencies["getAdapter"],
    resolveProviderAccount:
      resolveProviderAccountMock as unknown as TrialEndWorkflowDependencies["resolveProviderAccount"],
    intervalToMs:
      intervalToMsMock as unknown as TrialEndWorkflowDependencies["intervalToMs"],
    provisionEntitlements:
      provisionEntitlementsMock as unknown as TrialEndWorkflowDependencies["provisionEntitlements"],
    invalidateSubscriptionCache:
      invalidateSubscriptionCacheMock as unknown as TrialEndWorkflowDependencies["invalidateSubscriptionCache"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TrialEndWorkflow.dependencies = deps;
    resolveProviderAccountMock.mockResolvedValue({
      id: "acct_1",
      organizationId: "org_1",
      providerId: "paystack",
      environment: "test",
      credentials: { secretKey: "sk_test" },
      createdAt: 0,
      updatedAt: 0,
    });
    chargeAuthorizationMock.mockResolvedValue(Result.ok({ reference: "ref_123" }));
    createSubscriptionMock.mockResolvedValue(
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

    const step = createWorkflowStepMock();

    await TrialEndWorkflow.prototype.run.call(
      createWorkflowInstance(TrialEndWorkflow, { DB: db.DB }),
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

    expect(chargeAuthorizationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationCode: "AUTH_paystack",
      }),
    );
    expect(createSubscriptionMock).toHaveBeenCalledTimes(1);
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
    createSubscriptionMock.mockRejectedValueOnce(
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

    const step = createWorkflowStepMock();

    await TrialEndWorkflow.prototype.run.call(
      createWorkflowInstance(TrialEndWorkflow, { DB: db.DB }),
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
    expect(chargeAuthorizationMock).toHaveBeenCalledTimes(1);
    expect(createSubscriptionMock).toHaveBeenCalledTimes(1);
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
