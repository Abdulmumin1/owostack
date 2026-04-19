import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiCustomersRoute } from "../../../src/routes/api/customers";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { insertApiKey, RUNTIME_ROUTE_ENV } from "../helpers/catalog-runtime";
import {
  insertFeature,
  SimulatedUsageLedgerNamespace,
} from "../helpers/overage-runtime";
import {
  insertCustomer,
  insertOrganization,
} from "../helpers/workflow-runtime";

async function appendUsage(
  usageLedger: SimulatedUsageLedgerNamespace,
  record: {
    organizationId: string;
    customerId: string;
    featureId: string;
    featureSlug: string;
    featureName: string;
    amount: number;
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
    amount: record.amount,
    periodStart: record.createdAt,
    periodEnd: record.createdAt,
    createdAt: record.createdAt,
  });
}

describe("Customer usage history runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let usageLedger: SimulatedUsageLedgerNamespace;
  let app: ReturnType<typeof createRouteTestApp<{ db: any; authDb: any }>>;
  let apiKey: string;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    usageLedger = new SimulatedUsageLedgerNamespace();
    await insertOrganization(businessDb.d1, { id: "org_123" });
    apiKey = await insertApiKey(businessDb.d1, {
      organizationId: "org_123",
      apiKey: "owo_sk_customer_usage_history",
    });
    app = createRouteTestApp(createApiCustomersRoute(), {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  it("returns aggregate history plus per-feature breakdown with timezone-aware day buckets", async () => {
    await insertCustomer(businessDb.d1, {
      id: "cust_1",
      organizationId: "org_123",
      email: "usage@example.com",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_runs",
      organizationId: "org_123",
      slug: "agent-runs",
      name: "Agent Runs",
      unit: "runs",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_messages",
      organizationId: "org_123",
      slug: "messages",
      name: "Messages",
      unit: "messages",
    });

    await appendUsage(usageLedger, {
      organizationId: "org_123",
      customerId: "cust_1",
      featureId: "feature_runs",
      featureSlug: "agent-runs",
      featureName: "Agent Runs",
      amount: 2,
      createdAt: Date.parse("2026-04-17T23:30:00.000Z"),
    });
    await appendUsage(usageLedger, {
      organizationId: "org_123",
      customerId: "cust_1",
      featureId: "feature_messages",
      featureSlug: "messages",
      featureName: "Messages",
      amount: 3,
      createdAt: Date.parse("2026-04-18T00:15:00.000Z"),
    });
    await appendUsage(usageLedger, {
      organizationId: "org_123",
      customerId: "cust_1",
      featureId: "feature_runs",
      featureSlug: "agent-runs",
      featureName: "Agent Runs",
      amount: 5,
      createdAt: Date.parse("2026-04-19T10:00:00.000Z"),
    });

    const response = await app.request(
      "/customers/cust_1/usage/history?range=custom&from=2026-04-18&to=2026-04-19&granularity=day&groupBy=feature&timezone=Africa/Lagos",
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

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.customer).toEqual({ id: "cust_1" });
    expect(body.query).toEqual({
      range: { from: "2026-04-18", to: "2026-04-19" },
      granularity: "day",
      feature: null,
      groupBy: "feature",
      timezone: "Africa/Lagos",
    });
    expect(body.totals).toEqual({
      usage: 10,
      records: 3,
    });
    expect(body.series).toEqual([
      { bucket: "2026-04-18", value: 5 },
      { bucket: "2026-04-19", value: 5 },
    ]);
    expect(body.breakdown).toEqual([
      {
        feature: {
          id: "feature_runs",
          slug: "agent-runs",
          name: "Agent Runs",
          unit: "runs",
        },
        totals: {
          usage: 7,
          records: 2,
        },
        series: [
          { bucket: "2026-04-18", value: 2 },
          { bucket: "2026-04-19", value: 5 },
        ],
      },
      {
        feature: {
          id: "feature_messages",
          slug: "messages",
          name: "Messages",
          unit: "messages",
        },
        totals: {
          usage: 3,
          records: 1,
        },
        series: [
          { bucket: "2026-04-18", value: 3 },
          { bucket: "2026-04-19", value: 0 },
        ],
      },
    ]);
  });

  it("filters usage history to a single feature and collapses into month buckets", async () => {
    await insertCustomer(businessDb.d1, {
      id: "cust_month",
      organizationId: "org_123",
      email: "month@example.com",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_runs",
      organizationId: "org_123",
      slug: "agent-runs",
      name: "Agent Runs",
      unit: "runs",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_messages",
      organizationId: "org_123",
      slug: "messages",
      name: "Messages",
      unit: "messages",
    });

    await appendUsage(usageLedger, {
      organizationId: "org_123",
      customerId: "cust_month",
      featureId: "feature_runs",
      featureSlug: "agent-runs",
      featureName: "Agent Runs",
      amount: 4,
      createdAt: Date.parse("2026-04-03T08:00:00.000Z"),
    });
    await appendUsage(usageLedger, {
      organizationId: "org_123",
      customerId: "cust_month",
      featureId: "feature_runs",
      featureSlug: "agent-runs",
      featureName: "Agent Runs",
      amount: 6,
      createdAt: Date.parse("2026-04-20T08:00:00.000Z"),
    });
    await appendUsage(usageLedger, {
      organizationId: "org_123",
      customerId: "cust_month",
      featureId: "feature_messages",
      featureSlug: "messages",
      featureName: "Messages",
      amount: 99,
      createdAt: Date.parse("2026-04-25T08:00:00.000Z"),
    });

    const response = await app.request(
      "/customers/cust_month/usage/history?range=custom&from=2026-04-01&to=2026-04-30&granularity=month&feature=agent-runs",
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

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.query.feature).toBe("agent-runs");
    expect(body.totals).toEqual({
      usage: 10,
      records: 2,
    });
    expect(body.series).toEqual([{ bucket: "2026-04", value: 10 }]);
    expect(body.breakdown).toEqual([]);
  });
});
