import { Hono } from "hono";
import { cors } from "hono/cors";
import { createDb, schema } from "@owostack/db";
import { eq, and } from "drizzle-orm";
import { type User } from "better-auth";
import { auth } from "./lib/auth";
import { WebhookHandler } from "./lib/webhooks";
import { WebhookError, errorToResponse } from "./lib/errors";
import { decrypt } from "./lib/encryption";
import type { ProviderAccount } from "@owostack/adapters";
import { getProviderRegistry } from "./lib/providers";

// Provider registry — single source of truth in lib/providers.ts
const providerRegistry = getProviderRegistry();

// Route modules
import dashboardPlans from "./routes/dashboard/plans";
import dashboardKeys from "./routes/dashboard/keys";
import dashboardConfig from "./routes/dashboard/config";
import dashboardCatalog from "./routes/dashboard/catalog";
import dashboardFeatures from "./routes/dashboard/features";
import dashboardCustomers from "./routes/dashboard/customers";
import dashboardSubscriptions from "./routes/dashboard/subscriptions";
import dashboardEvents from "./routes/dashboard/events";
import dashboardUsage from "./routes/dashboard/usage";
import dashboardCredits from "./routes/dashboard/credits";
import dashboardTransactions from "./routes/dashboard/transactions";
import dashboardProviders from "./routes/dashboard/providers";
import dashboardCreditPacks from "./routes/dashboard/credit-packs";
import dashboardOverageSettings from "./routes/dashboard/overage-settings";
import apiCheckout from "./routes/api/checkout";
import apiEntitlements from "./routes/api/entitlements";
import apiBilling from "./routes/api/billing";
import apiAddon from "./routes/api/addon";
import apiSync from "./routes/api/sync";

// Durable Objects
import { UsageMeterDO } from "./lib/usage-meter";
export { UsageMeterDO };

// Workflows
import { TrialEndWorkflow } from "./lib/workflows/trial-end";
import { DowngradeWorkflow } from "./lib/workflows/downgrade";
import { PlanUpgradeWorkflow } from "./lib/workflows/plan-upgrade";
import { OverageBillingWorkflow } from "./lib/workflows/overage-billing";
export { TrialEndWorkflow, DowngradeWorkflow, PlanUpgradeWorkflow, OverageBillingWorkflow };

export type Env = {
  DB: D1Database;           // Per-environment business data (customers, plans, subs, etc.)
  DB_AUTH: D1Database;      // Shared auth data (users, sessions, orgs, projects)
  CACHE: KVNamespace;
  USAGE_METER: DurableObjectNamespace<UsageMeterDO>;
  TRIAL_END_WORKFLOW: Workflow;
  DOWNGRADE_WORKFLOW: Workflow;
  PLAN_UPGRADE_WORKFLOW: Workflow;
  OVERAGE_BILLING_WORKFLOW: Workflow;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  ENCRYPTION_KEY: string;
  ENVIRONMENT?: string; // "test" | "live" | "development" — set per worker deployment
  ENABLED_PROVIDERS?: string; // Comma-separated list of enabled provider IDs, e.g. "paystack" or "paystack,stripe"
  PAYSTACK_SECRET_KEY: string;
  PAYSTACK_WEBHOOK_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export type Variables = {
  db: ReturnType<typeof createDb>;     // Business DB (per-environment)
  authDb: ReturnType<typeof createDb>; // Auth DB (shared across environments)
  user: User | null;
  session: any | null;
  token: any | null;
  organizationId?: string; // Set by API key auth middleware
};

export const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get("/", (c) => {
  return c.json({ status: "healthy" });
});

// Dynamic CORS for credentials mode
app.use(
  "*",
  cors({
    origin: (origin) => {
      // Allow requests from localhost during development
      const allowedOrigins = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://localhost:4173",
        "https://dash.owostack.com",
        "https://app.owostack.com",
        "https://owostack.com",
      ];
      if (origin ) {
        return origin;
      }
      // Fallback for non-browser requests (e.g., Postman)
      return null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

// Middleware to inject DBs
// DB = per-environment business data, DB_AUTH = shared auth data
// In local dev DB_AUTH may not be bound — fall back to DB
app.use("*", async (c, next) => {
  const db = createDb(c.env.DB);
  const authDb = createDb(c.env.DB_AUTH ?? c.env.DB);
  c.set("db", db);
  c.set("authDb", authDb);
  await next();
});

// Auth Routes (Better Auth)
app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return auth(c.env).handler(c.req.raw);
});

// =============================================================================
// Dashboard Routes (Protected by Better Auth Session)
// =============================================================================
const dashboardRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();


dashboardRoutes.use(
  "*",
  cors({
    origin: (origin) => {
      // Allow requests from localhost during development
       const allowedOrigins = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://localhost:4173",
        "https://dash.owostack.com",
        "https://app.owostack.com",
        "https://owostack.com",
      ];
      if (origin && allowedOrigins.includes(origin)) {
        return origin;
      }
      // Fallback for non-browser requests (e.g., Postman)
      return null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

dashboardRoutes.use("*", async (c, next) => {
  const session = await auth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("user", session.user);
  c.set("session", session.session);

  // Sync organization to billing DB so FK constraints work.
  // Organizations are created by Better Auth in DB_AUTH; billing
  // tables in DB reference organizations via FK.
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
    const existing = await db.query.organizations.findFirst({
      where: eq(schema.organizations.id, organizationId),
      columns: { id: true },
    });
    if (!existing) {
      const org = await authDb.query.organizations.findFirst({
        where: eq(schema.organizations.id, organizationId),
      });
      if (org) {
        await db
          .insert(schema.organizations)
          .values(org)
          .onConflictDoNothing();
      }
    }
  }

  return await next();
});

// Mount modular dashboard routes
// Note: These modules define keys like post('/') or post('/keys').
// If I mount `dashboardKeys` at `/keys`, then `post('/')` in `keys.ts` becomes `post('/keys')` relative to `dashboardRoutes`.
// `dashboardRoutes` is mounted at `/api/dashboard`.
// So final path: `/api/dashboard/keys`

dashboardRoutes.route("/plans", dashboardPlans);
dashboardRoutes.route("/keys", dashboardKeys);
dashboardRoutes.route("/features", dashboardFeatures);
dashboardRoutes.route("/customers", dashboardCustomers);
dashboardRoutes.route("/subscriptions", dashboardSubscriptions);
dashboardRoutes.route("/events", dashboardEvents);
dashboardRoutes.route("/usage", dashboardUsage);
dashboardRoutes.route("/credits", dashboardCredits);
dashboardRoutes.route("/transactions", dashboardTransactions);
dashboardRoutes.route("/providers", dashboardProviders);
dashboardRoutes.route("/credit-packs", dashboardCreditPacks);
dashboardRoutes.route("/overage-settings", dashboardOverageSettings);
dashboardRoutes.route("/catalog", dashboardCatalog);
dashboardRoutes.route("/", dashboardConfig);

app.route("/api/dashboard", dashboardRoutes);

// =============================================================================
// Public API Routes (v1)
// =============================================================================
const apiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const v1Routes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Mount API modules
// checkout.ts has `post('/attach')`.
// entitlements.ts has `post('/check')` and `post('/track')`.
v1Routes.route("/", apiCheckout);
v1Routes.route("/", apiEntitlements);
v1Routes.route("/", apiAddon);
v1Routes.route("/billing", apiBilling);
v1Routes.route("/sync", apiSync);

apiRoutes.route("/v1", v1Routes);

app.route("/api", apiRoutes);

// Backward-compatible public API mount (some clients/tests still call `/v1/*`)
app.route("/v1", v1Routes);

// =============================================================================
// Webhooks — provider-agnostic
// POST /webhooks/:organizationId/:provider  (e.g. /webhooks/org123/paystack)
// POST /webhooks/:organizationId            (backward compat — defaults to paystack)
// =============================================================================

async function handleWebhookRequest(c: any, organizationId: string, providerId: string) {
  console.log(`[WEBHOOK-ROUTE] Received webhook for org=${organizationId}, provider=${providerId}`);

  // 1. Resolve adapter from registry
  const adapter = providerRegistry.get(providerId);
  if (!adapter) {
    console.error(`[WEBHOOK-ROUTE] Unknown provider: ${providerId}`);
    return c.json({ error: `Unsupported provider: ${providerId}` }, 400);
  }

  // 2. Get the signature from the provider-specific header
  const sigHeader = adapter.signatureHeaderName || `x-${providerId}-signature`;
  const signature = c.req.header(sigHeader);
  console.log(`[WEBHOOK-ROUTE] Signature header=${sigHeader}, hasSignature=${!!signature}`);

  if (!signature) {
    return c.json(
      errorToResponse(new WebhookError({ reason: "missing_signature" })),
      401,
    );
  }

  const rawBody = await c.req.text();
  const db = c.get("db");
  const authDb = c.get("authDb");

  // 3. Ensure organization row exists in billing DB
  const existingOrg = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, organizationId),
    columns: { id: true },
  });
  if (!existingOrg) {
    const org = await authDb.query.organizations.findFirst({
      where: eq(schema.organizations.id, organizationId),
    });
    if (org) {
      await db.insert(schema.organizations).values(org).onConflictDoNothing();
    }
  }

  // 4. Resolve the webhook secret for this provider
  const project = await authDb.query.projects.findFirst({
    where: (projects, { eq }) => eq(projects.organizationId, organizationId),
  });

  if (!project) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const workerEnv = c.env.ENVIRONMENT === "live" ? "live" : "test";
  let secret: string | null = null;

  // 4a. Check provider account credentials for a webhook-specific secret
  // (e.g. Dodo Payments uses a separate webhookSecret, not the API key)
  const providerAccounts = await db.query.providerAccounts.findMany({
    where: and(
      eq(schema.providerAccounts.organizationId, organizationId),
      eq(schema.providerAccounts.providerId, providerId),
    ),
  });
  for (const pa of providerAccounts) {
    const creds = (pa as any).credentials || {};
    if (typeof creds.webhookSecret === "string" && creds.webhookSecret.length > 0) {
      try {
        secret = await decrypt(creds.webhookSecret, c.env.ENCRYPTION_KEY);
        console.log(`[WEBHOOK-ROUTE] Using provider account webhookSecret for org=${organizationId}, provider=${providerId}`);
      } catch (e) {
        console.warn(`[WEBHOOK-ROUTE] Failed to decrypt provider webhookSecret:`, e);
      }
      break;
    }
  }

  // 4b. Fallback: project-level webhookSecret
  if (!secret) {
    secret = project.webhookSecret;
  }

  // 4c. Fallback: provider API secret key (e.g. Paystack uses this for HMAC)
  if (!secret) {
    const encryptedKey =
      workerEnv === "live" ? project.liveSecretKey : project.testSecretKey;
    console.log(`[WEBHOOK-ROUTE] No webhookSecret, falling back to ${workerEnv} secret key (hasKey=${!!encryptedKey})`);

    if (encryptedKey) {
      try {
        secret = await decrypt(encryptedKey, c.env.ENCRYPTION_KEY);
      } catch (e) {
        console.error(`[WEBHOOK-ROUTE] Failed to decrypt key for verification:`, e);
      }
    }
  }

  if (!secret) {
    console.error(`[WEBHOOK-ROUTE] No secret available for org=${organizationId}, provider=${providerId}`);
    return c.json({ error: "Webhook secret not configured" }, 500);
  }

  // 5. Verify signature via adapter
  // Pass all request headers so providers using Standard Webhooks (e.g. Dodo)
  // can access webhook-id, webhook-timestamp, etc.
  const reqHeaders: Record<string, string> = {};
  c.req.raw.headers.forEach((value: string, key: string) => {
    reqHeaders[key] = value;
  });

  const verifyResult = await adapter.verifyWebhook({
    signature,
    payload: rawBody,
    secret,
    headers: reqHeaders,
  });

  if (verifyResult.isErr() || !verifyResult.value) {
    console.error(`[WEBHOOK-ROUTE] Signature verification FAILED for org=${organizationId}, provider=${providerId}`);
    return c.json(
      errorToResponse(new WebhookError({ reason: "invalid_signature" })),
      401,
    );
  }
  console.log(`[WEBHOOK-ROUTE] Signature verified for org=${organizationId}`);

  // 6. Parse raw payload → normalized event via adapter
  let rawPayload: Record<string, unknown>;
  try {
    rawPayload = JSON.parse(rawBody);
  } catch {
    return c.json(
      errorToResponse(new WebhookError({ reason: "parse_failed" })),
      400,
    );
  }

  const parseResult = adapter.parseWebhookEvent({ payload: rawPayload });
  if (parseResult.isErr()) {
    // Unknown events are not errors — just ACK them
    console.log(`[WEBHOOK-ROUTE] Unhandled event from ${providerId}: ${parseResult.error.message}`);
    return c.json({ success: true, received: true, skipped: true });
  }

  const normalizedEvent = parseResult.value;
  console.log(`[WEBHOOK-ROUTE] Event: ${normalizedEvent.type}, provider=${normalizedEvent.provider}, ref=${normalizedEvent.payment?.reference || "n/a"}`);

  // 7. Build provider account for API calls (cancel sub, etc.)
  // Prefer a real provider account from the DB (already loaded above for webhookSecret).
  // Fall back to a synthetic account from project-level keys (Paystack legacy).
  let providerAccount: ProviderAccount | undefined;
  if (providerAccounts.length > 0) {
    const pa = providerAccounts[0] as any;
    const creds = { ...(pa.credentials || {}) };
    // Decrypt the secretKey for API calls
    if (typeof creds.secretKey === "string" && creds.secretKey.length > 0) {
      try {
        creds.secretKey = await decrypt(creds.secretKey, c.env.ENCRYPTION_KEY);
      } catch (e) {
        console.warn(`[WEBHOOK-ROUTE] Failed to decrypt provider secretKey:`, e);
      }
    }
    providerAccount = {
      id: pa.id,
      organizationId: pa.organizationId,
      providerId: pa.providerId,
      environment: pa.environment || workerEnv,
      displayName: pa.displayName,
      credentials: creds,
      metadata: pa.metadata,
      createdAt: pa.createdAt,
      updatedAt: pa.updatedAt,
    };
  } else {
    // Legacy fallback: build synthetic account from project-level keys
    const encKey = workerEnv === "live" ? project.liveSecretKey : project.testSecretKey;
    if (encKey) {
      try {
        const apiSecretKey = await decrypt(encKey, c.env.ENCRYPTION_KEY);
        providerAccount = {
          id: `webhook-${organizationId}`,
          organizationId,
          providerId,
          environment: workerEnv,
          credentials: { secretKey: apiSecretKey },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      } catch { /* already logged above */ }
    }
  }

  // 8. Handle via provider-agnostic WebhookHandler
  const handler = new WebhookHandler(db, organizationId, {
    adapter,
    account: providerAccount,
    trialEndWorkflow: c.env.TRIAL_END_WORKFLOW,
    planUpgradeWorkflow: c.env.PLAN_UPGRADE_WORKFLOW,
    cache: c.env.CACHE,
  });

  const handleResult = await handler.handle(normalizedEvent);
  if (handleResult.isErr()) {
    console.error("Webhook handling error:", handleResult.error);
  }

  return c.json({ success: true, received: true });
}

// Backward compat: /webhooks/:orgId → defaults to paystack
app.post("/webhooks/:organizationId", async (c) => {
  return handleWebhookRequest(c, c.req.param("organizationId"), "paystack");
});

// Provider-agnostic: /webhooks/:orgId/:provider
app.post("/webhooks/:organizationId/:provider", async (c) => {
  return handleWebhookRequest(c, c.req.param("organizationId"), c.req.param("provider"));
});

// =============================================================================
// Scheduled (Cron) — Periodic Overage Billing
// Runs on a cron trigger, finds orgs with matching billing intervals,
// and kicks off OverageBillingWorkflow for each customer with active subs.
// =============================================================================

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    console.log(`[CRON] Triggered at ${new Date(event.scheduledTime).toISOString()}, cron=${event.cron}`);

    const db = createDb(env.DB);

    // Determine which billing intervals this cron matches
    // Daily cron  → process "daily"
    // Weekly cron → process "weekly"
    // Monthly is handled by end_of_period via subscription renewal webhooks
    let targetInterval: string;
    if (event.cron === "0 0 * * 1") {
      targetInterval = "weekly";
    } else {
      // Daily cron or any other → process "daily"
      targetInterval = "daily";
    }

    try {
      // Find all orgs with this billing interval
      const orgs = await db
        .select()
        .from((schema as any).overageSettings)
        .where(eq((schema as any).overageSettings.billingInterval, targetInterval));

      console.log(`[CRON] Found ${orgs.length} orgs with interval=${targetInterval}`);

      for (const org of orgs) {
        // Find all customers with active subscriptions in this org
        const customers = await db
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .innerJoin(
            schema.subscriptions,
            and(
              eq(schema.subscriptions.customerId, schema.customers.id),
              eq(schema.subscriptions.status, "active"),
            ),
          )
          .where(eq(schema.customers.organizationId, (org as any).organizationId));

        for (const customer of customers) {
          try {
            await env.OVERAGE_BILLING_WORKFLOW.create({
              id: `overage-cron-${customer.id}-${event.scheduledTime}`,
              params: {
                organizationId: (org as any).organizationId,
                customerId: customer.id,
                trigger: "cron",
              },
            });
          } catch (e) {
            // Duplicate workflow ID is fine (idempotent)
            console.warn(`[CRON] Failed to create workflow for customer=${customer.id}:`, e);
          }
        }
      }
    } catch (e) {
      console.error("[CRON] Overage billing cron failed:", e);
    }
  },
};
