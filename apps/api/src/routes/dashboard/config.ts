import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import type { Env, Variables } from "../../index";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Get active environment
app.get("/config/active-environment", async (c) => {
  const organizationId = c.get("organizationId");
  if (!organizationId) {
    return c.json({ success: false, error: "Organization ID required" }, 400);
  }

  const authDb = c.get("authDb");
  const project = await authDb.query.projects.findFirst({
    where: eq(schema.projects.organizationId, organizationId),
    columns: { activeEnvironment: true },
  });

  return c.json({
    success: true,
    data: {
      activeEnvironment: project?.activeEnvironment || "test",
    },
  });
});

// Switch active environment
app.post("/switch-environment", async (c) => {
  const body = c.get("parsedBody") ?? (await c.req.json());
  const { organizationId, environment } = body;

  if (!organizationId || !["test", "live"].includes(environment)) {
    return c.json({ success: false, error: "Invalid parameters" }, 400);
  }

  const authDb = c.get("authDb");
  const db = c.get("db");
  const [project] = await authDb
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, organizationId))
    .limit(1);

  if (!project) {
    return c.json({ success: false, error: "Project not found" }, 404);
  }

  // Check if target environment is configured via provider accounts
  const providerAccount = await db.query.providerAccounts.findFirst({
    where: and(
      eq(schema.providerAccounts.organizationId, organizationId),
      eq(schema.providerAccounts.environment, environment),
    ),
  });

  if (!providerAccount) {
    return c.json(
      {
        success: false,
        error:
          environment === "live"
            ? "Live mode not configured. Add a live provider account first."
            : "Test mode not configured. Add a test provider account first.",
      },
      400,
    );
  }

  // Update active environment
  await authDb
    .update(schema.projects)
    .set({ activeEnvironment: environment, updatedAt: new Date().getTime() })
    .where(eq(schema.projects.id, project.id));

  return c.json({
    success: true,
    data: { activeEnvironment: environment },
  });
});

// Get org default currency
app.get("/config/default-currency", async (c) => {
  const organizationId = c.get("organizationId");
  if (!organizationId) {
    return c.json({ success: false, error: "Organization ID required" }, 400);
  }

  const db = c.get("db");
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, organizationId),
    columns: { metadata: true },
  });

  const metadata = (org?.metadata as Record<string, unknown>) || {};
  let currency = metadata.defaultCurrency as string | undefined;

  // Smart default: infer from the org's first plan if not explicitly set
  if (!currency) {
    const firstPlan = await db.query.plans.findFirst({
      where: eq(schema.plans.organizationId, organizationId),
      columns: { currency: true },
    });
    currency = firstPlan?.currency || "USD";
  }

  return c.json({
    success: true,
    data: { defaultCurrency: currency },
  });
});

// Update org default currency
app.put("/config/default-currency", async (c) => {
  const body = c.get("parsedBody") ?? (await c.req.json());
  const { organizationId, defaultCurrency } = body;

  if (!organizationId || !defaultCurrency) {
    return c.json(
      { success: false, error: "organizationId and defaultCurrency required" },
      400,
    );
  }

  if (
    typeof defaultCurrency !== "string" ||
    defaultCurrency.length < 3 ||
    defaultCurrency.length > 3
  ) {
    return c.json(
      { success: false, error: "Currency must be a 3-letter ISO 4217 code" },
      400,
    );
  }

  const db = c.get("db");
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, organizationId),
    columns: { metadata: true },
  });

  if (!org) {
    return c.json({ success: false, error: "Organization not found" }, 404);
  }

  const existingMetadata = (org.metadata as Record<string, unknown>) || {};
  const newMetadata = {
    ...existingMetadata,
    defaultCurrency: defaultCurrency.toUpperCase(),
  };

  await db
    .update(schema.organizations)
    .set({ metadata: newMetadata })
    .where(eq(schema.organizations.id, organizationId));

  return c.json({
    success: true,
    data: { defaultCurrency: defaultCurrency.toUpperCase() },
  });
});

export default app;
