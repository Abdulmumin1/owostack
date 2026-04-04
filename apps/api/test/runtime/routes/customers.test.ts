import { afterEach, beforeEach, describe, expect, it } from "vitest";
import customersRoute from "../../../src/routes/dashboard/customers";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  insertFeature,
  insertPlanFeature,
  SimulatedUsageLedgerNamespace,
} from "../helpers/overage-runtime";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
  insertSubscription,
} from "../helpers/workflow-runtime";

async function appendMeteredUsage(
  usageLedger: SimulatedUsageLedgerNamespace,
  record: {
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
  },
) {
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

describe("Customers route runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let usageLedger: SimulatedUsageLedgerNamespace;
  let app: ReturnType<
    typeof createRouteTestApp<{ db: any; organizationId: string }>
  >;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    usageLedger = new SimulatedUsageLedgerNamespace();
    await insertOrganization(businessDb.d1, { id: "org_123" });
    app = createRouteTestApp(customersRoute, {
      db: businessDb.db,
      organizationId: "org_123",
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  it("scopes plan-filtered usage history to matching subscriptions plus legacy plan rows", async () => {
    const now = Date.now();
    const currentPeriodStart = now - 5 * 24 * 60 * 60 * 1000;
    const currentPeriodEnd = now + 25 * 24 * 60 * 60 * 1000;

    await insertCustomer(businessDb.d1, {
      id: "cust_1",
      organizationId: "org_123",
      email: "customer@example.com",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_pro",
      organizationId: "org_123",
      providerId: null,
      providerPlanId: null,
      paystackPlanId: null,
      name: "Pro",
      slug: "pro",
      price: 5000,
      currency: "USD",
      type: "paid",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_other",
      organizationId: "org_123",
      providerId: null,
      providerPlanId: null,
      paystackPlanId: null,
      name: "Other",
      slug: "other",
      price: 2000,
      currency: "USD",
      type: "paid",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_runs",
      organizationId: "org_123",
      slug: "agent-runs",
      name: "Agent Runs",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_messages",
      organizationId: "org_123",
      slug: "messages",
      name: "Messages",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_runs",
      planId: "plan_pro",
      featureId: "feature_runs",
      limitValue: 50,
      usageModel: "included",
      resetOnEnable: 1,
      overage: "block",
      overagePrice: null,
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_messages",
      planId: "plan_other",
      featureId: "feature_messages",
      limitValue: 100,
      usageModel: "included",
      resetOnEnable: 1,
      overage: "block",
      overagePrice: null,
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_pro_old",
      customerId: "cust_1",
      planId: "plan_pro",
      providerId: null,
      providerSubscriptionCode: null,
      status: "canceled",
      currentPeriodStart: currentPeriodStart - 30 * 24 * 60 * 60 * 1000,
      currentPeriodEnd: currentPeriodStart - 1,
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_pro_new",
      customerId: "cust_1",
      planId: "plan_pro",
      providerId: null,
      providerSubscriptionCode: null,
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_other",
      customerId: "cust_1",
      planId: "plan_other",
      providerId: null,
      providerSubscriptionCode: null,
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
    });

    await appendMeteredUsage(usageLedger, {
      organizationId: "org_123",
      customerId: "cust_1",
      featureId: "feature_runs",
      featureSlug: "agent-runs",
      featureName: "Agent Runs",
      subscriptionId: "sub_pro_old",
      planId: "plan_pro",
      amount: 3,
      periodStart: currentPeriodStart,
      periodEnd: currentPeriodEnd,
      createdAt: now - 3 * 60 * 60 * 1000,
    });
    await appendMeteredUsage(usageLedger, {
      organizationId: "org_123",
      customerId: "cust_1",
      featureId: "feature_runs",
      featureSlug: "agent-runs",
      featureName: "Agent Runs",
      subscriptionId: "sub_pro_new",
      planId: "plan_pro",
      amount: 4,
      periodStart: currentPeriodStart,
      periodEnd: currentPeriodEnd,
      createdAt: now - 2 * 60 * 60 * 1000,
    });
    await appendMeteredUsage(usageLedger, {
      organizationId: "org_123",
      customerId: "cust_1",
      featureId: "feature_runs",
      featureSlug: "agent-runs",
      featureName: "Agent Runs",
      subscriptionId: null,
      planId: "plan_pro",
      amount: 2,
      periodStart: currentPeriodStart,
      periodEnd: currentPeriodEnd,
      createdAt: now - 1 * 60 * 60 * 1000,
    });
    await appendMeteredUsage(usageLedger, {
      organizationId: "org_123",
      customerId: "cust_1",
      featureId: "feature_runs",
      featureSlug: "agent-runs",
      featureName: "Agent Runs",
      subscriptionId: "sub_unknown",
      planId: "plan_pro",
      amount: 99,
      periodStart: currentPeriodStart,
      periodEnd: currentPeriodEnd,
      createdAt: now - 30 * 60 * 1000,
    });
    await appendMeteredUsage(usageLedger, {
      organizationId: "org_123",
      customerId: "cust_1",
      featureId: "feature_messages",
      featureSlug: "messages",
      featureName: "Messages",
      subscriptionId: "sub_other",
      planId: "plan_other",
      amount: 8,
      periodStart: currentPeriodStart,
      periodEnd: currentPeriodEnd,
      createdAt: now - 15 * 60 * 1000,
    });

    const response = await app.request(
      "/cust_1?planId=plan_pro",
      { method: "GET" },
      {
        ENVIRONMENT: "test",
        USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
      },
    );

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.scope).toEqual({
      plan: {
        id: "plan_pro",
        name: "Pro",
        slug: "pro",
      },
      featureIds: ["feature_runs"],
    });
    expect(body.data.recentUsage).toHaveLength(3);
    expect(body.data.recentUsage.map((row: any) => row.amount)).toEqual([
      2, 4, 3,
    ]);
    expect(
      body.data.recentUsage.map((row: any) => row.featureSlug),
    ).toEqual(["agent-runs", "agent-runs", "agent-runs"]);
    expect(body.data.featureUsageSummary).toEqual([
      {
        featureId: "feature_runs",
        featureName: "Agent Runs",
        featureSlug: "agent-runs",
        unit: null,
        totalUsage: 9,
        recordCount: 3,
      },
    ]);
  });
});
