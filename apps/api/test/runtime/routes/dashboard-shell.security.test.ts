import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardShell } from "../../../src/routes/dashboard/shell";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { insertOrganization } from "../helpers/workflow-runtime";

describe("Dashboard shell runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<
    typeof createRouteTestApp<{ db: any; authDb: any }>
  >;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_owned" });
    await insertOrganization(businessDb.d1, { id: "org_other" });

    const dashboardApp = createDashboardShell({
      getSession: async () => ({
        user: { id: "user_1" } as any,
        session: {
          id: "session_1",
          activeOrganizationId: "org_owned",
        } as any,
      }),
      getAccessibleOrganization: async (_env, _headers, identifier) =>
        identifier === "org_owned" ? { id: "org_owned" } : null,
    });
    dashboardApp.get("/ping", (c) =>
      c.json({ organizationId: c.get("organizationId") }),
    );

    app = createRouteTestApp(dashboardApp, {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  it("allows requests for organizations the session user belongs to", async () => {
    const response = await app.request("/ping?organizationId=org_owned");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ organizationId: "org_owned" });
  });

  it("rejects requests for organizations the session user does not belong to", async () => {
    const response = await app.request("/ping?organizationId=org_other");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("falls back to a Better Auth organization lookup when no active org is set", async () => {
    const dashboardApp = createDashboardShell({
      getSession: async () => ({
        user: { id: "user_1" } as any,
        session: { id: "session_1" } as any,
      }),
      getAccessibleOrganization: async (_env, _headers, identifier) =>
        identifier === "org_owned" ? { id: "org_owned" } : null,
    });
    dashboardApp.get("/ping", (c) =>
      c.json({ organizationId: c.get("organizationId") }),
    );

    const fallbackApp = createRouteTestApp(dashboardApp, {
      db: businessDb.db,
      authDb: businessDb.db,
    });

    const response = await fallbackApp.request("/ping?organizationId=org_owned");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ organizationId: "org_owned" });
  });

  it("rejects requests when the session active org differs from the requested org", async () => {
    const dashboardApp = createDashboardShell({
      getSession: async () => ({
        user: { id: "user_1" } as any,
        session: {
          id: "session_1",
          activeOrganizationId: "org_other",
        } as any,
      }),
      getAccessibleOrganization: async (_env, _headers, identifier) =>
        identifier === "org_owned" ? { id: "org_owned" } : null,
    });
    dashboardApp.get("/ping", (c) =>
      c.json({ organizationId: c.get("organizationId") }),
    );

    const overrideApp = createRouteTestApp(dashboardApp, {
      db: businessDb.db,
      authDb: businessDb.db,
    });

    const response = await overrideApp.request("/ping?organizationId=org_owned");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });
});
