import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@owostack/db";
import syncRoute from "../src/routes/api/sync";
import { createRouteTestApp } from "./helpers/route-harness";
import { ok } from "./helpers/result";

const hoisted = vi.hoisted(() => ({
  verifyApiKeyMock: vi.fn(),
  resolveProviderMock: vi.fn(),
  getProviderRegistryMock: vi.fn(),
  deriveProviderEnvironmentMock: vi.fn(() => "test"),
  loadProviderAccountsMock: vi.fn(),
  loadProviderRulesMock: vi.fn(),
  buildProviderContextMock: vi.fn((ctx: unknown) => ctx),
}));

const verifyApiKeyMock = hoisted.verifyApiKeyMock;
const resolveProviderMock = hoisted.resolveProviderMock;
const getProviderRegistryMock = hoisted.getProviderRegistryMock;
const deriveProviderEnvironmentMock = hoisted.deriveProviderEnvironmentMock;
const loadProviderAccountsMock = hoisted.loadProviderAccountsMock;
const loadProviderRulesMock = hoisted.loadProviderRulesMock;
const buildProviderContextMock = hoisted.buildProviderContextMock;

vi.mock("../src/lib/api-keys", () => ({
  verifyApiKey: (...args: unknown[]) => verifyApiKeyMock(...args),
}));

vi.mock("@owostack/adapters", async () => {
  const actual =
    await vi.importActual<typeof import("@owostack/adapters")>(
      "@owostack/adapters",
    );

  return {
    ...actual,
    resolveProvider: (...args: unknown[]) => resolveProviderMock(...args),
  };
});

vi.mock("../src/lib/providers", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/providers")>(
    "../src/lib/providers",
  );

  return {
    ...actual,
    getProviderRegistry: () => getProviderRegistryMock(),
    deriveProviderEnvironment: (...args: unknown[]) =>
      deriveProviderEnvironmentMock(...args),
    loadProviderAccounts: (...args: unknown[]) =>
      loadProviderAccountsMock(...args),
    loadProviderRules: (...args: unknown[]) => loadProviderRulesMock(...args),
    buildProviderContext: (...args: unknown[]) =>
      buildProviderContextMock(...args),
  };
});

function createMockDb() {
  const store = {
    features: [] as any[],
    creditSystems: [] as any[],
    creditSystemFeatures: [] as any[],
    creditPacks: [] as any[],
    plans: [] as any[],
    planFeatures: [] as any[],
  };

  const db = {
    store,
    query: {
      features: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => store.features),
      },
      creditSystems: {
        findFirst: vi.fn(async () => store.creditSystems[0] ?? null),
      },
      creditPacks: {
        findFirst: vi.fn(async () => store.creditPacks[0] ?? null),
      },
      creditSystemFeatures: {
        findMany: vi.fn(async () => store.creditSystemFeatures),
      },
      plans: {
        findFirst: vi.fn(async () => store.plans[0] ?? null),
      },
      planFeatures: {
        findMany: vi.fn(async () => store.planFeatures),
      },
    },
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (values: any) => {
        if (table === schema.features) {
          store.features.push(values);
          return;
        }

        if (table === schema.plans) {
          store.plans.push({
            billingModel: "base",
            billingType: "recurring",
            isActive: true,
            version: 1,
            providerPlanId: null,
            providerMetadata: null,
            paystackPlanId: null,
            trialCardRequired: false,
            ...values,
          });
          return;
        }

        if (table === schema.creditSystems) {
          store.creditSystems.push(values);
          return;
        }

        if (table === (schema as any).creditPacks) {
          store.creditPacks.push({
            providerProductId: null,
            providerPriceId: null,
            isActive: true,
            ...values,
          });
          return;
        }

        if (table === schema.planFeatures) {
          store.planFeatures.push(values);
          return;
        }

        if (table === (schema as any).creditSystemFeatures) {
          store.creditSystemFeatures.push(values);
        }
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: any) => ({
        where: vi.fn(async () => {
          if (table === schema.plans) {
            store.plans = store.plans.map((plan) => ({ ...plan, ...values }));
            return [];
          }

          if (table === schema.features) {
            store.features = store.features.map((feature) => ({
              ...feature,
              ...values,
            }));
            return [];
          }

          if (table === schema.creditSystems) {
            store.creditSystems = store.creditSystems.map((creditSystem) => ({
              ...creditSystem,
              ...values,
            }));
            return [];
          }

          if (table === (schema as any).creditPacks) {
            store.creditPacks = store.creditPacks.map((creditPack) => ({
              ...creditPack,
              ...values,
            }));
            return [];
          }

          if (table === schema.planFeatures) {
            store.planFeatures = store.planFeatures.map((planFeature) => ({
              ...planFeature,
              ...values,
            }));
            return [];
          }

          if (table === (schema as any).creditSystemFeatures) {
            store.creditSystemFeatures = store.creditSystemFeatures.map(
              (creditSystemFeature) => ({
                ...creditSystemFeature,
                ...values,
              }),
            );
          }

          return [];
        }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => []),
    })),
  };

  return db;
}

describe("POST /api/v1/sync", () => {
  const paystackAdapter = {
    id: "paystack",
    createPlan: vi.fn(async () => ok({ id: "prov_plan_paystack_1" })),
  };
  const dodoAdapter = {
    id: "dodopayments",
    createPlan: vi.fn(async () => ok({ id: "prov_plan_dodo_1" })),
    createProduct: vi.fn(async () =>
      ok({ productId: "dodo_prod_1", priceId: "dodo_prod_1" }),
    ),
  };
  const stripeAdapter = {
    id: "stripe",
    createProduct: vi.fn(async () =>
      ok({ productId: "prod_stripe_1", priceId: "price_stripe_1" }),
    ),
  };

  const env = {
    ENCRYPTION_KEY: "test_key",
    ENVIRONMENT: "test",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    verifyApiKeyMock.mockResolvedValue({
      id: "key_123",
      organizationId: "org_123",
    });
    deriveProviderEnvironmentMock.mockReturnValue("test");
    loadProviderRulesMock.mockResolvedValue([]);
    buildProviderContextMock.mockImplementation((ctx: unknown) => ctx);
    resolveProviderMock.mockReset();
  });

  it("syncs a paid plan to an explicitly selected provider", async () => {
    const db = createMockDb();
    getProviderRegistryMock.mockReturnValue(
      new Map([["paystack", paystackAdapter]]),
    );
    loadProviderAccountsMock.mockResolvedValue([
      {
        id: "acct_paystack",
        organizationId: "org_123",
        providerId: "paystack",
        environment: "test",
        credentials: {},
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const app = createRouteTestApp(syncRoute, { db, authDb: {} });
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer owo_sk_test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          features: [{ slug: "priority-support", type: "boolean", name: "Priority Support" }],
          plans: [
            {
              slug: "pro",
              name: "Pro",
              price: 5000,
              currency: "NGN",
              interval: "monthly",
              provider: "paystack",
              features: [{ slug: "priority-support", enabled: true }],
            },
          ],
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.warnings).toEqual([]);
    expect(resolveProviderMock).not.toHaveBeenCalled();
    expect(paystackAdapter.createPlan).toHaveBeenCalledTimes(1);
    expect(db.store.plans[0]).toMatchObject({
      providerId: "paystack",
      providerPlanId: "prov_plan_paystack_1",
      paystackPlanId: "prov_plan_paystack_1",
    });
  });

  it("syncs a paid plan using the organization's provider routing rules", async () => {
    const db = createMockDb();
    const dodoAccount = {
      id: "acct_dodo",
      organizationId: "org_123",
      providerId: "dodopayments",
      environment: "test",
      credentials: {},
      createdAt: 1,
      updatedAt: 1,
    };

    getProviderRegistryMock.mockReturnValue(
      new Map([["dodopayments", dodoAdapter]]),
    );
    loadProviderAccountsMock.mockResolvedValue([dodoAccount]);
    loadProviderRulesMock.mockResolvedValue([
      {
        id: "rule_default",
        organizationId: "org_123",
        providerId: "dodopayments",
        priority: 100,
        isDefault: true,
        conditions: {},
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    resolveProviderMock.mockReturnValue(
      ok({
        adapter: dodoAdapter,
        account: dodoAccount,
        ruleId: "rule_default",
      }),
    );

    const app = createRouteTestApp(syncRoute, { db, authDb: {} });
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer owo_sk_test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          features: [{ slug: "agents", type: "boolean", name: "Agents" }],
          plans: [
            {
              slug: "global-pro",
              name: "Global Pro",
              price: 12000,
              currency: "USD",
              interval: "monthly",
              metadata: { region: "global" },
              features: [{ slug: "agents", enabled: true }],
            },
          ],
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.warnings).toEqual([]);
    expect(buildProviderContextMock).toHaveBeenCalledWith({
      currency: "USD",
      metadata: { region: "global" },
    });
    expect(resolveProviderMock).toHaveBeenCalledTimes(1);
    expect(dodoAdapter.createPlan).toHaveBeenCalledTimes(1);
    expect(db.store.plans[0]).toMatchObject({
      providerId: "dodopayments",
      providerPlanId: "prov_plan_dodo_1",
      paystackPlanId: null,
    });
  });

  it("does not sync one-time plans to a provider and stores their billing type", async () => {
    const db = createMockDb();
    getProviderRegistryMock.mockReturnValue(
      new Map([["paystack", paystackAdapter]]),
    );
    loadProviderAccountsMock.mockResolvedValue([
      {
        id: "acct_paystack",
        organizationId: "org_123",
        providerId: "paystack",
        environment: "test",
        credentials: {},
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const app = createRouteTestApp(syncRoute, { db, authDb: {} });
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer owo_sk_test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          features: [{ slug: "credits", type: "boolean", name: "Credits" }],
          plans: [
            {
              slug: "credit-pack-plan",
              name: "Credit Pack Plan",
              price: 2500,
              currency: "USD",
              interval: "monthly",
              billingType: "one_time",
              trialDays: 14,
              autoEnable: true,
              provider: "paystack",
              features: [{ slug: "credits", enabled: true }],
            },
          ],
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.warnings).toEqual([]);
    expect(paystackAdapter.createPlan).not.toHaveBeenCalled();
    expect(db.store.plans[0]).toMatchObject({
      billingType: "one_time",
      providerId: "paystack",
      providerPlanId: null,
      paystackPlanId: null,
      trialDays: 0,
      autoEnable: false,
    });
  });

  it("eagerly syncs credit packs to providers that require products", async () => {
    const db = createMockDb();
    getProviderRegistryMock.mockReturnValue(
      new Map([["dodopayments", dodoAdapter]]),
    );
    loadProviderAccountsMock.mockResolvedValue([
      {
        id: "acct_dodo",
        organizationId: "org_123",
        providerId: "dodopayments",
        environment: "test",
        credentials: {},
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const app = createRouteTestApp(syncRoute, { db, authDb: {} });
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer owo_sk_test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          features: [],
          creditSystems: [
            {
              slug: "wallet",
              name: "Wallet",
              features: [],
            },
          ],
          creditPacks: [
            {
              slug: "starter-pack",
              name: "Starter Pack",
              credits: 100,
              price: 500,
              currency: "USD",
              creditSystem: "wallet",
              provider: "dodopayments",
            },
          ],
          plans: [],
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.warnings).toEqual([]);
    expect(dodoAdapter.createProduct).toHaveBeenCalledTimes(1);
    expect(db.store.creditPacks[0]).toMatchObject({
      providerId: "dodopayments",
      providerProductId: "dodo_prod_1",
      providerPriceId: "dodo_prod_1",
    });
  });

  it("backfills missing credit pack provider product ids on resync", async () => {
    const db = createMockDb();
    db.store.creditSystems.push({
      id: "cs_wallet",
      organizationId: "org_123",
      slug: "wallet",
      name: "Wallet",
    });
    db.store.creditPacks.push({
      id: "pack_1",
      organizationId: "org_123",
      slug: "starter-pack",
      name: "Starter Pack",
      description: null,
      credits: 100,
      price: 500,
      currency: "USD",
      creditSystemId: "cs_wallet",
      providerId: "stripe",
      providerProductId: null,
      providerPriceId: null,
      metadata: null,
    });

    getProviderRegistryMock.mockReturnValue(new Map([["stripe", stripeAdapter]]));
    loadProviderAccountsMock.mockResolvedValue([
      {
        id: "acct_stripe",
        organizationId: "org_123",
        providerId: "stripe",
        environment: "test",
        credentials: {},
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const app = createRouteTestApp(syncRoute, { db, authDb: {} });
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer owo_sk_test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          features: [],
          creditSystems: [
            {
              slug: "wallet",
              name: "Wallet",
              features: [],
            },
          ],
          creditPacks: [
            {
              slug: "starter-pack",
              name: "Starter Pack",
              credits: 100,
              price: 500,
              currency: "USD",
              creditSystem: "wallet",
              provider: "stripe",
            },
          ],
          plans: [],
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.warnings).toEqual([]);
    expect(stripeAdapter.createProduct).toHaveBeenCalledTimes(1);
    expect(db.store.creditPacks[0]).toMatchObject({
      providerId: "stripe",
      providerProductId: "prod_stripe_1",
      providerPriceId: "price_stripe_1",
    });
  });
});
