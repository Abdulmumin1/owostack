import { Hono } from "hono";
import { cors } from "hono/cors";
import { createDb } from "@owostack/db";
import { type User } from "better-auth";
import { auth } from "./lib/auth";
import { WebhookHandler } from "./lib/webhooks";
import { WebhookError, errorToResponse } from "./lib/errors";
import { decrypt } from "./lib/encryption";

// Route modules
import dashboardPlans from "./routes/dashboard/plans";
import dashboardKeys from "./routes/dashboard/keys";
import dashboardConfig from "./routes/dashboard/config";
import dashboardFeatures from "./routes/dashboard/features";
import dashboardCustomers from "./routes/dashboard/customers";
import dashboardSubscriptions from "./routes/dashboard/subscriptions";
import dashboardEvents from "./routes/dashboard/events";
import dashboardUsage from "./routes/dashboard/usage";
import dashboardCredits from "./routes/dashboard/credits";
import dashboardTransactions from "./routes/dashboard/transactions";
import apiCheckout from "./routes/api/checkout";
import apiEntitlements from "./routes/api/entitlements";

// Durable Objects
import { UsageMeterDO } from "./lib/usage-meter";
import { SubscriptionSchedulerDO } from "./lib/subscription-scheduler";
export { UsageMeterDO, SubscriptionSchedulerDO };

export type Env = {
  DB: D1Database;           // Per-environment business data (customers, plans, subs, etc.)
  DB_AUTH: D1Database;      // Shared auth data (users, sessions, orgs, projects)
  CACHE: KVNamespace;
  USAGE_METER: DurableObjectNamespace<UsageMeterDO>;
  SUBSCRIPTION_SCHEDULER: DurableObjectNamespace<SubscriptionSchedulerDO>;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  ENCRYPTION_KEY: string;
  ENVIRONMENT?: string; // "test" | "live" | "development" — set per worker deployment
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
        "https://dashboard.owostack.com",
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
        "https://dashboard.owostack.com",
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
dashboardRoutes.route("/", dashboardConfig); // Config module has paths like /paystack-config

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

apiRoutes.route("/v1", v1Routes);

app.route("/api", apiRoutes);

// Backward-compatible public API mount (some clients/tests still call `/v1/*`)
app.route("/v1", v1Routes);

// =============================================================================
// Webhooks
// =============================================================================
app.post("/webhooks/:organizationId", async (c) => {
  const organizationId = c.req.param("organizationId");
  const signature = c.req.header("x-paystack-signature");

  if (!signature) {
    return c.json(
      errorToResponse(new WebhookError({ reason: "missing_signature" })),
      401,
    );
  }

  const rawBody = await c.req.text();
  const db = c.get("db");
  const authDb = c.get("authDb");

  // Projects live in the shared auth DB
  const project = await authDb.query.projects.findFirst({
    where: (projects, { eq }) => eq(projects.organizationId, organizationId),
  });

  if (!project) {
    return c.json({ error: "Organization not found" }, 404);
  }

  let secret = project.webhookSecret;

  // Fallback: If no webhook secret is set, Paystack uses the Secret Key for signature
  if (!secret) {
    const activeEnv = project.activeEnvironment || "test";
    const encryptedKey =
      activeEnv === "live" ? project.liveSecretKey : project.testSecretKey;

    if (encryptedKey) {
      try {
        secret = await decrypt(encryptedKey, c.env.ENCRYPTION_KEY);
      } catch (e) {
        console.error(
          "Failed to decrypt Paystack key for webhook verification",
          e,
        );
      }
    }
  }

  const handler = new WebhookHandler(secret || "", db, organizationId);

  const verifyResult = await handler.verify(signature, rawBody);
  if (verifyResult.isErr()) {
    return c.json(errorToResponse(verifyResult.error), 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json(
      errorToResponse(new WebhookError({ reason: "parse_failed" })),
      400,
    );
  }

  const handleResult = await handler.handle(payload);
  if (handleResult.isErr()) {
    // swallow to always ack (Paystack will retry otherwise)
    console.error("Webhook handling error:", handleResult.error);
  }

  return c.json({ success: true, received: true });
});

export default app;
