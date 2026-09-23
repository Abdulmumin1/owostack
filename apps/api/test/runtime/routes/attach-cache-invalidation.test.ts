import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import checkoutRoute from "../../../src/routes/api/checkout";
import entitlementsRoute from "../../../src/routes/api/entitlements";
import { publicApiEnvelope } from "../../../src/lib/public-api-envelope";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { insertApiKey, RUNTIME_ROUTE_ENV } from "../helpers/catalog-runtime";
import { StatefulRuntimeKv } from "../helpers/kv-runtime";
import {
  insertFeature,
  insertPlanFeature,
  SimulatedUsageLedgerNamespace,
  SimulatedUsageMeterNamespace,
} from "../helpers/overage-runtime";
import { insertOrganization, insertPlan } from "../helpers/workflow-runtime";

/**
 * Reproduces a sandbox incident: `attach()` upgraded a customer and reported
 * success, but `/check` kept answering for the old plan because attach never
 * dropped the KV-cached subscription list that /check reads first.
 *
 * Real attach + check routes, real D1, a strongly consistent KV double.
 */

const API_KEY = "owo_sk_test_cache0123456789abcdef0123456789abcdef";

describe("attach invalidates the entitlement cache", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let kv: StatefulRuntimeKv;
  let app: ReturnType<typeof createRouteTestApp<{ db: any; authDb: any }>>;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    kv = new StatefulRuntimeKv();

    await insertOrganization(businessDb.d1, { id: "org_cache" });
    await insertApiKey(businessDb.d1, {
      id: "key_cache",
      organizationId: "org_cache",
      apiKey: API_KEY,
    });
    await insertFeature(businessDb.d1, {
      id: "feat_calls",
      organizationId: "org_cache",
      slug: "api-calls",
      type: "metered",
    });
    // Two free plans in one group so the switch is synchronous (no checkout).
    for (const [id, slug, limit] of [
      ["plan_small", "small", 50],
      ["plan_large", "large", 500],
    ] as const) {
      await insertPlan(businessDb.d1, {
        id,
        organizationId: "org_cache",
        slug,
        name: slug,
        price: 0,
        type: "free",
        billingType: "recurring",
        planGroup: "main",
        providerId: null as unknown as string,
        providerPlanId: null,
        paystackPlanId: null,
      });
      await insertPlanFeature(businessDb.d1, {
        id: `pf_${id}`,
        planId: id,
        featureId: "feat_calls",
        limitValue: limit,
        resetInterval: "monthly",
      });
    }

    const v1 = new Hono<any>();
    v1.use("*", publicApiEnvelope);
    v1.route("/", checkoutRoute);
    v1.route("/", entitlementsRoute);
    app = createRouteTestApp(v1, { db: businessDb.db, authDb: businessDb.db });
  });

  afterEach(() => businessDb.close());

  const env = () => ({
    ...RUNTIME_ROUTE_ENV,
    ENVIRONMENT: "test",
    CACHE: kv as unknown as KVNamespace,
    USAGE_LEDGER:
      new SimulatedUsageLedgerNamespace() as unknown as DurableObjectNamespace<any>,
    USAGE_METER:
      new SimulatedUsageMeterNamespace() as unknown as DurableObjectNamespace<any>,
  });

  async function post(path: string, body: Record<string, unknown>) {
    const waits: Promise<unknown>[] = [];
    const res = await app.request(
      path,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      env(),
      { waitUntil: (p) => waits.push(p), passThroughOnException() {} },
    );
    const json = await res.json();
    await Promise.all(waits); // flush cache writes / invalidations
    return { status: res.status, json };
  }

  it("serves the new plan's limits from /check immediately after a synchronous switch", async () => {
    const customer = "cache.user@example.com";

    expect((await post("/attach", { customer, product: "small" })).json).toMatchObject({
      success: true,
      requiresCheckout: false,
    });

    // Prime the cache on the old plan.
    const before = await post("/check", { customer, feature: "api-calls" });
    expect(before.json).toMatchObject({ allowed: true, limit: 50 });
    expect(kv.keys().some((k) => k.includes("subscriptions"))).toBe(true);

    const switched = await post("/attach", { customer, product: "large" });
    expect(switched.json).toMatchObject({ success: true, requiresCheckout: false });

    const after = await post("/check", { customer, feature: "api-calls" });
    expect(after.json).toMatchObject({
      allowed: true,
      limit: 500,
      details: { plan: "large" },
    });
  });
});
