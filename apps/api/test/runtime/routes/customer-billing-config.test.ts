import { afterEach, beforeEach, describe, expect, it } from "vitest";
import apiCustomers from "../../../src/routes/api/customers";
import entitlements from "../../../src/routes/api/entitlements";
import { getResetPeriod } from "../../../src/lib/reset-period";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { insertApiKey, RUNTIME_ROUTE_ENV } from "../helpers/catalog-runtime";
import {
  insertFeature,
  insertPlanFeature,
  SimulatedUsageLedgerNamespace,
} from "../helpers/overage-runtime";
import {
  insertCustomer,
  insertOrganization,
  insertPaymentMethod,
  insertPlan,
  insertSubscription,
} from "../helpers/workflow-runtime";

describe("Customer billing config runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let usageLedger: SimulatedUsageLedgerNamespace;
  let customerApp: ReturnType<
    typeof createRouteTestApp<{ db: any; authDb: any }>
  >;
  let entitlementsApp: ReturnType<
    typeof createRouteTestApp<{ db: any; authDb: any }>
  >;
  let apiKey: string;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    usageLedger = new SimulatedUsageLedgerNamespace();
    await insertOrganization(businessDb.d1, { id: "org_123" });
    apiKey = await insertApiKey(businessDb.d1, {
      organizationId: "org_123",
      apiKey: "owo_sk_customer_config_runtime",
    });
    customerApp = createRouteTestApp(apiCustomers, {
      db: businessDb.db,
      authDb: businessDb.db,
    });
    entitlementsApp = createRouteTestApp(entitlements, {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  async function setCustomerFeatureConfig(body: Record<string, unknown>) {
    return customerApp.request(
      "/customers/feature-config",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      RUNTIME_ROUTE_ENV,
    );
  }

  async function appendMeteredUsage(record: {
    organizationId: string;
    customerId: string;
    featureId: string;
    featureSlug: string;
    featureName: string;
    subscriptionId?: string | null;
    planId?: string | null;
    amount: number;
    periodStart: number;
    periodEnd: number;
    createdAt: number;
  }) {
    const stub = usageLedger.get(
      usageLedger.idFromName(`org:${record.organizationId}`),
    ) as any;

    await stub.appendUsage({
      customerId: record.customerId,
      featureId: record.featureId,
      featureSlug: record.featureSlug,
      featureName: record.featureName,
      subscriptionId: record.subscriptionId ?? null,
      planId: record.planId ?? null,
      amount: record.amount,
      periodStart: record.periodStart,
      periodEnd: record.periodEnd,
      createdAt: record.createdAt,
    });
  }

  it("returns billing config alongside customer responses and setter mutations", async () => {
    await insertFeature(businessDb.d1, {
      id: "feature_api_calls",
      organizationId: "org_123",
      slug: "api-calls",
      name: "API Calls",
    });

    const createResponse = await customerApp.request(
      "/customers",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "ops@acme.com",
          name: "Acme Ops",
        }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(createResponse.status).toBe(200);
    const created = await createResponse.json();
    expect(created.billing).toEqual({
      overageLimit: null,
      featureConfigs: [],
    });

    const overageLimitResponse = await customerApp.request(
      "/customers/overage-limit",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer: created.id,
          maxOverageAmount: 500000,
          onLimitReached: "block",
        }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(overageLimitResponse.status).toBe(200);
    const afterLimit = await overageLimitResponse.json();
    expect(afterLimit.billing.overageLimit).toMatchObject({
      maxOverageAmount: 500000,
      onLimitReached: "block",
    });

    const featureConfigResponse = await setCustomerFeatureConfig({
      customer: created.id,
      feature: "api-calls",
      overage: "charge",
      maxOverageUnits: 25,
    });

    expect(featureConfigResponse.status).toBe(200);
    const afterFeatureConfig = await featureConfigResponse.json();
    expect(afterFeatureConfig.billing.featureConfigs).toEqual([
      expect.objectContaining({
        feature: {
          id: "feature_api_calls",
          slug: "api-calls",
          name: "API Calls",
        },
        overage: "charge",
        maxOverageUnits: 25,
      }),
    ]);

    const getResponse = await customerApp.request(
      `/customers/${created.id}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(getResponse.status).toBe(200);
    const fetched = await getResponse.json();
    expect(fetched.billing.overageLimit).toMatchObject({
      maxOverageAmount: 500000,
      onLimitReached: "block",
    });
    expect(fetched.billing.featureConfigs).toHaveLength(1);
  });

  it("lets a customer feature config override a plan's overage mode during access checks", async () => {
    const now = Date.now();
    const currentPeriodStart = now - 2 * 24 * 60 * 60 * 1000;
    const currentPeriodEnd = now + 28 * 24 * 60 * 60 * 1000;
    const usageWindow = getResetPeriod(
      "monthly",
      currentPeriodStart,
      currentPeriodEnd,
    );

    await insertCustomer(businessDb.d1, {
      id: "cust_1",
      organizationId: "org_123",
      email: "billing@acme.com",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_growth",
      organizationId: "org_123",
      name: "Growth",
      slug: "growth",
      price: 4900,
      currency: "USD",
      type: "paid",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_api_calls",
      organizationId: "org_123",
      slug: "api-calls",
      name: "API Calls",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_growth_api_calls",
      planId: "plan_growth",
      featureId: "feature_api_calls",
      limitValue: 10,
      overage: "block",
      overagePrice: 25,
      billingUnits: 1,
      maxOverageUnits: null,
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_growth",
      customerId: "cust_1",
      planId: "plan_growth",
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
    });
    await insertPaymentMethod(businessDb.d1, {
      customerId: "cust_1",
      organizationId: "org_123",
    });

    await appendMeteredUsage({
      organizationId: "org_123",
      customerId: "cust_1",
      featureId: "feature_api_calls",
      featureSlug: "api-calls",
      featureName: "API Calls",
      subscriptionId: "sub_growth",
      planId: "plan_growth",
      amount: 10,
      periodStart: usageWindow.periodStart,
      periodEnd: usageWindow.periodEnd,
      createdAt: now - 60_000,
    });

    const configResponse = await setCustomerFeatureConfig({
      customer: "cust_1",
      feature: "api-calls",
      overage: "charge",
    });
    expect(configResponse.status).toBe(200);

    const checkResponse = await entitlementsApp.request(
      "/check",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer: "cust_1",
          feature: "api-calls",
          value: 1,
        }),
      },
      {
        ...RUNTIME_ROUTE_ENV,
        USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
      },
    );

    expect(checkResponse.status).toBe(200);
    const body = await checkResponse.json();
    expect(body.allowed).toBe(true);
    expect(body.code).toBe("overage_allowed");
    expect(body.details.overage).toMatchObject({
      type: "charge",
      willBeBilled: true,
    });
  });

  it("blocks plan overage by default until the customer explicitly enables it", async () => {
    const now = Date.now();
    const currentPeriodStart = now - 2 * 24 * 60 * 60 * 1000;
    const currentPeriodEnd = now + 28 * 24 * 60 * 60 * 1000;
    const usageWindow = getResetPeriod(
      "monthly",
      currentPeriodStart,
      currentPeriodEnd,
    );

    await insertCustomer(businessDb.d1, {
      id: "cust_default_block",
      organizationId: "org_123",
      email: "default-block@acme.com",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_default_block",
      organizationId: "org_123",
      name: "Pro",
      slug: "pro",
      price: 4900,
      currency: "USD",
      type: "paid",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_default_block",
      organizationId: "org_123",
      slug: "default-block-feature",
      name: "Default Block Feature",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_default_block",
      planId: "plan_default_block",
      featureId: "feature_default_block",
      limitValue: 10,
      overage: "charge",
      overagePrice: 25,
      billingUnits: 1,
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_default_block",
      customerId: "cust_default_block",
      planId: "plan_default_block",
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
    });
    await insertPaymentMethod(businessDb.d1, {
      customerId: "cust_default_block",
      organizationId: "org_123",
    });

    await appendMeteredUsage({
      organizationId: "org_123",
      customerId: "cust_default_block",
      featureId: "feature_default_block",
      featureSlug: "default-block-feature",
      featureName: "Default Block Feature",
      subscriptionId: "sub_default_block",
      planId: "plan_default_block",
      amount: 10,
      periodStart: usageWindow.periodStart,
      periodEnd: usageWindow.periodEnd,
      createdAt: now - 60_000,
    });

    const checkResponse = await entitlementsApp.request(
      "/check",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer: "cust_default_block",
          feature: "default-block-feature",
          value: 1,
        }),
      },
      {
        ...RUNTIME_ROUTE_ENV,
        USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
      },
    );

    expect(checkResponse.status).toBe(200);
    const body = await checkResponse.json();
    expect(body.allowed).toBe(false);
    expect(body.code).toBe("limit_exceeded");
    expect(body.details.overage ?? null).toBeNull();
  });

  it("enforces a customer feature max overage cap once customer overage is enabled", async () => {
    const now = Date.now();
    const currentPeriodStart = now - 2 * 24 * 60 * 60 * 1000;
    const currentPeriodEnd = now + 28 * 24 * 60 * 60 * 1000;
    const usageWindow = getResetPeriod(
      "monthly",
      currentPeriodStart,
      currentPeriodEnd,
    );

    await insertCustomer(businessDb.d1, {
      id: "cust_2",
      organizationId: "org_123",
      email: "platform@acme.com",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_scale",
      organizationId: "org_123",
      name: "Scale",
      slug: "scale",
      price: 9900,
      currency: "USD",
      type: "paid",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_agent_runs",
      organizationId: "org_123",
      slug: "agent-runs",
      name: "Agent Runs",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_scale_agent_runs",
      planId: "plan_scale",
      featureId: "feature_agent_runs",
      limitValue: 10,
      overage: "charge",
      overagePrice: 50,
      billingUnits: 1,
      maxOverageUnits: null,
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_scale",
      customerId: "cust_2",
      planId: "plan_scale",
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
    });
    await insertPaymentMethod(businessDb.d1, {
      customerId: "cust_2",
      organizationId: "org_123",
    });

    await appendMeteredUsage({
      organizationId: "org_123",
      customerId: "cust_2",
      featureId: "feature_agent_runs",
      featureSlug: "agent-runs",
      featureName: "Agent Runs",
      subscriptionId: "sub_scale",
      planId: "plan_scale",
      amount: 12,
      periodStart: usageWindow.periodStart,
      periodEnd: usageWindow.periodEnd,
      createdAt: now - 60_000,
    });

    const configResponse = await setCustomerFeatureConfig({
      customer: "cust_2",
      feature: "agent-runs",
      overage: "charge",
      maxOverageUnits: 2,
    });
    expect(configResponse.status).toBe(200);

    const checkResponse = await entitlementsApp.request(
      "/check",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer: "cust_2",
          feature: "agent-runs",
          value: 1,
        }),
      },
      {
        ...RUNTIME_ROUTE_ENV,
        USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
      },
    );

    expect(checkResponse.status).toBe(200);
    const body = await checkResponse.json();
    expect(body.allowed).toBe(false);
    expect(body.code).toBe("limit_exceeded");
    expect(body.limit).toBe(10);
  });
});
