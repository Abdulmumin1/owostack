import { afterEach, beforeEach, describe, expect, it } from "vitest";
import apiCustomers from "../../../src/routes/api/customers";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { insertApiKey, RUNTIME_ROUTE_ENV } from "../helpers/catalog-runtime";
import { insertFeature, insertPlanFeature } from "../helpers/overage-runtime";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
  insertSubscription,
} from "../helpers/workflow-runtime";

describe("Customer entity limit runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<typeof createRouteTestApp<{ db: any; authDb: any }>>;
  let apiKey: string;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_123" });
    apiKey = await insertApiKey(businessDb.d1, {
      organizationId: "org_123",
      apiKey: "owo_sk_customer_entities_runtime",
    });
    app = createRouteTestApp(apiCustomers, {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  async function addEntity(entity: string) {
    return app.request(
      "/entities",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer: "cust_1",
          feature: "licensed-members",
          entity,
        }),
      },
      RUNTIME_ROUTE_ENV,
    );
  }

  async function seedEntityFeature() {
    await insertCustomer(businessDb.d1, {
      id: "cust_1",
      organizationId: "org_123",
      email: "seats@example.com",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_members",
      organizationId: "org_123",
      slug: "licensed-members",
      name: "Licensed Members",
      type: "metered",
    });
  }

  it("enforces the trial entitlement limit for entity additions", async () => {
    const now = Date.now();
    await seedEntityFeature();
    await insertPlan(businessDb.d1, {
      id: "plan_trial",
      organizationId: "org_123",
      name: "Trial",
      slug: "trial",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_trial_members",
      planId: "plan_trial",
      featureId: "feature_members",
      limitValue: 10,
      trialLimitValue: 1,
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_trial",
      customerId: "cust_1",
      planId: "plan_trial",
      status: "trialing",
      currentPeriodStart: now - 60_000,
      currentPeriodEnd: now + 60_000,
    });

    expect((await addEntity("member_1")).status).toBe(200);
    const rejected = await addEntity("member_2");

    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      code: "limit_exceeded",
      current: 1,
      limit: 1,
    });
  });

  it("uses the deterministic access grant when subscriptions have different seat limits", async () => {
    const now = Date.now();
    await seedEntityFeature();
    await insertPlan(businessDb.d1, {
      id: "plan_short",
      organizationId: "org_123",
      name: "Short",
      slug: "short",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_long",
      organizationId: "org_123",
      name: "Long",
      slug: "long",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_short_members",
      planId: "plan_short",
      featureId: "feature_members",
      limitValue: 1,
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_long_members",
      planId: "plan_long",
      featureId: "feature_members",
      limitValue: 2,
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_short",
      customerId: "cust_1",
      planId: "plan_short",
      status: "active",
      currentPeriodStart: now - 60_000,
      currentPeriodEnd: now + 60_000,
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_long",
      customerId: "cust_1",
      planId: "plan_long",
      status: "pending_cancel",
      currentPeriodStart: now - 30_000,
      currentPeriodEnd: now + 120_000,
      cancelAt: now + 120_000,
    });

    expect((await addEntity("member_1")).status).toBe(200);
    expect((await addEntity("member_2")).status).toBe(200);
    const rejected = await addEntity("member_3");

    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      code: "limit_exceeded",
      current: 2,
      limit: 2,
    });
  });

  it("fails closed when no access-granting subscription entitles the feature", async () => {
    const now = Date.now();
    await seedEntityFeature();
    await insertPlan(businessDb.d1, {
      id: "plan_without_members",
      organizationId: "org_123",
      name: "No Members",
      slug: "no-members",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_without_members",
      customerId: "cust_1",
      planId: "plan_without_members",
      status: "active",
      currentPeriodStart: now - 60_000,
      currentPeriodEnd: now + 60_000,
    });

    const response = await addEntity("member_1");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "feature_not_in_plan",
    });
  });

  it("allows only one concurrent insertion at a full entity limit", async () => {
    const now = Date.now();
    await seedEntityFeature();
    await insertPlan(businessDb.d1, {
      id: "plan_one_member",
      organizationId: "org_123",
      name: "One Member",
      slug: "one-member",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_one_member",
      planId: "plan_one_member",
      featureId: "feature_members",
      limitValue: 1,
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_one_member",
      customerId: "cust_1",
      planId: "plan_one_member",
      status: "active",
      currentPeriodStart: now - 60_000,
      currentPeriodEnd: now + 60_000,
    });

    const responses = await Promise.all([
      addEntity("member_1"),
      addEntity("member_2"),
    ]);
    const entityCount = await businessDb.d1
      .prepare(
        "SELECT COUNT(*) AS count FROM entities WHERE customer_id = ? AND feature_id = ?",
      )
      .bind("cust_1", "feature_members")
      .first<{ count: number }>();

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    expect(entityCount?.count).toBe(1);
  });
});
