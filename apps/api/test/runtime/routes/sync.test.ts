import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import syncRoute, {
  resetSyncRouteDependencies,
} from "../../../src/routes/api/sync";
import {
  planProviderSyncDependencies,
  resetPlanProviderSyncDependencies,
} from "../../../src/lib/plan-provider-sync";
import {
  creditPackProviderSyncDependencies,
  resetCreditPackProviderSyncDependencies,
} from "../../../src/lib/credit-pack-provider-sync";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  createSimulatedProviderRegistry,
  insertApiKey,
  insertCreditPack,
  insertCreditSystem,
  insertProviderRule,
  insertRuntimeProviderAccount,
  RUNTIME_ROUTE_ENV,
  SimulatedCatalogProviderAdapter,
} from "../helpers/catalog-runtime";
import { insertOrganization } from "../helpers/workflow-runtime";

describe("Sync route runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<typeof createRouteTestApp<{ db: any; authDb: any }>>;
  let apiKey: string;
  let paystack: SimulatedCatalogProviderAdapter;
  let dodo: SimulatedCatalogProviderAdapter;
  let stripe: SimulatedCatalogProviderAdapter;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_123" });
    apiKey = await insertApiKey(businessDb.d1, {
      id: "key_123",
      organizationId: "org_123",
      apiKey: "owo_sk_test_runtime",
    });

    paystack = new SimulatedCatalogProviderAdapter("paystack", "Paystack", {
      expectedEnvironment: "test",
      createPlanId: "prov_plan_paystack_1",
    });
    dodo = new SimulatedCatalogProviderAdapter(
      "dodopayments",
      "Dodo Payments",
      {
        expectedEnvironment: "test",
        createPlanId: "prov_plan_dodo_1",
        createProductResult: {
          productId: "dodo_prod_1",
          priceId: "dodo_prod_1",
        },
      },
    );
    stripe = new SimulatedCatalogProviderAdapter("stripe", "Stripe", {
      expectedEnvironment: "test",
      createProductResult: {
        productId: "prod_stripe_1",
        priceId: "price_stripe_1",
      },
    });

    const registry = createSimulatedProviderRegistry([paystack, dodo, stripe]);

    resetSyncRouteDependencies();
    resetPlanProviderSyncDependencies();
    resetCreditPackProviderSyncDependencies();
    planProviderSyncDependencies.getProviderRegistry = () => registry;
    creditPackProviderSyncDependencies.getProviderRegistry = () => registry;

    app = createRouteTestApp(syncRoute, {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => {
    resetSyncRouteDependencies();
    resetPlanProviderSyncDependencies();
    resetCreditPackProviderSyncDependencies();
    businessDb.close();
  });

  it("syncs a paid plan to an explicitly selected provider", async () => {
    await insertRuntimeProviderAccount(businessDb.d1, {
      organizationId: "org_123",
      providerId: "paystack",
    });

    const response = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          features: [
            {
              slug: "priority-support",
              type: "boolean",
              name: "Priority Support",
            },
          ],
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
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.warnings).toEqual([]);
    expect(body.features.created).toEqual(["priority-support"]);
    expect(body.plans.created).toEqual(["pro"]);

    const feature = await businessDb.db.query.features.findFirst({
      where: and(
        eq(schema.features.organizationId, "org_123"),
        eq(schema.features.slug, "priority-support"),
      ),
    });
    const plan = await businessDb.db.query.plans.findFirst({
      where: and(
        eq(schema.plans.organizationId, "org_123"),
        eq(schema.plans.slug, "pro"),
      ),
    });
    const planFeatures = await businessDb.db.query.planFeatures.findMany({
      where: eq(schema.planFeatures.planId, plan?.id ?? ""),
    });
    const keyRecord = await businessDb.db.query.apiKeys.findFirst({
      where: eq(schema.apiKeys.id, "key_123"),
    });

    expect(feature?.source).toBe("sdk");
    expect(plan).toMatchObject({
      providerId: "paystack",
      providerPlanId: "prov_plan_paystack_1",
      paystackPlanId: "prov_plan_paystack_1",
      source: "sdk",
    });
    expect(planFeatures).toHaveLength(1);
    expect(keyRecord?.lastUsedAt).not.toBeNull();
    expect(paystack.operations).toEqual([
      {
        kind: "createPlan",
        providerId: "paystack",
        environment: "test",
        accountId: "acct_paystack_test",
        name: "Pro",
        amount: 5000,
        currency: "NGN",
        interval: "monthly",
        description: null,
      },
    ]);
  });

  it("syncs a paid plan using the organization's provider routing rules", async () => {
    await insertRuntimeProviderAccount(businessDb.d1, {
      organizationId: "org_123",
      providerId: "dodopayments",
    });
    await insertProviderRule(businessDb.d1, {
      organizationId: "org_123",
      providerId: "dodopayments",
      isDefault: 1,
    });

    const response = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.warnings).toEqual([]);

    const plan = await businessDb.db.query.plans.findFirst({
      where: eq(schema.plans.slug, "global-pro"),
    });
    expect(plan).toMatchObject({
      providerId: "dodopayments",
      providerPlanId: "prov_plan_dodo_1",
      paystackPlanId: null,
    });
    expect(dodo.operations).toEqual([
      {
        kind: "createPlan",
        providerId: "dodopayments",
        environment: "test",
        accountId: "acct_dodopayments_test",
        name: "Global Pro",
        amount: 12000,
        currency: "USD",
        interval: "monthly",
        description: null,
      },
    ]);
  });

  it("does not sync one-time plans to a provider and stores normalized flags", async () => {
    await insertRuntimeProviderAccount(businessDb.d1, {
      organizationId: "org_123",
      providerId: "paystack",
    });

    const response = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.warnings).toEqual([]);

    const plan = await businessDb.db.query.plans.findFirst({
      where: eq(schema.plans.slug, "credit-pack-plan"),
    });
    expect(plan).toMatchObject({
      billingType: "one_time",
      providerId: "paystack",
      providerPlanId: null,
      paystackPlanId: null,
      trialDays: 0,
      autoEnable: false,
    });
    expect(paystack.operations).toEqual([]);
  });

  it("eagerly syncs credit packs to providers that require products", async () => {
    await insertRuntimeProviderAccount(businessDb.d1, {
      organizationId: "org_123",
      providerId: "dodopayments",
    });

    const response = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          features: [],
          creditSystems: [{ slug: "wallet", name: "Wallet", features: [] }],
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
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.warnings).toEqual([]);
    expect(body.creditSystems.created).toEqual(["wallet"]);
    expect(body.creditPacks.created).toEqual(["starter-pack"]);

    const creditSystem = await businessDb.db.query.creditSystems.findFirst({
      where: eq(schema.creditSystems.slug, "wallet"),
    });
    const mirroredFeature = await businessDb.db.query.features.findFirst({
      where: eq(schema.features.slug, "wallet"),
    });
    const pack = await businessDb.db.query.creditPacks.findFirst({
      where: eq(schema.creditPacks.slug, "starter-pack"),
    });

    expect(creditSystem).not.toBeNull();
    expect(mirroredFeature).toMatchObject({
      slug: "wallet",
      type: "metered",
      source: "sdk",
    });
    expect(pack).toMatchObject({
      providerId: "dodopayments",
      providerProductId: "dodo_prod_1",
      providerPriceId: "dodo_prod_1",
    });
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

  it("backfills missing credit pack provider product ids on resync", async () => {
    await insertRuntimeProviderAccount(businessDb.d1, {
      organizationId: "org_123",
      providerId: "stripe",
    });
    await insertCreditSystem(businessDb.d1, {
      id: "cs_wallet",
      organizationId: "org_123",
      slug: "wallet",
      name: "Wallet",
    });
    await insertCreditPack(businessDb.d1, {
      id: "pack_1",
      organizationId: "org_123",
      slug: "starter-pack",
      name: "Starter Pack",
      creditSystemId: "cs_wallet",
      providerId: "stripe",
      providerProductId: null,
      providerPriceId: null,
    });

    const response = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          features: [],
          creditSystems: [{ slug: "wallet", name: "Wallet", features: [] }],
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
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.warnings).toEqual([]);
    expect(body.creditPacks.unchanged).toEqual(["starter-pack"]);

    const pack = await businessDb.db.query.creditPacks.findFirst({
      where: eq(schema.creditPacks.id, "pack_1"),
    });
    expect(pack).toMatchObject({
      providerId: "stripe",
      providerProductId: "prod_stripe_1",
      providerPriceId: "price_stripe_1",
    });
    expect(stripe.operations).toEqual([
      {
        kind: "createProduct",
        providerId: "stripe",
        environment: "test",
        accountId: "acct_stripe_test",
        name: "Starter Pack",
        amount: 500,
        currency: "USD",
        description: undefined,
      },
    ]);
  });
});
