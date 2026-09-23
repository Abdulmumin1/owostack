import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@owostack/db";
import { eq } from "drizzle-orm";
import dashboardKeysRoute from "../../../src/routes/dashboard/keys";
import { createDashboardShell } from "../../../src/routes/dashboard/shell";
import { verifyApiKey } from "../../../src/lib/api-keys";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { insertOrganization } from "../helpers/workflow-runtime";
import { RUNTIME_ROUTE_ENV } from "../helpers/catalog-runtime";

describe("Dashboard API key issuance", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<typeof createRouteTestApp<{ db: any; authDb: any }>>;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_123", slug: "acme" });

    // The Better Auth session is the only external boundary here.
    const dashboard = createDashboardShell({
      getSession: async () => ({
        user: { id: "user_123" } as any,
        session: { id: "session_123" },
      }),
    });
    dashboard.route("/keys", dashboardKeysRoute);
    app = createRouteTestApp(dashboard, {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  async function createKey(body: Record<string, unknown>) {
    return app.request(
      "/keys",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      RUNTIME_ROUTE_ENV,
    );
  }

  it("issues environment-scoped keys and persists the scope", async () => {
    const liveRes = await createKey({
      organizationId: "acme",
      name: "Production",
      environment: "live",
    });
    expect(liveRes.status).toBe(200);
    const live = await liveRes.json();
    expect(live.data.secretKey).toMatch(/^owo_sk_live_[0-9a-f]{48}$/);
    expect(live.data.environment).toBe("live");
    expect(live.data.prefix).toBe("owo_sk_live_");

    const sandboxRes = await createKey({
      organizationId: "org_123",
      name: "Local dev",
      environment: "test",
    });
    expect(sandboxRes.status).toBe(200);
    const sandbox = await sandboxRes.json();
    expect(sandbox.data.secretKey).toMatch(/^owo_sk_test_[0-9a-f]{48}$/);

    const rows = await businessDb.db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.organizationId, "org_123"));
    expect(rows.map((row) => row.environment).sort()).toEqual(["live", "test"]);
    // Only the hash is stored.
    expect(rows.some((row) => row.hash === live.data.secretKey)).toBe(false);

    // The issued key authenticates and reports its scope.
    await expect(
      verifyApiKey(businessDb.db, live.data.secretKey),
    ).resolves.toMatchObject({
      organizationId: "org_123",
      environment: "live",
    });
  });

  it("refuses to issue a key without an explicit environment", async () => {
    const res = await createKey({ organizationId: "org_123", name: "Oops" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("environment");

    const rows = await businessDb.db.select().from(schema.apiKeys);
    expect(rows).toHaveLength(0);
  });

  it("lists the environment alongside each key", async () => {
    await createKey({
      organizationId: "org_123",
      name: "A",
      environment: "test",
    });
    await createKey({
      organizationId: "org_123",
      name: "B",
      environment: "live",
    });

    const res = await app.request(
      "/keys?organizationId=org_123",
      { method: "GET" },
      RUNTIME_ROUTE_ENV,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    for (const key of body.data) {
      expect(["test", "live"]).toContain(key.environment);
      expect(key).not.toHaveProperty("hash");
    }
  });
});
