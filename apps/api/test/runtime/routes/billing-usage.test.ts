import { afterEach, beforeEach, describe, expect, it } from "vitest";
import apiBilling from "../../../src/routes/api/billing";
import { BillingService } from "../../../src/lib/billing";
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
  insertPlan,
  insertSubscription,
} from "../helpers/workflow-runtime";

describe("Billing usage runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let usageLedger: SimulatedUsageLedgerNamespace;
  let billingApp: ReturnType<
    typeof createRouteTestApp<{ db: any; authDb: any }>
  >;
  let apiKey: string;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    usageLedger = new SimulatedUsageLedgerNamespace();
    await insertOrganization(businessDb.d1, { id: "org_123" });
    apiKey = await insertApiKey(businessDb.d1, {
      organizationId: "org_123",
      apiKey: "owo_sk_billing_usage_runtime",
    });
    billingApp = createRouteTestApp(apiBilling, {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  async function appendUsage(record: {
    organizationId: string;
    customerId: string;
    featureId: string;
    featureSlug: string;
    featureName: string;
    subscriptionId: string;
    planId: string;
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
      subscriptionId: record.subscriptionId,
      planId: record.planId,
      amount: record.amount,
      periodStart: record.periodStart,
      periodEnd: record.periodEnd,
      createdAt: record.createdAt,
      pricingSnapshot: {
        usageModel: "included",
        ratingModel: "package",
        included: 5000,
        pricePerUnit: null,
        billingUnits: 1,
        overagePrice: 25,
        tiers: null,
      },
    });
  }

  it("keeps post-invoice overage visible within the same billing period", async () => {
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
      id: "feature_ai_credits",
      organizationId: "org_123",
      slug: "ai-credits",
      name: "AI Credits",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_growth_ai_credits",
      planId: "plan_growth",
      featureId: "feature_ai_credits",
      limitValue: 5000,
      overage: "charge",
      overagePrice: 25,
      billingUnits: 1,
      ratingModel: "package",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_growth",
      customerId: "cust_1",
      planId: "plan_growth",
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
    });

    await appendUsage({
      organizationId: "org_123",
      customerId: "cust_1",
      featureId: "feature_ai_credits",
      featureSlug: "ai-credits",
      featureName: "AI Credits",
      subscriptionId: "sub_growth",
      planId: "plan_growth",
      amount: 5100,
      periodStart: usageWindow.periodStart,
      periodEnd: usageWindow.periodEnd,
      createdAt: now - 2_000,
    });

    const billingService = new BillingService(businessDb.db, {
      usageLedger: usageLedger as unknown as DurableObjectNamespace<any>,
    });
    const invoiceResult = await billingService.generateInvoice(
      "cust_1",
      "org_123",
      {
        sourceTrigger: "threshold",
      },
    );

    expect(invoiceResult.isOk()).toBe(true);
    if (invoiceResult.isErr()) return;
    expect(invoiceResult.value.items).toEqual([
      expect.objectContaining({
        featureId: "feature_ai_credits",
        quantity: 100,
        amount: 2500,
      }),
    ]);

    await appendUsage({
      organizationId: "org_123",
      customerId: "cust_1",
      featureId: "feature_ai_credits",
      featureSlug: "ai-credits",
      featureName: "AI Credits",
      subscriptionId: "sub_growth",
      planId: "plan_growth",
      amount: 90,
      periodStart: usageWindow.periodStart,
      periodEnd: usageWindow.periodEnd,
      createdAt: now,
    });

    const usageResponse = await billingApp.request(
      "/usage?customer=cust_1",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
      {
        ...RUNTIME_ROUTE_ENV,
        USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
      },
    );

    expect(usageResponse.status).toBe(200);
    const body = await usageResponse.json();
    expect(body.success).toBe(true);
    expect(body.totalEstimated).toBe(2250);
    expect(body.features).toEqual([
      expect.objectContaining({
        featureId: "feature_ai_credits",
        usage: 5190,
        included: 5000,
        billableQuantity: 90,
        estimatedAmount: 2250,
      }),
    ]);
  });
});
