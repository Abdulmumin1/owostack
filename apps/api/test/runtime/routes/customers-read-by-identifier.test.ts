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

/**
 * Customers are written via /track and /check using the developer's own
 * identifier (`customer: "user_123"`). These tests pin down that the same
 * identifier — or the email — works for every customer read, not only the
 * internal UUID, and that listing/search exists and is tenant-scoped.
 */
describe("Customer reads by external identifier", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let usageLedger: SimulatedUsageLedgerNamespace;
  let app: ReturnType<typeof createRouteTestApp<{ db: any; authDb: any }>>;
  let apiKey: string;

  const env = () => ({
    ...RUNTIME_ROUTE_ENV,
    USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
  });

  const get = (path: string) =>
    app.request(
      path,
      { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } },
      env(),
    );

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    usageLedger = new SimulatedUsageLedgerNamespace();

    await insertOrganization(businessDb.d1, { id: "org_123" });
    await insertOrganization(businessDb.d1, { id: "org_other" });
    apiKey = await insertApiKey(businessDb.d1, {
      organizationId: "org_123",
      apiKey: "owo_sk_test_customer_reads",
    });

    const day = 24 * 60 * 60 * 1000;
    await insertCustomer(businessDb.d1, {
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: "org_123",
      externalId: "workspace_alpha",
      email: "alpha-owner@example.com",
      name: "Alpha Workspace",
      createdAt: Date.now() - 2 * day,
    });
    await insertCustomer(businessDb.d1, {
      id: "22222222-2222-4222-8222-222222222222",
      organizationId: "org_123",
      externalId: "workspace_beta",
      email: "beta-owner@example.com",
      name: "Beta Workspace",
      createdAt: Date.now() - day,
    });
    await insertCustomer(businessDb.d1, {
      id: "33333333-3333-4333-8333-333333333333",
      organizationId: "org_123",
      externalId: null,
      email: "solo@example.com",
      name: "Solo Dev",
      createdAt: Date.now(),
    });
    // Same external id in another tenant must never be visible.
    await insertCustomer(businessDb.d1, {
      id: "99999999-9999-4999-8999-999999999999",
      organizationId: "org_other",
      externalId: "workspace_alpha",
      email: "alpha-owner@example.com",
      name: "Other Tenant Alpha",
    });

    app = createRouteTestApp(createApiCustomersRoute(), {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  it("GET /customers/{id} accepts the internal id, the external id and the email", async () => {
    for (const identifier of [
      "11111111-1111-4111-8111-111111111111",
      "workspace_alpha",
      "alpha-owner@example.com",
      encodeURIComponent("alpha-owner@example.com"),
    ]) {
      const response = await get(`/customers/${identifier}`);
      expect(response.status, identifier).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        success: true,
        id: "11111111-1111-4111-8111-111111111111",
        externalId: "workspace_alpha",
        email: "alpha-owner@example.com",
        name: "Alpha Workspace",
      });
      expect(body.billing).toBeDefined();
    }

    const missing = await get("/customers/workspace_nope");
    expect(missing.status).toBe(404);
  });

  it("GET /customers/{id}/usage/history resolves the external id to the same ledger rows", async () => {
    await insertFeature(businessDb.d1, {
      id: "feature_turns",
      organizationId: "org_123",
      slug: "agent-turns",
      name: "Agent turns",
      unit: "turns",
    });
    const stub = usageLedger.get(usageLedger.idFromName("org:org_123")) as any;
    const createdAt = Date.now() - 60 * 60 * 1000;
    await stub.appendUsage({
      customerId: "11111111-1111-4111-8111-111111111111",
      featureId: "feature_turns",
      featureSlug: "agent-turns",
      featureName: "Agent turns",
      amount: 7,
      periodStart: createdAt,
      periodEnd: createdAt,
      createdAt,
    });

    const byExternalId = await get(
      "/customers/workspace_alpha/usage/history?range=7d",
    );
    expect(byExternalId.status).toBe(200);
    const external = await byExternalId.json();
    expect(external.customer.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(external.totals).toEqual({ usage: 7, records: 1 });

    const byInternalId = await get(
      "/customers/11111111-1111-4111-8111-111111111111/usage/history?range=7d",
    );
    expect(await byInternalId.json()).toEqual(external);

    // A different customer's identifier does not see this usage.
    const beta = await get("/customers/workspace_beta/usage/history?range=7d");
    expect((await beta.json()).totals).toEqual({ usage: 0, records: 0 });
  });

  it("GET /customers lists newest first, paginates and reports the tenant total", async () => {
    const first = await get("/customers?limit=2");
    expect(first.status).toBe(200);
    const page1 = await first.json();
    expect(page1.total).toBe(3);
    expect(page1.limit).toBe(2);
    expect(page1.offset).toBe(0);
    expect(page1.data.map((c: any) => c.externalId)).toEqual([
      null,
      "workspace_beta",
    ]);
    expect(page1.data[1]).toMatchObject({
      id: "22222222-2222-4222-8222-222222222222",
      email: "beta-owner@example.com",
      name: "Beta Workspace",
    });
    expect(page1.data[0]).not.toHaveProperty("providerAuthorizationCode");

    const second = await get("/customers?limit=2&offset=2");
    const page2 = await second.json();
    expect(page2.data.map((c: any) => c.externalId)).toEqual([
      "workspace_alpha",
    ]);

    const invalid = await get("/customers?limit=0");
    expect(invalid.status).toBe(400);
  });

  it("GET /customers filters by exact external id / email and searches across fields", async () => {
    const byExternal = await get("/customers?externalId=workspace_alpha");
    const external = await byExternal.json();
    expect(external.total).toBe(1);
    expect(external.data[0].id).toBe("11111111-1111-4111-8111-111111111111");

    const byEmail = await get(
      `/customers?email=${encodeURIComponent("BETA-OWNER@example.com")}`,
    );
    const email = await byEmail.json();
    expect(email.data.map((c: any) => c.externalId)).toEqual([
      "workspace_beta",
    ]);

    const bySearch = await get("/customers?search=workspace");
    const search = await bySearch.json();
    expect(search.total).toBe(2);
    expect(search.data.map((c: any) => c.externalId).sort()).toEqual([
      "workspace_alpha",
      "workspace_beta",
    ]);

    const byName = await get("/customers?search=solo");
    expect((await byName.json()).data.map((c: any) => c.email)).toEqual([
      "solo@example.com",
    ]);

    const none = await get("/customers?externalId=workspace_gamma");
    expect(await none.json()).toMatchObject({ total: 0, data: [] });
  });
});
