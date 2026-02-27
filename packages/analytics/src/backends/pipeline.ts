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
  PipelineBinding,
  PipelineConfig,
} from "../types";

// Table names in R2 Data Catalog (Iceberg)
const TABLES = {
  httpRequests: "http_requests",
  businessEvents: "business_events",
  usageEvents: "usage_events",
  webhookEvents: "webhook_events",
} as const;

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

function statusBucket(status: number): string {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  if (status >= 200) return "2xx";
  if (status >= 100) return "1xx";
  return "0xx";
}

function normalizePath(path: string): string {
  return path
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
      ":uuid",
    )
    .replace(/\/[a-zA-Z0-9_-]{20,}(?=\/|$)/g, "/:id")
    .slice(0, 128);
}

export class PipelineStore implements EventStore {
  private pipeline: PipelineBinding | undefined;
  private environment: string;
  private accountId: string | null;
  private apiToken: string | null;
  private warehouse: string | null;

  constructor(config: PipelineConfig) {
    this.pipeline = config.pipeline;
    this.environment = config.environment || "development";
    this.accountId = config.accountId || null;
    this.apiToken = config.apiToken || null;
    this.warehouse = config.warehouse || null;
  }

  private send(event: Record<string, unknown>): void {
    if (!this.pipeline) return;
    try {
      this.pipeline.send([event]);
    } catch (error) {
      console.warn("[pipeline] send failed:", error);
    }
  }

  private async queryR2Sql<T extends Record<string, unknown>>(
    query: string,
  ): Promise<T[] | null> {
    if (!this.accountId || !this.apiToken || !this.warehouse) return null;

    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/r2/warehouses/${this.warehouse}/sql`;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });
    } catch (error) {
      console.warn("[pipeline] R2 SQL query failed:", error);
      return null;
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch (error) {
      console.warn("[pipeline] R2 SQL response parse failed:", error);
      return null;
    }

    if (!response.ok) {
      console.warn("[pipeline] R2 SQL query error", {
        status: response.status,
        errors: (payload as Record<string, unknown>)?.errors,
      });
      return null;
    }

    const p = payload as Record<string, unknown>;
    const result = p?.result as Record<string, unknown> | unknown[] | undefined;
    if (Array.isArray(result)) return result as T[];
    if (
      result &&
      typeof result === "object" &&
      Array.isArray((result as Record<string, unknown>).data)
    )
      return (result as Record<string, unknown>).data as T[];
    if (Array.isArray(p?.data)) return p.data as T[];
    return [];
  }

  // ---- Ingestion ----
  // Events are sent as structured JSON to the Pipeline.
  // The Pipeline's SQL transform routes them into the correct Iceberg table.

  trackHttpRequest(event: HttpRequestEvent): void {
    if (event.method === "OPTIONS") return;
    this.send({
      _table: TABLES.httpRequests,
      timestamp: new Date().toISOString(),
      environment: this.environment,
      method: event.method?.toLowerCase(),
      path: normalizePath(event.path),
      status: event.status,
      status_bucket: statusBucket(event.status),
      duration_ms: event.durationMs,
      organization_id: event.organizationId || null,
      provider_id: event.providerId || null,
    });
  }

  trackBusiness(event: BusinessEvent): void {
    this.send({
      _table: TABLES.businessEvents,
      timestamp: new Date().toISOString(),
      environment: this.environment,
      event: event.event,
      outcome: event.outcome || "unknown",
      organization_id: event.organizationId || null,
      provider_id: event.providerId || null,
      customer_id: event.customerId || null,
      currency: event.currency || null,
      value: event.value ?? 0,
    });
  }

  trackUsage(event: UsageEvent): void {
    this.send({
      _table: TABLES.usageEvents,
      timestamp: new Date().toISOString(),
      environment: this.environment,
      customer_id: event.customerId,
      feature_id: event.featureId,
      amount: event.amount,
      organization_id: event.organizationId,
      period_start: event.periodStart,
      period_end: event.periodEnd,
      entity_id: event.entityId || null,
      invoice_id: event.invoiceId || null,
    });
  }

  trackWebhook(event: WebhookEvent): void {
    this.send({
      _table: TABLES.webhookEvents,
      timestamp: new Date().toISOString(),
      environment: this.environment,
      event_id: event.id,
      organization_id: event.organizationId,
      event_type: event.eventType,
      provider_id: event.providerId || null,
      customer_email: event.customerEmail || null,
      customer_id: event.customerId || null,
      processed: event.processed,
      payload: safeJSONStringify(event.payload),
      created_at: event.createdAt,
    });
  }

  // ---- Querying ----

  async listWebhookEvents(
    opts: ListEventsOpts,
  ): Promise<ListResult<DashboardEvent>> {
    if (!this.warehouse) {
      return {
        success: false,
        error: "unavailable",
        message: "R2 SQL warehouse not configured",
      };
    }

    const limit = Math.min(opts.limit || 20, 100);
    const offset = Math.max(opts.offset || 0, 0);

    const conditions: string[] = [];
    if (opts.organizationId) {
      conditions.push(`organization_id = ${sqlString(opts.organizationId)}`);
    }
    if (opts.customerId) {
      conditions.push(`customer_id = ${sqlString(opts.customerId)}`);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
      SELECT
        timestamp,
        event_id,
        organization_id,
        event_type,
        customer_email,
        customer_id,
        processed,
        payload,
        created_at
      FROM ${TABLES.webhookEvents}
      ${where}
      ORDER BY timestamp DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const rows = await this.queryR2Sql<Record<string, unknown>>(query);
    if (!rows) {
      return {
        success: false,
        error: "unavailable",
        message: "R2 SQL query failed or service unavailable",
      };
    }

    const events: DashboardEvent[] = rows.map((row) => {
      const createdAt = Number(row.created_at) || Date.now();
      const customerEmail = (row.customer_email as string) || null;
      const customerId = (row.customer_id as string) || null;

      let data: Record<string, unknown> = {};
      if (typeof row.payload === "string") {
        try {
          data = JSON.parse(row.payload);
        } catch {
          data = { _raw: row.payload };
        }
      }

      return {
        id: (row.event_id as string) || `pl_${createdAt}`,
        organizationId:
          (row.organization_id as string) || opts.organizationId || "unknown",
        type: (row.event_type as string) || "unknown",
        customerId,
        data,
        processed: Boolean(row.processed),
        createdAt,
        customer: customerEmail
          ? { id: customerId, email: customerEmail, name: null }
          : null,
      };
    });

    return { success: true, data: events };
  }

  async getWebhookEventById(
    id: string,
    organizationId?: string,
  ): Promise<ItemResult<DashboardEvent>> {
    if (!this.warehouse) {
      return {
        success: false,
        error: "unavailable",
        message: "R2 SQL warehouse not configured",
      };
    }

    const conditions = [`event_id = ${sqlString(id)}`];
    if (organizationId) {
      conditions.push(`organization_id = ${sqlString(organizationId)}`);
    }

    const query = `
      SELECT
        timestamp,
        event_id,
        organization_id,
        event_type,
        customer_email,
        customer_id,
        processed,
        payload,
        created_at
      FROM ${TABLES.webhookEvents}
      WHERE ${conditions.join(" AND ")}
      ORDER BY timestamp DESC
      LIMIT 1
    `;

    const rows = await this.queryR2Sql<Record<string, unknown>>(query);
    if (!rows) {
      return {
        success: false,
        error: "unavailable",
        message: "R2 SQL query failed or service unavailable",
      };
    }

    if (rows.length === 0) {
      return { success: true, data: null };
    }

    const row = rows[0];
    const createdAt = Number(row.created_at) || Date.now();
    const customerEmail = (row.customer_email as string) || null;
    const customerId = (row.customer_id as string) || null;

    let data: Record<string, unknown> = {};
    if (typeof row.payload === "string") {
      try {
        data = JSON.parse(row.payload);
      } catch {
        data = { _raw: row.payload };
      }
    }

    return {
      success: true,
      data: {
        id: (row.event_id as string) || `pl_${createdAt}`,
        organizationId:
          (row.organization_id as string) || organizationId || "unknown",
        type: (row.event_type as string) || "unknown",
        customerId,
        data,
        processed: Boolean(row.processed),
        createdAt,
        customer: customerEmail
          ? { id: customerId, email: customerEmail, name: null }
          : null,
      },
    };
  }
}
