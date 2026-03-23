import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import plansRoute from "../../../src/routes/dashboard/plans";
import {
  planProviderSyncDependencies,
  resetPlanProviderSyncDependencies,
} from "../../../src/lib/plan-provider-sync";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  createSimulatedProviderRegistry,
  insertProviderRule,
  insertRuntimeProviderAccount,
  RUNTIME_ROUTE_ENV,
  SimulatedCatalogProviderAdapter,
} from "../helpers/catalog-runtime";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
  insertSubscription,
} from "../helpers/workflow-runtime";
import { insertFeature, insertPlanFeature } from "../helpers/overage-runtime";

describe("Plans route runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<typeof createRouteTestApp<{ db: any; organizationId: string }>>;
  let paystack: SimulatedCatalogProviderAdapter;
  let dodo: SimulatedCatalogProviderAdapter;
  let stripe: SimulatedCatalogProviderAdapter;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_123" });

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
      },
    );
    stripe = new SimulatedCatalogProviderAdapter("stripe", "Stripe", {
      expectedEnvironment: "test",
      createPlanId: "price_stripe_1",
      updatePlanResult: {
        updated: true,
        nextPlanId: "price_new_1",
      },
    });

    resetPlanProviderSyncDependencies();
    planProviderSyncDependencies.getProviderRegistry = () =>
      createSimulatedProviderRegistry([paystack, dodo, stripe]);

    app = createRouteTestApp(plansRoute, {
      db: businessDb.db,
      organizationId: "org_123",
    });
  });

  afterEach(() => {
    resetPlanProviderSyncDependencies();
    businessDb.close();
  });

  it("creates a basic paid plan even when no provider is configured", async () => {
    const response = await app.request(
      "/",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          name: "Pro Plan",
          price: 500000,
          interval: "monthly",
          currency: "NGN",
          type: "paid",
          billingModel: "base",
          billingType: "recurring",
          description: "A pro plan",
        }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.slug).toBe("pro-plan");

    const plan = await businessDb.db.query.plans.findFirst({
      where: and(
        eq(schema.plans.organizationId, "org_123"),
        eq(schema.plans.slug, "pro-plan"),
      ),
    });
    expect(plan?.providerId).toBeNull();
    expect(plan?.providerPlanId).toBeNull();
    expect(paystack.operations).toEqual([]);
    expect(dodo.operations).toEqual([]);
    expect(stripe.operations).toEqual([]);
  });

  it("creates a free plan without provider synchronization", async () => {
    const response = await app.request(
      "/",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          name: "Free Plan",
          price: 0,
          type: "free",
          billingModel: "base",
          billingType: "recurring",
        }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const plan = await businessDb.db.query.plans.findFirst({
      where: and(
        eq(schema.plans.organizationId, "org_123"),
        eq(schema.plans.slug, "free-plan"),
      ),
    });
    expect(plan?.type).toBe("free");
    expect(plan?.price).toBe(0);
    expect(paystack.operations).toEqual([]);
    expect(dodo.operations).toEqual([]);
  });

  it("syncs a paid recurring plan to an explicitly requested provider", async () => {
    await insertRuntimeProviderAccount(businessDb.d1, {
      organizationId: "org_123",
      providerId: "paystack",
    });

    const response = await app.request(
      "/",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          name: "Pro Plus",
          price: 8000,
          interval: "monthly",
          currency: "USD",
          type: "paid",
          billingModel: "base",
          billingType: "recurring",
          providerId: "paystack",
        }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const plan = await businessDb.db.query.plans.findFirst({
      where: eq(schema.plans.slug, "pro-plus"),
    });
    expect(plan?.providerId).toBe("paystack");
    expect(plan?.providerPlanId).toBe("prov_plan_paystack_1");
    expect(plan?.paystackPlanId).toBe("prov_plan_paystack_1");
    expect(paystack.operations).toEqual([
      {
        kind: "createPlan",
        providerId: "paystack",
        environment: "test",
        accountId: "acct_paystack_test",
        name: "Pro Plus",
        amount: 8000,
        currency: "USD",
        interval: "monthly",
        description: null,
      },
    ]);
  });

  it("routes a recurring paid plan through provider rules when no provider is requested", async () => {
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
        body: JSON.stringify({
          organizationId: "org_123",
          name: "Global Pro",
          price: 12000,
          interval: "monthly",
          currency: "USD",
          type: "paid",
          billingModel: "base",
          billingType: "recurring",
        }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const plan = await businessDb.db.query.plans.findFirst({
      where: eq(schema.plans.slug, "global-pro"),
    });
    expect(plan?.providerId).toBe("dodopayments");
    expect(plan?.providerPlanId).toBe("prov_plan_dodo_1");
    expect(plan?.paystackPlanId).toBeNull();
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

  it("creates unique slugs by suffixing when a slug already exists", async () => {
    await insertPlan(businessDb.d1, {
      id: "existing_plan",
      organizationId: "org_123",
      providerId: null,
      providerPlanId: null,
      paystackPlanId: null,
      name: "Pro Plan",
      slug: "pro-plan",
      price: 0,
      type: "free",
    });

    const response = await app.request(
      "/",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          name: "Pro Plan",
          price: 0,
          type: "free",
          billingModel: "base",
          billingType: "recurring",
        }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const plan = await businessDb.db.query.plans.findFirst({
      where: eq(schema.plans.slug, "pro-plan-1"),
    });
    expect(plan).not.toBeNull();
  });

  it("persists a rotated provider plan id when updatePlan returns nextPlanId", async () => {
    await insertRuntimeProviderAccount(businessDb.d1, {
      organizationId: "org_123",
      providerId: "stripe",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_patch_stripe_1",
      organizationId: "org_123",
      providerId: "stripe",
      providerPlanId: "price_old_1",
      paystackPlanId: null,
      name: "Pro",
      slug: "pro",
      description: "Old plan",
      price: 5000,
      currency: "USD",
      interval: "monthly",
      metadata: {},
    });

    const response = await app.request(
      "/plan_patch_stripe_1",
      {
        method: "PATCH",
        body: JSON.stringify({ description: "Updated plan" }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.providerPlanId).toBe("price_new_1");

    const updated = await businessDb.db.query.plans.findFirst({
      where: eq(schema.plans.id, "plan_patch_stripe_1"),
    });
    expect(updated?.providerPlanId).toBe("price_new_1");
    expect(stripe.operations).toEqual([
      {
        kind: "updatePlan",
        providerId: "stripe",
        environment: "test",
        accountId: "acct_stripe_test",
        planId: "price_old_1",
        name: "Pro",
        amount: 5000,
        currency: "USD",
        interval: "monthly",
        description: "Updated plan",
      },
    ]);
  });

  it("does not call the provider when provider-managed fields are unchanged", async () => {
    await insertRuntimeProviderAccount(businessDb.d1, {
      organizationId: "org_123",
      providerId: "paystack",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_patch_noop",
      organizationId: "org_123",
      providerId: "paystack",
      providerPlanId: "prov_plan_paystack_1",
      paystackPlanId: "prov_plan_paystack_1",
      name: "Pro",
      slug: "pro-noop",
      isActive: 0,
      metadata: {},
    });

    const response = await app.request(
      "/plan_patch_noop",
      {
        method: "PATCH",
        body: JSON.stringify({ isActive: true }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const updated = await businessDb.db.query.plans.findFirst({
      where: eq(schema.plans.id, "plan_patch_noop"),
    });
    expect(updated?.isActive).toBe(true);
    expect(paystack.operations).toEqual([]);
  });

  it("preserves trial settings for recurring trial plans", async () => {
    const response = await app.request(
      "/",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          name: "Trial Plan",
          price: 10000,
          interval: "monthly",
          type: "paid",
          trialDays: 14,
          trialCardRequired: true,
        }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const plan = await businessDb.db.query.plans.findFirst({
      where: eq(schema.plans.slug, "trial-plan"),
    });
    expect(plan?.trialDays).toBe(14);
    expect(plan?.trialCardRequired).toBe(true);
  });

  it("returns distinct customer counts without multiplying subscribers by plan features", async () => {
    await insertPlan(businessDb.d1, {
      id: "plan_count_1",
      organizationId: "org_123",
      providerId: null,
      providerPlanId: null,
      paystackPlanId: null,
      name: "Pro",
      slug: "pro",
      price: 150,
      currency: "NGN",
      billingType: "recurring",
      metadata: {},
    });

    await insertFeature(businessDb.d1, {
      id: "feature_ai_1",
      organizationId: "org_123",
      name: "AI Generation Credits",
      slug: "ai-generation-credits",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_models_1",
      organizationId: "org_123",
      name: "Premium Models",
      slug: "premium-models",
      type: "boolean",
    });

    await insertPlanFeature(businessDb.d1, {
      id: "plan_feature_ai_1",
      planId: "plan_count_1",
      featureId: "feature_ai_1",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "plan_feature_models_1",
      planId: "plan_count_1",
      featureId: "feature_models_1",
      limitValue: null,
    });

    await insertCustomer(businessDb.d1, {
      id: "cust_count_1",
      organizationId: "org_123",
      email: "one@example.com",
    });
    await insertCustomer(businessDb.d1, {
      id: "cust_count_2",
      organizationId: "org_123",
      email: "two@example.com",
    });
    await insertCustomer(businessDb.d1, {
      id: "cust_count_3",
      organizationId: "org_123",
      email: "three@example.com",
    });
    await insertCustomer(businessDb.d1, {
      id: "cust_count_4",
      organizationId: "org_123",
      email: "four@example.com",
    });

    await insertSubscription(businessDb.d1, {
      id: "sub_count_1",
      customerId: "cust_count_1",
      planId: "plan_count_1",
      status: "active",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_count_2",
      customerId: "cust_count_2",
      planId: "plan_count_1",
      status: "active",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_count_3",
      customerId: "cust_count_3",
      planId: "plan_count_1",
      status: "active",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_count_4",
      customerId: "cust_count_4",
      planId: "plan_count_1",
      status: "canceled",
    });

    const response = await app.request("/", undefined, RUNTIME_ROUTE_ENV);

    expect(response.status).toBe(200);
    const body = await response.json();
    const plan = body.data.find((item: any) => item.id === "plan_count_1");

    expect(plan).toMatchObject({
      id: "plan_count_1",
      customerCount: 3,
    });
    expect(plan.planFeatures).toHaveLength(2);
    expect(plan.subscriptions).toBeUndefined();
  });

  it("clears trial and auto-enable flags for one-time plans on create", async () => {
    const response = await app.request(
      "/",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          name: "One-off Plan",
          price: 2500,
          currency: "USD",
          type: "paid",
          billingModel: "base",
          billingType: "one_time",
          trialDays: 14,
          trialCardRequired: true,
          autoEnable: true,
        }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const plan = await businessDb.db.query.plans.findFirst({
      where: eq(schema.plans.slug, "one-off-plan"),
    });
    expect(plan?.billingType).toBe("one_time");
    expect(plan?.trialDays).toBe(0);
    expect(plan?.trialCardRequired).toBe(false);
    expect(plan?.autoEnable).toBe(false);
  });

  it("normalizes one-time plan flags in list and detail responses", async () => {
    await insertPlan(businessDb.d1, {
      id: "plan_one_time_dashboard_1",
      organizationId: "org_123",
      providerId: null,
      providerPlanId: null,
      paystackPlanId: null,
      name: "Credit Pack",
      slug: "credit-pack",
      price: 5000,
      currency: "USD",
      billingType: "one_time",
      trialDays: 14,
      trialCardRequired: 1,
      autoEnable: 1,
    });

    const listResponse = await app.request("/", { method: "GET" });
    const detailResponse = await app.request(
      "/plan_one_time_dashboard_1",
      { method: "GET" },
      RUNTIME_ROUTE_ENV,
    );

    const listBody = await listResponse.json();
    const detailBody = await detailResponse.json();

    expect(listBody.data[0].trialDays).toBe(0);
    expect(listBody.data[0].trialCardRequired).toBe(false);
    expect(listBody.data[0].autoEnable).toBe(false);
    expect(detailBody.data.trialDays).toBe(0);
    expect(detailBody.data.trialCardRequired).toBe(false);
    expect(detailBody.data.autoEnable).toBe(false);
  });

  it("clears trial metadata and provider ids when a plan becomes one-time", async () => {
    await insertPlan(businessDb.d1, {
      id: "plan_patch_one_time_1",
      organizationId: "org_123",
      providerId: "paystack",
      providerPlanId: "prov_plan_paystack_1",
      paystackPlanId: "prov_plan_paystack_1",
      name: "One-off Plan",
      slug: "one-off-existing",
      price: 2500,
      currency: "USD",
      billingType: "recurring",
      trialDays: 3,
      trialCardRequired: 1,
      autoEnable: 1,
      metadata: { trialUnit: "minutes" },
    });

    const response = await app.request(
      "/plan_patch_one_time_1",
      {
        method: "PATCH",
        body: JSON.stringify({
          billingType: "one_time",
          trialDays: 10,
          trialCardRequired: true,
          autoEnable: true,
        }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    const updated = await businessDb.db.query.plans.findFirst({
      where: eq(schema.plans.id, "plan_patch_one_time_1"),
    });
    const metadata =
      typeof updated?.metadata === "string"
        ? JSON.parse(updated.metadata)
        : updated?.metadata || {};

    expect(updated?.billingType).toBe("one_time");
    expect(updated?.trialDays).toBe(0);
    expect(updated?.trialCardRequired).toBe(false);
    expect(updated?.autoEnable).toBe(false);
    expect(updated?.providerPlanId).toBeNull();
    expect(updated?.paystackPlanId).toBeNull();
    expect(metadata.trialUnit).toBeUndefined();
  });

  it("rejects invalid payloads", async () => {
    const response = await app.request(
      "/",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          price: 5000,
        }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
  });
});
