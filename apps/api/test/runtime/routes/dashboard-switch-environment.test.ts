import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import dashboardConfig from "../../../src/routes/dashboard/config";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { RUNTIME_ROUTE_ENV } from "../helpers/catalog-runtime";
import {
  insertOrganization,
  insertProviderAccount,
} from "../helpers/workflow-runtime";

/**
 * Environment switching against a real D1. In production the dashboard calls
 * the worker for the *target* environment, so `ENVIRONMENT` in the env passed
 * here is the target worker's environment.
 */

const MANAGED_SECRET = JSON.stringify({
  paystack: { secretKey: "sk_test_owostack_managed" },
});

describe("POST /switch-environment with managed sandbox", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<
    typeof createRouteTestApp<{ db: any; authDb: any; organizationId: string }>
  >;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_switch" });
    app = createRouteTestApp(dashboardConfig, {
      db: businessDb.db,
      authDb: businessDb.db,
      organizationId: "org_switch",
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  function switchTo(environment: "test" | "live", env: Record<string, unknown>) {
    return app.request(
      "/switch-environment",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment }),
      },
      env,
    );
  }

  async function activeEnvironment() {
    const org = await businessDb.db.query.organizations.findFirst({
      where: eq(schema.organizations.id, "org_switch"),
      columns: { metadata: true },
    });
    return (org?.metadata as Record<string, unknown> | null)?.activeEnvironment;
  }

  it("lets an organization with no provider accounts enter sandbox when credentials are managed", async () => {
    const response = await switchTo("test", {
      ...RUNTIME_ROUTE_ENV,
      ENVIRONMENT: "test",
      MANAGED_SANDBOX_PROVIDERS: MANAGED_SECRET,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { activeEnvironment: "test" },
    });
    expect(await activeEnvironment()).toBe("test");
  });

  it("keeps requiring a test provider account when the sandbox worker has no managed credentials", async () => {
    const response = await switchTo("test", {
      ...RUNTIME_ROUTE_ENV,
      ENVIRONMENT: "test",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Test mode not configured. Add a test provider account first.",
    });
    expect(await activeEnvironment()).toBeUndefined();
  });

  it("still requires the organization's own live provider account to go live", async () => {
    const blocked = await switchTo("live", {
      ...RUNTIME_ROUTE_ENV,
      ENVIRONMENT: "live",
      // Even if someone mistakenly set the secret on the live worker.
      MANAGED_SANDBOX_PROVIDERS: MANAGED_SECRET,
    });
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toEqual({
      success: false,
      error: "Live mode not configured. Add a live provider account first.",
    });

    await insertProviderAccount({
      db: businessDb.d1,
      organizationId: "org_switch",
      providerId: "paystack",
      environment: "live",
      secretKey: "sk_live_own",
    });

    const allowed = await switchTo("live", {
      ...RUNTIME_ROUTE_ENV,
      ENVIRONMENT: "live",
    });
    expect(allowed.status).toBe(200);
    expect(await activeEnvironment()).toBe("live");
  });
});
