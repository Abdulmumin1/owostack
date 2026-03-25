import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import creditPacksRoute from "../../../src/routes/dashboard/credit-packs";
import {
  creditPackProviderSyncDependencies,
  resetCreditPackProviderSyncDependencies,
} from "../../../src/lib/credit-pack-provider-sync";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  createSimulatedProviderRegistry,
  insertCreditPack,
  insertCreditSystem,
  insertRuntimeProviderAccount,
  RUNTIME_ROUTE_ENV,
  SimulatedCatalogProviderAdapter,
} from "../helpers/catalog-runtime";
import { insertOrganization } from "../helpers/workflow-runtime";

describe("Credit packs route runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<
    typeof createRouteTestApp<{ db: any; organizationId: string }>
  >;
  let dodo: SimulatedCatalogProviderAdapter;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_123" });
    await insertCreditSystem(businessDb.d1, {
      id: "cs_wallet",
      organizationId: "org_123",
      slug: "wallet",
      name: "Wallet",
    });

    dodo = new SimulatedCatalogProviderAdapter(
      "dodopayments",
      "Dodo Payments",
      {
        expectedEnvironment: "test",
        createProductResult: {
          productId: "dodo_prod_1",
          priceId: "dodo_price_1",
        },
      },
    );

    resetCreditPackProviderSyncDependencies();
    creditPackProviderSyncDependencies.getProviderRegistry = () =>
      createSimulatedProviderRegistry([dodo]);

    app = createRouteTestApp(creditPacksRoute, {
      db: businessDb.db,
      organizationId: "org_123",
    });
  });

  afterEach(() => {
    resetCreditPackProviderSyncDependencies();
    businessDb.close();
  });

  it("eagerly syncs provider product ids on create", async () => {
    await insertRuntimeProviderAccount(businessDb.d1, {
      organizationId: "org_123",
      providerId: "dodopayments",
    });

    const response = await app.request(
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
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      providerId: "dodopayments",
      providerProductId: "dodo_prod_1",
      providerPriceId: "dodo_price_1",
    });

    const pack = await businessDb.db.query.creditPacks.findFirst({
      where: and(
        eq(schema.creditPacks.organizationId, "org_123"),
        eq(schema.creditPacks.slug, "starter-pack"),
      ),
    });
    expect(pack?.providerId).toBe("dodopayments");
    expect(pack?.providerProductId).toBe("dodo_prod_1");
    expect(pack?.providerPriceId).toBe("dodo_price_1");
    expect(dodo.operations).toEqual([
      {
        kind: "createProduct",
        providerId: "dodopayments",
        environment: "test",
        accountId: "acct_dodopayments_test",
        name: "Starter Pack",
        amount: 500,
        currency: "USD",
        description: undefined,
      },
    ]);
  });

  it("recreates provider product ids when provider-backed fields change", async () => {
    await insertRuntimeProviderAccount(businessDb.d1, {
      organizationId: "org_123",
      providerId: "dodopayments",
    });
    await insertCreditPack(businessDb.d1, {
      id: "pack_existing",
      organizationId: "org_123",
      name: "Starter Pack",
      slug: "starter-pack",
      creditSystemId: "cs_wallet",
      providerId: "dodopayments",
      providerProductId: "old_prod",
      providerPriceId: "old_price",
    });

    const response = await app.request(
      "/pack_existing",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: 900 }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      providerId: "dodopayments",
      providerProductId: "dodo_prod_1",
      providerPriceId: "dodo_price_1",
      price: 900,
    });

    const pack = await businessDb.db.query.creditPacks.findFirst({
      where: eq(schema.creditPacks.id, "pack_existing"),
    });
    expect(pack?.price).toBe(900);
    expect(pack?.providerProductId).toBe("dodo_prod_1");
    expect(pack?.providerPriceId).toBe("dodo_price_1");
    expect(dodo.operations).toEqual([
      {
        kind: "createProduct",
        providerId: "dodopayments",
        environment: "test",
        accountId: "acct_dodopayments_test",
        name: "Starter Pack",
        amount: 900,
        currency: "USD",
        description: undefined,
      },
    ]);
  });

  it("rejects duplicate slugs before touching the provider", async () => {
    await insertRuntimeProviderAccount(businessDb.d1, {
      organizationId: "org_123",
      providerId: "dodopayments",
    });
    await insertCreditPack(businessDb.d1, {
      id: "pack_duplicate",
      organizationId: "org_123",
      name: "Starter Pack",
      slug: "starter-pack",
      creditSystemId: "cs_wallet",
    });

    const response = await app.request(
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
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false,
      error: "Credit pack with slug 'starter-pack' already exists",
    });
    expect(dodo.operations).toEqual([]);
  });
});
