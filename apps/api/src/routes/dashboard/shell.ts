import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { auth } from "../../lib/auth";
import type { Env, Variables } from "../../index";

export type DashboardShellDependencies = {
  getSession: (
    env: Env,
    headers: Headers,
  ) => Promise<{
    user: Variables["user"];
    session: Variables["session"];
  } | null>;
  getAccessibleOrganization: (
    env: Env,
    headers: Headers,
    identifier: string,
  ) => Promise<{ id: string } | null>;
};

const defaultDependencies: DashboardShellDependencies = {
  getSession: (env, headers) =>
    auth(env).api.getSession({
      headers,
    }),
  getAccessibleOrganization: async (env, headers, identifier) => {
    const authApi = auth(env).api as any;

    const organizations = await authApi.listOrganizations?.({
      headers,
    });

    if (!Array.isArray(organizations)) {
      return null;
    }

    const organization = organizations.find(
      (org: { id: string; slug?: string | null }) =>
        org.id === identifier || org.slug === identifier,
    );

    return organization?.id ? { id: organization.id } : null;
  },
};

export function createDashboardShell(
  overrides: Partial<DashboardShellDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...overrides };
  const dashboardRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

  dashboardRoutes.use("*", async (c, next) => {
    const authResult = await deps.getSession(c.env, c.req.raw.headers);

    if (!authResult) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!authResult.user || !authResult.session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("user", authResult.user);
    c.set("session", authResult.session);

    const activeOrganizationId =
      authResult.session.activeOrganizationId ||
      authResult.session.organizationId;

    let requestedOrganizationId: string | undefined;
    requestedOrganizationId = c.req.query("organizationId");
    if (
      !requestedOrganizationId &&
      ["POST", "PATCH", "PUT"].includes(c.req.method)
    ) {
      try {
        const body = await c.req.json();
        requestedOrganizationId = body?.organizationId;
      } catch {}
    }

    const authDb = c.get("authDb");
    const db = c.get("db");
    let organizationId = activeOrganizationId;

    if (requestedOrganizationId) {
      if (activeOrganizationId) {
        if (requestedOrganizationId !== activeOrganizationId) {
          const activeOrganization = await authDb.query.organizations.findFirst({
            where: eq(schema.organizations.id, activeOrganizationId),
            columns: { id: true, slug: true },
          });

          if (
            !activeOrganization ||
            requestedOrganizationId !== activeOrganization.slug
          ) {
            return c.json({ error: "Forbidden" }, 403);
          }
        }
      } else {
        const requestedOrganization = await deps.getAccessibleOrganization(
          c.env,
          c.req.raw.headers,
          requestedOrganizationId,
        );

        if (!requestedOrganization) {
          return c.json({ error: "Forbidden" }, 403);
        }

        organizationId = requestedOrganization.id;
      }
    }

    if (!organizationId) {
      return c.json({ error: "No active organization" }, 403);
    }

    const existing = await db.query.organizations.findFirst({
      where: eq(schema.organizations.id, organizationId),
      columns: { id: true },
    });

    if (!existing) {
      const authOrg = await authDb.query.organizations.findFirst({
        where: eq(schema.organizations.id, organizationId),
      });

      if (authOrg) {
        await db
          .insert(schema.organizations)
          .values(authOrg)
          .onConflictDoNothing();
      }
    }

    c.set("organizationId", organizationId);

    return await next();
  });

  return dashboardRoutes;
}
