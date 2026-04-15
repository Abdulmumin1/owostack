import { afterEach, beforeEach, describe, expect, it } from "vitest";
import entitlementsRoute from "../../../src/routes/api/entitlements";
import { BillingService } from "../../../src/lib/billing";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  insertFeature,
  insertPlanFeature,
  SimulatedUsageLedgerNamespace,
  SimulatedUsageMeterNamespace,
} from "../helpers/overage-runtime";
import {
  insertApiKey,
  RUNTIME_ROUTE_ENV,
} from "../helpers/catalog-runtime";
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
    customerId: string;
    featureId: string;
    limitValue: number;
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
      params.customerId,
      params.featureId,
      params.limitValue,
      params.resetInterval || "monthly",
      params.source || "plan",
      now,
      now,
    )
    .run();
}

async function appendPlanUsage(
  usageLedger: SimulatedUsageLedgerNamespace,
  params: {
    organizationId: string;
    customerId: string;
    featureId: string;
    subscriptionId: string;
    planId: string;
    amount: number;
    periodStart: number;
    periodEnd: number;
  },
) {
  const stub = usageLedger.get(
    usageLedger.idFromName(`org:${params.organizationId}`),
  ) as any;

  await stub.appendUsage({
    customerId: params.customerId,
    featureId: params.featureId,
    featureSlug: "ai-credits",
    featureName: "AI Credits",
    subscriptionId: params.subscriptionId,
    planId: params.planId,
    amount: params.amount,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    coverageSource: "plan",
    pricingSnapshot: {
      usageModel: "included",
      ratingModel: "package",
      included: 5000,
      pricePerUnit: null,
      billingUnits: 1,
      overagePrice: 25,
      tiers: null,
    },
    createdAt: Date.now() - 1000,
  });
}

describe("Entitlements bonus credits runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let usageLedger: SimulatedUsageLedgerNamespace;
  let usageMeter: SimulatedUsageMeterNamespace;
  let app: ReturnType<typeof createRouteTestApp<{ db: any; authDb: any }>>;
  let apiKey: string;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    usageLedger = new SimulatedUsageLedgerNamespace();
    usageMeter = new SimulatedUsageMeterNamespace();
    await insertOrganization(businessDb.d1, { id: "org_123" });
    apiKey = await insertApiKey(businessDb.d1, {
      organizationId: "org_123",
      apiKey: "owo_sk_bonus_runtime",
    });
    app = createRouteTestApp(entitlementsRoute, {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  it("tracks post-limit manual bonus usage without turning it into billable overage", async () => {
    const now = Date.now();
    const currentPeriodStart = now - 5 * 24 * 60 * 60 * 1000;
    const currentPeriodEnd = now + 25 * 24 * 60 * 60 * 1000;

    await insertCustomer(businessDb.d1, {
      id: "cust_1",
      organizationId: "org_123",
      email: "bonus@example.com",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_pro",
      organizationId: "org_123",
      name: "Pro",
      slug: "pro",
      price: 5000,
      currency: "USD",
      type: "paid",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_ai_credits",
      organizationId: "org_123",
      slug: "ai-credits",
      name: "AI Credits",
      type: "metered",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_ai_credits",
      planId: "plan_pro",
      featureId: "feature_ai_credits",
      limitValue: 5000,
      usageModel: "included",
      overage: "charge",
      overagePrice: 25,
      billingUnits: 1,
      ratingModel: "package",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_pro",
      customerId: "cust_1",
      planId: "plan_pro",
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
    });
    await insertEntitlement(businessDb.d1, {
      id: "ent_bonus_ai_credits",
      customerId: "cust_1",
      featureId: "feature_ai_credits",
      limitValue: 100,
      source: "manual_bonus",
    });

    await appendPlanUsage(usageLedger, {
      organizationId: "org_123",
      customerId: "cust_1",
      featureId: "feature_ai_credits",
      subscriptionId: "sub_pro",
      planId: "plan_pro",
      amount: 5000,
      periodStart: currentPeriodStart,
      periodEnd: currentPeriodEnd,
    });

    const response = await app.request(
      "/track",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer: "cust_1",
          feature: "feature_ai_credits",
          value: 20,
        }),
      },
      {
        ...RUNTIME_ROUTE_ENV,
        USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
        USAGE_METER: usageMeter as unknown as DurableObjectNamespace<any>,
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.allowed).toBe(true);
    expect(body.code).toBe("bonus_credits_used");
    expect(body.credits).toMatchObject({
      source: "feature",
      bonusBalance: 80,
      totalBalance: 80,
      plan: {
        used: 5000,
        limit: 5000,
        balance: 0,
      },
    });

    const ledgerRecords = usageLedger.listRecords("org_123");
    expect(
      ledgerRecords.find(
        (record) =>
          record.coverageSource === "manual_bonus" && record.amount === 20,
      ),
    ).toMatchObject({
      featureId: "feature_ai_credits",
      coverageSource: "manual_bonus",
      coverageReferenceId: "ent_bonus_ai_credits",
      pricingSnapshot: null,
    });

    const billingService = new BillingService(businessDb.db, {
      usageLedger: usageLedger as unknown as DurableObjectNamespace<any>,
    });
    const usageResult = await billingService.getUnbilledUsage(
      "cust_1",
      "org_123",
    );

    expect(usageResult.isOk()).toBe(true);
    if (usageResult.isErr()) return;

    expect(usageResult.value.totalEstimated).toBe(0);
    expect(usageResult.value.features).toEqual([]);
  });

  it("shows manual bonus coverage during check once plan credits are exhausted", async () => {
    const now = Date.now();
    const currentPeriodStart = now - 5 * 24 * 60 * 60 * 1000;
    const currentPeriodEnd = now + 25 * 24 * 60 * 60 * 1000;

    await insertCustomer(businessDb.d1, {
      id: "cust_2",
      organizationId: "org_123",
      email: "bonus-check@example.com",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_pro",
      organizationId: "org_123",
      name: "Pro",
      slug: "pro",
      price: 5000,
      currency: "USD",
      type: "paid",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_ai_credits",
      organizationId: "org_123",
      slug: "ai-credits",
      name: "AI Credits",
      type: "metered",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_ai_credits",
      planId: "plan_pro",
      featureId: "feature_ai_credits",
      limitValue: 5000,
      usageModel: "included",
      overage: "charge",
      overagePrice: 25,
      billingUnits: 1,
      ratingModel: "package",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_pro",
      customerId: "cust_2",
      planId: "plan_pro",
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
    });
    await insertEntitlement(businessDb.d1, {
      id: "ent_bonus_ai_credits",
      customerId: "cust_2",
      featureId: "feature_ai_credits",
      limitValue: 100,
      source: "manual_bonus",
    });

    await appendPlanUsage(usageLedger, {
      organizationId: "org_123",
      customerId: "cust_2",
      featureId: "feature_ai_credits",
      subscriptionId: "sub_pro",
      planId: "plan_pro",
      amount: 5000,
      periodStart: currentPeriodStart,
      periodEnd: currentPeriodEnd,
    });

    const response = await app.request(
      "/check",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer: "cust_2",
          feature: "feature_ai_credits",
          value: 20,
        }),
      },
      {
        ...RUNTIME_ROUTE_ENV,
        USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
        USAGE_METER: usageMeter as unknown as DurableObjectNamespace<any>,
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.allowed).toBe(true);
    expect(body.code).toBe("bonus_credits_used");
    expect(body.credits).toMatchObject({
      source: "feature",
      bonusBalance: 100,
      totalBalance: 100,
      plan: {
        used: 5000,
        limit: 5000,
        balance: 0,
      },
    });

    const ledgerRecords = usageLedger.listRecords("org_123");
    expect(ledgerRecords).toHaveLength(1);
    expect(ledgerRecords[0]).toMatchObject({
      coverageSource: "plan",
      amount: 5000,
    });
  });
});
