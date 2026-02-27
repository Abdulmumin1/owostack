import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Mock } from "vitest";
import checkoutRoute from "../src/routes/api/checkout";
import { verifyApiKey } from "../src/lib/api-keys";
import { resolveOrCreateCustomer } from "../src/lib/customers";
import { executeSwitch } from "../src/lib/plan-switch";
import {
  getProviderRegistry,
  loadProviderAccounts,
  loadProviderRules,
} from "../src/lib/providers";
import { resolveProvider } from "@owostack/adapters";
import type { Adapter } from "@owostack/adapters";

vi.mock("@owostack/db", () => ({
  schema: {
    projects: { organizationId: "organizationId" },
    plans: { organizationId: "organizationId", slug: "slug" },
  },
}));

vi.mock("../src/lib/api-keys", () => ({
  verifyApiKey: vi.fn(),
}));

vi.mock("../src/lib/customers", () => ({
  resolveOrCreateCustomer: vi.fn(),
}));

vi.mock("../src/lib/plan-switch", () => ({
  executeSwitch: vi.fn(),
  provisionEntitlements: vi.fn(),
}));

vi.mock("../src/lib/overage-guards", () => ({
  hasPaymentMethod: vi.fn(async () => false),
}));

vi.mock("../src/lib/plan-sync", () => ({
  ensurePlanSynced: vi.fn(async () => null),
}));

vi.mock("../src/lib/providers", () => ({
  getProviderRegistry: vi.fn(),
  buildProviderContext: vi.fn((params) => params),
  deriveProviderEnvironment: vi.fn(() => "test"),
  loadProviderAccounts: vi.fn(),
  loadProviderRules: vi.fn(),
}));

vi.mock("@owostack/adapters", () => ({
  resolveProvider: vi.fn(),
}));

// Mock types
type MockDb = {
  query: {
    plans: {
      findFirst: Mock;
    };
  };
};

type MockAuthDb = {
  query: {
    projects: {
      findFirst: Mock;
    };
  };
};

type ProviderAccount = {
  id: string;
  providerId: string;
  environment: string;
  credentials: { secretKey: string };
};

type SwitchResult = {
  success: boolean;
  type: string;
  requiresCheckout: boolean;
  checkoutUrl?: string;
  message: string;
};

describe("/attach behavior", () => {
  const mockDb: MockDb = {
    query: {
      plans: {
        findFirst: vi.fn(),
      },
    },
  };

  const mockAuthDb: MockAuthDb = {
    query: {
      projects: {
        findFirst: vi.fn(async () => ({
          id: "proj_1",
          activeEnvironment: "test",
        })),
      },
    },
  };

  const env = {
    ENCRYPTION_KEY: "test_key",
    ENVIRONMENT: "test",
    TRIAL_END_WORKFLOW: { create: vi.fn(async () => null) },
    DOWNGRADE_WORKFLOW: { create: vi.fn(async () => null) },
  };

  let app: Hono<{ Variables: { db: MockDb; authDb: MockAuthDb } }>;

  const paystackAdapter: Adapter & { createCheckoutSession: Mock } = {
    id: "paystack",
    supportsNativeTrials: false,
    createCheckoutSession: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    app = new Hono<{ Variables: { db: MockDb; authDb: MockAuthDb } }>();
    app.use("*", async (c, next) => {
      c.set("db", mockDb);
      c.set("authDb", mockAuthDb);
      await next();
    });
    app.route("/", checkoutRoute);

    vi.mocked(verifyApiKey).mockResolvedValue({
      id: "key_1",
      organizationId: "org_1",
    });

    vi.mocked(getProviderRegistry).mockReturnValue({
      get: vi.fn((id: string) =>
        id === "paystack" ? paystackAdapter : undefined,
      ),
    });

    vi.mocked(loadProviderRules).mockResolvedValue([]);
    vi.mocked(loadProviderAccounts).mockResolvedValue([]);
    vi.mocked(resolveProvider).mockReturnValue({
      isOk: () => false,
      isErr: () => true,
    } as ReturnType<typeof resolveProvider>);
  });

  it("bypasses provider resolution for free plan and executes switch with null provider context", async () => {
    mockDb.query.plans.findFirst.mockResolvedValue({
      id: "plan_free",
      slug: "starter",
      type: "free",
      price: 0,
      currency: "USD",
      billingType: "recurring",
      trialDays: 0,
      trialCardRequired: false,
    });

    vi.mocked(resolveOrCreateCustomer).mockResolvedValue({
      id: "cus_1",
      email: "free@example.com",
    });

    vi.mocked(executeSwitch).mockResolvedValue({
      success: true,
      type: "new",
      requiresCheckout: false,
      message: "Switched",
    } as SwitchResult);

    const res = await app.request(
      "/attach",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer owo_sk_test",
        },
        body: JSON.stringify({
          customer: "free@example.com",
          product: "starter",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      customer_id: string;
    };
    expect(body.success).toBe(true);
    expect(body.customer_id).toBe("cus_1");
    expect(vi.mocked(resolveProvider)).not.toHaveBeenCalled();

    const providerCtxArg = vi.mocked(executeSwitch).mock.calls[0]?.[3];
    expect(providerCtxArg).toBeNull();
  });

  it("returns 400 when explicit provider is requested but account is not configured", async () => {
    mockDb.query.plans.findFirst.mockResolvedValue({
      id: "plan_paid",
      slug: "pro",
      type: "paid",
      price: 5000,
      currency: "USD",
      billingType: "recurring",
      trialDays: 0,
      trialCardRequired: false,
      providerId: null,
    });

    vi.mocked(loadProviderAccounts).mockResolvedValue([]);

    const res = await app.request(
      "/attach",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer owo_sk_test",
        },
        body: JSON.stringify({
          customer: "paid@example.com",
          product: "pro",
          provider: "paystack",
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("not configured");
    expect(vi.mocked(resolveOrCreateCustomer)).not.toHaveBeenCalled();
    expect(vi.mocked(executeSwitch)).not.toHaveBeenCalled();
  });

  it("uses explicit provider account and passes resolved provider context into executeSwitch", async () => {
    const providerAccount: ProviderAccount = {
      id: "acct_1",
      providerId: "paystack",
      environment: "test",
      credentials: { secretKey: "sk_test" },
    };

    mockDb.query.plans.findFirst.mockResolvedValue({
      id: "plan_paid",
      slug: "growth",
      type: "paid",
      price: 20000,
      currency: "USD",
      billingType: "recurring",
      trialDays: 0,
      trialCardRequired: false,
      providerId: null,
      providerPlanId: "plan_provider_1",
      paystackPlanId: null,
    });

    vi.mocked(loadProviderAccounts).mockResolvedValue([providerAccount]);

    vi.mocked(resolveOrCreateCustomer).mockResolvedValue({
      id: "cus_2",
      email: "paid@example.com",
    });

    vi.mocked(executeSwitch).mockResolvedValue({
      success: true,
      type: "new",
      requiresCheckout: true,
      checkoutUrl: "https://checkout.example.com/abc",
      message: "Checkout created",
    } as SwitchResult);

    const res = await app.request(
      "/attach",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer owo_sk_test",
        },
        body: JSON.stringify({
          customer: "paid@example.com",
          product: "growth",
          provider: "paystack",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);

    const providerCtxArg = vi.mocked(executeSwitch).mock.calls[0]?.[3] as {
      adapter: Adapter;
      account: ProviderAccount;
    };
    expect(providerCtxArg?.adapter?.id).toBe("paystack");
    expect(providerCtxArg?.account?.id).toBe("acct_1");
  });

  it("returns 400 for paid plans when no provider can be resolved", async () => {
    mockDb.query.plans.findFirst.mockResolvedValue({
      id: "plan_paid",
      slug: "business",
      type: "paid",
      price: 12000,
      currency: "USD",
      billingType: "recurring",
      trialDays: 0,
      trialCardRequired: false,
      providerId: null,
    });

    vi.mocked(loadProviderAccounts).mockResolvedValue([]);
    vi.mocked(loadProviderRules).mockResolvedValue([]);

    const res = await app.request(
      "/attach",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer owo_sk_test",
        },
        body: JSON.stringify({
          customer: "nobody@example.com",
          product: "business",
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("No payment provider configured");
    expect(vi.mocked(resolveOrCreateCustomer)).not.toHaveBeenCalled();
    expect(vi.mocked(executeSwitch)).not.toHaveBeenCalled();
  });

  it("uses rules-based provider resolution when no explicit provider or plan provider is set", async () => {
    const resolvedAccount: ProviderAccount = {
      id: "acct_rule_paystack",
      providerId: "paystack",
      environment: "test",
      credentials: { secretKey: "sk_test" },
    };

    mockDb.query.plans.findFirst.mockResolvedValue({
      id: "plan_paid",
      slug: "team",
      type: "paid",
      price: 9000,
      currency: "USD",
      billingType: "recurring",
      trialDays: 0,
      trialCardRequired: false,
      providerId: null,
      providerPlanId: "provider_plan_team",
      paystackPlanId: null,
    });

    vi.mocked(loadProviderAccounts).mockResolvedValue([resolvedAccount]);
    vi.mocked(loadProviderRules).mockResolvedValue([{ id: "rule_1" }]);
    vi.mocked(resolveProvider).mockReturnValue({
      isOk: () => true,
      isErr: () => false,
      value: {
        adapter: paystackAdapter,
        account: resolvedAccount,
        ruleId: "rule_1",
      },
    } as ReturnType<typeof resolveProvider>);

    vi.mocked(resolveOrCreateCustomer).mockResolvedValue({
      id: "cus_rule",
      email: "rule@example.com",
    });

    vi.mocked(executeSwitch).mockResolvedValue({
      success: true,
      type: "new",
      requiresCheckout: true,
      checkoutUrl: "https://checkout.example.com/rule",
      message: "Checkout created",
    } as SwitchResult);

    const res = await app.request(
      "/attach",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer owo_sk_test",
        },
        body: JSON.stringify({
          customer: "rule@example.com",
          product: "team",
          region: "NG",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(resolveProvider)).toHaveBeenCalledTimes(1);

    const resolverArg = vi.mocked(resolveProvider).mock.calls[0]?.[1] as {
      context: { region: string; currency: string };
      accounts: ProviderAccount[];
    };
    expect(resolverArg.context.region).toBe("NG");
    expect(resolverArg.context.currency).toBe("USD");
    expect(resolverArg.accounts[0].id).toBe("acct_rule_paystack");

    const providerCtxArg = vi.mocked(executeSwitch).mock.calls[0]?.[3] as {
      adapter: Adapter;
      account: ProviderAccount;
    };
    expect(providerCtxArg?.adapter?.id).toBe("paystack");
    expect(providerCtxArg?.account?.id).toBe("acct_rule_paystack");
  });
});
