import { Result } from "better-result";
import type {
  CheckoutSession,
  NormalizedWebhookEvent,
  ProviderAccount,
  ProviderAdapter,
  ProviderCustomerRef,
  ProviderPlanRef,
  ProviderCustomerSession,
  ProviderProductRef,
  ProviderResult,
  ProviderSubscriptionDetail,
  ProviderSubscriptionRef,
} from "./index";

interface PolarConfig {
  accessToken: string;
  baseUrl: string;
  timeout?: number;
  maxRetries?: number;
}

interface PolarCheckoutResponse {
  id: string;
  url: string;
  client_secret?: string;
  status?: string;
  is_payment_form_required?: boolean;
  is_payment_setup_required?: boolean;
  subscription_id?: string;
}

const POLAR_BASE_URLS = {
  test: "https://sandbox-api.polar.sh",
  live: "https://api.polar.sh",
} as const;

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_RETRIES = 2;
const PROVIDER_ID = "polar" as const;

class PolarClient {
  private accessToken: string;
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(config: PolarConfig) {
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
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

            const response = await fetch(`${this.baseUrl}${path}`, {
              method,
              headers: {
                Authorization: `Bearer ${this.accessToken}`,
                "Content-Type": "application/json",
              },
              body: body ? JSON.stringify(body) : undefined,
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              const errorBody = await response.text();
              throw new Error(`Polar API ${response.status}: ${errorBody}`);
            }

            const text = await response.text();
            if (!text) return {} as T;

            return JSON.parse(text) as T;
          } catch (error) {
            lastError = error as Error;
            if (attempt < this.maxRetries) {
              await new Promise((resolve) =>
                setTimeout(resolve, Math.pow(2, attempt) * 100),
              );
            }
          }
        }

        throw lastError || new Error("Request failed after retries");
      },
      catch: (error) => ({
        code: "request_failed" as const,
        message: error instanceof Error ? error.message : String(error),
        providerId: PROVIDER_ID,
        cause: error,
      }),
    });
  }

  createCheckoutSession(
    params: Record<string, unknown>,
  ): Promise<ProviderResult<PolarCheckoutResponse>> {
    return this.request("POST", "/v1/checkouts/", params);
  }

  getCheckoutSession(
    checkoutId: string,
  ): Promise<ProviderResult<Record<string, unknown>>> {
    return this.request(
      "GET",
      `/v1/checkouts/${encodeURIComponent(checkoutId)}`,
    );
  }

  confirmCheckoutSessionFromClient(
    clientSecret: string,
    params: Record<string, unknown>,
  ): Promise<ProviderResult<Record<string, unknown>>> {
    return this.request(
      "POST",
      `/v1/checkouts/client/${encodeURIComponent(clientSecret)}/confirm`,
      params,
    );
  }

  createCustomer(params: Record<string, unknown>): Promise<
    ProviderResult<{
      id: string;
      email: string;
    }>
  > {
    return this.request("POST", "/v1/customers", params);
  }

  createCustomerSession(params: Record<string, unknown>): Promise<
    ProviderResult<{
      token?: string;
      customer_portal_url?: string;
      customer_portal?: {
        url?: string;
      };
    }>
  > {
    return this.request("POST", "/v1/customer-sessions", params);
  }

  createProduct(params: Record<string, unknown>): Promise<
    ProviderResult<{
      id: string;
      name?: string;
    }>
  > {
    return this.request("POST", "/v1/products", params);
  }

  updateProduct(
    productId: string,
    params: Record<string, unknown>,
  ): Promise<ProviderResult<Record<string, unknown>>> {
    return this.request(
      "PATCH",
      `/v1/products/${encodeURIComponent(productId)}`,
      params,
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

  revokeSubscription(
    subscriptionId: string,
  ): Promise<ProviderResult<Record<string, unknown>>> {
    return this.request(
      "DELETE",
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
  }

  createRefund(
    params: Record<string, unknown>,
  ): Promise<ProviderResult<Record<string, unknown>>> {
    return this.request("POST", "/v1/refunds", params);
  }
}

function resolveClient(
  account: ProviderAccount,
  environment: "test" | "live",
): ProviderResult<PolarClient> {
  const credentials = account.credentials || {};
  const accessToken =
    typeof credentials.secretKey === "string" ? credentials.secretKey : null;

  if (!accessToken) {
    return Result.err({
      code: "configuration_missing",
      message: "Polar access token missing",
      providerId: PROVIDER_ID,
    });
  }

  const baseUrl =
    typeof credentials.baseUrl === "string" && credentials.baseUrl.length > 0
      ? credentials.baseUrl
      : POLAR_BASE_URLS[environment];

  return Result.ok(new PolarClient({ accessToken, baseUrl }));
}

function coerceMetadata(
  metadata?: Record<string, unknown>,
): Record<string, string> | undefined {
  if (!metadata) return undefined;
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, String(value)]),
  );
}

function mapInterval(interval: string): {
  recurringInterval: "day" | "week" | "month" | "year";
  recurringIntervalCount: number;
} {
  switch (interval.toLowerCase()) {
    case "daily":
      return { recurringInterval: "day", recurringIntervalCount: 1 };
    case "weekly":
      return { recurringInterval: "week", recurringIntervalCount: 1 };
    case "quarterly":
      return { recurringInterval: "month", recurringIntervalCount: 3 };
    case "biannually":
    case "biannual":
    case "semi_annual":
      return { recurringInterval: "month", recurringIntervalCount: 6 };
    case "annually":
    case "yearly":
      return { recurringInterval: "year", recurringIntervalCount: 1 };
    case "monthly":
    default:
      return { recurringInterval: "month", recurringIntervalCount: 1 };
  }
}

function toPolarCurrency(currency: string): string {
  return currency.toLowerCase();
}

function extractProductIds(params: {
  plan?: ProviderPlanRef | null;
  lineItems?: Array<{ priceId: string; quantity: number }>;
}): string[] {
  if (params.plan?.id) {
    return [params.plan.id];
  }

  const items = params.lineItems ?? [];
  if (items.length === 0) {
    return [];
  }

  const productIds: string[] = [];
  for (const item of items) {
    const quantity = Number.isFinite(item.quantity)
      ? Math.max(1, Math.floor(item.quantity))
      : 1;

    // Polar checkouts don't support cart quantities for fixed products.
    // Only pass through synced provider products for a single unit each.
    if (quantity !== 1 || !item.priceId) {
      return [];
    }
    productIds.push(item.priceId);
  }

  return productIds;
}

function buildAdHocProductName(metadata?: Record<string, unknown>): string {
  const checkoutType =
    typeof metadata?.type === "string" ? metadata.type : "custom";

  switch (checkoutType) {
    case "invoice_payment":
      return "Invoice Payment";
    case "plan_upgrade":
      return "Plan Upgrade";
    default:
      return "One-time Checkout";
  }
}

function mapProrationMode(
  mode?: "prorated_immediately" | "full_immediately" | "difference_immediately",
): "invoice" | "prorate" {
  if (!mode) return "invoice";
  return mode === "prorated_immediately" ||
    mode === "difference_immediately" ||
    mode === "full_immediately"
    ? "invoice"
    : "prorate";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
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

function extractPrimaryProductId(data: Record<string, unknown>): string | null {
  const product = asRecord(data.product);
  const productIdFromObj = asString(product?.id);
  if (productIdFromObj) return productIdFromObj;

  const products = Array.isArray(data.products) ? data.products : null;
  if (products && products.length > 0) {
    const first = products[0];
    if (typeof first === "string") return first;
    const firstObj = asRecord(first);
    const firstId = asString(firstObj?.id);
    if (firstId) return firstId;
  }

  return asString(data.product_id);
}

function extractSubscriptionData(
  data: Record<string, unknown>,
  options?: { allowDataIdFallback?: boolean },
): {
  id: string | null;
  status: string;
  planCode: string | null;
  startDate: string | null;
  nextPaymentDate: string | null;
  trialEndDate: string | null;
} {
  const nestedSub = asRecord(data.subscription);
  const id =
    asString(nestedSub?.id) ||
    asString(data.subscription_id) ||
    (options?.allowDataIdFallback ? asString(data.id) : null);

  const status =
    asString(nestedSub?.status) || asString(data.status) || "active";

  const planCode =
    extractPrimaryProductId(nestedSub || {}) || extractPrimaryProductId(data);

  const startDate =
    asString(nestedSub?.current_period_start) ||
    asString(data.current_period_start) ||
    asString(data.started_at) ||
    asString(data.created_at);

  const nextPaymentDate =
    asString(nestedSub?.current_period_end) ||
    asString(data.current_period_end) ||
    asString(data.next_billing_date);

  const trialEndDate =
    asString(nestedSub?.trial_end) || asString(data.trial_end) || null;

  return { id, status, planCode, startDate, nextPaymentDate, trialEndDate };
}

function extractPaymentAmount(data: Record<string, unknown>): number {
  return (
    asNumber(data.amount) ??
    asNumber(data.total_amount) ??
    asNumber(data.subtotal_amount) ??
    0
  );
}

function extractMetadata(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const raw = data.metadata;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function looksLikeBase64(value: string): boolean {
  if (value.length === 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(value);
}

function looksLikeBase64Url(value: string): boolean {
  if (value.length === 0) return false;
  return /^[A-Za-z0-9\-_]+$/.test(value);
}

function decodeBase64Flexible(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingNeeded = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(paddingNeeded);
  if (!looksLikeBase64(padded)) return null;

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function toUtf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeSecret(secret: string): Uint8Array | null {
  const normalizedSecret = secret.trim();
  const hasWhsecPrefix = normalizedSecret.startsWith("whsec_");
  const hasPolarPrefix = normalizedSecret.startsWith("polar_whs_");
  const stripped = hasWhsecPrefix
    ? normalizedSecret.slice(6)
    : hasPolarPrefix
      ? normalizedSecret.slice(10)
      : normalizedSecret;

  if (
    hasWhsecPrefix ||
    hasPolarPrefix ||
    looksLikeBase64(stripped) ||
    looksLikeBase64Url(stripped)
  ) {
    const decoded = decodeBase64Flexible(stripped);
    if (decoded) return decoded;
  }

  return null;
}

function maskValue(value: string, start = 6, end = 4): string {
  if (!value) return "<empty>";
  if (value.length <= start + end) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  // Clone into a plain Uint8Array so TS sees an ArrayBuffer-backed BufferSource.
  const normalized = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", normalized);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyStandardWebhook(params: {
  webhookId: string;
  webhookTimestamp: string;
  webhookSignature: string;
  payload: string;
  secret: string;
}): Promise<{ valid: boolean; diagnostics: Record<string, unknown> }> {
  const { webhookId, webhookTimestamp, webhookSignature, payload, secret } =
    params;

  const normalizedTimestamp = webhookTimestamp.trim();
  const timestamp = Number.parseInt(normalizedTimestamp, 10);
  if (!Number.isFinite(timestamp)) {
    return {
      valid: false,
      diagnostics: {
        reason: "invalid_timestamp",
        webhookId,
        webhookTimestamp,
        webhookTimestampTrimmed: normalizedTimestamp,
      },
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const skewSeconds = now - timestamp;
  if (Math.abs(skewSeconds) > 300) {
    return {
      valid: false,
      diagnostics: {
        reason: "timestamp_out_of_range",
        webhookId,
        webhookTimestamp: normalizedTimestamp,
        now,
        skewSeconds,
      },
    };
  }

  const signedMessage = `${webhookId}.${normalizedTimestamp}.${payload}`;
  const candidates: string[] = [];
  for (const chunk of webhookSignature.trim().split(" ")) {
    const parts = chunk.split(",");
    if (parts.length >= 2) {
      candidates.push(parts.slice(1).join(","));
    } else if (chunk.length > 0) {
      candidates.push(chunk);
    }
  }

  const signatureBytesCandidates = candidates
    .map((candidate) => decodeBase64Flexible(candidate.trim()))
    .filter((candidate): candidate is Uint8Array => candidate !== null);

  const normalizedSecret = secret.trim();
  const strippedSecret = normalizedSecret.startsWith("whsec_")
    ? normalizedSecret.slice(6)
    : normalizedSecret.startsWith("polar_whs_")
      ? normalizedSecret.slice(10)
      : normalizedSecret;

  const secretStrategies: Array<{ name: string; key: Uint8Array }> = [];
  const pushSecretStrategy = (name: string, key: Uint8Array | null) => {
    if (!key || key.length === 0) return;
    if (
      secretStrategies.some(
        (s) =>
          s.key.length === key.length && s.key.every((v, i) => v === key[i]),
      )
    ) {
      return;
    }
    secretStrategies.push({ name, key });
  };

  // Polar docs + standard-webhooks ecosystem show multiple valid secret encodings in the wild.
  // We verify against all canonical derivations to avoid false negatives.
  pushSecretStrategy("raw_utf8_full", toUtf8Bytes(normalizedSecret));
  if (strippedSecret !== normalizedSecret) {
    pushSecretStrategy("raw_utf8_stripped", toUtf8Bytes(strippedSecret));
  }
  pushSecretStrategy("base64_decoded_stripped", decodeSecret(normalizedSecret));
  pushSecretStrategy(
    "base64_decoded_full",
    decodeBase64Flexible(normalizedSecret),
  );

  let matchedStrategy: string | null = null;
  let computedForMatched: string | null = null;
  const perStrategyComputed: Array<{
    strategy: string;
    computedSignaturePreview: string;
    keyLength: number;
    keySha256: string;
  }> = [];

  for (const strategy of secretStrategies) {
    const key = await crypto.subtle.importKey(
      "raw",
      strategy.key.buffer as ArrayBuffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signedMessage),
    );
    const computedBytes = new Uint8Array(signatureBuffer);
    const computed = btoa(String.fromCharCode(...computedBytes));

    perStrategyComputed.push({
      strategy: strategy.name,
      computedSignaturePreview: maskValue(computed),
      keyLength: strategy.key.length,
      keySha256: (await sha256Hex(strategy.key)).slice(0, 24),
    });

    const matchedByBytes = signatureBytesCandidates.some((candidate) => {
      if (candidate.length !== computedBytes.length) return false;
      for (let i = 0; i < candidate.length; i++) {
        if (candidate[i] !== computedBytes[i]) return false;
      }
      return true;
    });

    const matchedByString = candidates.includes(computed);
    if (matchedByBytes || matchedByString) {
      matchedStrategy = strategy.name;
      computedForMatched = computed;
      break;
    }
  }

  const valid = matchedStrategy !== null;
  return {
    valid,
    diagnostics: {
      reason: valid ? "matched" : "signature_mismatch",
      webhookId,
      webhookTimestamp: normalizedTimestamp,
      now,
      skewSeconds,
      signatureHeaderLength: webhookSignature.length,
      signatureCandidatesCount: candidates.length,
      signatureCandidatesPreview: candidates
        .slice(0, 5)
        .map((c) => maskValue(c)),
      matchedStrategy,
      computedSignature: computedForMatched,
      computedSignaturePreview: computedForMatched
        ? maskValue(computedForMatched)
        : null,
      secretLength: secret.length,
      secretPreview: maskValue(secret),
      secretStrategiesTried: secretStrategies.map((strategy) => strategy.name),
      perStrategyComputed,
      payloadSha256: (await sha256Hex(payload)).slice(0, 24),
      signedMessageSha256: (await sha256Hex(signedMessage)).slice(0, 24),
    },
  };
}

function mapSubscriptionStatusToEventType(
  status: string,
  options?: { cancelAtPeriodEnd?: boolean | null },
):
  | "subscription.active"
  | "subscription.canceled"
  | "subscription.not_renew"
  | "subscription.past_due" {
  const normalized = status.toLowerCase();
  if (
    normalized === "revoked" ||
    normalized === "unpaid" ||
    normalized === "expired"
  ) {
    return "subscription.canceled";
  }
  if (normalized === "canceled" || normalized === "cancelled") {
    return "subscription.not_renew";
  }
  if (normalized === "past_due") {
    return "subscription.past_due";
  }
  if (options?.cancelAtPeriodEnd === true) {
    return "subscription.not_renew";
  }
  return "subscription.active";
}

function normalizeCurrency(currency: string | null, fallback: string): string {
  return (currency || fallback).toUpperCase();
}

function toTrialIntervalCount(days: number): number {
  if (!Number.isFinite(days)) return 1;
  return Math.max(1, Math.floor(days));
}

function resolveExternalCustomerId(
  customer: ProviderCustomerRef,
): string | null {
  const id = asString(customer.id);
  if (!id) return null;
  if (id === customer.email) return null;
  return id;
}

function buildChargeProductName(metadata?: Record<string, unknown>): string {
  const type = typeof metadata?.type === "string" ? metadata.type : "";
  if (type === "invoice_payment") return "Invoice Auto Charge";
  if (type === "overage_billing") return "Overage Auto Charge";
  if (type === "trial_conversion") return "Trial Conversion Charge";
  return "Off-session Charge";
}

function isCheckoutTerminalFailure(status: string): boolean {
  const normalized = status.toLowerCase();
  return (
    normalized === "failed" ||
    normalized === "expired" ||
    normalized === "canceled"
  );
}

function isCheckoutSuccess(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === "succeeded" || normalized === "success";
}

export const polarAdapter: ProviderAdapter = {
  id: PROVIDER_ID,
  displayName: "Polar",
  signatureHeaderName: "webhook-signature",
  supportsNativeTrials: true,
  defaultCurrency: "USD",

  async createCheckoutSession(
    params,
  ): Promise<ProviderResult<CheckoutSession>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    if (params.onDemand?.mandateOnly) {
      return Result.err({
        code: "unsupported",
        message:
          "Polar mandate-only checkout is not supported by this adapter yet",
        providerId: PROVIDER_ID,
      });
    }

    const client = clientResult.value;
    const metadata = coerceMetadata(params.metadata);

    let productIds = extractProductIds({
      plan: params.plan,
      lineItems: params.lineItems,
    });

    if (productIds.length === 0) {
      if (params.amount <= 0) {
        return Result.err({
          code: "invalid_request",
          message:
            "Polar checkout requires a product. Provide a plan/line item or a positive amount.",
          providerId: PROVIDER_ID,
        });
      }

      const adHocProductResult = await client.createProduct({
        name: buildAdHocProductName(params.metadata),
        description: "Auto-generated checkout product",
        prices: [
          {
            amount_type: "fixed",
            price_amount: params.amount,
            price_currency: toPolarCurrency(params.currency),
          },
        ],
        metadata,
      });

      if (adHocProductResult.isErr()) {
        return adHocProductResult as ProviderResult<CheckoutSession>;
      }

      productIds = [adHocProductResult.value.id];
    }

    const body: Record<string, unknown> = {
      products: productIds,
      customer_email: params.customer.email,
      metadata,
    };

    if (params.callbackUrl) {
      body.success_url = params.callbackUrl;
    }

    const externalCustomerId = resolveExternalCustomerId(params.customer);
    if (externalCustomerId) {
      body.external_customer_id = externalCustomerId;
    }

    if (params.trialDays && params.trialDays > 0) {
      body.allow_trial = true;
      body.trial_interval = "day";
      body.trial_interval_count = toTrialIntervalCount(params.trialDays);
    }

    const response = await client.createCheckoutSession(body);
    if (response.isErr()) return response;

    return Result.ok({
      url: response.value.url,
      reference: response.value.id,
      accessCode: null,
    });
  },

  async createProduct(params): Promise<ProviderResult<ProviderProductRef>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.createProduct({
      name: params.name,
      description: params.description || undefined,
      prices: [
        {
          amount_type: "fixed",
          price_amount: params.amount,
          price_currency: toPolarCurrency(params.currency),
        },
      ],
      metadata: coerceMetadata(params.metadata),
    });

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

    const response = await clientResult.value.createCustomer({
      email: params.email,
      name: params.name || undefined,
      metadata: coerceMetadata(params.metadata),
    });

    if (response.isErr()) return response;

    return Result.ok({
      id: response.value.id,
      email: response.value.email,
      metadata: params.metadata,
    });
  },

  async createCustomerSession(
    params,
  ): Promise<ProviderResult<ProviderCustomerSession>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const providerCustomerId =
      params.customer.id && !params.customer.id.includes("@")
        ? params.customer.id
        : null;

    if (!providerCustomerId) {
      return Result.err({
        code: "invalid_request",
        message: "Polar customer session requires a provider customer ID",
        providerId: PROVIDER_ID,
      });
    }

    const response = await clientResult.value.createCustomerSession({
      customer_id: providerCustomerId,
      ...(params.metadata ? { metadata: coerceMetadata(params.metadata) } : {}),
    });

    if (response.isErr()) return response;

    const portal = asRecord(response.value.customer_portal);
    const url =
      asString(response.value.customer_portal_url) || asString(portal?.url);

    if (!url) {
      return Result.err({
        code: "request_failed",
        message: "Polar customer session response missing customer portal URL",
        providerId: PROVIDER_ID,
      });
    }

    return Result.ok({
      url,
      token: asString(response.value.token),
    });
  },

  async createPlan(params): Promise<ProviderResult<ProviderPlanRef>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const { recurringInterval, recurringIntervalCount } = mapInterval(
      params.interval,
    );

    const response = await clientResult.value.createProduct({
      name: params.name,
      description: params.description || undefined,
      recurring_interval: recurringInterval,
      recurring_interval_count: recurringIntervalCount,
      prices: [
        {
          amount_type: "fixed",
          price_amount: params.amount,
          price_currency: toPolarCurrency(params.currency),
        },
      ],
    });

    if (response.isErr()) return response;

    return Result.ok({
      id: response.value.id,
      metadata: {},
    });
  },

  async updatePlan(params): Promise<ProviderResult<{ updated: boolean }>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const body: Record<string, unknown> = {};

    if (params.name !== undefined) body.name = params.name;
    if (params.description !== undefined) body.description = params.description;

    if (params.interval !== undefined) {
      const mapped = mapInterval(params.interval);
      body.recurring_interval = mapped.recurringInterval;
      body.recurring_interval_count = mapped.recurringIntervalCount;
    }

    if (params.amount !== undefined || params.currency !== undefined) {
      if (params.amount === undefined || params.currency === undefined) {
        return Result.err({
          code: "invalid_request",
          message:
            "Polar updatePlan requires both amount and currency when updating price",
          providerId: PROVIDER_ID,
        });
      }

      body.prices = [
        {
          amount_type: "fixed",
          price_amount: params.amount,
          price_currency: toPolarCurrency(params.currency),
        },
      ];
    }

    if (Object.keys(body).length === 0) {
      return Result.ok({ updated: true });
    }

    const response = await clientResult.value.updateProduct(
      params.planId,
      body,
    );
    if (response.isErr()) return response;

    return Result.ok({ updated: true });
  },

  async createSubscription(
    params,
  ): Promise<ProviderResult<ProviderSubscriptionRef>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const body: Record<string, unknown> = {
      products: [params.plan.id],
      customer_email: params.customer.email,
      ...(params.metadata ? { metadata: coerceMetadata(params.metadata) } : {}),
    };

    const externalCustomerId = resolveExternalCustomerId(params.customer);
    if (externalCustomerId) {
      body.external_customer_id = externalCustomerId;
    }

    const response = await clientResult.value.createCheckoutSession(body);

    if (response.isErr()) return response;

    return Result.ok({
      id: response.value.id,
      status: "pending",
      metadata: {
        checkout_url: response.value.url,
        ...(params.metadata || {}),
      },
    });
  },

  async cancelSubscription(
    params,
  ): Promise<ProviderResult<{ canceled: boolean }>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.revokeSubscription(
      params.subscription.id,
    );
    if (response.isErr())
      return response as ProviderResult<{ canceled: boolean }>;

    return Result.ok({ canceled: true });
  },

  async chargeAuthorization(
    params,
  ): Promise<ProviderResult<{ reference: string }>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const providerCustomerId =
      params.customer.id && !params.customer.id.includes("@")
        ? params.customer.id
        : null;

    if (!providerCustomerId) {
      return Result.err({
        code: "invalid_request",
        message: "Polar off-session charge requires the provider customer ID",
        providerId: PROVIDER_ID,
      });
    }

    if (!params.authorizationCode) {
      return Result.err({
        code: "invalid_request",
        message:
          "Polar off-session charge requires a saved payment method token",
        providerId: PROVIDER_ID,
      });
    }

    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      return Result.err({
        code: "invalid_request",
        message: "Polar off-session charge amount must be greater than 0",
        providerId: PROVIDER_ID,
      });
    }

    const client = clientResult.value;
    const metadata = coerceMetadata({
      ...(params.metadata || {}),
      payment_method_token: params.authorizationCode,
    });

    const adHocProductResult = await client.createProduct({
      name: buildChargeProductName(params.metadata),
      description: "Auto-generated product for off-session charge",
      prices: [
        {
          amount_type: "fixed",
          price_amount: params.amount,
          price_currency: toPolarCurrency(params.currency),
        },
      ],
      metadata,
    });
    if (adHocProductResult.isErr()) {
      return adHocProductResult as ProviderResult<{ reference: string }>;
    }

    const checkoutResult = await client.createCheckoutSession({
      products: [adHocProductResult.value.id],
      customer_id: providerCustomerId,
      customer_email: params.customer.email,
      metadata,
    });
    if (checkoutResult.isErr()) {
      return checkoutResult as ProviderResult<{ reference: string }>;
    }

    const checkoutId = asString(checkoutResult.value.id);
    const clientSecret = asString(checkoutResult.value.client_secret);
    if (!checkoutId || !clientSecret) {
      return Result.err({
        code: "request_failed",
        message:
          "Polar checkout response missing id/client_secret for off-session charge",
        providerId: PROVIDER_ID,
      });
    }

    const paymentFormRequired =
      asBoolean(checkoutResult.value.is_payment_form_required) === true ||
      asBoolean(checkoutResult.value.is_payment_setup_required) === true;

    if (paymentFormRequired) {
      return Result.err({
        code: "invalid_request",
        message:
          "Polar checkout requires customer payment form input; off-session charge is unavailable for this customer",
        providerId: PROVIDER_ID,
      });
    }

    const confirmResult = await client.confirmCheckoutSessionFromClient(
      clientSecret,
      {},
    );
    if (confirmResult.isErr()) {
      return confirmResult as ProviderResult<{ reference: string }>;
    }

    const confirmStatus = asString(confirmResult.value.status);
    if (confirmStatus && isCheckoutTerminalFailure(confirmStatus)) {
      return Result.err({
        code: "request_failed",
        message: `Polar checkout confirmation failed with status=${confirmStatus}`,
        providerId: PROVIDER_ID,
      });
    }

    if (confirmStatus && isCheckoutSuccess(confirmStatus)) {
      return Result.ok({
        reference:
          asString(confirmResult.value.id) ||
          checkoutId ||
          params.reference ||
          `polar-${Date.now()}`,
      });
    }

    // Poll a few times for terminal checkout state after confirmation.
    let lastKnownStatus = confirmStatus;
    for (let attempt = 0; attempt < 5; attempt++) {
      const getResult = await client.getCheckoutSession(checkoutId);
      if (!getResult.isErr()) {
        const status = asString(getResult.value.status);
        if (status) lastKnownStatus = status;
        if (status && isCheckoutTerminalFailure(status)) {
          return Result.err({
            code: "request_failed",
            message: `Polar checkout failed with status=${status}`,
            providerId: PROVIDER_ID,
          });
        }
        if (status && isCheckoutSuccess(status)) {
          return Result.ok({
            reference:
              asString(getResult.value.id) ||
              checkoutId ||
              params.reference ||
              `polar-${Date.now()}`,
          });
        }
      }

      if (attempt < 4) {
        await new Promise((resolve) =>
          setTimeout(resolve, (attempt + 1) * 300),
        );
      }
    }

    return Result.err({
      code: "request_failed",
      message: `Polar off-session checkout did not reach a successful state (last_status=${lastKnownStatus || "unknown"})`,
      providerId: PROVIDER_ID,
    });
  },

  async changePlan(params): Promise<ProviderResult<{ changed: boolean }>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.updateSubscription(
      params.subscriptionId,
      {
        product_id: params.newPlanId,
        proration_behavior: mapProrationMode(params.prorationMode),
      },
    );

    if (response.isErr())
      return response as ProviderResult<{ changed: boolean }>;

    return Result.ok({ changed: true });
  },

  async refundCharge(
    params,
  ): Promise<ProviderResult<{ refunded: boolean; reference: string }>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const body: Record<string, unknown> = {
      order_id: params.reference,
      ...(params.reason ? { reason: params.reason } : {}),
    };

    if (typeof params.amount === "number" && Number.isFinite(params.amount)) {
      body.amount = params.amount;
    }

    const response = await clientResult.value.createRefund(body);
    if (response.isErr()) return response;

    return Result.ok({ refunded: true, reference: params.reference });
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

    const sub = response.value;
    const subRecord = asRecord(sub) || {};

    const subId = asString(subRecord.id) || params.subscriptionId;
    const status = asString(subRecord.status) || "unknown";

    const product = asRecord(subRecord.product);
    const planCode =
      asString(product?.id) || asString(subRecord.product_id) || undefined;

    return Result.ok({
      id: subId,
      status,
      planCode,
      startDate:
        asString(subRecord.current_period_start) ||
        asString(subRecord.started_at) ||
        asString(subRecord.created_at) ||
        undefined,
      nextPaymentDate:
        asString(subRecord.current_period_end) ||
        asString(subRecord.next_billing_date) ||
        undefined,
      metadata: subRecord,
    });
  },

  async verifyWebhook(params): Promise<ProviderResult<boolean>> {
    try {
      const headers = params.headers || {};
      const webhookId = headers["webhook-id"] || "";
      const webhookTimestamp = headers["webhook-timestamp"] || "";
      const webhookSignature =
        params.signature || headers["webhook-signature"] || "";

      if (!webhookId || !webhookTimestamp || !webhookSignature) {
        console.error(
          "[POLAR] Webhook verification failed: missing standard webhook headers",
          {
            hasWebhookId: !!webhookId,
            hasWebhookTimestamp: !!webhookTimestamp,
            hasWebhookSignature: !!webhookSignature,
            headerKeys: Object.keys(headers),
          },
        );
        return Result.ok(false);
      }

      const verification = await verifyStandardWebhook({
        webhookId,
        webhookTimestamp,
        webhookSignature,
        payload: params.payload,
        secret: params.secret,
      });

      if (!verification.valid) {
        console.error(
          "[POLAR] Webhook signature mismatch",
          verification.diagnostics,
        );
      }

      return Result.ok(verification.valid);
    } catch (error) {
      console.error("[POLAR] Webhook verification exception", {
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
        message: "Missing type or data in Polar webhook payload",
        providerId: PROVIDER_ID,
      });
    }

    const customer = asRecord(data.customer);
    const customerEmail =
      asString(customer?.email) || asString(data.email) || "";
    const customerId =
      asString(customer?.id) ||
      asString(data.customer_id) ||
      asString(customer?.customer_id) ||
      asString(customer?.external_id) ||
      asString(data.external_customer_id) ||
      asString(data.customer_external_id) ||
      "";

    const metadata = extractMetadata(data);
    const primaryProductId = extractPrimaryProductId(data);
    const subscription = extractSubscriptionData(data, {
      allowDataIdFallback: eventType.startsWith("subscription."),
    });

    const base = {
      provider: PROVIDER_ID,
      customer: {
        email: customerEmail,
        providerCustomerId: customerId,
      },
      metadata,
      raw,
    };

    switch (eventType) {
      case "order.paid":
        return Result.ok({
          ...base,
          type: "charge.success",
          payment: {
            amount: extractPaymentAmount(data),
            currency: normalizeCurrency(asString(data.currency), "USD"),
            reference: asString(data.id) || "",
            paidAt:
              asString(data.paid_at) ||
              asString(data.processed_at) ||
              asString(data.created_at) ||
              undefined,
          },
          subscription: subscription.id
            ? {
                providerCode: subscription.id,
                providerSubscriptionId: subscription.id,
                status: subscription.status,
                planCode: subscription.planCode || undefined,
                startDate: subscription.startDate || undefined,
                nextPaymentDate: subscription.nextPaymentDate || undefined,
                trialEndDate: subscription.trialEndDate || undefined,
              }
            : undefined,
          plan: primaryProductId
            ? { providerPlanCode: primaryProductId }
            : undefined,
        });

      case "order.refunded":
        return Result.ok({
          ...base,
          type: "refund.success",
          refund: {
            amount: extractPaymentAmount(data),
            currency: normalizeCurrency(asString(data.currency), "USD"),
            reference: asString(data.id) || asString(data.order_id) || "",
            reason: asString(data.reason) || undefined,
          },
          payment: {
            amount: extractPaymentAmount(data),
            currency: normalizeCurrency(asString(data.currency), "USD"),
            reference: asString(data.order_id) || asString(data.id) || "",
          },
        });

      case "refund.updated": {
        const status = asString(data.status)?.toLowerCase() || "";
        if (status === "succeeded" || status === "success") {
          return Result.ok({
            ...base,
            type: "refund.success",
            refund: {
              amount: extractPaymentAmount(data),
              currency: normalizeCurrency(asString(data.currency), "USD"),
              reference: asString(data.id) || asString(data.order_id) || "",
              reason: asString(data.reason) || undefined,
            },
          });
        }

        if (status === "failed") {
          return Result.ok({
            ...base,
            type: "refund.failed",
            refund: {
              amount: extractPaymentAmount(data),
              currency: normalizeCurrency(asString(data.currency), "USD"),
              reference: asString(data.id) || asString(data.order_id) || "",
              reason: asString(data.reason) || undefined,
            },
          });
        }

        return Result.err({
          code: "unknown_event",
          message: `Unsupported Polar refund.updated status: ${status || "unknown"}`,
          providerId: PROVIDER_ID,
        });
      }

      case "subscription.created":
        return Result.ok({
          ...base,
          type: "subscription.created",
          subscription: {
            providerCode: subscription.id || "",
            providerSubscriptionId: subscription.id || undefined,
            status: subscription.status,
            planCode: subscription.planCode || undefined,
            startDate: subscription.startDate || undefined,
            nextPaymentDate: subscription.nextPaymentDate || undefined,
            trialEndDate: subscription.trialEndDate || undefined,
          },
          plan: subscription.planCode
            ? { providerPlanCode: subscription.planCode }
            : undefined,
        });

      case "subscription.active":
      case "subscription.uncanceled":
        return Result.ok({
          ...base,
          type: "subscription.active",
          subscription: {
            providerCode: subscription.id || "",
            providerSubscriptionId: subscription.id || undefined,
            status: "active",
            planCode: subscription.planCode || undefined,
            startDate: subscription.startDate || undefined,
            nextPaymentDate: subscription.nextPaymentDate || undefined,
            trialEndDate: subscription.trialEndDate || undefined,
          },
          plan: subscription.planCode
            ? { providerPlanCode: subscription.planCode }
            : undefined,
        });

      case "subscription.canceled":
        return Result.ok({
          ...base,
          type: "subscription.not_renew",
          subscription: {
            providerCode: subscription.id || "",
            providerSubscriptionId: subscription.id || undefined,
            status: "pending_cancel",
            planCode: subscription.planCode || undefined,
            startDate: subscription.startDate || undefined,
            nextPaymentDate: subscription.nextPaymentDate || undefined,
            trialEndDate: subscription.trialEndDate || undefined,
          },
          plan: subscription.planCode
            ? { providerPlanCode: subscription.planCode }
            : undefined,
        });

      case "subscription.past_due":
        return Result.ok({
          ...base,
          type: "subscription.past_due",
          subscription: {
            providerCode: subscription.id || "",
            providerSubscriptionId: subscription.id || undefined,
            status: "past_due",
            planCode: subscription.planCode || undefined,
            startDate: subscription.startDate || undefined,
            nextPaymentDate: subscription.nextPaymentDate || undefined,
            trialEndDate: subscription.trialEndDate || undefined,
          },
          plan: subscription.planCode
            ? { providerPlanCode: subscription.planCode }
            : undefined,
        });

      case "subscription.unpaid":
        return Result.ok({
          ...base,
          type: "subscription.canceled",
          subscription: {
            providerCode: subscription.id || "",
            providerSubscriptionId: subscription.id || undefined,
            status: "canceled",
            planCode: subscription.planCode || undefined,
            startDate: subscription.startDate || undefined,
            nextPaymentDate: subscription.nextPaymentDate || undefined,
            trialEndDate: subscription.trialEndDate || undefined,
          },
          plan: subscription.planCode
            ? { providerPlanCode: subscription.planCode }
            : undefined,
        });

      case "subscription.revoked":
        return Result.ok({
          ...base,
          type: "subscription.canceled",
          subscription: {
            providerCode: subscription.id || "",
            providerSubscriptionId: subscription.id || undefined,
            status: "canceled",
            planCode: subscription.planCode || undefined,
            startDate: subscription.startDate || undefined,
            nextPaymentDate: subscription.nextPaymentDate || undefined,
            trialEndDate: subscription.trialEndDate || undefined,
          },
          plan: subscription.planCode
            ? { providerPlanCode: subscription.planCode }
            : undefined,
        });

      case "subscription.updated": {
        const nestedSubscription = asRecord(data.subscription);
        const cancelAtPeriodEnd =
          asBoolean(nestedSubscription?.cancel_at_period_end) ??
          asBoolean(data.cancel_at_period_end);

        const type = mapSubscriptionStatusToEventType(subscription.status, {
          cancelAtPeriodEnd,
        });
        const normalizedStatus =
          type === "subscription.canceled"
            ? "canceled"
            : type === "subscription.not_renew"
              ? "pending_cancel"
              : type === "subscription.past_due"
                ? "past_due"
                : "active";

        return Result.ok({
          ...base,
          type,
          subscription: {
            providerCode: subscription.id || "",
            providerSubscriptionId: subscription.id || undefined,
            status: normalizedStatus,
            planCode: subscription.planCode || undefined,
            startDate: subscription.startDate || undefined,
            nextPaymentDate: subscription.nextPaymentDate || undefined,
            trialEndDate: subscription.trialEndDate || undefined,
          },
          plan: subscription.planCode
            ? { providerPlanCode: subscription.planCode }
            : undefined,
        });
      }

      default:
        return Result.err({
          code: "unknown_event",
          message: `Unsupported Polar event: ${eventType}`,
          providerId: PROVIDER_ID,
        });
    }
  },
};
