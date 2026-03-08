import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  createWalletRoute,
  type WalletDependencies,
} from "../src/routes/api/wallet";
import { createRouteTestApp } from "./helpers/route-harness";
import { err, ok } from "./helpers/result";

interface MockDb {
  query: {
    customers: { findFirst: Mock };
    paymentMethods: { findMany: Mock };
  };
  update: Mock;
}

interface MockAuthDb {
  query: {
    organizations: { findFirst: Mock };
  };
  update: Mock;
}

interface Env {
  ENCRYPTION_KEY: string;
  ENVIRONMENT: string;
}

describe("/wallet/setup behavior", () => {
  const dbUpdateWhere = vi.fn(async () => []);
  const dbUpdateSet = vi.fn(() => ({ where: dbUpdateWhere }));
  const dbUpdate = vi.fn(() => ({ set: dbUpdateSet }));

  const mockDb: MockDb = {
    query: {
      customers: {
        findFirst: vi.fn(),
      },
      paymentMethods: {
        findMany: vi.fn(async () => []),
      },
    },
    update: dbUpdate,
  };

  const mockAuthDb: MockAuthDb = {
    query: {
      organizations: {
        findFirst: vi.fn(async () => ({
          id: "org_1",
          metadata: { defaultCurrency: "USD" },
        })),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => []) })),
    })),
  };

  const env: Env = {
    ENCRYPTION_KEY: "test_key",
    ENVIRONMENT: "test",
  };

  const verifyApiKeyMock = vi.fn();
  const getProviderRegistryMock = vi.fn();
  const loadProviderAccountsMock = vi.fn();
  const deriveProviderEnvironmentMock = vi.fn(() => "test");
  const deps: WalletDependencies = {
    verifyApiKey:
      verifyApiKeyMock as unknown as WalletDependencies["verifyApiKey"],
    getProviderRegistry:
      getProviderRegistryMock as unknown as WalletDependencies["getProviderRegistry"],
    loadProviderAccounts:
      loadProviderAccountsMock as unknown as WalletDependencies["loadProviderAccounts"],
    deriveProviderEnvironment:
      deriveProviderEnvironmentMock as unknown as WalletDependencies["deriveProviderEnvironment"],
  };

  interface CustomerSessionResult {
    id: string;
    email: string;
  }

  interface CustomerSessionResponse {
    url: string;
    token: string;
  }

  interface PolarAdapter {
    id: string;
    defaultCurrency: string;
    createPlan: Mock;
    createCheckoutSession: Mock;
    createCustomer: Mock;
    createCustomerSession: Mock;
  }

  const polarAdapter: PolarAdapter = {
    id: "polar",
    defaultCurrency: "USD",
    createPlan: vi.fn(async () => ok({ id: "prod_should_not_be_created" })),
    createCheckoutSession: vi.fn(async () =>
      err("checkout should not be used for Polar wallet setup"),
    ),
    createCustomer: vi.fn(async () =>
      ok<CustomerSessionResult>({
        id: "cus_polar_1",
        email: "alice@example.com",
      }),
    ),
    createCustomerSession: vi.fn(async () =>
      ok<CustomerSessionResponse>({
        url: "https://polar.sh/customer-portal/session_1",
        token: "cssn_1",
      }),
    ),
  };

  const stripeAdapter = {
    id: "stripe",
    defaultCurrency: "USD",
    createCheckoutSession: vi.fn(async () =>
      ok({
        url: "https://checkout.stripe.com/c/pay/cs_test_wallet_1",
        reference: "cs_test_wallet_1",
      }),
    ),
  };

  const app = createRouteTestApp(createWalletRoute(deps), {
    db: mockDb,
    authDb: mockAuthDb,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    verifyApiKeyMock.mockResolvedValue({
      id: "key_1",
      organizationId: "org_1",
    });

    getProviderRegistryMock.mockReturnValue({
      get: vi.fn((providerId: string) =>
        providerId === "polar"
          ? polarAdapter
          : providerId === "stripe"
            ? stripeAdapter
            : undefined,
      ),
    });

    loadProviderAccountsMock.mockResolvedValue([
      {
        id: "acct_polar_1",
        organizationId: "org_1",
        providerId: "polar",
        environment: "test",
        credentials: { secretKey: "polar_test_token" },
      },
    ]);

    deriveProviderEnvironmentMock.mockReturnValue("test");

    mockDb.query.customers.findFirst.mockResolvedValue({
      id: "cust_1",
      email: "alice@example.com",
      name: "Alice",
      providerId: null,
      providerCustomerId: null,
      paystackCustomerId: null,
    });
  });

  it("uses Polar customer session flow and avoids mandate-only checkout path", async () => {
    const res = await app.request(
      "/wallet/setup",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer owo_sk_test",
        },
        body: JSON.stringify({
          customer: "alice@example.com",
          provider: "polar",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);

    const body = (await res.json()) as { url: string; reference: string };
    expect(body.url).toBe("https://polar.sh/customer-portal/session_1");
    expect(body.reference).toBe("cssn_1");

    expect(polarAdapter.createCustomer).toHaveBeenCalledTimes(1);
    expect(polarAdapter.createCustomerSession).toHaveBeenCalledTimes(1);
    expect(polarAdapter.createPlan).not.toHaveBeenCalled();
    expect(polarAdapter.createCheckoutSession).not.toHaveBeenCalled();

    expect(dbUpdate).toHaveBeenCalledTimes(1);
  });

  it("uses a $1.00 setup authorization for Stripe instead of $100.00", async () => {
    loadProviderAccountsMock.mockResolvedValueOnce([
      {
        id: "acct_stripe_1",
        organizationId: "org_1",
        providerId: "stripe",
        environment: "test",
        credentials: { secretKey: "sk_test_123" },
      },
    ]);

    const res = await app.request(
      "/wallet/setup",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer owo_sk_test",
        },
        body: JSON.stringify({
          customer: "alice@example.com",
          provider: "stripe",
          callbackUrl: "https://example.com/return",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(stripeAdapter.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(stripeAdapter.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 100,
        currency: "USD",
        metadata: expect.objectContaining({
          type: "card_setup",
        }),
      }),
    );
  });
});
