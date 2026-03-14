import { Hono } from "hono";
import { cors } from "hono/cors";
import { createDb, schema } from "@owostack/db";
import { eq } from "drizzle-orm";
import { type User } from "better-auth";
import { auth } from "./lib/auth";
import { trackHttpMetric } from "./lib/analytics-engine";

// Route modules
import healthRoute from "./routes/health";
import { createDashboardShell } from "./routes/dashboard/shell";
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
import dashboardEntitlementOverrides from "./routes/dashboard/entitlement-overrides";
import apiCheckout from "./routes/api/checkout";
import apiEntitlements from "./routes/api/entitlements";
import apiAddon from "./routes/api/addon";
import apiBilling from "./routes/api/billing";
import apiSync from "./routes/api/sync";
import apiWallet from "./routes/api/wallet";
import apiPlans from "./routes/api/plans";
import apiCustomers from "./routes/api/customers";
import apiCreditSystems from "./routes/api/credit-systems";
import apiCreditPacks from "./routes/api/credit-packs";
import apiSubscriptions from "./routes/api/subscriptions";
import webhooksRoute from "./routes/webhooks";
import cliAuth from "./routes/cli-auth";

// Durable Objects
import { UsageMeterDO } from "./lib/usage-meter";
import { UsageLedgerDO } from "./lib/usage-ledger-do";
export { UsageMeterDO, UsageLedgerDO };

// Workflows
import { TrialEndWorkflow } from "./lib/workflows/trial-end";
import { DowngradeWorkflow } from "./lib/workflows/downgrade";
import { PlanUpgradeWorkflow } from "./lib/workflows/plan-upgrade";
import { RenewalSetupRetryWorkflow } from "./lib/workflows/renewal-setup-retry";
import { OverageBillingWorkflow } from "./lib/workflows/overage-billing";
import { CancelDowngradeWorkflow } from "./lib/workflows/cancel-downgrade";
export {
  TrialEndWorkflow,
  DowngradeWorkflow,
  PlanUpgradeWorkflow,
  RenewalSetupRetryWorkflow,
  OverageBillingWorkflow,
  CancelDowngradeWorkflow,
};

export type Env = {
  DB: D1Database; // Per-environment business data (customers, plans, subs, etc.)
  DB_AUTH: D1Database; // Shared auth data (users, sessions, orgs)
  CACHE: KVNamespace; // Per-environment cache
  CACHE_SHARED: KVNamespace; // Shared cache across all environments (CLI auth, etc.)
  ANALYTICS?: AnalyticsEngineDataset; // Optional Cloudflare Analytics Engine dataset
  // Cloudflare Data Platform (Pipelines + R2 SQL) — enabled only when USE_EVENTS_PIPELINE is true
  EVENTS_PIPELINE?: { send(records: Record<string, unknown>[]): Promise<void> };
  R2_SQL_TOKEN?: string; // API token for R2 SQL queries
  R2_WAREHOUSE?: string; // R2 Data Catalog warehouse ID
  USAGE_METER: DurableObjectNamespace<UsageMeterDO>;
  USAGE_LEDGER?: DurableObjectNamespace<UsageLedgerDO>;
  TRIAL_END_WORKFLOW: Workflow;
  DOWNGRADE_WORKFLOW: Workflow;
  PLAN_UPGRADE_WORKFLOW: Workflow;
  RENEWAL_SETUP_WORKFLOW: Workflow;
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
  USE_EVENTS_PIPELINE?: string; // Explicit opt-in for Cloudflare Pipelines reads/writes
  ENABLED_PROVIDERS?: string; // Comma-separated list of enabled provider IDs, e.g. "paystack,stripe,dodopayments"
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

app.route("/", healthRoute);

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
        "https://simulator.owostack.com",
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
const dashboardRoutes = createDashboardShell();

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
dashboardRoutes.route("/entitlement-overrides", dashboardEntitlementOverrides);
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
app.route("/", webhooksRoute);

// =============================================================================
// Scheduled (Cron) — Periodic Overage Billing
// Runs on a cron trigger, finds orgs with matching billing intervals,
// and kicks off OverageBillingWorkflow for each customer with active subs.
// =============================================================================

interface OverageBillingQueueMessage {
  organizationId: string;
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

    // Only the daily cron dispatches overage billing.
    if (event.cron !== "0 0 * * *") {
      console.log(
        `[CRON] Ignoring non-daily overage cron ${event.cron}; daily period-end dispatch is the canonical lane.`,
      );
      return;
    }

    try {
      const dueOrgs = await env.DB.prepare(
        `SELECT DISTINCT c.organization_id AS organization_id
         FROM subscriptions s
         INNER JOIN customers c ON c.id = s.customer_id
         WHERE s.status = 'active'
           AND s.current_period_end <= ?`,
      )
        .bind(event.scheduledTime)
        .all<{ organization_id: string }>();

      const orgs = dueOrgs.results || [];
      console.log(
        `[CRON] Found ${orgs.length} orgs with due subscriptions for period-end overage billing, enqueuing...`,
      );

      const messages: { body: OverageBillingQueueMessage }[] = orgs.map(
        (org) => ({
          body: {
            organizationId: org.organization_id,
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
    for (const msg of batch.messages) {
      const { organizationId, scheduledTime } = msg.body;
      try {
        const due = await env.DB.prepare(
          `SELECT DISTINCT s.customer_id AS id
           FROM subscriptions s
           INNER JOIN customers c ON c.id = s.customer_id
           WHERE c.organization_id = ?
             AND s.status = 'active'
             AND s.current_period_end <= ?`,
        )
          .bind(organizationId, scheduledTime)
          .all<{ id: string }>();

        const uniqueIds = (due.results || []).map((row) => row.id);
        const trigger = "period_end" as const;

        console.log(
          `[QUEUE] Org ${organizationId}: dispatching ${uniqueIds.length} workflows (trigger=${trigger})`,
        );

        // Dispatch in parallel batches
        const BATCH_SIZE = 50;
        for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
          const chunk = uniqueIds.slice(i, i + BATCH_SIZE);
          await Promise.allSettled(
            chunk.map((customerId) =>
              env.OVERAGE_BILLING_WORKFLOW.create({
                id: `overage-period-end-${customerId}-${scheduledTime}`,
                params: {
                  organizationId,
                  customerId,
                  trigger,
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
