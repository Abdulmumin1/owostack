import { afterEach, beforeEach, describe, expect, it } from "vitest";
import subscriptionsRoute from "../../../src/routes/dashboard/subscriptions";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { insertFeature, insertPlanFeature } from "../helpers/overage-runtime";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
  insertSubscription,
} from "../helpers/workflow-runtime";

async function insertEntitlement(
  db: D1Database,
  params: {
    id: string;
    customerId?: string;
    featureId: string;
    limitValue?: number | null;
    resetInterval?: string;
    source?: string;
  },
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO entitlements
       (id, customer_id, feature_id, limit_value, reset_interval, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id,
      params.customerId || "cust_1",
      params.featureId,
      params.limitValue ?? 100,
      params.resetInterval || "monthly",
      params.source || "plan",
      now,
      now,
    )
    .run();
}

describe("Subscriptions route runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<
    typeof createRouteTestApp<{ db: any; organizationId: string }>
  >;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_123" });
    app = createRouteTestApp(subscriptionsRoute, {
      db: businessDb.db,
      organizationId: "org_123",
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  it("does not flag extra legacy plan entitlements as active-plan drift", async () => {
    await insertCustomer(businessDb.d1, {
      id: "cust_1",
      organizationId: "org_123",
      email: "abdulmuminyqn@gmail.com",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_1",
      organizationId: "org_123",
      name: "test-trial-polar2",
      slug: "test-trial-polar2",
      providerId: "polar",
      providerPlanId: "polar_plan_1",
      paystackPlanId: null,
      price: 10,
      currency: "USD",
      interval: "monthly",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_1",
      customerId: "cust_1",
      planId: "plan_1",
      providerId: "polar",
      providerSubscriptionCode: "polar_sub_1",
      status: "active",
      currentPeriodStart: new Date("2026-03-23T00:00:00.000Z").getTime(),
      currentPeriodEnd: new Date("2026-04-23T00:00:00.000Z").getTime(),
    });

    await insertFeature(businessDb.d1, {
      id: "feature_thirdpen",
      organizationId: "org_123",
      slug: "thirdpen",
      name: "Thirdpen",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_dearfutureself",
      organizationId: "org_123",
      slug: "dearfutureself",
      name: "dearfutureself",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_support_credits",
      organizationId: "org_123",
      slug: "support-credits",
      name: "support credits",
    });

    await insertPlanFeature(businessDb.d1, {
      id: "pf_thirdpen",
      planId: "plan_1",
      featureId: "feature_thirdpen",
      limitValue: 100,
      billingUnits: 5,
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_dearfutureself",
      planId: "plan_1",
      featureId: "feature_dearfutureself",
      limitValue: 10,
      billingUnits: 5,
    });

    await insertEntitlement(businessDb.d1, {
      id: "ent_thirdpen",
      featureId: "feature_thirdpen",
      limitValue: 100,
    });
    await insertEntitlement(businessDb.d1, {
      id: "ent_dearfutureself",
      featureId: "feature_dearfutureself",
      limitValue: 10,
    });
    await insertEntitlement(businessDb.d1, {
      id: "ent_support_credits",
      featureId: "feature_support_credits",
      limitValue: 250,
    });

    const response = await app.request("/sub_1", { method: "GET" }, {});

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.data.entitlements.map((entry: any) => entry.featureSlug),
    ).toEqual(["thirdpen", "dearfutureself"]);
    expect(body.data.entitlementDiagnostics).toMatchObject({
      hasDrift: false,
      hasExtraProvisionedRows: true,
    });
    expect(
      body.data.entitlementDiagnostics.orphanedProvisionedEntitlements.map(
        (entry: any) => entry.featureSlug,
      ),
    ).toEqual(["support-credits"]);
    expect(
      body.data.entitlementDiagnostics.missingProvisionedEntitlements,
    ).toEqual([]);
  });

  it("still flags real drift when the active plan is missing provisioned rows", async () => {
    await insertCustomer(businessDb.d1, {
      id: "cust_2",
      organizationId: "org_123",
      email: "missing@example.com",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_2",
      organizationId: "org_123",
      name: "starter",
      slug: "starter",
      providerId: null,
      providerPlanId: null,
      paystackPlanId: null,
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_2",
      customerId: "cust_2",
      planId: "plan_2",
      providerId: null,
      providerSubscriptionCode: null,
      status: "active",
    });

    await insertFeature(businessDb.d1, {
      id: "feature_alpha",
      organizationId: "org_123",
      slug: "alpha",
      name: "Alpha",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_beta",
      organizationId: "org_123",
      slug: "beta",
      name: "Beta",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_alpha",
      planId: "plan_2",
      featureId: "feature_alpha",
      limitValue: 50,
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_beta",
      planId: "plan_2",
      featureId: "feature_beta",
      limitValue: 10,
    });
    await insertEntitlement(businessDb.d1, {
      id: "ent_alpha",
      customerId: "cust_2",
      featureId: "feature_alpha",
      limitValue: 50,
    });

    const response = await app.request("/sub_2", { method: "GET" }, {});

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.entitlementDiagnostics).toMatchObject({
      hasDrift: true,
      hasExtraProvisionedRows: false,
    });
    expect(
      body.data.entitlementDiagnostics.missingProvisionedEntitlements.map(
        (entry: any) => entry.featureSlug,
      ),
    ).toEqual(["beta"]);
  });

  it("marks stale active paid subscriptions as requiring billing review", async () => {
    await insertCustomer(businessDb.d1, {
      id: "cust_3",
      organizationId: "org_123",
      email: "stale@example.com",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_3",
      organizationId: "org_123",
      name: "dry",
      slug: "dry",
      providerId: "dodopayments",
      providerPlanId: "dodo_plan_1",
      paystackPlanId: null,
      price: 14,
      currency: "USD",
      interval: "monthly",
      type: "paid",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_3",
      customerId: "cust_3",
      planId: "plan_3",
      providerId: "dodopayments",
      providerSubscriptionCode: "sub_old_1",
      status: "active",
      currentPeriodStart: new Date("2026-02-11T00:00:00.000Z").getTime(),
      currentPeriodEnd: new Date("2026-03-13T00:00:00.000Z").getTime(),
    });

    const response = await app.request("/sub_3", { method: "GET" }, {});

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.subscription.status).toBe("active");
    expect(body.data.subscription.health).toMatchObject({
      requiresAction: true,
      pastGracePeriodEnd: true,
    });
    expect(body.data.subscription.health.reasons).toContain("period_end_stale");
  });
});
