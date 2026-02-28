import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { app } from "../src/index";
import { verifyApiKey } from "../src/lib/api-keys";
import { resolveOrCreateCustomer } from "../src/lib/customers";
import { ensureCreditPackSynced } from "../src/lib/credit-pack-sync";
import {
  getProviderRegistry,
  loadProviderAccounts,
  loadProviderRules,
} from "../src/lib/providers";
import { resolveProvider } from "@owostack/adapters";

function ok<T>(value: T) {
  return {
    isOk: () => true,
    isErr: () => false,
    value,
  };
}

function err(message: string) {
  return {
    isOk: () => false,
    isErr: () => true,
    error: { message },
  };
}

interface MockDb {
  query: {
    creditPacks: { findFirst: Mock };
  };
}

const mockDb: MockDb = {
  query: {
    creditPacks: { findFirst: vi.fn() },
  },
};

vi.mock("@owostack/db", () => ({
  createDb: () => mockDb,
  schema: {
    creditPacks: {
      organizationId: "organizationId",
      slug: "slug",
      isActive: "isActive",
      id: "id",
    },
  },
}));

vi.mock("../src/lib/api-keys", () => ({
  verifyApiKey: vi.fn(),
}));

vi.mock("../src/lib/customers", () => ({
  resolveOrCreateCustomer: vi.fn(),
}));

vi.mock("../src/lib/credit-pack-sync", () => ({
  ensureCreditPackSynced: vi.fn(),
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

vi.mock("../src/lib/auth", () => ({
  auth: () => ({
    handler: () => new Response("Auth"),
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  }),
}));

interface Adapter {
  id: string;
  createCheckoutSession: Mock;
}

interface Env {
  DB: unknown;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  ENCRYPTION_KEY: string;
}

describe("POST /v1/addon behavior", () => {
  const paystackAdapter: Adapter = {
    id: "paystack",
    createCheckoutSession: vi.fn(),
  };

  const dodoAdapter: Adapter = {
    id: "dodopayments",
    createCheckoutSession: vi.fn(),
  };

  const env: Env = {
    DB: {},
    BETTER_AUTH_SECRET: "secret",
    BETTER_AUTH_URL: "http://localhost",
    ENCRYPTION_KEY: "test_key",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(verifyApiKey).mockResolvedValue({
      id: "key_1",
      organizationId: "org_1",
    });

    vi.mocked(getProviderRegistry).mockReturnValue({
      get: vi.fn((providerId: string) => {
        if (providerId === "paystack") return paystackAdapter;
        if (providerId === "dodopayments") return dodoAdapter;
        return undefined;
      }),
    });

    vi.mocked(loadProviderRules).mockResolvedValue([]);
    vi.mocked(loadProviderAccounts).mockResolvedValue([]);
    vi.mocked(resolveProvider).mockReturnValue(err("no match"));

    vi.mocked(resolveOrCreateCustomer).mockResolvedValue({
      id: "cus_1",
      email: "customer@example.com",
      providerCustomerId: "prov_cus_1",
      paystackCustomerId: null,
    });

    vi.mocked(ensureCreditPackSynced).mockResolvedValue(null);

    paystackAdapter.createCheckoutSession.mockResolvedValue(
      ok({ url: "https://checkout.paystack.com/abc" }),
    );
    dodoAdapter.createCheckoutSession.mockResolvedValue(
      ok({ url: "https://checkout.dodo.com/abc" }),
    );
  });

  it("fails early when explicit provider is requested but account is not configured", async () => {
    mockDb.query.creditPacks.findFirst.mockResolvedValue({
      id: "pack_1",
      organizationId: "org_1",
      slug: "credits-100",
      name: "100 Credits",
      credits: 100,
      price: 2500,
      currency: "USD",
      providerId: null,
      creditSystemId: "cs_1",
      isActive: true,
    });

    vi.mocked(loadProviderAccounts).mockResolvedValue([]);

    const res = await app.request(
      "/v1/addon",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer owo_sk_test",
        },
        body: JSON.stringify({
          customer: "customer@example.com",
          pack: "credits-100",
          provider: "paystack",
          quantity: 1,
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Provider 'paystack' not configured");

    expect(vi.mocked(resolveOrCreateCustomer)).not.toHaveBeenCalled();
    expect(vi.mocked(resolveProvider)).not.toHaveBeenCalled();
    expect(paystackAdapter.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("uses pack provider when request has no explicit provider and produces checkout", async () => {
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

    vi.mocked(loadProviderAccounts).mockResolvedValue([
      {
        id: "acct_paystack",
        providerId: "paystack",
        environment: "test",
        credentials: { secretKey: "sk_test" },
      },
    ]);

    vi.mocked(ensureCreditPackSynced).mockResolvedValue({
      productId: "prod_1",
      priceId: "price_1",
    });

    const res = await app.request(
      "/v1/addon",
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
    expect(vi.mocked(resolveProvider)).not.toHaveBeenCalled();

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

  it("falls back to rules-based provider resolution when pack has no provider", async () => {
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

    vi.mocked(loadProviderRules).mockResolvedValue([{ id: "rule_1" }]);
    vi.mocked(loadProviderAccounts).mockResolvedValue([
      {
        id: "acct_dodo",
        providerId: "dodopayments",
        environment: "test",
        credentials: { secretKey: "dodo_test" },
      },
    ]);

    vi.mocked(resolveProvider).mockReturnValue(
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
      "/v1/addon",
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
    expect(vi.mocked(resolveProvider)).toHaveBeenCalledTimes(1);
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

    vi.mocked(loadProviderAccounts).mockResolvedValue([
      {
        id: "acct_paystack",
        providerId: "paystack",
        environment: "test",
        credentials: { secretKey: "sk_test" },
      },
    ]);

    vi.mocked(resolveOrCreateCustomer).mockResolvedValue(null);

    const res = await app.request(
      "/v1/addon",
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
    expect(vi.mocked(resolveOrCreateCustomer)).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "external-customer-123",
        customerData: undefined,
      }),
    );
    expect(paystackAdapter.createCheckoutSession).not.toHaveBeenCalled();
  });
});
