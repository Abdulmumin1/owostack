import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import entitlementsRoute from "../../../src/routes/api/entitlements";
import { publicApiEnvelope } from "../../../src/lib/public-api-envelope";
import {
  ENVIRONMENT_HEADER,
  ORGANIZATION_HEADER,
} from "../../../src/lib/public-environment";
import { verifyApiKey } from "../../../src/lib/api-keys";
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

const SANDBOX_KEY = "owo_sk_test_0123456789abcdef0123456789abcdef01234567";
const LIVE_KEY = "owo_sk_live_fedcba9876543210fedcba9876543210fedcba98";
const LEGACY_KEY = "owo_sk_legacy0123456789abcdef0123456789abcdef";

/**
 * Mirrors the production mount: the envelope middleware wraps the whole
 * public /v1 router, and the entitlement routes hang off it.
 */
function buildPublicApi(variables: { db: any; authDb: any }) {
  const v1 = new Hono<any>();
  v1.use("*", publicApiEnvelope);
  v1.route("/", entitlementsRoute);
  return createRouteTestApp(v1, variables);
}

function entitlementRequest(
  apiKey: string,
  body: Record<string, unknown>,
): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

describe("Public API environment scoping", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let usageLedger: SimulatedUsageLedgerNamespace;
  let usageMeter: SimulatedUsageMeterNamespace;
  let app: ReturnType<typeof buildPublicApi>;

  const envFor = (environment: "test" | "live") => ({
    ...RUNTIME_ROUTE_ENV,
    ENVIRONMENT: environment,
    USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
    USAGE_METER: usageMeter as unknown as DurableObjectNamespace<any>,
  });

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    usageLedger = new SimulatedUsageLedgerNamespace();
    usageMeter = new SimulatedUsageMeterNamespace();

    await insertOrganization(businessDb.d1, { id: "org_123" });
    await insertApiKey(businessDb.d1, {
      id: "key_sandbox",
      organizationId: "org_123",
      apiKey: SANDBOX_KEY,
    });
    await insertApiKey(businessDb.d1, {
      id: "key_live",
      organizationId: "org_123",
      apiKey: LIVE_KEY,
    });
    await insertApiKey(businessDb.d1, {
      id: "key_legacy",
      organizationId: "org_123",
      apiKey: LEGACY_KEY,
    });

    const now = Date.now();
    await insertCustomer(businessDb.d1, {
      id: "cust_1",
      organizationId: "org_123",
      email: "workspace-owner@example.com",
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
      id: "feature_turns",
      organizationId: "org_123",
      slug: "agent-turns",
      name: "Agent turns",
      type: "metered",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_turns",
      planId: "plan_pro",
      featureId: "feature_turns",
      limitValue: 100,
      usageModel: "included",
      overage: "block",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_tokens",
      organizationId: "org_123",
      slug: "tokens",
      name: "Tokens",
      type: "metered",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_tokens",
      planId: "plan_pro",
      featureId: "feature_tokens",
      limitValue: null,
      usageModel: "included",
      overage: "block",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_pro",
      customerId: "cust_1",
      planId: "plan_pro",
      status: "active",
      currentPeriodStart: now - 5 * 24 * 60 * 60 * 1000,
      currentPeriodEnd: now + 25 * 24 * 60 * 60 * 1000,
    });

    app = buildPublicApi({ db: businessDb.db, authDb: businessDb.db });
  });

  afterEach(() => {
    businessDb.close();
  });

  it("rejects a sandbox key on the live API before any usage is written", async () => {
    const response = await app.request(
      "/track",
      entitlementRequest(SANDBOX_KEY, {
        customer: "cust_1",
        feature: "agent-turns",
        value: 1,
      }),
      envFor("live"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get(ENVIRONMENT_HEADER)).toBe("live");
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("environment_mismatch");
    expect(body.error.message).toContain("sandbox");
    expect(body.error.message).toContain("https://sandbox.owostack.com");
    expect(body.environment).toBe("live");
    expect(body.keyEnvironment).toBe("sandbox");

    expect(usageLedger.listRecords("org_123")).toHaveLength(0);
  });

  it("rejects a live key on the sandbox API", async () => {
    const response = await app.request(
      "/check",
      entitlementRequest(LIVE_KEY, {
        customer: "cust_1",
        feature: "agent-turns",
      }),
      envFor("test"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get(ENVIRONMENT_HEADER)).toBe("sandbox");
    const body = await response.json();
    expect(body.error.code).toBe("environment_mismatch");
    expect(body.error.message).toContain("https://api.owostack.com");
  });

  it("accepts a matching key and echoes environment, organization and plan on track", async () => {
    const response = await app.request(
      "/track",
      entitlementRequest(LIVE_KEY, {
        customer: "cust_1",
        feature: "agent-turns",
        value: 3,
      }),
      envFor("live"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get(ENVIRONMENT_HEADER)).toBe("live");
    expect(response.headers.get(ORGANIZATION_HEADER)).toBe("org_123");

    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      allowed: true,
      code: "tracked",
      environment: "live",
      unlimited: false,
      usage: 3,
      limit: 100,
      balance: 97,
      details: { plan: "pro", planName: "Pro" },
    });

    expect(usageLedger.listRecords("org_123")).toHaveLength(1);
  });

  it("marks unlimited features explicitly instead of only limit: null", async () => {
    const response = await app.request(
      "/check",
      entitlementRequest(SANDBOX_KEY, {
        customer: "cust_1",
        feature: "tokens",
      }),
      envFor("test"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      allowed: true,
      environment: "sandbox",
      unlimited: true,
      limit: null,
      balance: null,
    });
  });

  it("keeps legacy unscoped keys working on both environments", async () => {
    for (const environment of ["test", "live"] as const) {
      const response = await app.request(
        "/check",
        entitlementRequest(LEGACY_KEY, {
          customer: "cust_1",
          feature: "agent-turns",
        }),
        envFor(environment),
      );

      expect(response.status).toBe(200);
      const expected = environment === "live" ? "live" : "sandbox";
      expect(response.headers.get(ENVIRONMENT_HEADER)).toBe(expected);
      expect(response.headers.get(ORGANIZATION_HEADER)).toBe("org_123");
      const body = await response.json();
      expect(body.environment).toBe(expected);
      expect(body.allowed).toBe(true);
    }
  });

  it("still reports the environment on ordinary auth failures", async () => {
    const response = await app.request(
      "/check",
      entitlementRequest("owo_sk_live_doesnotexist000000000000000000000000", {
        customer: "cust_1",
        feature: "agent-turns",
      }),
      envFor("live"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get(ENVIRONMENT_HEADER)).toBe("live");
    expect(response.headers.get(ORGANIZATION_HEADER)).toBeNull();
    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      error: "Invalid API Key",
      environment: "live",
    });
  });

  it("derives the key scope from its prefix on verification", async () => {
    await expect(
      verifyApiKey(businessDb.db, SANDBOX_KEY),
    ).resolves.toMatchObject({
      id: "key_sandbox",
      organizationId: "org_123",
      environment: "test",
    });
    await expect(verifyApiKey(businessDb.db, LIVE_KEY)).resolves.toMatchObject({
      id: "key_live",
      organizationId: "org_123",
      environment: "live",
    });
    await expect(
      verifyApiKey(businessDb.db, LEGACY_KEY),
    ).resolves.toMatchObject({
      id: "key_legacy",
      organizationId: "org_123",
      environment: null,
    });
    // A key whose prefix was tampered with hashes differently and is rejected.
    await expect(
      verifyApiKey(
        businessDb.db,
        LIVE_KEY.replace("owo_sk_live_", "owo_sk_test_"),
      ),
    ).resolves.toBeNull();
  });
});
