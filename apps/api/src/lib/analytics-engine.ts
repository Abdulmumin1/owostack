type AnalyticsEnv = {
  ANALYTICS?: AnalyticsEngineDataset;
  ENVIRONMENT?: string;
  CF_ACCOUNT_ID?: string;
  CF_ANALYTICS_READ_TOKEN?: string;
  ANALYTICS_DATASET?: string;
};

/**
 * Result type for analytics queries that distinguishes between:
 * - Success with data
 * - Success with empty results (no events)
 * - Service unavailable (misconfiguration or query failure)
 */
/**
 * Result type for analytics list queries
 */
export type AnalyticsListResult<T> =
  | { success: true; data: T[] }
  | { success: false; error: "unavailable"; message: string };

/**
 * Result type for analytics single item queries
 */
export type AnalyticsItemResult<T> =
  | { success: true; data: T | null }
  | { success: false; error: "unavailable"; message: string };

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

const MAX_BLOB_LENGTH = 128;
const MAX_EVENT_PAYLOAD_BYTES = 12 * 1024;
const DATASET_BY_ENV: Record<string, string> = {
  development: "owostack_api_dev",
  test: "owostack_api_test",
  live: "owostack_api_live",
};
const SAFE_DATASET_RE = /^[A-Za-z0-9_]+$/;

function cleanBlob(
  value: string | null | undefined,
  lower = false,
  maxLength = MAX_BLOB_LENGTH,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const normalized = lower ? trimmed.toLowerCase() : trimmed;
  return normalized.slice(0, maxLength);
}

function cleanNumber(value: number | null | undefined): number {
  return Number.isFinite(value ?? NaN) ? Number(value) : 0;
}

function normalizePath(path: string): string {
  return path
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
      ":uuid",
    )
    .replace(/\/[a-zA-Z0-9_-]{20,}(?=\/|$)/g, "/:id")
    .slice(0, MAX_BLOB_LENGTH);
}

function statusBucket(status: number): string {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  if (status >= 200) return "2xx";
  if (status >= 100) return "1xx";
  return "0xx";
}

function writePoint(env: AnalyticsEnv, point: AnalyticsEngineDataPoint): void {
  if (!env.ANALYTICS) return;

  try {
    env.ANALYTICS.writeDataPoint(point);
  } catch (error) {
    console.warn("[analytics] writeDataPoint failed:", error);
  }
}

function resolveAnalyticsDataset(env: AnalyticsEnv): string | null {
  const configured = cleanBlob(env.ANALYTICS_DATASET);
  if (configured && SAFE_DATASET_RE.test(configured)) return configured;

  const key = cleanBlob(env.ENVIRONMENT || "development", true);
  if (!key) return null;

  const fromMap = DATASET_BY_ENV[key];
  if (!fromMap) return null;
  return SAFE_DATASET_RE.test(fromMap) ? fromMap : null;
}

function parseQueryRows(payload: any): Array<Record<string, unknown>> {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.result?.data)) return payload.result.data;
  if (Array.isArray(payload?.result?.rows)) return payload.result.rows;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload)) return payload;
  return [];
}

function safeJSONStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

export function getAnalyticsDatasetName(env: AnalyticsEnv): string | null {
  return resolveAnalyticsDataset(env);
}

export function analyticsSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function queryAnalyticsSql<T extends Record<string, unknown>>(
  env: AnalyticsEnv,
  query: string,
): Promise<T[] | null> {
  const accountId = cleanBlob(env.CF_ACCOUNT_ID);
  const token = cleanBlob(env.CF_ANALYTICS_READ_TOKEN);
  const dataset = resolveAnalyticsDataset(env);

  if (!accountId || !token || !dataset) return null;

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      body: query,
    });
  } catch (error) {
    console.warn("[analytics] SQL query request failed:", error);
    return null;
  }

  let payload: any = null;
  try {
    payload = await response.json();
  } catch (error) {
    console.warn("[analytics] SQL query parse failed:", error);
    return null;
  }

  if (!response.ok || payload?.success === false) {
    console.warn("[analytics] SQL query failed", {
      status: response.status,
      errors: payload?.errors,
      messages: payload?.messages,
    });
    return null;
  }

  return parseQueryRows(payload) as T[];
}

export function trackHttpMetric(env: AnalyticsEnv, metric: HttpMetric): void {
  if (metric.method === "OPTIONS") return;

  writePoint(env, {
    // Cloudflare currently supports a single index column per data point.
    indexes: ["http.request"],
    doubles: [cleanNumber(metric.durationMs), cleanNumber(metric.status)],
    blobs: [
      cleanBlob(env.ENVIRONMENT || "development", true),
      cleanBlob(metric.method, true),
      cleanBlob(normalizePath(metric.path)),
      cleanBlob(statusBucket(metric.status), true),
      cleanBlob(metric.organizationId ?? null),
      cleanBlob(metric.providerId ?? null, true),
      cleanBlob(String(metric.status), true),
    ],
  });
}

export function trackBusinessEvent(
  env: AnalyticsEnv,
  event: BusinessEvent,
): void {
  writePoint(env, {
    // Cloudflare currently supports a single index column per data point.
    indexes: [cleanBlob(event.event, true) || "unknown"],
    doubles: [cleanNumber(event.value)],
    blobs: [
      cleanBlob(env.ENVIRONMENT || "development", true),
      cleanBlob(event.outcome || "unknown", true),
      cleanBlob(event.organizationId ?? null),
      cleanBlob(event.providerId ?? null, true),
      cleanBlob(event.customerId ?? null),
      cleanBlob(event.currency ?? null, true),
    ],
  });
}

export function trackWebhookEvent(
  env: AnalyticsEnv,
  event: WebhookEventLog,
): void {
  const createdAt = cleanNumber(event.createdAt ?? Date.now());
  const payloadJson = safeJSONStringify(event.payload ?? {});
  const payloadBytes = new TextEncoder().encode(payloadJson).length;
  const payloadBlob =
    payloadBytes > MAX_EVENT_PAYLOAD_BYTES
      ? JSON.stringify({
          _truncated: true,
          _sizeBytes: payloadBytes,
          preview: payloadJson.slice(0, 4000),
        })
      : payloadJson;

  writePoint(env, {
    // Cloudflare currently supports a single index column per data point.
    indexes: [cleanBlob(event.id) || "unknown"],
    doubles: [createdAt],
    blobs: [
      cleanBlob(env.ENVIRONMENT || "development", true),
      "webhook.event",
      cleanBlob(event.organizationId),
      cleanBlob(event.id),
      cleanBlob(event.type, true),
      cleanBlob(event.providerId ?? null, true),
      cleanBlob(event.customerEmail ?? null, true),
      cleanBlob(event.customerId ?? null),
      cleanBlob(String(Boolean(event.processed)), true),
      cleanBlob(payloadBlob, false, MAX_EVENT_PAYLOAD_BYTES),
      cleanBlob(String(payloadBytes > MAX_EVENT_PAYLOAD_BYTES), true),
    ],
  });
}

export function trackUsageEvent(env: AnalyticsEnv, event: UsageEvent): void {
  writePoint(env, {
    indexes: ["usage.record"],
    doubles: [
      cleanNumber(event.amount),
      cleanNumber(event.periodStart),
      cleanNumber(event.periodEnd),
    ],
    blobs: [
      cleanBlob(env.ENVIRONMENT || "development", true),
      "usage.log",
      cleanBlob(event.organizationId),
      cleanBlob(event.featureId),
      cleanBlob(event.customerId),
      cleanBlob(event.entityId ?? null),
      cleanBlob(event.invoiceId ?? null),
    ],
  });
}

export type AnalyticsEventRow = {
  timestamp?: string;
  index1?: string;
  organization_id?: string | null;
  event_id?: string | null;
  event_type?: string | null;
  customer_email?: string | null;
  customer_id?: string | null;
  processed?: string | number | boolean | null;
  payload_json?: string | null;
  created_at_ms?: number | string | null;
};

export type DashboardEvent = {
  id: string;
  organizationId: string;
  type: string;
  customerId: string | null;
  data: Record<string, unknown>;
  processed: boolean;
  createdAt: number;
  customer: {
    id: string | null;
    email: string;
    name: null;
  } | null;
};

function parseProcessed(value: AnalyticsEventRow["processed"]): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function parsePayload(
  value: AnalyticsEventRow["payload_json"],
): Record<string, unknown> {
  if (!value) return {};
  if (typeof value !== "string") {
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : { value };
  }

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { _raw: value };
  }
}

function parseCreatedAt(row: AnalyticsEventRow): number {
  const fromDouble = Number(row.created_at_ms ?? NaN);
  if (Number.isFinite(fromDouble) && fromDouble > 0)
    return Math.floor(fromDouble);

  if (typeof row.timestamp === "string") {
    const fromTimestamp = Date.parse(row.timestamp);
    if (Number.isFinite(fromTimestamp)) return fromTimestamp;
  }

  return Date.now();
}

function toDashboardEvent(
  row: AnalyticsEventRow,
  organizationId: string,
): DashboardEvent {
  const createdAt = parseCreatedAt(row);
  const id = row.event_id || row.index1 || `ae_${organizationId}_${createdAt}`;
  const customerEmail = row.customer_email || null;
  const customerId = row.customer_id || null;

  return {
    id,
    organizationId: row.organization_id || organizationId,
    type: row.event_type || "unknown",
    customerId,
    data: parsePayload(row.payload_json),
    processed: parseProcessed(row.processed),
    createdAt,
    customer: customerEmail
      ? {
          id: customerId,
          email: customerEmail,
          name: null,
        }
      : null,
  };
}

export async function listRecentEvents(
  env: AnalyticsEnv,
  opts: {
    organizationId?: string | null;
    customerId?: string | null;
    limit?: number;
    offset?: number;
  },
): Promise<AnalyticsListResult<DashboardEvent>> {
  const dataset = getAnalyticsDatasetName(env);
  if (!dataset) {
    return {
      success: false,
      error: "unavailable",
      message: "Analytics dataset not configured",
    };
  }

  const limit = Math.min(opts.limit || 20, 100);
  const offset = Math.max(opts.offset || 0, 0);

  let where = "blob2 = 'webhook.event'";
  if (opts.organizationId) {
    where += ` AND blob3 = ${analyticsSqlString(opts.organizationId)}`;
  }
  if (opts.customerId) {
    where += ` AND blob8 = ${analyticsSqlString(opts.customerId)}`;
  }

  const query = `
    SELECT
      timestamp,
      index1,
      blob3 AS organization_id,
      blob4 AS event_id,
      blob5 AS event_type,
      blob7 AS customer_email,
      blob8 AS customer_id,
      blob9 AS processed,
      blob10 AS payload_json,
      double1 AS created_at_ms
    FROM ${dataset}
    WHERE ${where}
    ORDER BY timestamp DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const rows = await queryAnalyticsSql<AnalyticsEventRow>(env, query);
  if (!rows) {
    return {
      success: false,
      error: "unavailable",
      message: "Analytics query failed or service unavailable",
    };
  }

  const events = rows.map((row) =>
    toDashboardEvent(
      row,
      opts.organizationId || row.organization_id || "unknown",
    ),
  );

  return { success: true, data: events };
}

export async function getEventById(
  env: AnalyticsEnv,
  id: string,
  organizationId?: string,
): Promise<AnalyticsItemResult<DashboardEvent>> {
  const dataset = getAnalyticsDatasetName(env);
  if (!dataset) {
    return {
      success: false,
      error: "unavailable",
      message: "Analytics dataset not configured",
    };
  }

  let where = `blob2 = 'webhook.event' AND blob4 = ${analyticsSqlString(id)}`;
  if (organizationId) {
    where += ` AND blob3 = ${analyticsSqlString(organizationId)}`;
  }

  const query = `
    SELECT
      timestamp,
      index1,
      blob3 AS organization_id,
      blob4 AS event_id,
      blob5 AS event_type,
      blob7 AS customer_email,
      blob8 AS customer_id,
      blob9 AS processed,
      blob10 AS payload_json,
      double1 AS created_at_ms
    FROM ${dataset}
    WHERE ${where}
    ORDER BY timestamp DESC
    LIMIT 1
  `;

  const rows = await queryAnalyticsSql<AnalyticsEventRow>(env, query);
  if (!rows) {
    return {
      success: false,
      error: "unavailable",
      message: "Analytics query failed or service unavailable",
    };
  }

  if (rows.length === 0) {
    return { success: true, data: null };
  }

  const event = toDashboardEvent(
    rows[0],
    organizationId || rows[0].organization_id || "unknown",
  );

  return { success: true, data: event };
}
