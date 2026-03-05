import { Hono } from "hono";
import { cors } from "hono/cors";
import { createDb, schema } from "@owostack/db";
import { eq, and, or } from "drizzle-orm";
import { type User } from "better-auth";
import { auth } from "./lib/auth";
import { resolveOrganizationId } from "./lib/organization-resolver";
import { WebhookHandler } from "./lib/webhooks";
import { WebhookError, errorToResponse } from "./lib/errors";
import { decrypt } from "./lib/encryption";
import { trackHttpMetric } from "./lib/analytics-engine";

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
import apiWallet from "./routes/api/wallet";
import apiPlans from "./routes/api/plans";
import apiCustomers from "./routes/api/customers";
import apiCreditSystems from "./routes/api/credit-systems";
import apiCreditPacks from "./routes/api/credit-packs";
import apiSubscriptions from "./routes/api/subscriptions";
import cliAuth from "./routes/cli-auth";

// Durable Objects
import { UsageMeterDO } from "./lib/usage-meter";
import { UsageLedgerDO } from "./lib/usage-ledger-do";
export { UsageMeterDO, UsageLedgerDO };

// Workflows
import { TrialEndWorkflow } from "./lib/workflows/trial-end";
import { DowngradeWorkflow } from "./lib/workflows/downgrade";
import { PlanUpgradeWorkflow } from "./lib/workflows/plan-upgrade";
import { OverageBillingWorkflow } from "./lib/workflows/overage-billing";
import { CancelDowngradeWorkflow } from "./lib/workflows/cancel-downgrade";
export {
  TrialEndWorkflow,
  DowngradeWorkflow,
  PlanUpgradeWorkflow,
  OverageBillingWorkflow,
  CancelDowngradeWorkflow,
};

export type Env = {
  DB: D1Database; // Per-environment business data (customers, plans, subs, etc.)
  DB_AUTH: D1Database; // Shared auth data (users, sessions, orgs)
  CACHE: KVNamespace; // Per-environment cache
  CACHE_SHARED: KVNamespace; // Shared cache across all environments (CLI auth, etc.)
  ANALYTICS?: AnalyticsEngineDataset; // Optional Cloudflare Analytics Engine dataset
  // Cloudflare Data Platform (Pipelines + R2 SQL) — when present, preferred over AE
  EVENTS_PIPELINE?: { send(records: Record<string, unknown>[]): Promise<void> };
  R2_SQL_TOKEN?: string; // API token for R2 SQL queries
  R2_WAREHOUSE?: string; // R2 Data Catalog warehouse ID
  USAGE_METER: DurableObjectNamespace<UsageMeterDO>;
  USAGE_LEDGER?: DurableObjectNamespace<UsageLedgerDO>;
  TRIAL_END_WORKFLOW: Workflow;
  DOWNGRADE_WORKFLOW: Workflow;
  PLAN_UPGRADE_WORKFLOW: Workflow;
  CANCEL_DOWNGRADE_WORKFLOW: Workflow;
  OVERAGE_BILLING_WORKFLOW: Workflow;
  OVERAGE_BILLING_QUEUE: Queue;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  ENCRYPTION_KEY: string;
  ENVIRONMENT?: string; // "test" | "live" | "development" — set per worker deployment
  CF_ACCOUNT_ID?: string; // Cloudflare account ID — used for Analytics Engine & R2 SQL
  CF_ANALYTICS_READ_TOKEN?: string; // API token with Analytics:Read for SQL queries
  ANALYTICS_DATASET?: string; // Optional override dataset name for SQL reads
  ENABLED_PROVIDERS?: string; // Comma-separated list of enabled provider IDs, e.g. "paystack,dodopayments,polar"
  PAYSTACK_SECRET_KEY: string;
  PAYSTACK_WEBHOOK_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  DASHBOARD_URL?: string; // URL for redirects (e.g., after OAuth)
  RESEND_API_KEY?: string;
};

export type Variables = {
  db: ReturnType<typeof createDb>; // Business DB (per-environment)
  authDb: ReturnType<typeof createDb>; // Auth DB (shared across environments)
  user: User | null;
  session: any | null;
  token: any | null;
  organizationId?: string; // Set by API key auth middleware
};

export const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.onError((err, c) => {
  console.error("[GLOBAL] Unhandled error:", err?.message, err?.stack);
  return c.json(
    { success: false, error: err?.message || "Internal server error" },
    500,
  );
});

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

// Lightweight request analytics for capacity planning and debugging.
app.use("*", async (c, next) => {
  const start = Date.now();
  let threw = false;

  try {
    await next();
  } catch (error) {
    threw = true;
    throw error;
  } finally {
    const webhookMatch = c.req.path.match(
      /^\/webhooks\/([^/]+)(?:\/([^/]+))?$/,
    );
    let organizationId: string | null = null;

    try {
      organizationId = (c.get("organizationId") as string | undefined) ?? null;
    } catch {
      organizationId = null;
    }

    organizationId =
      organizationId ||
      c.req.query("organizationId") ||
      webhookMatch?.[1] ||
      null;
    const providerId = webhookMatch ? webhookMatch[2] || "paystack" : null;

    trackHttpMetric(c.env, {
      method: c.req.method,
      path: c.req.path,
      status: c.res?.status ?? (threw ? 500 : 0),
      durationMs: Date.now() - start,
      organizationId,
      providerId,
    });
  }
});

app.get("/api/organizations/slug-check/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!slug || slug.length < 3) {
    return c.json({ available: false, error: "Invalid slug" });
  }

  const authDb = c.get("authDb");
  const existing = await authDb.query.organizations.findFirst({
    where: eq(schema.organizations.slug, slug),
    columns: { id: true },
  });

  return c.json({ available: !existing });
});

app.get("/api/auth/debug-routes", (c) => {
  const routes = Object.keys(auth(c.env).api);
  return c.json({ routes });
});

// CLI Authentication Routes (must be BEFORE Better Auth wildcard)
app.route("/api/auth/cli", cliAuth);

// Auth Routes (Better Auth)
app.on(["POST", "GET"], "/api/auth/*", (c) => {
  console.log(`[AUTH-DEBUG] ${c.req.method} ${c.req.url}`);
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

    // Resolve organization identifier (could be ID or slug)
    const resolvedId = await resolveOrganizationId(db, organizationId);
    const finalOrgId = resolvedId || organizationId;

    // Store resolved ID in context for downstream handlers
    c.set("organizationId", finalOrgId);

    const existing = await db.query.organizations.findFirst({
      where: eq(schema.organizations.id, finalOrgId),
      columns: { id: true },
    });
    if (!existing) {
      const org = await authDb.query.organizations.findFirst({
        where: eq(schema.organizations.id, finalOrgId),
      });
      if (org) {
        await db.insert(schema.organizations).values(org).onConflictDoNothing();
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
// IMPORTANT: Mount specific routes BEFORE generic ones (e.g., customers has auth middleware on "*")
v1Routes.route("/subscriptions", apiSubscriptions); // Public GET /activate must come before customers
v1Routes.route("/", apiCheckout);
v1Routes.route("/", apiEntitlements);
v1Routes.route("/", apiAddon);
v1Routes.route("/billing", apiBilling);
v1Routes.route("/sync", apiSync);
v1Routes.route("/", apiWallet);
v1Routes.route("/plans", apiPlans);
v1Routes.route("/", apiCustomers);
v1Routes.route("/credit-systems", apiCreditSystems);
v1Routes.route("/credit-packs", apiCreditPacks);

apiRoutes.route("/v1", v1Routes);

app.route("/api", apiRoutes);

// Backward-compatible public API mount (some clients/tests still call `/v1/*`)
app.route("/v1", v1Routes);

// =============================================================================
// Webhooks — provider-agnostic
// POST /webhooks/:organizationId/:provider  (e.g. /webhooks/org123/paystack)
// POST /webhooks/:organizationId            (backward compat — defaults to paystack)
// =============================================================================

async function handleWebhookRequest(
  c: any,
  organizationId: string,
  providerId: string,
) {
  const maskSecretForLog = (value: string | null | undefined) => {
    if (!value) return "<empty>";
    if (value.length <= 10) return `${value.slice(0, 2)}***`;
    return `${value.slice(0, 6)}...${value.slice(-4)} (len=${value.length})`;
  };

  console.log(
    `[WEBHOOK-ROUTE] Received webhook for org=${organizationId}, provider=${providerId}`,
  );

  // 1. Resolve adapter from registry
  const adapter = providerRegistry.get(providerId);
  if (!adapter) {
    console.error(`[WEBHOOK-ROUTE] Unknown provider: ${providerId}`);
    return c.json({ error: `Unsupported provider: ${providerId}` }, 400);
  }

  // 2. Get the signature from the provider-specific header
  const sigHeader = adapter.signatureHeaderName || `x-${providerId}-signature`;
  const signature = c.req.header(sigHeader);
  console.log(
    `[WEBHOOK-ROUTE] Signature header=${sigHeader}, hasSignature=${!!signature}`,
  );

  if (!signature) {
    return c.json(
      errorToResponse(new WebhookError({ reason: "missing_signature" })),
      401,
    );
  }

  const rawBody = await c.req.text();
  const db = c.get("db");
  const authDb = c.get("authDb");

  // 3. Resolve organization from auth DB to get webhook secrets
  const org = await authDb.query.organizations.findFirst({
    where: or(
      eq(schema.organizations.id, organizationId),
      eq(schema.organizations.slug, organizationId),
    ),
  });

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  // Ensure organization row exists in billing DB for FK constraints
  const existingOrgInBilling = await db.query.organizations.findFirst({
    where: or(
      eq(schema.organizations.id, organizationId),
      eq(schema.organizations.slug, organizationId),
    ),
    columns: { id: true },
  });

  if (!existingOrgInBilling) {
    await db.insert(schema.organizations).values(org).onConflictDoNothing();
  }

  // 4. Resolve the webhook secret for this provider
  const workerEnv = c.env.ENVIRONMENT === "live" ? "live" : "test";
  let secret: string | null = null;
  let secretSource: string | null = null;

  // 4a. Check provider account credentials for a webhook-specific secret
  // (e.g. Dodo Payments uses a separate webhookSecret, not the API key)
  const allProviderAccounts = await db.query.providerAccounts.findMany({
    where: and(
      eq(schema.providerAccounts.organizationId, org.id),
      eq(schema.providerAccounts.providerId, providerId),
    ),
  });
  const providerAccounts = allProviderAccounts.filter((pa: any) => {
    const env = pa?.environment;
    return !env || env === workerEnv;
  });

  const scopedProviderAccounts =
    providerAccounts.length > 0 ? providerAccounts : allProviderAccounts;
  let secretAccountId: string | null = null;
  for (const pa of scopedProviderAccounts) {
    const creds = (pa as any).credentials || {};
    // Fallback to secretKey for Paystack if webhookSecret isn't explicitly set
    const potentialSecret =
      creds.webhookSecret ||
      (providerId === "paystack" ? creds.secretKey : null);

    if (typeof potentialSecret === "string" && potentialSecret.length > 0) {
      try {
        secret = (await decrypt(potentialSecret, c.env.ENCRYPTION_KEY)).trim();
        secretSource = creds.webhookSecret
          ? "provider_account_webhook_secret_encrypted"
          : "provider_account_api_key_encrypted";
        secretAccountId = pa.id;
        console.log(
          `[WEBHOOK-ROUTE] Using provider account secret (${secretSource}) for org=${organizationId}, provider=${providerId}`,
        );
      } catch (e) {
        console.warn(`[WEBHOOK-ROUTE] Failed to decrypt provider secret:`, e);
        // Backward compatibility: older rows may have been stored as plaintext.
        secret = potentialSecret.trim();
        secretSource = creds.webhookSecret
          ? "provider_account_webhook_secret_plaintext"
          : "provider_account_api_key_plaintext";
        secretAccountId = pa.id;
        console.warn(
          `[WEBHOOK-ROUTE] Falling back to raw provider secret for org=${organizationId}, provider=${providerId}`,
        );
      }
      break;
    }
  }

  // 4b. Fallback: organization-level webhookSecret
  if (!secret) {
    const orgWebhookSecret =
      workerEnv === "live" ? org.liveWebhookSecret : org.testWebhookSecret;
    secret = orgWebhookSecret || org.webhookSecret; // Use specific env or deprecated global field
    if (secret) {
      secretSource = "organization_webhook_secret";
    }
  }

  // 4c. Fallback: organization API secret key (if relevant for this provider)
  if (!secret) {
    const encryptedKey =
      workerEnv === "live" ? org.liveSecretKey : org.testSecretKey;
    if (encryptedKey) {
      try {
        secret = (await decrypt(encryptedKey, c.env.ENCRYPTION_KEY)).trim();
        secretSource = `organization_${workerEnv}_secret_key_encrypted`;
        console.log(
          `[WEBHOOK-ROUTE] No webhookSecret, falling back to ${workerEnv} secret key for org=${organizationId}`,
        );
      } catch (e) {
        console.error(
          `[WEBHOOK-ROUTE] Failed to decrypt key for verification:`,
          e,
        );
        // Backward compatibility
        secret = encryptedKey.trim();
        secretSource = `organization_${workerEnv}_secret_key_plaintext`;
      }
    }
  }

  if (!secret) {
    console.error(
      `[WEBHOOK-ROUTE] No secret available for org=${organizationId}, provider=${providerId}`,
    );
    return c.json({ error: "Webhook secret not configured" }, 500);
  }

  // 5. Verify signature via adapter
  // Pass all request headers so providers using Standard Webhooks (e.g. Dodo)
  // can access webhook-id, webhook-timestamp, etc.
  const reqHeaders: Record<string, string> = {};
  c.req.raw.headers.forEach((value: string, key: string) => {
    reqHeaders[key.toLowerCase()] = value;
  });

  const verifyResult = await adapter.verifyWebhook({
    signature,
    payload: rawBody,
    secret,
    headers: reqHeaders,
  });

  if (verifyResult.isErr() || !verifyResult.value) {
    console.error(
      `[WEBHOOK-ROUTE] Signature verification FAILED for org=${organizationId}, provider=${providerId}`,
    );
    if (providerId === "polar") {
      console.error("[WEBHOOK-ROUTE] Polar verification context", {
        org: organizationId,
        provider: providerId,
        workerEnv,
        secretSource,
        secretAccountId,
        providerAccountsTotal: allProviderAccounts.length,
        providerAccountsScoped: scopedProviderAccounts.length,
        secretPreview: maskSecretForLog(secret),
        signatureHeaderPresent: !!signature,
        signatureHeaderPreview: maskSecretForLog(signature),
        webhookId: reqHeaders["webhook-id"] || null,
        webhookTimestamp: reqHeaders["webhook-timestamp"] || null,
        availableHeaders: Object.keys(reqHeaders),
      });
    }
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
    console.log(
      `[WEBHOOK-ROUTE] Unhandled event from ${providerId}: ${parseResult.error.message}`,
    );
    return c.json({ success: true, received: true, skipped: true });
  }

  const normalizedEvent = parseResult.value;
  console.log(
    `[WEBHOOK-ROUTE] Event: ${normalizedEvent.type}, provider=${normalizedEvent.provider}, ref=${normalizedEvent.payment?.reference || "n/a"}`,
  );

  // 7. Build provider context for API calls (cancel sub, etc.)
  // Provider accounts are loaded from the DB — no legacy fallback.
  let selectedAccount: any | undefined;
  const accountToUse = secretAccountId
    ? scopedProviderAccounts.find((a: any) => a.id === secretAccountId)
    : scopedProviderAccounts.length > 0
      ? scopedProviderAccounts[0]
      : undefined;

  if (accountToUse) {
    const pa = accountToUse as any;
    const creds = { ...(pa.credentials || {}) };
    // Decrypt the secretKey for API calls
    if (typeof creds.secretKey === "string" && creds.secretKey.length > 0) {
      try {
        creds.secretKey = (
          await decrypt(creds.secretKey, c.env.ENCRYPTION_KEY)
        ).trim();
      } catch (e) {
        console.warn(
          `[WEBHOOK-ROUTE] Failed to decrypt provider secretKey for org=${organizationId}:`,
          e,
        );
        creds.secretKey = creds.secretKey.trim();
      }
    }
    selectedAccount = {
      ...pa,
      credentials: creds,
    };
  }

  // 8. Handle via provider-agnostic WebhookHandler
  const handler = new WebhookHandler(db, org.id, {
    adapter,
    account: selectedAccount,
    trialEndWorkflow: c.env.TRIAL_END_WORKFLOW,
    planUpgradeWorkflow: c.env.PLAN_UPGRADE_WORKFLOW,
    cache: c.env.CACHE,
    analyticsEnv: {
      ANALYTICS: c.env.ANALYTICS,
      ENVIRONMENT: c.env.ENVIRONMENT,
    },
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
  return handleWebhookRequest(
    c,
    c.req.param("organizationId"),
    c.req.param("provider"),
  );
});

// =============================================================================
// Scheduled (Cron) — Periodic Overage Billing
// Runs on a cron trigger, finds orgs with matching billing intervals,
// and kicks off OverageBillingWorkflow for each customer with active subs.
// =============================================================================

// Queue message shape for overage billing dispatch
interface OverageBillingQueueMessage {
  organizationId: string;
  targetInterval: string;
  scheduledTime: number;
}

export default {
  fetch: app.fetch,

  // -------------------------------------------------------------------------
  // Cron → enqueue org-level messages (lightweight, stays well within 30s)
  // -------------------------------------------------------------------------
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    console.log(
      `[CRON] Triggered at ${new Date(event.scheduledTime).toISOString()}, cron=${event.cron}`,
    );

    const db = createDb(env.DB);

    // Determine which billing intervals this cron matches
    // Daily cron  → process "daily"
    // Weekly cron → process "weekly"
    // Monthly is handled by end_of_period via subscription renewal webhooks
    let targetInterval: string;
    if (event.cron === "0 0 * * 1") {
      targetInterval = "weekly";
    } else {
      targetInterval = "daily";
    }

    try {
      const orgs = await db
        .select()
        .from((schema as any).overageSettings)
        .where(
          eq((schema as any).overageSettings.billingInterval, targetInterval),
        );

      console.log(
        `[CRON] Found ${orgs.length} orgs with interval=${targetInterval}, enqueuing...`,
      );

      // Enqueue one message per org — the queue consumer handles the heavy lifting
      const messages: { body: OverageBillingQueueMessage }[] = orgs.map(
        (org: any) => ({
          body: {
            organizationId: org.organizationId,
            targetInterval,
            scheduledTime: event.scheduledTime,
          },
        }),
      );

      // Queue.sendBatch accepts up to 100 messages per call
      const QUEUE_BATCH_LIMIT = 100;
      for (let i = 0; i < messages.length; i += QUEUE_BATCH_LIMIT) {
        await env.OVERAGE_BILLING_QUEUE.sendBatch(
          messages.slice(i, i + QUEUE_BATCH_LIMIT),
        );
      }

      console.log(`[CRON] Enqueued ${messages.length} org messages to queue`);
    } catch (e) {
      console.error("[CRON] Overage billing cron failed:", e);
    }
  },

  // -------------------------------------------------------------------------
  // Queue consumer — each message = one org. Query customers, dispatch workflows.
  // Each consumer invocation gets its own 30s CPU budget.
  // -------------------------------------------------------------------------
  async queue(
    batch: MessageBatch<OverageBillingQueueMessage>,
    env: Env,
    _ctx: ExecutionContext,
  ) {
    const db = createDb(env.DB);

    for (const msg of batch.messages) {
      const { organizationId, scheduledTime } = msg.body;
      try {
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
          .where(eq(schema.customers.organizationId, organizationId));

        // Deduplicate — a customer with multiple active subs appears multiple times
        const uniqueIds = [
          ...new Set(customers.map((c: { id: string }) => c.id)),
        ];
        console.log(
          `[QUEUE] Org ${organizationId}: dispatching ${uniqueIds.length} workflows`,
        );

        // Dispatch in parallel batches
        const BATCH_SIZE = 50;
        for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
          const chunk = uniqueIds.slice(i, i + BATCH_SIZE);
          await Promise.allSettled(
            chunk.map((customerId) =>
              env.OVERAGE_BILLING_WORKFLOW.create({
                id: `overage-cron-${customerId}-${scheduledTime}`,
                params: {
                  organizationId,
                  customerId,
                  trigger: "cron" as const,
                },
              }).catch((e) => {
                console.warn(
                  `[QUEUE] Failed to create workflow for customer=${customerId}:`,
                  e,
                );
              }),
            ),
          );
        }

        msg.ack();
      } catch (e) {
        console.error(`[QUEUE] Failed to process org=${organizationId}:`, e);
        msg.retry();
      }
    }
  },
};
