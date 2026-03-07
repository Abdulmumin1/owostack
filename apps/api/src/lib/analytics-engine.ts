/**
 * Compatibility layer — delegates to @owostack/analytics EventStore.
 *
 * All consumers continue to import the same function names from this module.
 * Under the hood we create an EventStore backed by Analytics Engine (current)
 * or Cloudflare Pipelines (when EVENTS_PIPELINE binding is present).
 *
 * To migrate to the Data Platform, simply add the Pipeline binding in
 * wrangler.jsonc — no consumer code changes needed.
 */
import {
  createEventStore,
  type EventStore,
  type DashboardEvent,
  type ListResult,
  type ItemResult,
} from "@owostack/analytics";

// Re-export result types so existing consumers don't break
export type {
  DashboardEvent,
  ListResult as AnalyticsListResult,
  ItemResult as AnalyticsItemResult,
};

// ---------------------------------------------------------------------------
// Env type accepted by all public functions (superset of both backends)
// ---------------------------------------------------------------------------

type AnalyticsEnv = {
  ANALYTICS?: AnalyticsEngineDataset;
  ENVIRONMENT?: string;
  CF_ACCOUNT_ID?: string;
  CF_ANALYTICS_READ_TOKEN?: string;
  ANALYTICS_DATASET?: string;
  // Pipeline backend (Cloudflare Data Platform)
  EVENTS_PIPELINE?: { send(records: Record<string, unknown>[]): Promise<void> };
  R2_SQL_TOKEN?: string;
  R2_WAREHOUSE?: string;
};

// ---------------------------------------------------------------------------
// Lazy-cached store per environment config hash!
// ---------------------------------------------------------------------------

const storeCache = new WeakMap<object, EventStore>();

function getStore(env: AnalyticsEnv): EventStore {
  // Use the env object itself as the cache key (stable per request lifecycle)
  let store = storeCache.get(env as object);
  if (store) return store;

  if (env.EVENTS_PIPELINE) {
    store = createEventStore({
      backend: "pipeline",
      pipeline: env.EVENTS_PIPELINE,
      environment: env.ENVIRONMENT,
      accountId: env.CF_ACCOUNT_ID,
      apiToken: env.R2_SQL_TOKEN,
      warehouse: env.R2_WAREHOUSE,
    });
  } else {
    store = createEventStore({
      backend: "analytics-engine",
      dataset: env.ANALYTICS,
      environment: env.ENVIRONMENT,
      accountId: env.CF_ACCOUNT_ID,
      apiToken: env.CF_ANALYTICS_READ_TOKEN,
      datasetName: env.ANALYTICS_DATASET,
    });
  }

  storeCache.set(env as object, store);
  return store;
}

// ---------------------------------------------------------------------------
// Event shapes accepted by consumers (unchanged from before)
// ---------------------------------------------------------------------------

export type UsageEvent = {
  customerId: string;
  featureId: string;
  amount: number;
  organizationId: string;
  periodStart: number;
  periodEnd: number;
  entityId?: string | null;
  invoiceId?: string | null;
};

type HttpMetric = {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  organizationId?: string | null;
  providerId?: string | null;
};

type BusinessEvent = {
  event: string;
  outcome?: string | null;
  organizationId?: string | null;
  providerId?: string | null;
  customerId?: string | null;
  currency?: string | null;
  value?: number | null;
};

type WebhookEventLog = {
  id: string;
  organizationId: string;
  type: string;
  providerId?: string | null;
  customerEmail?: string | null;
  customerId?: string | null;
  processed?: boolean | null;
  payload?: Record<string, unknown> | null;
  createdAt?: number | null;
};

// ---------------------------------------------------------------------------
// Public API — drop-in replacements for the old functions
// ---------------------------------------------------------------------------

export function trackHttpMetric(env: AnalyticsEnv, metric: HttpMetric): void {
  getStore(env).trackHttpRequest(metric);
}

export function trackBusinessEvent(
  env: AnalyticsEnv,
  event: BusinessEvent,
): void {
  getStore(env).trackBusiness(event);
}

export function trackUsageEvent(env: AnalyticsEnv, event: UsageEvent): void {
  getStore(env).trackUsage(event);
}

export function trackWebhookEvent(
  env: AnalyticsEnv,
  event: WebhookEventLog,
): void {
  getStore(env).trackWebhook({
    id: event.id,
    organizationId: event.organizationId,
    eventType: event.type,
    providerId: event.providerId,
    customerEmail: event.customerEmail,
    customerId: event.customerId,
    processed: Boolean(event.processed),
    payload: event.payload ?? {},
    createdAt: event.createdAt ?? Date.now(),
  });
}

export async function listRecentEvents(
  env: AnalyticsEnv,
  opts: {
    organizationId?: string | null;
    customerId?: string | null;
    limit?: number;
    offset?: number;
  },
): Promise<ListResult<DashboardEvent>> {
  return getStore(env).listWebhookEvents(opts);
}

export async function getEventById(
  env: AnalyticsEnv,
  id: string,
  organizationId?: string,
): Promise<ItemResult<DashboardEvent>> {
  return getStore(env).getWebhookEventById(id, organizationId);
}
