import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Hono } from "hono";
import walletRoute from "../src/routes/api/wallet";
import { verifyApiKey } from "../src/lib/api-keys";
import {
  deriveProviderEnvironment,
  getProviderRegistry,
  loadProviderAccounts,
} from "../src/lib/providers";

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

vi.mock("@owostack/db", () => ({
  schema: {
    organizations: { id: "id" },
    customers: { id: "id" },
    paymentMethods: {
      id: "id",
      customerId: "customerId",
      organizationId: "organizationId",
    },
  },
}));

vi.mock("../src/lib/api-keys", () => ({
  verifyApiKey: vi.fn(),
}));

vi.mock("../src/lib/providers", () => ({
  getProviderRegistry: vi.fn(),
  loadProviderAccounts: vi.fn(),
  deriveProviderEnvironment: vi.fn(() => "test"),
}));

const ok = <T>(value: T) => ({
  isOk: () => true,
  isErr: () => false,
  value,
});

const err = (message: string) => ({
  isOk: () => false,
  isErr: () => true,
  error: { message },
});

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

  let app: Hono;

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

  beforeEach(() => {
    vi.clearAllMocks();

    app = new Hono();
    app.use("*", async (c, next) => {
      c.set("db", mockDb);
      c.set("authDb", mockAuthDb);
      await next();
    });
    app.route("/", walletRoute);

    vi.mocked(verifyApiKey).mockResolvedValue({
      id: "key_1",
      organizationId: "org_1",
    });

    vi.mocked(getProviderRegistry).mockReturnValue({
      get: vi.fn((providerId: string) =>
        providerId === "polar" ? polarAdapter : undefined,
      ),
    });

    vi.mocked(loadProviderAccounts).mockResolvedValue([
      {
        id: "acct_polar_1",
        organizationId: "org_1",
        providerId: "polar",
        environment: "test",
        credentials: { secretKey: "polar_test_token" },
      },
    ]);

    vi.mocked(deriveProviderEnvironment).mockReturnValue("test");

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
});
