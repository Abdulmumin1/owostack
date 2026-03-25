import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import providersRoute, {
  dashboardProvidersRouteDependencies,
  resetDashboardProvidersRouteDependencies,
} from "../../../src/routes/dashboard/providers";
import { createRouteTestApp } from "../../helpers/route-harness";
import { decrypt, encrypt } from "../../../src/lib/encryption";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { insertOrganization } from "../helpers/workflow-runtime";

const env = {
  ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  ENABLED_PROVIDERS: "paystack,stripe,dodopayments,polar",
};

type QueuedResponse =
  | Response
  | ((url: string, init?: RequestInit) => Response | Promise<Response>);

function createFetchRecorder(queue: QueuedResponse[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  return {
    calls,
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });

      const next = queue.shift();
      if (!next) {
        throw new Error(`Unexpected fetch call for ${url}`);
      }

      return next instanceof Response ? next : await next(url, init);
    },
  };
}

describe("Dashboard provider validation runtime integration", () => {
  let originalFetch: typeof globalThis.fetch;
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<
    typeof createRouteTestApp<{ db: any; organizationId: string }>
  >;
  let planSyncCalls: Array<{ organizationId: string; providerId: string }>;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_123" });
    planSyncCalls = [];

    resetDashboardProvidersRouteDependencies();
    dashboardProvidersRouteDependencies.syncPlansToProvider = async (
      _db,
      organizationId,
      adapter,
    ) => {
      planSyncCalls.push({ organizationId, providerId: adapter.id });
      return { synced: [], failed: [], skipped: 0 };
    };

    app = createRouteTestApp(providersRoute, {
      db: businessDb.db,
      organizationId: "org_123",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetDashboardProvidersRouteDependencies();
    businessDb.close();
  });

  it("rejects Stripe environment mismatches before making a network call", async () => {
    const recorder = createFetchRecorder([]);
    globalThis.fetch = recorder.fetch as typeof globalThis.fetch;

    const response = await app.request(
      "/accounts",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          providerId: "stripe",
          environment: "live",
          credentials: { secretKey: "sk_test_123" },
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Stripe live environment requires an sk_live_ secret key",
    });
    expect(recorder.calls).toEqual([]);

    const accounts = await businessDb.db.query.providerAccounts.findMany({
      where: eq(schema.providerAccounts.organizationId, "org_123"),
    });
    expect(accounts).toHaveLength(0);
  });

  it("preflights provider validation without creating a provider account", async () => {
    const recorder = createFetchRecorder([
      new Response(JSON.stringify({ livemode: false }), { status: 200 }),
    ]);
    globalThis.fetch = recorder.fetch as typeof globalThis.fetch;

    const response = await app.request(
      "/validate",
      {
        method: "POST",
        body: JSON.stringify({
          providerId: "stripe",
          environment: "test",
          credentials: { secretKey: "sk_test_123" },
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.validation.status).toBe("verified");

    const accounts = await businessDb.db.query.providerAccounts.findMany({
      where: eq(schema.providerAccounts.organizationId, "org_123"),
    });
    expect(accounts).toHaveLength(0);
    expect(planSyncCalls).toEqual([]);
  });

  it("creates a Stripe account only after a successful authenticated verification", async () => {
    const recorder = createFetchRecorder([
      new Response(JSON.stringify({ livemode: false }), { status: 200 }),
    ]);
    globalThis.fetch = recorder.fetch as typeof globalThis.fetch;

    const response = await app.request(
      "/accounts",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          providerId: "stripe",
          environment: "test",
          credentials: {
            secretKey: " sk_test_123 ",
            publishableKey: "pk_test_123",
            webhookSecret: "whsec_123",
          },
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.validation.status).toBe("verified");
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]?.url).toBe("https://api.stripe.com/v1/balance");
    expect(recorder.calls[0]?.init?.headers).toEqual({
      Authorization: "Bearer sk_test_123",
    });

    const accounts = await businessDb.db.query.providerAccounts.findMany({
      where: eq(schema.providerAccounts.organizationId, "org_123"),
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.credentials.publishableKey).toBe("pk_test_123");
    expect(accounts[0]?.credentials.secretKey).not.toBe("sk_test_123");
    expect(accounts[0]?.credentials.webhookSecret).not.toBe("whsec_123");
    expect(accounts[0]?.metadata).toMatchObject({
      providerValidation: {
        status: "verified",
        verificationLevel: "authentication_and_environment",
      },
    });
    expect(
      await decrypt(
        accounts[0]?.credentials.secretKey as string,
        env.ENCRYPTION_KEY,
      ),
    ).toBe("sk_test_123");
    expect(
      await decrypt(
        accounts[0]?.credentials.webhookSecret as string,
        env.ENCRYPTION_KEY,
      ),
    ).toBe("whsec_123");
    expect(planSyncCalls).toEqual([
      { organizationId: "org_123", providerId: "stripe" },
    ]);
  });

  it("merges incoming updates with existing encrypted credentials before validating", async () => {
    const encryptedSecretKey = await encrypt(
      "sk_test_existing",
      env.ENCRYPTION_KEY,
    );
    await businessDb.d1
      .prepare(
        `INSERT INTO provider_accounts
         (id, organization_id, provider_id, environment, display_name, credentials, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "acct_existing",
        "org_123",
        "stripe",
        "test",
        "Stripe Test",
        JSON.stringify({
          secretKey: encryptedSecretKey,
          webhookSecret: "whsec_existing",
        }),
        JSON.stringify({ retained: true }),
        1000,
        2000,
      )
      .run();

    const recorder = createFetchRecorder([
      new Response(JSON.stringify({ livemode: false }), { status: 200 }),
    ]);
    globalThis.fetch = recorder.fetch as typeof globalThis.fetch;

    const response = await app.request(
      "/accounts/acct_existing",
      {
        method: "PATCH",
        body: JSON.stringify({
          organizationId: "org_123",
          credentials: {
            publishableKey: "pk_test_updated",
          },
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(recorder.calls[0]?.init?.headers).toEqual({
      Authorization: "Bearer sk_test_existing",
    });

    const updated = await businessDb.db.query.providerAccounts.findFirst({
      where: eq(schema.providerAccounts.id, "acct_existing"),
    });
    expect(updated?.credentials).toMatchObject({
      secretKey: encryptedSecretKey,
      webhookSecret: "whsec_existing",
      publishableKey: "pk_test_updated",
    });
    expect(updated?.metadata).toMatchObject({
      retained: true,
      providerValidation: {
        status: "verified",
      },
    });
  });

  it("rejects Dodo Payments keys when the provider denies authentication", async () => {
    const recorder = createFetchRecorder([
      new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 }),
    ]);
    globalThis.fetch = recorder.fetch as typeof globalThis.fetch;

    const response = await app.request(
      "/accounts",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          providerId: "dodopayments",
          environment: "test",
          credentials: { secretKey: "dodo_test_invalid" },
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error:
        "Dodo Payments rejected the test API key: Unauthorized. Make sure the key belongs to the test environment selected in Owostack.",
    });

    const accounts = await businessDb.db.query.providerAccounts.findMany({
      where: eq(schema.providerAccounts.organizationId, "org_123"),
    });
    expect(accounts).toHaveLength(0);
  });

  it("rejects Polar tokens that are missing required resource permissions", async () => {
    const recorder = createFetchRecorder([
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
      new Response(JSON.stringify({ detail: "Forbidden" }), { status: 403 }),
    ]);
    globalThis.fetch = recorder.fetch as typeof globalThis.fetch;

    const response = await app.request(
      "/accounts",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          providerId: "polar",
          environment: "test",
          credentials: { secretKey: "polar_token" },
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Polar token is missing permission for customers: Forbidden",
    });

    const accounts = await businessDb.db.query.providerAccounts.findMany({
      where: eq(schema.providerAccounts.organizationId, "org_123"),
    });
    expect(accounts).toHaveLength(0);
  });
});
