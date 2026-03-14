import { Hono } from "hono";
import { and, eq, or } from "drizzle-orm";
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
  const org = await authDb.query.organizations.findFirst({
    where: or(
      eq(schema.organizations.id, organizationId),
      eq(schema.organizations.slug, organizationId),
    ),
    columns: { metadata: true },
  });

  const metadata = (org?.metadata as Record<string, unknown>) || {};
  const activeEnvironment = metadata.activeEnvironment || "test";

  return c.json({
    success: true,
    data: {
      activeEnvironment,
    },
  });
});

// Switch active environment
app.post("/switch-environment", async (c) => {
  const body = await c.req.json();
  const { environment } = body;
  const organizationId = c.get("organizationId") ?? body.organizationId;

  if (!organizationId || !["test", "live"].includes(environment)) {
    return c.json({ success: false, error: "Invalid parameters" }, 400);
  }

  const db = c.get("db");
  const authDb = c.get("authDb");

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

  // Get current metadata from authDb
  const org = await authDb.query.organizations.findFirst({
    where: or(
      eq(schema.organizations.id, organizationId),
      eq(schema.organizations.slug, organizationId),
    ),
    columns: { metadata: true },
  });

  if (!org) {
    return c.json({ success: false, error: "Organization not found" }, 404);
  }

  // Update active environment in metadata via authDb
  const existingMetadata = (org.metadata as Record<string, unknown>) || {};
  const newMetadata = {
    ...existingMetadata,
    activeEnvironment: environment,
  };

  await authDb
    .update(schema.organizations)
    .set({ metadata: newMetadata })
    .where(
      or(
        eq(schema.organizations.id, organizationId),
        eq(schema.organizations.slug, organizationId),
      ),
    );

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
  const authDb = c.get("authDb");

  // Organizations are in authDb
  const org = await authDb.query.organizations.findFirst({
    where: or(
      eq(schema.organizations.id, organizationId),
      eq(schema.organizations.slug, organizationId),
    ),
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
  const body = await c.req.json();
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

  // Organizations are in authDb, not business db
  const authDb = c.get("authDb");
  const org = await authDb.query.organizations.findFirst({
    where: or(
      eq(schema.organizations.id, organizationId),
      eq(schema.organizations.slug, organizationId),
    ),
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

  await authDb
    .update(schema.organizations)
    .set({ metadata: newMetadata })
    .where(
      or(
        eq(schema.organizations.id, organizationId),
        eq(schema.organizations.slug, organizationId),
      ),
    );

  return c.json({
    success: true,
    data: { defaultCurrency: defaultCurrency.toUpperCase() },
  });
});

export default app;
