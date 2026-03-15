import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@owostack/db";
import creditPacksRoute from "../src/routes/dashboard/credit-packs";
import { createRouteTestApp } from "./helpers/route-harness";
import { ok } from "./helpers/result";

const hoisted = vi.hoisted(() => ({
  resolveProviderMock: vi.fn(),
  getProviderRegistryMock: vi.fn(),
  deriveProviderEnvironmentMock: vi.fn(() => "test"),
  loadProviderAccountsMock: vi.fn(),
  loadProviderRulesMock: vi.fn(),
  buildProviderContextMock: vi.fn((ctx: unknown) => ctx),
}));

const resolveProviderMock = hoisted.resolveProviderMock;
const getProviderRegistryMock = hoisted.getProviderRegistryMock;
const deriveProviderEnvironmentMock = hoisted.deriveProviderEnvironmentMock;
const loadProviderAccountsMock = hoisted.loadProviderAccountsMock;
const loadProviderRulesMock = hoisted.loadProviderRulesMock;
const buildProviderContextMock = hoisted.buildProviderContextMock;

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
    creditPacks: [] as any[],
  };

  const db = {
    store,
    query: {
      creditPacks: {
        findFirst: vi.fn(async () => store.creditPacks[0] ?? null),
        findMany: vi.fn(async () => store.creditPacks),
      },
    },
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: any) => ({
        returning: vi.fn(async () => {
          if (table === (schema as any).creditPacks) {
            const inserted = {
              id: "pack_new",
              organizationId: "org_123",
              providerProductId: null,
              providerPriceId: null,
              isActive: true,
              ...values,
            };
            store.creditPacks = [inserted];
            return [inserted];
          }
          return [];
        }),
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: any) => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            if (table === (schema as any).creditPacks) {
              store.creditPacks = store.creditPacks.map((pack) => ({
                ...pack,
                ...values,
              }));
              return [store.creditPacks[0]];
            }
            return [];
          }),
        })),
      })),
    })),
    select: vi.fn(),
  };

  return db;
}

describe("Dashboard Credit Packs API", () => {
  const dodoAdapter = {
    id: "dodopayments",
    createProduct: vi.fn(async () =>
      ok({ productId: "dodo_prod_1", priceId: "dodo_prod_1" }),
    ),
  };

  const env = {
    ENCRYPTION_KEY: "test_key",
    ENVIRONMENT: "test",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resolveProviderMock.mockReset();
    deriveProviderEnvironmentMock.mockReturnValue("test");
    loadProviderRulesMock.mockResolvedValue([]);
    buildProviderContextMock.mockImplementation((ctx: unknown) => ctx);
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
  });

  it("eagerly syncs provider product ids on create", async () => {
    const db = createMockDb();
    const app = createRouteTestApp(creditPacksRoute, {
      db,
      organizationId: "org_123",
    });

    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: "org_123",
          name: "Starter Pack",
          credits: 100,
          price: 500,
          currency: "USD",
          creditSystemId: "cs_wallet",
          providerId: "dodopayments",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(dodoAdapter.createProduct).toHaveBeenCalledTimes(1);
    expect(body.data).toMatchObject({
      providerId: "dodopayments",
      providerProductId: "dodo_prod_1",
      providerPriceId: "dodo_prod_1",
    });
  });

  it("recreates provider product ids when provider-backed fields change", async () => {
    const db = createMockDb();
    db.store.creditPacks = [
      {
        id: "pack_existing",
        organizationId: "org_123",
        name: "Starter Pack",
        slug: "starter-pack",
        description: null,
        credits: 100,
        price: 500,
        currency: "USD",
        creditSystemId: "cs_wallet",
        providerId: "dodopayments",
        providerProductId: "old_prod",
        providerPriceId: "old_prod",
        metadata: null,
      },
    ];

    dodoAdapter.createProduct.mockResolvedValueOnce(
      ok({ productId: "dodo_prod_2", priceId: "dodo_prod_2" }),
    );

    const app = createRouteTestApp(creditPacksRoute, {
      db,
      organizationId: "org_123",
    });

    const res = await app.request(
      "/pack_existing",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: 900 }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(dodoAdapter.createProduct).toHaveBeenCalledTimes(1);
    expect(body.data).toMatchObject({
      providerId: "dodopayments",
      providerProductId: "dodo_prod_2",
      providerPriceId: "dodo_prod_2",
      price: 900,
    });
  });
});
