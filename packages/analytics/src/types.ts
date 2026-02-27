// ---------------------------------------------------------------------------
// Event Types — strongly typed, no more blob columns
// ---------------------------------------------------------------------------

export interface HttpRequestEvent {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  organizationId?: string | null;
  providerId?: string | null;
}

export interface BusinessEvent {
  event: string;
  outcome?: string | null;
  organizationId?: string | null;
  providerId?: string | null;
  customerId?: string | null;
  currency?: string | null;
  value?: number | null;
}

export interface UsageEvent {
  customerId: string;
  featureId: string;
  amount: number;
  organizationId: string;
  periodStart: number;
  periodEnd: number;
  entityId?: string | null;
  invoiceId?: string | null;
}

export interface WebhookEvent {
  id: string;
  organizationId: string;
  eventType: string;
  providerId?: string | null;
  customerEmail?: string | null;
  customerId?: string | null;
  processed: boolean;
  payload: Record<string, unknown>;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Dashboard Event — formatted for display
// ---------------------------------------------------------------------------

export interface DashboardEvent {
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
}

// ---------------------------------------------------------------------------
// Query Options & Results
// ---------------------------------------------------------------------------

export interface ListEventsOpts {
  organizationId?: string | null;
  customerId?: string | null;
  limit?: number;
  offset?: number;
}

export type ListResult<T> =
  | { success: true; data: T[] }
  | { success: false; error: "unavailable"; message: string };

export type ItemResult<T> =
  | { success: true; data: T | null }
  | { success: false; error: "unavailable"; message: string };

// ---------------------------------------------------------------------------
// EventStore Interface — the core abstraction
// ---------------------------------------------------------------------------

export interface EventStore {
  // Ingestion (fire-and-forget, never throws)
  trackHttpRequest(event: HttpRequestEvent): void;
  trackBusiness(event: BusinessEvent): void;
  trackUsage(event: UsageEvent): void;
  trackWebhook(event: WebhookEvent): void;

  // Querying
  listWebhookEvents(opts: ListEventsOpts): Promise<ListResult<DashboardEvent>>;
  getWebhookEventById(
    id: string,
    organizationId?: string,
  ): Promise<ItemResult<DashboardEvent>>;
}

// ---------------------------------------------------------------------------
// Pipeline binding (mirrors cloudflare:pipelines but usable as a global)
// ---------------------------------------------------------------------------

export interface PipelineBinding {
  send(records: Record<string, unknown>[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Backend Configuration
// ---------------------------------------------------------------------------

export interface AnalyticsEngineConfig {
  backend: "analytics-engine";
  dataset?: AnalyticsEngineDataset;
  environment?: string;
  accountId?: string;
  apiToken?: string;
  datasetName?: string;
}

export interface PipelineConfig {
  backend: "pipeline";
  pipeline?: PipelineBinding;
  environment?: string;
  accountId?: string;
  apiToken?: string;
  warehouse?: string;
}

export type EventStoreConfig = AnalyticsEngineConfig | PipelineConfig;
