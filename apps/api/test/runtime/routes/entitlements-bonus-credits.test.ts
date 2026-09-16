import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@owostack/db";
import { eq } from "drizzle-orm";
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
import { insertApiKey, RUNTIME_ROUTE_ENV } from "../helpers/catalog-runtime";
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

async function insertPrepaidCredits(
  db: D1Database,
  params: { id: string; customerId: string; balance: number },
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO credits (id, customer_id, balance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(params.id, params.customerId, params.balance, now, now)
    .run();
}

async function seedPrepaidFeature(
  db: D1Database,
  params: { customerId: string; creditBalance: number; limitValue?: number },
) {
  const now = Date.now();
  const currentPeriodStart = now - 5 * 24 * 60 * 60 * 1000;
  const currentPeriodEnd = now + 25 * 24 * 60 * 60 * 1000;

  await insertCustomer(db, {
    id: params.customerId,
    organizationId: "org_123",
    email: `${params.customerId}@example.com`,
  });
  await insertPlan(db, {
    id: `plan_${params.customerId}`,
    organizationId: "org_123",
    name: "Prepaid",
    slug: `prepaid-${params.customerId}`,
    price: 5000,
    currency: "USD",
    type: "paid",
  });
  await insertFeature(db, {
    id: `feature_${params.customerId}`,
    organizationId: "org_123",
    slug: `prepaid-${params.customerId}`,
    name: "Prepaid API calls",
    type: "metered",
  });
  await insertPlanFeature(db, {
    id: `pf_${params.customerId}`,
    planId: `plan_${params.customerId}`,
    featureId: `feature_${params.customerId}`,
    limitValue: params.limitValue ?? 1_000,
    usageModel: "prepaid",
    creditCost: 5,
    overage: "block",
  });
  await insertSubscription(db, {
    id: `sub_${params.customerId}`,
    customerId: params.customerId,
    planId: `plan_${params.customerId}`,
    status: "active",
    currentPeriodStart,
    currentPeriodEnd,
  });
  await insertPrepaidCredits(db, {
    id: `credits_${params.customerId}`,
    customerId: params.customerId,
    balance: params.creditBalance,
  });
}

function prepaidRequest(params: {
  apiKey: string;
  customerId: string;
  featureId: string;
  sendEvent?: boolean;
}) {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customer: params.customerId,
      feature: params.featureId,
      value: 1,
      ...(params.sendEvent === undefined
        ? {}
        : { sendEvent: params.sendEvent }),
    }),
  } satisfies RequestInit;
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

  it("allows exactly one concurrent prepaid track and records only its reserved usage", async () => {
    await seedPrepaidFeature(businessDb.d1, {
      customerId: "cust_prepaid_track",
      creditBalance: 5,
    });

    const request = prepaidRequest({
      apiKey,
      customerId: "cust_prepaid_track",
      featureId: "feature_cust_prepaid_track",
    });
    const env = {
      ...RUNTIME_ROUTE_ENV,
      USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
      USAGE_METER: usageMeter as unknown as DurableObjectNamespace<any>,
    };
    const responses = await Promise.all([
      app.request("/track", request, env),
      app.request("/track", request, env),
    ]);
    const bodies = await Promise.all(
      responses.map((response) => response.json()),
    );

    expect(bodies.filter((body) => body.allowed)).toHaveLength(1);
    expect(
      bodies.filter((body) => body.code === "insufficient_credits"),
    ).toHaveLength(1);

    const creditRecord = await businessDb.db.query.credits.findFirst({
      where: eq(schema.credits.customerId, "cust_prepaid_track"),
    });
    expect(creditRecord?.balance).toBe(0);
    expect(usageLedger.listRecords("org_123")).toHaveLength(1);
    expect(usageLedger.listRecords("org_123")[0]).toMatchObject({
      customerId: "cust_prepaid_track",
      amount: 1,
    });
  });

  it("does not record check-with-event usage when the prepaid reservation loses a retry race", async () => {
    await seedPrepaidFeature(businessDb.d1, {
      customerId: "cust_prepaid_check",
      creditBalance: 5,
    });

    const request = prepaidRequest({
      apiKey,
      customerId: "cust_prepaid_check",
      featureId: "feature_cust_prepaid_check",
      sendEvent: true,
    });
    const env = {
      ...RUNTIME_ROUTE_ENV,
      USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
      USAGE_METER: usageMeter as unknown as DurableObjectNamespace<any>,
    };
    const responses = await Promise.all([
      app.request("/check", request, env),
      app.request("/check", request, env),
    ]);
    const bodies = await Promise.all(
      responses.map((response) => response.json()),
    );

    expect(bodies.filter((body) => body.allowed)).toHaveLength(1);
    expect(
      bodies.filter((body) => body.code === "insufficient_credits"),
    ).toHaveLength(1);

    const creditRecord = await businessDb.db.query.credits.findFirst({
      where: eq(schema.credits.customerId, "cust_prepaid_check"),
    });
    expect(creditRecord?.balance).toBe(0);
    expect(usageLedger.listRecords("org_123")).toHaveLength(1);
    expect(usageLedger.listRecords("org_123")[0]).toMatchObject({
      customerId: "cust_prepaid_check",
      amount: 1,
    });
  });
  it("denies a plain check (no event) when the prepaid balance cannot cover the cost, without spending it", async () => {
    await seedPrepaidFeature(businessDb.d1, {
      customerId: "cust_prepaid_readonly",
      creditBalance: 4,
    });

    const env = {
      ...RUNTIME_ROUTE_ENV,
      USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
      USAGE_METER: usageMeter as unknown as DurableObjectNamespace<any>,
    };
    const response = await app.request(
      "/check",
      prepaidRequest({
        apiKey,
        customerId: "cust_prepaid_readonly",
        featureId: "feature_cust_prepaid_readonly",
      }),
      env,
    );
    const body = await response.json();

    expect(body.allowed).toBe(false);
    expect(body.code).toBe("insufficient_credits");

    const creditRecord = await businessDb.db.query.credits.findFirst({
      where: eq(schema.credits.customerId, "cust_prepaid_readonly"),
    });
    expect(creditRecord?.balance).toBe(4);
    expect(usageLedger.listRecords("org_123")).toHaveLength(0);
  });

  it("does not spend the prepaid balance on a plain check that is affordable", async () => {
    await seedPrepaidFeature(businessDb.d1, {
      customerId: "cust_prepaid_peek",
      creditBalance: 5,
    });

    const env = {
      ...RUNTIME_ROUTE_ENV,
      USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
      USAGE_METER: usageMeter as unknown as DurableObjectNamespace<any>,
    };
    const response = await app.request(
      "/check",
      prepaidRequest({
        apiKey,
        customerId: "cust_prepaid_peek",
        featureId: "feature_cust_prepaid_peek",
      }),
      env,
    );
    const body = await response.json();

    expect(body.allowed).toBe(true);

    const creditRecord = await businessDb.db.query.credits.findFirst({
      where: eq(schema.credits.customerId, "cust_prepaid_peek"),
    });
    expect(creditRecord?.balance).toBe(5);
    expect(usageLedger.listRecords("org_123")).toHaveLength(0);
  });

  it("keeps the plan limit enforced for prepaid tracking and refunds the reservation when the meter denies", async () => {
    // creditCost 5 with a plan limit of 1 means the usage meter's credit
    // multiplier (1 * 5 > 1) must deny the event even though the prepaid
    // balance could cover it.
    await seedPrepaidFeature(businessDb.d1, {
      customerId: "cust_prepaid_limited",
      creditBalance: 50,
      limitValue: 1,
    });

    const env = {
      ...RUNTIME_ROUTE_ENV,
      USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
      USAGE_METER: usageMeter as unknown as DurableObjectNamespace<any>,
    };
    const response = await app.request(
      "/track",
      prepaidRequest({
        apiKey,
        customerId: "cust_prepaid_limited",
        featureId: "feature_cust_prepaid_limited",
      }),
      env,
    );
    const body = await response.json();

    expect(body.allowed).toBe(false);
    expect(body.code).toBe("limit_exceeded");

    const creditRecord = await businessDb.db.query.credits.findFirst({
      where: eq(schema.credits.customerId, "cust_prepaid_limited"),
    });
    expect(creditRecord?.balance).toBe(50);
    expect(usageLedger.listRecords("org_123")).toHaveLength(0);
  });

  it("records prepaid tracking in the usage meter so a following check sees the usage", async () => {
    await seedPrepaidFeature(businessDb.d1, {
      customerId: "cust_prepaid_meter",
      creditBalance: 50,
      limitValue: 100,
    });

    const env = {
      ...RUNTIME_ROUTE_ENV,
      USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
      USAGE_METER: usageMeter as unknown as DurableObjectNamespace<any>,
    };
    const tracked = await app.request(
      "/track",
      prepaidRequest({
        apiKey,
        customerId: "cust_prepaid_meter",
        featureId: "feature_cust_prepaid_meter",
      }),
      env,
    );
    expect((await tracked.json()).allowed).toBe(true);

    const checked = await app.request(
      "/check",
      prepaidRequest({
        apiKey,
        customerId: "cust_prepaid_meter",
        featureId: "feature_cust_prepaid_meter",
      }),
      env,
    );
    const body = await checked.json();
    expect(body.allowed).toBe(true);
    // creditCost 5 -> one tracked unit consumes 5 of the plan limit
    expect(body.usage).toBe(5);

    const creditRecord = await businessDb.db.query.credits.findFirst({
      where: eq(schema.credits.customerId, "cust_prepaid_meter"),
    });
    expect(creditRecord?.balance).toBe(45);
  });
});
