import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createAddonRoute, type AddonDependencies } from "../src/routes/api/addon";
import { CustomerResolutionConflictError } from "../src/lib/customer-resolution";
import { createRouteTestApp } from "./helpers/route-harness";
import { err, ok } from "./helpers/result";

interface MockDb {
  query: {
    creditPacks: { findFirst: Mock };
  };
}

type MockAuthDb = {
  query: {
    organizations: {
      findFirst: Mock;
    };
  };
};

interface Adapter {
  id: string;
  createCheckoutSession: Mock;
}

interface Env {
  ENCRYPTION_KEY: string;
  ENVIRONMENT?: string;
}

describe("POST /v1/addon behavior", () => {
  const mockDb: MockDb = {
    query: {
      creditPacks: { findFirst: vi.fn() },
    },
  };

  const mockAuthDb: MockAuthDb = {
    query: {
      organizations: {
        findFirst: vi.fn(async () => ({ id: "org_1" })),
      },
    },
  };

  const verifyApiKeyMock = vi.fn();
  const resolveOrCreateCustomerMock = vi.fn();
  const ensureCreditPackSyncedMock = vi.fn();
  const getProviderRegistryMock = vi.fn();
  const buildProviderContextMock = vi.fn((params) => params);
  const deriveProviderEnvironmentMock = vi.fn(() => "test");
  const loadProviderAccountsMock = vi.fn();
  const loadProviderRulesMock = vi.fn();
  const resolveProviderMock = vi.fn(() => err("no match"));

  const deps: AddonDependencies = {
    resolveOrCreateCustomer:
      resolveOrCreateCustomerMock as unknown as AddonDependencies["resolveOrCreateCustomer"],
    verifyApiKey: verifyApiKeyMock as unknown as AddonDependencies["verifyApiKey"],
    resolveProvider:
      resolveProviderMock as unknown as AddonDependencies["resolveProvider"],
    getProviderRegistry:
      getProviderRegistryMock as unknown as AddonDependencies["getProviderRegistry"],
    buildProviderContext:
      buildProviderContextMock as unknown as AddonDependencies["buildProviderContext"],
    deriveProviderEnvironment:
      deriveProviderEnvironmentMock as unknown as AddonDependencies["deriveProviderEnvironment"],
    loadProviderAccounts:
      loadProviderAccountsMock as unknown as AddonDependencies["loadProviderAccounts"],
    loadProviderRules:
      loadProviderRulesMock as unknown as AddonDependencies["loadProviderRules"],
    ensureCreditPackSynced:
      ensureCreditPackSyncedMock as unknown as AddonDependencies["ensureCreditPackSynced"],
  };

  const paystackAdapter: Adapter = {
    id: "paystack",
    createCheckoutSession: vi.fn(),
  };

  const dodoAdapter: Adapter = {
    id: "dodopayments",
    createCheckoutSession: vi.fn(),
  };

  const env: Env = {
    ENCRYPTION_KEY: "test_key",
    ENVIRONMENT: "test",
  };

  let app: ReturnType<
    typeof createRouteTestApp<{ db: MockDb; authDb: MockAuthDb }>
  >;

  beforeEach(() => {
    vi.clearAllMocks();

    app = createRouteTestApp(createAddonRoute(deps), {
      db: mockDb,
      authDb: mockAuthDb,
    });

    verifyApiKeyMock.mockResolvedValue({
      id: "key_1",
      organizationId: "org_1",
    });

    getProviderRegistryMock.mockReturnValue({
      get: vi.fn((providerId: string) => {
        if (providerId === "paystack") return paystackAdapter;
        if (providerId === "dodopayments") return dodoAdapter;
        return undefined;
      }),
    });

    loadProviderRulesMock.mockResolvedValue([]);
    loadProviderAccountsMock.mockResolvedValue([]);
    resolveProviderMock.mockReturnValue(err("no match"));

    resolveOrCreateCustomerMock.mockResolvedValue({
      id: "cus_1",
      email: "customer@example.com",
      providerCustomerId: "prov_cus_1",
      paystackCustomerId: null,
    });

    ensureCreditPackSyncedMock.mockResolvedValue(null);

    paystackAdapter.createCheckoutSession.mockResolvedValue(
      ok({ url: "https://checkout.paystack.com/abc" }),
    );
    dodoAdapter.createCheckoutSession.mockResolvedValue(
      ok({ url: "https://checkout.dodo.com/abc" }),
    );
  });

  it("fails early when no provider account is configured for a provider-backed pack", async () => {
    mockDb.query.creditPacks.findFirst.mockResolvedValue({
      id: "pack_1",
      organizationId: "org_1",
      slug: "credits-100",
      name: "100 Credits",
      credits: 100,
      price: 2500,
      currency: "USD",
      providerId: "paystack",
      creditSystemId: "cs_1",
      isActive: true,
    });

    loadProviderAccountsMock.mockResolvedValue([]);

    const res = await app.request(
      "/addon",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer owo_sk_test",
        },
        body: JSON.stringify({
          customer: "customer@example.com",
          pack: "credits-100",
          quantity: 1,
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Provider 'paystack' not configured");
    expect(resolveOrCreateCustomerMock).not.toHaveBeenCalled();
    expect(resolveProviderMock).not.toHaveBeenCalled();
    expect(paystackAdapter.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("uses the pack provider and produces checkout", async () => {
    mockDb.query.creditPacks.findFirst.mockResolvedValue({
      id: "pack_1",
      organizationId: "org_1",
      slug: "credits-100",
      name: "100 Credits",
      credits: 100,
      price: 2500,
      currency: "USD",
      providerId: "paystack",
      creditSystemId: "cs_1",
      isActive: true,
    });

    loadProviderAccountsMock.mockResolvedValue([
      {
        id: "acct_paystack",
        providerId: "paystack",
        environment: "test",
        credentials: { secretKey: "sk_test" },
      },
    ]);

    ensureCreditPackSyncedMock.mockResolvedValue({
      productId: "prod_1",
      priceId: "price_1",
    });

    const res = await app.request(
      "/addon",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer owo_sk_test",
        },
        body: JSON.stringify({
          customer: "customer@example.com",
          pack: "credits-100",
          quantity: 2,
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      requiresCheckout: boolean;
    };
    expect(body.success).toBe(true);
    expect(body.requiresCheckout).toBe(true);
    expect(resolveProviderMock).not.toHaveBeenCalled();

    const checkoutArg = paystackAdapter.createCheckoutSession.mock
      .calls[0]?.[0] as {
      lineItems: unknown[];
      metadata: { type: string; provider_id: string };
    };
    expect(checkoutArg.lineItems).toEqual([
      {
        priceId: "price_1",
        quantity: 2,
        adjustableQuantity: { enabled: true, minimum: 1, maximum: 100 },
      },
    ]);
    expect(checkoutArg.metadata.type).toBe("credit_purchase");
    expect(checkoutArg.metadata.provider_id).toBe("paystack");
  });

  it("falls back to rules-based provider resolution when the pack has no provider", async () => {
    mockDb.query.creditPacks.findFirst.mockResolvedValue({
      id: "pack_2",
      organizationId: "org_1",
      slug: "credits-500",
      name: "500 Credits",
      credits: 500,
      price: 10000,
      currency: "USD",
      providerId: null,
      creditSystemId: "cs_1",
      isActive: true,
    });

    loadProviderRulesMock.mockResolvedValue([{ id: "rule_1" }]);
    loadProviderAccountsMock.mockResolvedValue([
      {
        id: "acct_dodo",
        providerId: "dodopayments",
        environment: "test",
        credentials: { secretKey: "dodo_test" },
      },
    ]);

    resolveProviderMock.mockReturnValue(
      ok({
        adapter: dodoAdapter,
        account: {
          id: "acct_dodo",
          providerId: "dodopayments",
          environment: "test",
          credentials: { secretKey: "dodo_test" },
        },
        ruleId: "rule_1",
      }),
    );

    const res = await app.request(
      "/addon",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer owo_sk_test",
        },
        body: JSON.stringify({
          customer: "customer@example.com",
          pack: "credits-500",
          quantity: 1,
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(resolveProviderMock).toHaveBeenCalledTimes(1);
    expect(dodoAdapter.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(paystackAdapter.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("does not auto-create a customer from a non-email identifier", async () => {
    mockDb.query.creditPacks.findFirst.mockResolvedValue({
      id: "pack_1",
      organizationId: "org_1",
      slug: "credits-100",
      name: "100 Credits",
      credits: 100,
      price: 2500,
      currency: "USD",
      providerId: "paystack",
      creditSystemId: "cs_1",
      isActive: true,
    });

    loadProviderAccountsMock.mockResolvedValue([
      {
        id: "acct_paystack",
        providerId: "paystack",
        environment: "test",
        credentials: { secretKey: "sk_test" },
      },
    ]);

    resolveOrCreateCustomerMock.mockResolvedValue(null);

    const res = await app.request(
      "/addon",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer owo_sk_test",
        },
        body: JSON.stringify({
          customer: "external-customer-123",
          pack: "credits-100",
          quantity: 1,
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Could not resolve customer");
    expect(resolveOrCreateCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "external-customer-123",
        customerData: undefined,
      }),
    );
    expect(paystackAdapter.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns 409 when customer resolution is ambiguous", async () => {
    mockDb.query.creditPacks.findFirst.mockResolvedValue({
      id: "pack_1",
      organizationId: "org_1",
      slug: "credits-100",
      name: "100 Credits",
      credits: 100,
      price: 2500,
      currency: "USD",
      providerId: "paystack",
      creditSystemId: "cs_1",
      isActive: true,
    });

    loadProviderAccountsMock.mockResolvedValue([
      {
        id: "acct_paystack",
        providerId: "paystack",
        environment: "test",
        credentials: { secretKey: "sk_test" },
      },
    ]);

    resolveOrCreateCustomerMock.mockRejectedValueOnce(
      new CustomerResolutionConflictError(
        "org_1",
        "customer@example.com",
        "email",
      ),
    );

    const res = await app.request(
      "/addon",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer owo_sk_test",
        },
        body: JSON.stringify({
          customer: "customer@example.com",
          pack: "credits-100",
          quantity: 1,
        }),
      },
      env,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Multiple customers");
  });
});
