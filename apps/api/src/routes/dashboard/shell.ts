import { Hono } from "hono";
import { eq, or } from "drizzle-orm";
import { schema } from "@owostack/db";
import { auth } from "../../lib/auth";
import { resolveOrganizationId } from "../../lib/organization-resolver";
import type { Env, Variables } from "../../index";

export type DashboardShellDependencies = {
  getSession: (
    env: Env,
    headers: Headers,
  ) => Promise<
    | {
        user: Variables["user"];
        session: Variables["session"];
      }
    | null
  >;
  resolveOrganizationId: typeof resolveOrganizationId;
};

const defaultDependencies: DashboardShellDependencies = {
  getSession: (env, headers) =>
    auth(env).api.getSession({
      headers,
    }),
  resolveOrganizationId,
};

export function createDashboardShell(
  overrides: Partial<DashboardShellDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...overrides };
  const dashboardRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

  dashboardRoutes.use("*", async (c, next) => {
    const session = await deps.getSession(c.env, c.req.raw.headers);

    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("user", session.user);
    c.set("session", session.session);

    let organizationId: string | undefined;
    organizationId = c.req.query("organizationId");
    if (!organizationId && ["POST", "PATCH", "PUT"].includes(c.req.method)) {
      try {
        const body = await c.req.json();
        organizationId = body?.organizationId;
      } catch {}
    }

    if (organizationId) {
      const db = c.get("db");
      const authDb = c.get("authDb");

      const authOrg = await authDb.query.organizations.findFirst({
        where: or(
          eq(schema.organizations.id, organizationId),
          eq(schema.organizations.slug, organizationId),
        ),
      });
      const resolvedId =
        authOrg?.id ?? (await deps.resolveOrganizationId(db, organizationId));
      const finalOrgId = resolvedId || organizationId;

      c.set("organizationId", finalOrgId);

      const existing = await db.query.organizations.findFirst({
        where: eq(schema.organizations.id, finalOrgId),
        columns: { id: true },
      });
      if (!existing) {
        const org =
          authOrg ??
          (await authDb.query.organizations.findFirst({
            where: eq(schema.organizations.id, finalOrgId),
          }));
        if (org) {
          await db.insert(schema.organizations).values(org).onConflictDoNothing();
        }
      }
    }

    return await next();
  });

  return dashboardRoutes;
}
