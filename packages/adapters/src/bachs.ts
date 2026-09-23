import { Result } from "better-result";
import type {
  CheckoutSession,
  NormalizedWebhookEvent,
  ProviderAccount,
  PlanChangeResult,
  ProviderAdapter,
  ProviderCustomerRef,
  ProviderCustomerSession,
  ProviderPlanRef,
  ProviderProductRef,
  ProviderResult,
  ProviderSubscriptionDetail,
  ProviderSubscriptionRef,
  WebhookEventType,
} from "./index";

// =============================================================================
// Bachs adapter
//
// Bachs (https://bachs.io) is a product-centric billing API:
// - Money is a decimal string ("29.00"); Owostack passes integer minor units.
// - Subscriptions are created by completing a checkout for a recurring product;
//   there is no direct create-subscription endpoint.
// - Trials live on the product (`trial_period`) and are provider-managed.
// - There is NO off-session "charge saved card" API, so chargeAuthorization is
//   unsupported and callers must fall back to hosted checkout links.
// - Webhooks are signed with HMAC-SHA256 over `${X-Bachs-Timestamp}.${rawBody}`.
// =============================================================================

interface BachsConfig {
  secretKey: string;
  baseUrl: string;
  timeout?: number;
  maxRetries?: number;
}

interface BachsRequestOptions {
  idempotencyKey?: string;
}

interface BachsCheckoutResponse {
  checkout_id: string;
  checkout_url: string;
  status?: string;
  expires_at?: string;
  reference?: string | null;
}

interface BachsCustomerResponse {
  customer_id: string;
  email: string;
  name?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface BachsCustomerListResponse {
  items?: BachsCustomerResponse[];
}

interface BachsProductResponse {
  id: string;
  name?: string;
  billing_cycle?: BachsCadence | null;
  trial_period?: BachsCadence | null;
}

interface BachsCadence {
  interval: "day" | "week" | "month" | "year";
  frequency: number;
}

interface BachsRefundResponse {
  refund_id: string;
  charge_id?: string;
  status?: string;
}

interface BachsPortalSessionResponse {
  id: string;
  url: string;
}

interface BachsApiError {
  detail?: string;
  error_code?: string;
  doc_url?: string;
  errors?: Array<{ field: string; message: string; type: string }>;
}

export const BACHS_BASE_URLS = {
  test: "https://sandbox-api.bachs.io",
  live: "https://api.bachs.io",
} as const;

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_RETRIES = 2;
const PROVIDER_ID = "bachs" as const;
const WEBHOOK_TOLERANCE_SECONDS = 300;
const MAX_METADATA_KEYS = 20;

/**
 * Currencies Bachs accepts for product pricing. Subscriptions are USD-only
 * on Bachs today; the other currencies work for one-time payments.
 */
export const BACHS_SUPPORTED_CURRENCIES = [
  "USD",
  "NGN",
  "GHS",
  "KES",
  "MWK",
  "RWF",
  "TZS",
  "UGX",
  "XAF",
  "XOF",
  "ZMW",
] as const;

export const BACHS_SUBSCRIPTION_CURRENCIES = ["USD"] as const;

class BachsRequestError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string | null,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "BachsRequestError";
  }
}

class BachsClient {
  private secretKey: string;
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(config: BachsConfig) {
    this.secretKey = config.secretKey;
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    options?: BachsRequestOptions,
  ): Promise<ProviderResult<T>> {
    return Result.tryPromise({
      try: async () => {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(
              () => controller.abort(),
              this.timeout,
            );

            const headers: Record<string, string> = {
              Authorization: `Bearer ${this.secretKey}`,
              Accept: "application/json",
            };
            if (body !== undefined) {
              headers["Content-Type"] = "application/json";
            }
            if (options?.idempotencyKey) {
              headers["Idempotency-Key"] = options.idempotencyKey;
            }

            const response = await fetch(`${this.baseUrl}${path}`, {
              method,
              headers,
              body: body !== undefined ? JSON.stringify(body) : undefined,
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            const text = await response.text();

            if (!response.ok) {
              const parsed = safeJsonParse(text) as BachsApiError | null;
              const detail =
                asString(parsed?.detail) ||
                (text.length > 0 ? text : response.statusText);
              const error = new BachsRequestError(
                response.status,
                asString(parsed?.error_code),
                `Bachs API ${response.status}: ${detail}`,
                parsed ?? text,
              );

              // 4xx responses are deterministic; do not retry them.
              if (response.status < 500) {
                throw error;
              }

              lastError = error;
            } else {
              if (!text) return {} as T;
              return JSON.parse(text) as T;
            }
          } catch (error) {
            if (error instanceof BachsRequestError && error.status < 500) {
              throw error;
            }
            lastError = error as Error;
          }

          if (attempt < this.maxRetries) {
            await new Promise((resolve) =>
              setTimeout(resolve, Math.pow(2, attempt) * 100),
            );
          }
        }

        throw lastError || new Error("Request failed after retries");
      },
      catch: (error) => ({
        code:
          error instanceof BachsRequestError &&
          (error.status === 400 || error.status === 422)
            ? ("invalid_request" as const)
            : ("request_failed" as const),
        message: error instanceof Error ? error.message : String(error),
        providerId: PROVIDER_ID,
        cause: error,
      }),
    });
  }

  createCheckoutSession(
    params: Record<string, unknown>,
    options?: BachsRequestOptions,
  ): Promise<ProviderResult<BachsCheckoutResponse>> {
    return this.request("POST", "/v1/checkout-sessions", params, options);
  }

  createCustomer(
    params: Record<string, unknown>,
  ): Promise<ProviderResult<BachsCustomerResponse>> {
    return this.request("POST", "/v1/customers", params);
  }

  searchCustomers(
    email: string,
  ): Promise<ProviderResult<BachsCustomerListResponse>> {
    return this.request(
      "GET",
      `/v1/customers?search=${encodeURIComponent(email)}&limit=10`,
    );
  }

  createPortalSession(
    customerId: string,
  ): Promise<ProviderResult<BachsPortalSessionResponse>> {
    return this.request(
      "POST",
      `/v1/customers/${encodeURIComponent(customerId)}/portal-sessions`,
      {},
    );
  }

  createProduct(
    params: Record<string, unknown>,
  ): Promise<ProviderResult<BachsProductResponse>> {
    return this.request("POST", "/v1/products", params);
  }

  getProduct(productId: string): Promise<ProviderResult<BachsProductResponse>> {
    return this.request("GET", `/v1/products/${encodeURIComponent(productId)}`);
  }

  updateProduct(
    productId: string,
    params: Record<string, unknown>,
  ): Promise<ProviderResult<BachsProductResponse>> {
    return this.request(
      "PATCH",
      `/v1/products/${encodeURIComponent(productId)}`,
      params,
    );
  }

  archiveProduct(
    productId: string,
  ): Promise<ProviderResult<Record<string, unknown>>> {
    return this.request(
      "POST",
      `/v1/products/${encodeURIComponent(productId)}/archive`,
      {},
    );
  }

  getSubscription(
    subscriptionId: string,
  ): Promise<ProviderResult<Record<string, unknown>>> {
    return this.request(
      "GET",
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
  }

  updateSubscription(
    subscriptionId: string,
    params: Record<string, unknown>,
  ): Promise<ProviderResult<Record<string, unknown>>> {
    return this.request(
      "PATCH",
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      params,
    );
  }

  cancelSubscription(
    subscriptionId: string,
    params: Record<string, unknown>,
  ): Promise<ProviderResult<Record<string, unknown>>> {
    return this.request(
      "DELETE",
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      params,
    );
  }

  createRefund(
    params: Record<string, unknown>,
    options?: BachsRequestOptions,
  ): Promise<ProviderResult<BachsRefundResponse>> {
    return this.request("POST", "/v1/refunds", params, options);
  }
}

// =============================================================================
// Helpers
// =============================================================================

function safeJsonParse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

/**
 * Owostack minor units -> Bachs decimal string with two fraction digits.
 * Owostack stores every amount x100 regardless of the ISO exponent, so we
 * always divide by 100. Examples: 2999 -> "29.99", 100 -> "1.00", 1 -> "0.01".
 */
export function toDecimalString(minor: number): string {
  if (!Number.isFinite(minor)) return "0.00";
  const rounded = Math.round(minor);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  return `${sign}${whole}.${String(fraction).padStart(2, "0")}`;
}

/**
 * Bachs decimal string -> Owostack minor units. Parses by splitting on "."
 * rather than multiplying a float so "29.99" is exactly 2999.
 * Examples: "29.99" -> 2999, "75000" -> 7500000, "0.1" -> 10, "1.005" -> 101.
 */
export function toMinorUnits(
  value: string | number | null | undefined,
): number {
  if (value === null || value === undefined) return 0;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100);
  }

  const trimmed = value.trim();
  const match = /^(-)?(\d+)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) return 0;

  const negative = match[1] === "-";
  const whole = Number.parseInt(match[2], 10);
  const fractionDigits = (match[3] ?? "").padEnd(3, "0");
  const twoDigits = Number.parseInt(fractionDigits.slice(0, 2), 10);
  const thirdDigit = Number.parseInt(fractionDigits.charAt(2), 10);

  let minor = whole * 100 + twoDigits;
  if (thirdDigit >= 5) minor += 1;

  return negative ? -minor : minor;
}

export function mapIntervalToCadence(interval: string): BachsCadence {
  switch ((interval || "").toLowerCase()) {
    case "daily":
    case "day":
      return { interval: "day", frequency: 1 };
    case "weekly":
    case "week":
      return { interval: "week", frequency: 1 };
    case "quarterly":
    case "quarter":
      return { interval: "month", frequency: 3 };
    case "biannually":
    case "biannual":
    case "semi_annual":
    case "semiannual":
      return { interval: "month", frequency: 6 };
    case "annually":
    case "yearly":
    case "annual":
    case "year":
      return { interval: "year", frequency: 1 };
    case "monthly":
    case "month":
    default:
      return { interval: "month", frequency: 1 };
  }
}

function cadenceEquals(
  left: BachsCadence | null | undefined,
  right: BachsCadence | null | undefined,
): boolean {
  if (!left || !right) return false;
  return left.interval === right.interval && left.frequency === right.frequency;
}

/**
 * Bachs metadata: string values, max 20 keys. Drop null/undefined values and
 * keep insertion order so the checkout keys Owostack sets first survive.
 */
export function coerceMetadata(
  metadata?: Record<string, unknown> | null,
): Record<string, string> | undefined {
  if (!metadata) return undefined;

  const entries = Object.entries(metadata).filter(
    ([, value]) => value !== null && value !== undefined,
  );

  if (entries.length === 0) return undefined;

  if (entries.length > MAX_METADATA_KEYS) {
    console.warn(
      `[BACHS] Metadata has ${entries.length} keys; Bachs allows ${MAX_METADATA_KEYS}. Dropping: ${entries
        .slice(MAX_METADATA_KEYS)
        .map(([key]) => key)
        .join(", ")}`,
    );
  }

  return Object.fromEntries(
    entries
      .slice(0, MAX_METADATA_KEYS)
      .map(([key, value]) => [
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      ]),
  );
}

const PAYMENT_METHOD_TYPES = new Set([
  "card",
  "crypto",
  "bank_transfer",
  "mobile_money",
]);

/**
 * Owostack channels are Paystack-style (`card`, `bank`, `bank_transfer`,
 * `mobile_money`, `ussd`, `qr`, ...). Map the ones Bachs understands.
 */
export function mapChannelsToPaymentMethodTypes(
  channels?: string[] | null,
): string[] | undefined {
  if (!channels || channels.length === 0) return undefined;

  const mapped = new Set<string>();
  for (const channel of channels) {
    const normalized = channel.toLowerCase();
    if (normalized === "bank") {
      mapped.add("bank_transfer");
    } else if (PAYMENT_METHOD_TYPES.has(normalized)) {
      mapped.add(normalized);
    }
  }

  return mapped.size > 0 ? Array.from(mapped) : undefined;
}

function isBachsCustomerId(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("cust_");
}

function resolveClient(
  account: ProviderAccount,
  environment: "test" | "live",
): ProviderResult<BachsClient> {
  const credentials = account.credentials || {};
  const secretKey =
    typeof credentials.secretKey === "string" ? credentials.secretKey : null;

  if (!secretKey) {
    return Result.err({
      code: "configuration_missing",
      message: "Bachs secret key missing",
      providerId: PROVIDER_ID,
    });
  }

  const baseUrl =
    typeof credentials.baseUrl === "string" && credentials.baseUrl.length > 0
      ? credentials.baseUrl
      : BACHS_BASE_URLS[environment];

  return Result.ok(new BachsClient({ secretKey, baseUrl }));
}

function deriveCustomerName(
  customer: ProviderCustomerRef,
  metadata?: Record<string, unknown>,
): string {
  const fromMetadata =
    asString(metadata?.customer_name) || asString(metadata?.name);
  if (fromMetadata) return fromMetadata;

  const local = customer.email.split("@")[0];
  return local && local.length > 0 ? local : "Customer";
}

function buildCheckoutCustomer(
  customer: ProviderCustomerRef,
  metadata?: Record<string, unknown>,
): Record<string, unknown> {
  if (isBachsCustomerId(customer.id)) {
    return { customer_id: customer.id };
  }
  return {
    email: customer.email,
    name: deriveCustomerName(customer, metadata),
  };
}

function buildIdempotencyKey(
  prefix: string,
  metadata?: Record<string, unknown>,
): string | undefined {
  const stable =
    asString(metadata?.invoice_id) ||
    asString(metadata?.reference) ||
    asString(metadata?.billing_run_id);
  return stable ? `${prefix}:${stable}` : undefined;
}

// -----------------------------------------------------------------------------
// Webhook parsing helpers
// -----------------------------------------------------------------------------

function extractCustomer(data: Record<string, unknown>): {
  email: string;
  providerCustomerId: string;
} {
  const customer = asRecord(data.customer);
  const details = asRecord(data.customer_details);

  const providerCustomerId =
    asString(customer?.customer_id) ||
    asString(customer?.id) ||
    asString(data.customer_id) ||
    "";

  const email =
    asString(customer?.email) ||
    asString(details?.email) ||
    asString(data.customer_email) ||
    "";

  return { email, providerCustomerId };
}

function extractMetadata(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const raw = asRecord(data.metadata);
  return raw ? { ...raw } : {};
}

function extractPaymentReference(data: Record<string, unknown>): string {
  return (
    asString(data.payment_id) ||
    asString(data.charge_id) ||
    asString(data.reference) ||
    asString(data.checkout_id) ||
    ""
  );
}

function normalizeCurrency(value: unknown, fallback = "USD"): string {
  return (asString(value) || fallback).toUpperCase();
}

type OwostackSubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "pending_cancel"
  | "canceled";

export function mapSubscriptionStatus(
  status: string | null | undefined,
  cancelAtPeriodEnd?: boolean | null,
): OwostackSubscriptionStatus {
  const normalized = (status || "").toLowerCase();

  if (normalized === "canceled" || normalized === "cancelled") {
    return "canceled";
  }
  if (cancelAtPeriodEnd === true) {
    return "pending_cancel";
  }
  if (normalized === "trialing") {
    return "trialing";
  }
  if (
    normalized === "past_due" ||
    normalized === "unpaid" ||
    normalized === "paused"
  ) {
    return "past_due";
  }
  return "active";
}

function subscriptionEventTypeForStatus(
  status: OwostackSubscriptionStatus,
): WebhookEventType {
  switch (status) {
    case "canceled":
      return "subscription.canceled";
    case "pending_cancel":
      return "subscription.not_renew";
    case "past_due":
      return "subscription.past_due";
    default:
      return "subscription.active";
  }
}

function extractSubscriptionFromEvent(
  data: Record<string, unknown>,
): NormalizedWebhookEvent["subscription"] | undefined {
  const nested = asRecord(data.subscription);
  const id =
    asString(data.subscription_id) ||
    asString(nested?.subscription_id) ||
    asString(nested?.id) ||
    asString(data.id);

  if (!id) return undefined;

  const cancelAtPeriodEnd = asBoolean(data.cancel_at_period_end);
  const status = mapSubscriptionStatus(
    asString(data.status),
    cancelAtPeriodEnd,
  );

  const product = asRecord(data.product);
  const planCode =
    asString(data.product_id) || asString(product?.id) || undefined;

  return {
    providerCode: id,
    providerSubscriptionId: id,
    status,
    planCode,
    startDate:
      asString(data.current_period_start) ||
      asString(data.created_at) ||
      undefined,
    nextPaymentDate:
      asString(data.next_billed_at) ||
      asString(data.current_period_end) ||
      undefined,
    trialEndDate: asString(data.trial_end) || undefined,
  };
}

// =============================================================================
// Adapter
// =============================================================================

export const bachsAdapter: ProviderAdapter = {
  id: PROVIDER_ID,
  displayName: "Bachs",
  // Default header (`x-bachs-signature`) matches Bachs' X-Bachs-Signature.
  supportsNativeTrials: true,
  defaultCurrency: "USD",

  async createCheckoutSession(
    params,
  ): Promise<ProviderResult<CheckoutSession>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    if (
      params.onDemand?.mandateOnly ||
      params.metadata?.type === "card_setup"
    ) {
      return Result.err({
        code: "unsupported",
        message:
          "Bachs does not support mandate-only (card setup) checkout sessions",
        providerId: PROVIDER_ID,
      });
    }

    const client = clientResult.value;
    const metadata = coerceMetadata(params.metadata);
    const currency = normalizeCurrency(params.currency, "USD");

    const body: Record<string, unknown> = {
      customer: buildCheckoutCustomer(params.customer, params.metadata),
    };

    const lineItems = (params.lineItems ?? []).filter(
      (item) => typeof item.priceId === "string" && item.priceId.length > 0,
    );

    if (params.plan?.id) {
      // Recurring product: never override the price here, it would become
      // the subscription's price for life.
      body.product_cart = [{ product_id: params.plan.id, quantity: 1 }];
    } else if (lineItems.length > 0) {
      body.product_cart = lineItems.map((item) => ({
        product_id: item.priceId,
        quantity: Number.isFinite(item.quantity)
          ? Math.max(1, Math.floor(item.quantity))
          : 1,
      }));
    } else {
      if (!Number.isFinite(params.amount) || params.amount <= 0) {
        return Result.err({
          code: "invalid_request",
          message:
            "Bachs checkout requires a product, line items, or a positive amount",
          providerId: PROVIDER_ID,
        });
      }
      body.pricing = {
        currency,
        amount: toDecimalString(params.amount),
        price_type: "fixed",
      };
    }

    if (params.callbackUrl) {
      body.success_url = params.callbackUrl;
      body.cancel_url = params.callbackUrl;
    }

    if (metadata) {
      body.metadata = metadata;
    }

    const reference = asString(params.metadata?.reference);
    if (reference) {
      body.reference = reference.slice(0, 128);
    }

    const paymentMethodTypes = mapChannelsToPaymentMethodTypes(params.channels);
    if (paymentMethodTypes) {
      body.payment_method_types = paymentMethodTypes;
    }

    if (params.trialDays && params.trialDays > 0 && !params.plan?.id) {
      console.warn(
        "[BACHS] trialDays was provided without a plan; Bachs trials are configured on the recurring product and cannot be applied to a one-off checkout",
      );
    }

    const response = await client.createCheckoutSession(body, {
      idempotencyKey: buildIdempotencyKey("checkout", params.metadata),
    });
    if (response.isErr()) return response;

    return Result.ok({
      url: response.value.checkout_url,
      reference: response.value.checkout_id,
      accessCode: null,
    });
  },

  async createProduct(params): Promise<ProviderResult<ProviderProductRef>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const body: Record<string, unknown> = {
      name: params.name,
      price: {
        currency: normalizeCurrency(params.currency),
        price_type: "fixed",
        amount: toDecimalString(params.amount),
      },
    };

    const metadata = coerceMetadata({
      ...(params.metadata || {}),
      ...(params.description ? { description: params.description } : {}),
    });
    if (metadata) body.metadata = metadata;

    const response = await clientResult.value.createProduct(body);
    if (response.isErr()) return response;

    return Result.ok({
      productId: response.value.id,
      priceId: response.value.id,
      metadata: {},
    });
  },

  async createCustomer(params): Promise<ProviderResult<ProviderCustomerRef>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const client = clientResult.value;
    const body: Record<string, unknown> = { email: params.email };
    if (params.name) body.name = params.name;
    const metadata = coerceMetadata(params.metadata);
    if (metadata) body.metadata = metadata;

    const response = await client.createCustomer(body);

    if (response.isOk()) {
      return Result.ok({
        id: response.value.customer_id,
        email: response.value.email || params.email,
        metadata: params.metadata,
      });
    }

    // Bachs never duplicates an email; on a conflict, look the customer up.
    const cause = response.error.cause;
    const isConflict =
      cause instanceof BachsRequestError &&
      (cause.status === 409 || /already exists|CONFLICT/i.test(cause.message));

    if (!isConflict) return response;

    const search = await client.searchCustomers(params.email);
    if (search.isErr()) return response;

    const wanted = params.email.toLowerCase();
    const existing = (search.value.items ?? []).find(
      (item) => (item.email || "").toLowerCase() === wanted,
    );

    if (!existing) return response;

    return Result.ok({
      id: existing.customer_id,
      email: existing.email || params.email,
      metadata: params.metadata,
    });
  },

  async createCustomerSession(
    params,
  ): Promise<ProviderResult<ProviderCustomerSession>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    if (!isBachsCustomerId(params.customer.id)) {
      return Result.err({
        code: "invalid_request",
        message:
          "Bachs customer portal session requires a provider customer ID (cust_...)",
        providerId: PROVIDER_ID,
      });
    }

    const response = await clientResult.value.createPortalSession(
      params.customer.id,
    );
    if (response.isErr()) return response;

    if (!response.value.url) {
      return Result.err({
        code: "request_failed",
        message: "Bachs portal session response missing url",
        providerId: PROVIDER_ID,
      });
    }

    return Result.ok({
      url: response.value.url,
      token: response.value.id || null,
    });
  },

  async createPlan(params): Promise<ProviderResult<ProviderPlanRef>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const currency = normalizeCurrency(params.currency);
    if (
      !(BACHS_SUBSCRIPTION_CURRENCIES as readonly string[]).includes(currency)
    ) {
      return Result.err({
        code: "invalid_request",
        message: `Bachs subscriptions currently support ${BACHS_SUBSCRIPTION_CURRENCIES.join(", ")} only (got ${currency})`,
        providerId: PROVIDER_ID,
      });
    }

    const cadence = mapIntervalToCadence(params.interval);
    const body: Record<string, unknown> = {
      name: params.name,
      price: {
        currency,
        price_type: "fixed",
        amount: toDecimalString(params.amount),
      },
      billing_cycle: cadence,
    };

    if (params.description) {
      body.metadata = { description: params.description };
    }

    const response = await clientResult.value.createProduct(body);
    if (response.isErr()) return response;

    return Result.ok({
      id: response.value.id,
      metadata: {
        billing_cycle: response.value.billing_cycle ?? cadence,
      },
    });
  },

  async updatePlan(params): Promise<
    ProviderResult<{
      updated: boolean;
      nextPlanId?: string;
      metadata?: Record<string, unknown>;
    }>
  > {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const client = clientResult.value;

    // billing_cycle is immutable on Bachs. If the interval changes we must
    // mint a new product and hand its id back as nextPlanId.
    if (params.interval !== undefined) {
      const current = await client.getProduct(params.planId);
      if (current.isErr()) return current;

      const desired = mapIntervalToCadence(params.interval);
      if (!cadenceEquals(current.value.billing_cycle, desired)) {
        if (params.amount === undefined || params.currency === undefined) {
          return Result.err({
            code: "invalid_request",
            message:
              "Bachs updatePlan needs amount and currency to create a replacement product when the interval changes",
            providerId: PROVIDER_ID,
          });
        }

        const created = await client.createProduct({
          name: params.name ?? current.value.name ?? "Plan",
          price: {
            currency: normalizeCurrency(params.currency),
            price_type: "fixed",
            amount: toDecimalString(params.amount),
          },
          billing_cycle: desired,
          ...(params.description
            ? { metadata: { description: params.description } }
            : {}),
        });
        if (created.isErr()) return created;

        // Best effort: stop selling the old cadence. Existing subscribers keep access.
        const archived = await client.archiveProduct(params.planId);
        if (archived.isErr()) {
          console.warn(
            `[BACHS] Failed to archive replaced product ${params.planId}: ${archived.error.message}`,
          );
        }

        return Result.ok({
          updated: true,
          nextPlanId: created.value.id,
          metadata: { billing_cycle: desired, replaced: params.planId },
        });
      }
    }

    const body: Record<string, unknown> = {};
    if (params.name !== undefined) body.name = params.name;
    if (params.description !== undefined) {
      body.metadata = { description: params.description ?? "" };
    }
    if (params.amount !== undefined) {
      body.price = { amount: toDecimalString(params.amount) };
    }

    if (Object.keys(body).length === 0) {
      return Result.ok({ updated: true });
    }

    const response = await client.updateProduct(params.planId, body);
    if (response.isErr()) return response;

    return Result.ok({ updated: true });
  },

  async createSubscription(
    params,
  ): Promise<ProviderResult<ProviderSubscriptionRef>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    // Bachs has no direct create-subscription endpoint; a subscription is
    // created when the customer completes a checkout for a recurring product.
    const body: Record<string, unknown> = {
      product_cart: [{ product_id: params.plan.id, quantity: 1 }],
      customer: buildCheckoutCustomer(params.customer, params.metadata),
    };

    const metadata = coerceMetadata(params.metadata);
    if (metadata) body.metadata = metadata;

    const response = await clientResult.value.createCheckoutSession(body);
    if (response.isErr()) return response;

    return Result.ok({
      id: response.value.checkout_id,
      status: "pending",
      metadata: {
        checkout_url: response.value.checkout_url,
        ...(params.metadata || {}),
      },
    });
  },

  async cancelSubscription(
    params,
  ): Promise<ProviderResult<{ canceled: boolean }>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.cancelSubscription(
      params.subscription.id,
      {
        cancel_at_period_end: false,
        reason: "Canceled via Owostack",
      },
    );

    if (response.isErr()) {
      const cause = response.error.cause;
      const alreadyCanceled =
        cause instanceof BachsRequestError &&
        cause.status === 400 &&
        /already\s+cancel/i.test(cause.message);
      if (alreadyCanceled) {
        return Result.ok({ canceled: true });
      }
      return response as ProviderResult<{ canceled: boolean }>;
    }

    return Result.ok({ canceled: true });
  },

  async chargeAuthorization(): Promise<ProviderResult<{ reference: string }>> {
    return Result.err({
      code: "unsupported",
      message:
        "Bachs has no off-session charge API; collect payment through a checkout session (invoice pay link) instead",
      providerId: PROVIDER_ID,
    });
  },

  async changePlan(params): Promise<ProviderResult<PlanChangeResult>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    // Every Owostack proration mode settles the difference now.
    const response = await clientResult.value.updateSubscription(
      params.subscriptionId,
      {
        product_id: params.newPlanId,
        proration_behavior: "invoice_now",
      },
    );

    if (response.isErr()) return response as ProviderResult<PlanChangeResult>;

    // Bachs returns 200 for an upgrade it has only *staged*: the subscription
    // still carries the old product and a `pending_update` pointing at the new
    // one, waiting on the prorated invoice to be collected. Only the
    // `product` field tells us the change is live.
    const body = response.value as Record<string, unknown>;
    const currentProductId = asString(asRecord(body.product)?.id);
    if (currentProductId === params.newPlanId) {
      return Result.ok({ changed: true });
    }

    const pendingUpdate = asRecord(body.pending_update);
    if (asString(pendingUpdate?.product_id) === params.newPlanId) {
      return Result.ok({
        changed: false,
        pending: true,
        pendingReference: asString(pendingUpdate?.proration_invoice_id) || null,
      });
    }

    return Result.err({
      code: "request_failed",
      message: `Bachs accepted the plan change but the subscription still reports product ${currentProductId ?? "unknown"}`,
      providerId: PROVIDER_ID,
    });
  },

  async refundCharge(
    params,
  ): Promise<ProviderResult<{ refunded: boolean; reference: string }>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const refundReference = `owo_${crypto.randomUUID().replace(/-/g, "")}`;

    const body: Record<string, unknown> = {
      charge_id: params.reference,
      reference: refundReference,
    };

    if (typeof params.amount === "number" && Number.isFinite(params.amount)) {
      body.amount = toDecimalString(params.amount);
    }
    if (params.reason) {
      body.reason = params.reason.slice(0, 500);
    }

    const response = await clientResult.value.createRefund(body, {
      idempotencyKey: `refund:${params.reference}`,
    });
    if (response.isErr()) return response;

    return Result.ok({
      refunded: true,
      reference: response.value.refund_id || refundReference,
    });
  },

  async fetchSubscription(
    params,
  ): Promise<ProviderResult<ProviderSubscriptionDetail>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.getSubscription(
      params.subscriptionId,
    );
    if (response.isErr())
      return response as ProviderResult<ProviderSubscriptionDetail>;

    const sub = asRecord(response.value) || {};
    const product = asRecord(sub.product);
    const items = Array.isArray(sub.items) ? sub.items : [];
    const firstItem = asRecord(items[0]);
    const firstPrice = asRecord(firstItem?.price);

    const cancelAtPeriodEnd = asBoolean(sub.cancel_at_period_end);

    return Result.ok({
      id: asString(sub.id) || params.subscriptionId,
      status: mapSubscriptionStatus(asString(sub.status), cancelAtPeriodEnd),
      planCode:
        asString(product?.id) ||
        asString(firstPrice?.product_id) ||
        asString(firstItem?.product_id) ||
        undefined,
      startDate:
        asString(sub.current_period_start) ||
        asString(sub.created_at) ||
        undefined,
      nextPaymentDate:
        asString(sub.next_billed_at) ||
        asString(sub.current_period_end) ||
        undefined,
      metadata: {
        provider_status: asString(sub.status),
        current_period_start: asString(sub.current_period_start),
        current_period_end: asString(sub.current_period_end),
        cancel_at_period_end: cancelAtPeriodEnd,
        trial_end: asString(sub.trial_end),
        currency: asString(sub.currency),
        amount: asString(sub.amount),
        raw: sub,
      },
    });
  },

  async verifyWebhook(params): Promise<ProviderResult<boolean>> {
    try {
      const headers = params.headers || {};
      const timestampHeader = (
        headers["x-bachs-timestamp"] ||
        headers["X-Bachs-Timestamp"] ||
        ""
      ).trim();
      const signature = (params.signature || headers["x-bachs-signature"] || "")
        .trim()
        .toLowerCase();

      if (!timestampHeader || !signature) {
        console.error(
          "[BACHS] Webhook verification failed: missing X-Bachs-Timestamp or X-Bachs-Signature",
          {
            hasTimestamp: !!timestampHeader,
            hasSignature: !!signature,
            headerKeys: Object.keys(headers),
          },
        );
        return Result.ok(false);
      }

      const timestamp = Number.parseInt(timestampHeader, 10);
      if (!Number.isFinite(timestamp)) {
        return Result.ok(false);
      }

      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
        console.error("[BACHS] Webhook timestamp outside tolerance", {
          now,
          timestamp,
          skewSeconds: now - timestamp,
        });
        return Result.ok(false);
      }

      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(params.secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );

      const signed = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(`${timestampHeader}.${params.payload}`),
      );

      const computed = Array.from(new Uint8Array(signed))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

      if (computed.length !== signature.length) {
        return Result.ok(false);
      }

      let mismatch = 0;
      for (let index = 0; index < computed.length; index++) {
        mismatch |= computed.charCodeAt(index) ^ signature.charCodeAt(index);
      }

      return Result.ok(mismatch === 0);
    } catch (error) {
      console.error("[BACHS] Webhook verification exception", {
        message: error instanceof Error ? error.message : String(error),
      });
      return Result.ok(false);
    }
  },

  parseWebhookEvent(params): ProviderResult<NormalizedWebhookEvent> {
    const raw = params.payload;
    const eventType = asString(raw.type);
    const data = asRecord(raw.data);

    if (!eventType || !data) {
      return Result.err({
        code: "invalid_payload",
        message: "Missing type or data in Bachs webhook payload",
        providerId: PROVIDER_ID,
      });
    }

    const customer = extractCustomer(data);
    const metadata = extractMetadata(data);
    const eventId = asString(raw.id);
    if (eventId) metadata.event_id = eventId;

    const base = {
      provider: PROVIDER_ID,
      customer,
      metadata,
      raw,
    };

    const skip = (reason: string) =>
      Result.err({
        code: "unknown_event" as const,
        message: `Skipping Bachs event ${eventType}: ${reason}`,
        providerId: PROVIDER_ID,
      });

    switch (eventType) {
      case "collection.succeeded": {
        const subscriptionId = asString(data.subscription_id);
        const billingReason = asString(data.billing_reason);
        if (billingReason) metadata.billing_reason = billingReason;

        return Result.ok({
          ...base,
          type: "charge.success",
          payment: {
            amount: toMinorUnits(asString(data.amount)),
            currency: normalizeCurrency(data.currency),
            reference: extractPaymentReference(data),
            paidAt:
              asString(data.completed_at) ||
              asString(data.paid_at) ||
              asString(raw.created_at) ||
              undefined,
          },
          subscription: subscriptionId
            ? {
                providerCode: subscriptionId,
                providerSubscriptionId: subscriptionId,
                status: "active",
              }
            : undefined,
        });
      }

      case "collection.failed": {
        const reason = asString(data.reason);
        if (reason) metadata.reason = reason;
        const subscriptionId = asString(data.subscription_id);

        return Result.ok({
          ...base,
          type: "charge.failed",
          payment: {
            amount: toMinorUnits(asString(data.amount)),
            currency: normalizeCurrency(data.currency),
            reference: extractPaymentReference(data),
          },
          subscription: subscriptionId
            ? {
                providerCode: subscriptionId,
                providerSubscriptionId: subscriptionId,
                status: "past_due",
              }
            : undefined,
        });
      }

      case "checkout.completed": {
        // Paid checkouts are reported by collection.succeeded and recurring
        // checkouts by customer.subscription.created. The only case where
        // this is the sole signal is a free trial start (no charge yet).
        const mode = asString(data.mode);
        const paymentStatus = asString(data.payment_status);
        const nestedSub = asRecord(data.subscription);
        const subscriptionId = asString(nestedSub?.subscription_id);

        if (
          mode === "subscription" &&
          paymentStatus === "no_payment_required"
        ) {
          return Result.ok({
            ...base,
            type: "charge.success",
            payment: {
              amount: 0,
              currency: normalizeCurrency(data.currency),
              reference: asString(data.checkout_id) || "",
              paidAt: asString(data.completed_at) || undefined,
            },
            subscription: subscriptionId
              ? {
                  providerCode: subscriptionId,
                  providerSubscriptionId: subscriptionId,
                  status: "trialing",
                }
              : undefined,
          });
        }

        return skip(
          "payment and subscription are reported by dedicated events",
        );
      }

      case "customer.subscription.created": {
        const subscription = extractSubscriptionFromEvent(data);
        return Result.ok({
          ...base,
          type: "subscription.created",
          subscription: subscription ?? {
            providerCode: "",
            status: "active",
          },
          plan: subscription?.planCode
            ? { providerPlanCode: subscription.planCode }
            : undefined,
        });
      }

      case "customer.subscription.updated": {
        const subscription = extractSubscriptionFromEvent(data);
        if (!subscription) {
          return Result.err({
            code: "invalid_payload",
            message: "Bachs subscription event missing subscription_id",
            providerId: PROVIDER_ID,
          });
        }

        const type = subscriptionEventTypeForStatus(
          subscription.status as OwostackSubscriptionStatus,
        );

        return Result.ok({
          ...base,
          type,
          subscription,
          plan: subscription.planCode
            ? { providerPlanCode: subscription.planCode }
            : undefined,
        });
      }

      case "customer.subscription.deleted": {
        const subscription = extractSubscriptionFromEvent(data);
        if (!subscription) {
          return Result.err({
            code: "invalid_payload",
            message: "Bachs subscription event missing subscription_id",
            providerId: PROVIDER_ID,
          });
        }

        return Result.ok({
          ...base,
          type: "subscription.canceled",
          subscription: { ...subscription, status: "canceled" },
          plan: subscription.planCode
            ? { providerPlanCode: subscription.planCode }
            : undefined,
        });
      }

      case "invoice.payment_failed": {
        const nestedSub = asRecord(data.subscription);
        const subscriptionId = asString(nestedSub?.subscription_id);
        const charge = asRecord(data.charge);
        // Let the API correlate this with a staged plan change's proration
        // invoice and tell renewal failures from proration failures.
        const invoiceId = asString(data.invoice_id) || asString(data.id);
        if (invoiceId) metadata.invoice_id = invoiceId;
        const billingReason = asString(data.billing_reason);
        if (billingReason) metadata.billing_reason = billingReason;

        return Result.ok({
          ...base,
          type: "charge.failed",
          payment: {
            amount: toMinorUnits(
              asString(data.amount_remaining) || asString(data.total),
            ),
            currency: normalizeCurrency(data.currency),
            reference:
              asString(charge?.payment_id) ||
              asString(charge?.id) ||
              asString(data.invoice_id) ||
              "",
          },
          subscription: subscriptionId
            ? {
                providerCode: subscriptionId,
                providerSubscriptionId: subscriptionId,
                status: "past_due",
              }
            : undefined,
        });
      }

      case "refund.paid": {
        return Result.ok({
          ...base,
          type: "refund.success",
          refund: {
            amount: toMinorUnits(
              asString(data.refunded_amount) || asString(data.requested_amount),
            ),
            currency: normalizeCurrency(data.currency),
            reference:
              asString(data.charge_id) || asString(data.refund_id) || "",
            reason: asString(data.reason) || undefined,
          },
          payment: {
            amount: toMinorUnits(
              asString(data.refunded_amount) || asString(data.requested_amount),
            ),
            currency: normalizeCurrency(data.currency),
            reference: asString(data.charge_id) || "",
          },
        });
      }

      case "refund.failed": {
        return Result.ok({
          ...base,
          type: "refund.failed",
          refund: {
            amount: toMinorUnits(asString(data.requested_amount)),
            currency: normalizeCurrency(data.currency),
            reference:
              asString(data.charge_id) || asString(data.refund_id) || "",
            reason:
              asString(data.reason) ||
              asString(data.failure_reason) ||
              undefined,
          },
        });
      }

      case "invoice.paid":
        // Renewal money is reported by collection.succeeded; emitting here
        // too would double-count the payment.
        return skip("payment is reported by collection.succeeded");

      default:
        return skip("event type is not handled");
    }
  },
};
