import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  createCheckoutRoute,
  type CheckoutDependencies,
} from "../src/routes/api/checkout";
import type { Adapter, ProviderAccount } from "@owostack/adapters";
import { createRouteTestApp } from "./helpers/route-harness";
import { err, ok } from "./helpers/result";

type MockDb = {
  query: {
    plans: {
      findFirst: Mock;
    };
  };
};

type MockAuthDb = {
  query: {
    organizations: {
      findFirst: Mock;
    };
  };
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
      organizations: {
        findFirst: vi.fn(async () => ({ id: "org_1" })),
      },
    },
  };

  const env = {
    ENCRYPTION_KEY: "test_key",
    ENVIRONMENT: "test",
    TRIAL_END_WORKFLOW: { create: vi.fn(async () => null) },
    DOWNGRADE_WORKFLOW: { create: vi.fn(async () => null) },
  };

  const verifyApiKeyMock = vi.fn();
  const resolveOrCreateCustomerMock = vi.fn();
  const executeSwitchMock = vi.fn();
  const provisionEntitlementsMock = vi.fn(async () => null);
  const hasPaymentMethodMock = vi.fn(async () => false);
  const ensurePlanSyncedMock = vi.fn(async () => null);
  const resolveProviderMock = vi.fn(() => err("no match"));
  const registryGetMock = vi.fn();
  const getProviderRegistryMock = vi.fn(() => ({
    get: registryGetMock,
  }));
  const buildProviderContextMock = vi.fn((params) => params);
  const deriveProviderEnvironmentMock = vi.fn(() => "test");
  const loadProviderAccountsMock = vi.fn(async () => []);
  const loadProviderRulesMock = vi.fn(async () => []);

  const deps: CheckoutDependencies = {
    verifyApiKey: verifyApiKeyMock as unknown as CheckoutDependencies["verifyApiKey"],
    resolveOrCreateCustomer:
      resolveOrCreateCustomerMock as unknown as CheckoutDependencies["resolveOrCreateCustomer"],
    executeSwitch: executeSwitchMock as unknown as CheckoutDependencies["executeSwitch"],
    provisionEntitlements:
      provisionEntitlementsMock as unknown as CheckoutDependencies["provisionEntitlements"],
    hasPaymentMethod:
      hasPaymentMethodMock as unknown as CheckoutDependencies["hasPaymentMethod"],
    ensurePlanSynced:
      ensurePlanSyncedMock as unknown as CheckoutDependencies["ensurePlanSynced"],
    resolveProvider:
      resolveProviderMock as unknown as CheckoutDependencies["resolveProvider"],
    getProviderRegistry:
      getProviderRegistryMock as unknown as CheckoutDependencies["getProviderRegistry"],
    buildProviderContext:
      buildProviderContextMock as unknown as CheckoutDependencies["buildProviderContext"],
    deriveProviderEnvironment:
      deriveProviderEnvironmentMock as unknown as CheckoutDependencies["deriveProviderEnvironment"],
    loadProviderAccounts:
      loadProviderAccountsMock as unknown as CheckoutDependencies["loadProviderAccounts"],
    loadProviderRules:
      loadProviderRulesMock as unknown as CheckoutDependencies["loadProviderRules"],
  };

  let app: ReturnType<
    typeof createRouteTestApp<{ db: MockDb; authDb: MockAuthDb }>
  >;

  const paystackAdapter: Adapter = {
    id: "paystack",
    supportsNativeTrials: false,
    createCheckoutSession: vi.fn(),
  } as Adapter;

  beforeEach(() => {
    vi.clearAllMocks();

    app = createRouteTestApp(createCheckoutRoute(deps), {
      db: mockDb,
      authDb: mockAuthDb,
    });

    verifyApiKeyMock.mockResolvedValue({
      id: "key_1",
      organizationId: "org_1",
    });

    getProviderRegistryMock.mockReturnValue({
      get: registryGetMock,
    });
    registryGetMock.mockImplementation((id: string) =>
      id === "paystack" ? paystackAdapter : undefined,
    );

    loadProviderRulesMock.mockResolvedValue([]);
    loadProviderAccountsMock.mockResolvedValue([]);
    resolveProviderMock.mockImplementation(() => err("no match"));
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

    resolveOrCreateCustomerMock.mockResolvedValue({
      id: "cus_1",
      email: "free@example.com",
    });

    executeSwitchMock.mockResolvedValue({
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
    expect(resolveProviderMock).not.toHaveBeenCalled();

    const providerCtxArg = executeSwitchMock.mock.calls[0]?.[3];
    expect(providerCtxArg).toBeNull();
  });

  it("returns 400 when no provider account is configured for a paid plan", async () => {
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

    loadProviderAccountsMock.mockResolvedValue([]);

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
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("No payment provider configured");
    expect(resolveOrCreateCustomerMock).not.toHaveBeenCalled();
    expect(executeSwitchMock).not.toHaveBeenCalled();
  });

  it("uses the first configured account in the current environment when no explicit provider is set", async () => {
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

    loadProviderAccountsMock.mockResolvedValue([providerAccount]);

    resolveOrCreateCustomerMock.mockResolvedValue({
      id: "cus_2",
      email: "paid@example.com",
    });

    executeSwitchMock.mockResolvedValue({
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
        }),
      },
      env,
    );

    expect(res.status).toBe(200);

    const providerCtxArg = executeSwitchMock.mock.calls[0]?.[3] as {
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

    loadProviderAccountsMock.mockResolvedValue([]);
    loadProviderRulesMock.mockResolvedValue([]);

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
    expect(resolveOrCreateCustomerMock).not.toHaveBeenCalled();
    expect(executeSwitchMock).not.toHaveBeenCalled();
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

    loadProviderAccountsMock.mockResolvedValue([resolvedAccount]);
    loadProviderRulesMock.mockResolvedValue([{ id: "rule_1" }]);
    resolveProviderMock.mockImplementation(() =>
      ok({
        adapter: paystackAdapter,
        account: resolvedAccount,
        ruleId: "rule_1",
      }),
    );

    resolveOrCreateCustomerMock.mockResolvedValue({
      id: "cus_rule",
      email: "rule@example.com",
    });

    executeSwitchMock.mockResolvedValue({
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
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(resolveProviderMock).toHaveBeenCalledTimes(1);

    const resolverArg = resolveProviderMock.mock.calls[0]?.[1] as {
      context: { region?: string; currency: string };
      accounts: ProviderAccount[];
    };
    expect(resolverArg.context.region).toBe(undefined);
    expect(resolverArg.context.currency).toBe("USD");
    expect(resolverArg.accounts[0].id).toBe("acct_rule_paystack");

    const providerCtxArg = executeSwitchMock.mock.calls[0]?.[3] as {
      adapter: Adapter;
      account: ProviderAccount;
    };
    expect(providerCtxArg?.adapter?.id).toBe("paystack");
    expect(providerCtxArg?.account?.id).toBe("acct_rule_paystack");
  });
});
