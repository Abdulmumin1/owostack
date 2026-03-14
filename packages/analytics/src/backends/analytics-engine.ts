import type {
  EventStore,
  HttpRequestEvent,
  BusinessEvent,
  UsageEvent,
  WebhookEvent,
  DashboardEvent,
  ListEventsOpts,
  ListResult,
  ItemResult,
  AnalyticsEngineConfig,
} from "../types";

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

function safeJSONStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

interface AnalyticsEventRow {
  [key: string]: unknown;
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
}

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
      ? { id: customerId, email: customerEmail, name: null }
      : null,
  };
}

function parseQueryRows(payload: unknown): Array<Record<string, unknown>> {
  const p = payload as Record<string, unknown> | null | undefined;
  if (Array.isArray(p)) return p as Array<Record<string, unknown>>;
  if (!p || typeof p !== "object") return [];
  if (Array.isArray(p.data)) return p.data as Array<Record<string, unknown>>;
  const result = p.result;
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r.data)) return r.data as Array<Record<string, unknown>>;
    if (Array.isArray(r.rows)) return r.rows as Array<Record<string, unknown>>;
  }
  if (Array.isArray(p.rows)) return p.rows as Array<Record<string, unknown>>;
  return [];
}

export class AnalyticsEngineStore implements EventStore {
  private dataset: AnalyticsEngineDataset | undefined;
  private environment: string;
  private accountId: string | null;
  private apiToken: string | null;
  private datasetName: string | null;

  constructor(config: AnalyticsEngineConfig) {
    this.dataset = config.dataset;
    this.environment = config.environment || "development";
    this.accountId = config.accountId || null;
    this.apiToken = config.apiToken || null;
    this.datasetName = config.datasetName || null;
  }

  private writePoint(point: AnalyticsEngineDataPoint): void {
    if (!this.dataset) return;
    try {
      this.dataset.writeDataPoint(point);
    } catch (error) {
      console.warn("[analytics] writeDataPoint failed:", error);
    }
  }

  private resolveDatasetName(): string | null {
    if (this.datasetName && SAFE_DATASET_RE.test(this.datasetName))
      return this.datasetName;
    const key = cleanBlob(this.environment, true);
    if (!key) return null;
    const fromMap = DATASET_BY_ENV[key];
    if (!fromMap) return null;
    return SAFE_DATASET_RE.test(fromMap) ? fromMap : null;
  }

  private async querySql<T extends Record<string, unknown>>(
    query: string,
  ): Promise<T[] | null> {
    const dataset = this.resolveDatasetName();
    if (!this.accountId || !this.apiToken || !dataset) return null;

    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/analytics_engine/sql`;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "text/plain",
        },
        body: query,
      });
    } catch (error) {
      console.warn("[analytics] SQL query request failed:", error);
      return null;
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch (error) {
      console.warn("[analytics] SQL query parse failed:", error);
      return null;
    }

    if (
      !response.ok ||
      (payload as Record<string, unknown>)?.success === false
    ) {
      console.warn("[analytics] SQL query failed", {
        status: response.status,
        errors: (payload as Record<string, unknown>)?.errors,
        messages: (payload as Record<string, unknown>)?.messages,
      });
      return null;
    }

    return parseQueryRows(payload) as T[];
  }

  // ---- Ingestion ----

  trackHttpRequest(event: HttpRequestEvent): void {
    if (event.method === "OPTIONS") return;
    this.writePoint({
      indexes: ["http.request"],
      doubles: [cleanNumber(event.durationMs), cleanNumber(event.status)],
      blobs: [
        cleanBlob(this.environment, true),
        cleanBlob(event.method, true),
        cleanBlob(normalizePath(event.path)),
        cleanBlob(statusBucket(event.status), true),
        cleanBlob(event.organizationId ?? null),
        cleanBlob(event.providerId ?? null, true),
        cleanBlob(String(event.status), true),
      ],
    });
  }

  trackBusiness(event: BusinessEvent): void {
    this.writePoint({
      indexes: [cleanBlob(event.event, true) || "unknown"],
      doubles: [cleanNumber(event.value)],
      blobs: [
        cleanBlob(this.environment, true),
        cleanBlob(event.outcome || "unknown", true),
        cleanBlob(event.organizationId ?? null),
        cleanBlob(event.providerId ?? null, true),
        cleanBlob(event.customerId ?? null),
        cleanBlob(event.currency ?? null, true),
      ],
    });
  }

  trackUsage(event: UsageEvent): void {
    this.writePoint({
      indexes: ["usage.record"],
      doubles: [
        cleanNumber(event.amount),
        cleanNumber(event.periodStart),
        cleanNumber(event.periodEnd),
      ],
      blobs: [
        cleanBlob(this.environment, true),
        "usage.log",
        cleanBlob(event.organizationId),
        cleanBlob(event.featureId),
        cleanBlob(event.customerId),
        cleanBlob(event.entityId ?? null),
        cleanBlob(event.invoiceId ?? null),
      ],
    });
  }

  trackWebhook(event: WebhookEvent): void {
    const payloadStr = safeJSONStringify(event.payload);
    const payloadBytes = new TextEncoder().encode(payloadStr).byteLength;
    const payloadBlob =
      payloadBytes > MAX_EVENT_PAYLOAD_BYTES
        ? payloadStr.slice(0, MAX_EVENT_PAYLOAD_BYTES)
        : payloadStr;

    this.writePoint({
      indexes: ["webhook.ingest"],
      doubles: [cleanNumber(event.createdAt)],
      blobs: [
        cleanBlob(this.environment, true),
        "webhook.event",
        cleanBlob(event.organizationId),
        cleanBlob(event.id),
        cleanBlob(event.eventType),
        cleanBlob(event.providerId ?? null, true),
        cleanBlob(event.customerEmail ?? null, true),
        cleanBlob(event.customerId ?? null),
        cleanBlob(String(Boolean(event.processed)), true),
        cleanBlob(payloadBlob, false, MAX_EVENT_PAYLOAD_BYTES),
        cleanBlob(String(payloadBytes > MAX_EVENT_PAYLOAD_BYTES), true),
      ],
    });
  }

  // ---- Querying ----

  async listWebhookEvents(
    opts: ListEventsOpts,
  ): Promise<ListResult<DashboardEvent>> {
    const dataset = this.resolveDatasetName();
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
      where += ` AND blob3 = ${sqlString(opts.organizationId)}`;
    }
    if (opts.customerId) {
      where += ` AND blob8 = ${sqlString(opts.customerId)}`;
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

    const rows = await this.querySql<AnalyticsEventRow>(query);
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

  async getWebhookEventById(
    id: string,
    organizationId?: string,
  ): Promise<ItemResult<DashboardEvent>> {
    const dataset = this.resolveDatasetName();
    if (!dataset) {
      return {
        success: false,
        error: "unavailable",
        message: "Analytics dataset not configured",
      };
    }

    let where = `blob2 = 'webhook.event' AND blob4 = ${sqlString(id)}`;
    if (organizationId) {
      where += ` AND blob3 = ${sqlString(organizationId)}`;
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

    const rows = await this.querySql<AnalyticsEventRow>(query);
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
}
