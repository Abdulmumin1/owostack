import { Result } from "better-result";
import type {
  CheckoutLineItem,
  CheckoutSession,
  NormalizedWebhookEvent,
  ProviderAccount,
  ProviderAdapter,
  ProviderCustomerRef,
  ProviderPlanRef,
  ProviderProductRef,
  ProviderResult,
  ProviderSubscriptionDetail,
  ProviderSubscriptionRef,
} from "./index";

const PROVIDER_ID = "stripe" as const;
const STRIPE_API_BASE = "https://api.stripe.com/v1";
const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_RETRIES = 2;
const WEBHOOK_TOLERANCE_SECONDS = 300;

interface StripeConfig {
  secretKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

interface StripeErrorResponse {
  error?: {
    message?: string;
    type?: string;
    param?: string;
    code?: string;
  };
}

interface StripeListResponse<T> {
  data?: T[];
}

interface StripeCustomerResponse {
  id: string;
  email?: string | null;
  metadata?: Record<string, string>;
}

interface StripeProductResponse {
  id: string;
  default_price?: string | null;
  description?: string | null;
  metadata?: Record<string, string>;
  name?: string | null;
}

interface StripePriceResponse {
  active?: boolean | null;
  currency?: string | null;
  id: string;
  metadata?: Record<string, string>;
  product?: string | { id?: string | null } | null;
  recurring?: {
    interval?: "day" | "week" | "month" | "year" | null;
    interval_count?: number | null;
  } | null;
  unit_amount?: number | null;
}

interface StripeCheckoutSessionResponse {
  id: string;
  url?: string | null;
}

interface StripeSubscriptionItemResponse {
  id?: string;
  current_period_start?: number | null;
  current_period_end?: number | null;
  price?: { id?: string | null } | null;
}

interface StripeSubscriptionResponse {
  id: string;
  status?: string | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  cancel_at?: number | null;
  items?: StripeListResponse<StripeSubscriptionItemResponse> | null;
  metadata?: Record<string, string>;
}

interface StripePaymentIntentResponse {
  id: string;
  status?: string | null;
}

interface StripeRefundResponse {
  id: string;
  status?: string | null;
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? Number(value)
      : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isTruthy(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function isStripeCustomerId(value: string | undefined): boolean {
  return typeof value === "string" && /^cus_/.test(value);
}

function isStripePaymentMethodId(value: string | undefined): boolean {
  return typeof value === "string" && /^pm_/.test(value);
}

function toUnixTimestamp(isoDate: string | undefined): number | undefined {
  if (!isoDate) return undefined;
  const parsed = Date.parse(isoDate);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.floor(parsed / 1000);
}

function fromUnixTimestamp(value: unknown): string | undefined {
  const seconds = asNumber(value);
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function uppercaseCurrency(value: unknown, fallback = "USD"): string {
  return asString(value)?.toUpperCase() || fallback;
}

function lowercaseCurrency(value: string): string {
  return value.toLowerCase();
}

function mergeMetadata(
  ...sources: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      next[key] = value;
    }
  }
  return next;
}

function coerceMetadata(
  metadata?: Record<string, unknown>,
): Record<string, string> | undefined {
  if (!metadata) return undefined;

  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      next[key] = value;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      next[key] = String(value);
      continue;
    }
    next[key] = JSON.stringify(value);
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function appendFormValue(
  params: URLSearchParams,
  key: string,
  value: unknown,
): void {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      appendFormValue(params, `${key}[${index}]`, item);
    });
    return;
  }

  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      appendFormValue(params, `${key}[${childKey}]`, childValue);
    }
    return;
  }

  params.append(key, String(value));
}

function toFormBody(body?: Record<string, unknown>): string | undefined {
  if (!body) return undefined;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    appendFormValue(params, key, value);
  }
  return params.toString();
}

function intervalToStripe(interval: string): {
  interval: "day" | "week" | "month" | "year";
  interval_count?: number;
} {
  switch (interval) {
    case "weekly":
      return { interval: "week" };
    case "quarterly":
      return { interval: "month", interval_count: 3 };
    case "yearly":
    case "annually":
      return { interval: "year" };
    case "monthly":
    default:
      return { interval: "month" };
  }
}

function stripeRecurringMatches(
  recurring:
    | {
        interval?: "day" | "week" | "month" | "year" | null;
        interval_count?: number | null;
      }
    | null
    | undefined,
  interval: string,
): boolean {
  const expected = intervalToStripe(interval);
  if (!recurring?.interval) return false;

  const actualCount =
    typeof recurring.interval_count === "number" && recurring.interval_count > 0
      ? recurring.interval_count
      : 1;
  const expectedCount = expected.interval_count ?? 1;

  return (
    recurring.interval === expected.interval && actualCount === expectedCount
  );
}

function mapProrationMode(
  mode:
    | "prorated_immediately"
    | "full_immediately"
    | "difference_immediately"
    | undefined,
): "create_prorations" | "always_invoice" | "none" {
  switch (mode) {
    case "difference_immediately":
    case "full_immediately":
    case "prorated_immediately":
    default:
      return "always_invoice";
  }
}

function buildCheckoutItemName(metadata: Record<string, unknown>): string {
  switch (metadata.type) {
    case "card_setup":
      return "Payment method authorization";
    case "invoice_payment":
      return metadata.invoice_number
        ? `Invoice ${String(metadata.invoice_number)}`
        : "Invoice payment";
    case "plan_upgrade":
      return "Plan upgrade";
    case "credit_purchase":
      return metadata.credit_pack_slug
        ? `Credit pack: ${String(metadata.credit_pack_slug)}`
        : "Credit purchase";
    case "one_time_purchase":
      return "One-time purchase";
    default:
      return "Owostack payment";
  }
}

function getSecretKey(account: ProviderAccount): string | null {
  const secretKey = account.credentials?.secretKey;
  return typeof secretKey === "string" && secretKey.length > 0
    ? secretKey
    : null;
}

function resolveClient(account: ProviderAccount): ProviderResult<StripeClient> {
  const secretKey = getSecretKey(account);
  if (!secretKey) {
    return Result.err({
      code: "configuration_missing",
      message: "Stripe secret key missing",
      providerId: PROVIDER_ID,
    });
  }

  return Result.ok(new StripeClient({ secretKey }));
}

function extractStripeMetadata(
  source: Record<string, any> | undefined,
): Record<string, unknown> {
  const metadata = asRecord(source?.metadata);
  return metadata ? { ...metadata } : {};
}

function extractCheckoutQuantity(
  metadata: Record<string, unknown>,
  amount: number,
): Array<{ priceId?: string; quantity: number }> | undefined {
  const unitAmount = asNumber(metadata.checkout_unit_amount);
  if (
    unitAmount === undefined ||
    !Number.isFinite(unitAmount) ||
    unitAmount <= 0 ||
    amount <= 0
  ) {
    return undefined;
  }

  const quantity = amount / unitAmount;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return undefined;
  }

  const priceId = asString(metadata.checkout_price_id);
  return [{ priceId, quantity }];
}

function extractCardDetails(source: Record<string, any> | undefined) {
  const charges = asArray<Record<string, any>>(asRecord(source?.charges)?.data);
  const charge = asRecord(charges[0]);
  const card = asRecord(asRecord(charge?.payment_method_details)?.card);

  return {
    email:
      asString(asRecord(charge?.billing_details)?.email) ||
      asString(source?.receipt_email),
    cardType: asString(card?.brand),
    last4: asString(card?.last4),
    expMonth:
      asNumber(card?.exp_month) !== undefined
        ? String(asNumber(card?.exp_month))
        : undefined,
    expYear:
      asNumber(card?.exp_year) !== undefined
        ? String(asNumber(card?.exp_year))
        : undefined,
  };
}

function extractSubscriptionPriceId(
  subscription: Record<string, any> | undefined,
): string | undefined {
  const items = asArray<Record<string, any>>(
    asRecord(asRecord(subscription)?.items)?.data,
  );
  const firstItem = asRecord(items[0]);
  const price = asRecord(firstItem?.price);
  return asString(price?.id);
}

function extractPriceProductId(price: StripePriceResponse): string | undefined {
  if (typeof price.product === "string") return price.product;
  return asString(asRecord(price.product)?.id);
}

function extractSubscriptionItemId(
  subscription: StripeSubscriptionResponse | undefined,
): string | undefined {
  const items = asArray<StripeSubscriptionItemResponse>(
    subscription?.items?.data,
  );
  return asString(items[0]?.id);
}

function extractSubscriptionPeriod(
  subscription: Record<string, any> | undefined,
): {
  startDate?: string;
  endDate?: string;
} {
  const items = asArray<Record<string, any>>(
    asRecord(asRecord(subscription)?.items)?.data,
  );
  const firstItem = asRecord(items[0]);

  return {
    startDate:
      fromUnixTimestamp(subscription?.current_period_start) ||
      fromUnixTimestamp(firstItem?.current_period_start) ||
      fromUnixTimestamp(subscription?.billing_cycle_anchor),
    endDate:
      fromUnixTimestamp(subscription?.current_period_end) ||
      fromUnixTimestamp(firstItem?.current_period_end),
  };
}

function extractInvoiceLine(
  invoice: Record<string, any> | undefined,
): Record<string, any> | undefined {
  const lines = asArray<Record<string, any>>(asRecord(invoice?.lines)?.data);
  return asRecord(lines[0]);
}

function extractInvoicePlanCode(
  invoice: Record<string, any> | undefined,
  metadata: Record<string, unknown>,
): string | undefined {
  const line = extractInvoiceLine(invoice);
  const price = asRecord(line?.price);
  return (
    asString(price?.id) ||
    asString(metadata.provider_plan_id) ||
    asString(metadata.provider_price_id)
  );
}

function extractInvoicePeriod(invoice: Record<string, any> | undefined): {
  startDate?: string;
  endDate?: string;
} {
  const line = extractInvoiceLine(invoice);
  const period = asRecord(line?.period);

  return {
    startDate:
      fromUnixTimestamp(period?.start) ||
      fromUnixTimestamp(invoice?.period_start),
    endDate:
      fromUnixTimestamp(period?.end) || fromUnixTimestamp(invoice?.period_end),
  };
}

function mapSubscriptionEventType(
  status: string | undefined,
  cancelAtPeriodEnd: boolean,
):
  | "subscription.active"
  | "subscription.not_renew"
  | "subscription.canceled"
  | "subscription.past_due"
  | null {
  if (cancelAtPeriodEnd) return "subscription.not_renew";

  switch (status) {
    case "trialing":
    case "active":
      return "subscription.active";
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
      return "subscription.past_due";
    case "canceled":
      return "subscription.canceled";
    default:
      return null;
  }
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

class StripeClient {
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(private config: StripeConfig) {
    this.baseUrl = config.baseUrl || STRIPE_API_BASE;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
    options?: { headers?: Record<string, string> },
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
                Authorization: `Bearer ${this.config.secretKey}`,
                "Content-Type": "application/x-www-form-urlencoded",
                ...(options?.headers || {}),
              },
              body: method === "GET" ? undefined : toFormBody(body),
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            const text = await response.text();
            const json = text ? JSON.parse(text) : {};

            if (!response.ok) {
              const errorBody = json as StripeErrorResponse;
              const message =
                errorBody.error?.message ||
                `Stripe API ${response.status}: ${text || "Unknown error"}`;
              throw new Error(message);
            }

            return json as T;
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
        code: "request_failed",
        message: error instanceof Error ? error.message : String(error),
        providerId: PROVIDER_ID,
        cause: error,
      }),
    });
  }

  createCustomer(params: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<ProviderResult<StripeCustomerResponse>> {
    return this.request("POST", "/customers", params);
  }

  createProduct(params: {
    name: string;
    description?: string;
    metadata?: Record<string, string>;
  }): Promise<ProviderResult<StripeProductResponse>> {
    return this.request("POST", "/products", params);
  }

  createPrice(params: {
    product: string;
    unit_amount: number;
    currency: string;
    recurring?: {
      interval: "day" | "week" | "month" | "year";
      interval_count?: number;
    };
    metadata?: Record<string, string>;
  }): Promise<ProviderResult<StripePriceResponse>> {
    return this.request("POST", "/prices", params);
  }

  getPrice(priceId: string): Promise<ProviderResult<StripePriceResponse>> {
    return this.request("GET", `/prices/${encodeURIComponent(priceId)}`);
  }

  updatePrice(
    priceId: string,
    params: Record<string, unknown>,
  ): Promise<ProviderResult<StripePriceResponse>> {
    return this.request(
      "POST",
      `/prices/${encodeURIComponent(priceId)}`,
      params,
    );
  }

  updateProduct(
    productId: string,
    params: Record<string, unknown>,
  ): Promise<ProviderResult<StripeProductResponse>> {
    return this.request(
      "POST",
      `/products/${encodeURIComponent(productId)}`,
      params,
    );
  }

  createCheckoutSession(
    params: Record<string, unknown>,
  ): Promise<ProviderResult<StripeCheckoutSessionResponse>> {
    return this.request("POST", "/checkout/sessions", params);
  }

  createSubscription(
    params: Record<string, unknown>,
  ): Promise<ProviderResult<StripeSubscriptionResponse>> {
    return this.request("POST", "/subscriptions", params);
  }

  getSubscription(
    subscriptionId: string,
  ): Promise<ProviderResult<StripeSubscriptionResponse>> {
    return this.request(
      "GET",
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
  }

  updateSubscription(
    subscriptionId: string,
    params: Record<string, unknown>,
  ): Promise<ProviderResult<StripeSubscriptionResponse>> {
    return this.request(
      "POST",
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      params,
    );
  }

  cancelSubscription(
    subscriptionId: string,
  ): Promise<ProviderResult<StripeSubscriptionResponse>> {
    return this.request(
      "DELETE",
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
  }

  createPaymentIntent(
    params: Record<string, unknown>,
    options?: { headers?: Record<string, string> },
  ): Promise<ProviderResult<StripePaymentIntentResponse>> {
    return this.request("POST", "/payment_intents", params, options);
  }

  createRefund(
    params: Record<string, unknown>,
  ): Promise<ProviderResult<StripeRefundResponse>> {
    return this.request("POST", "/refunds", params);
  }
}

export const stripeAdapter: ProviderAdapter = {
  id: PROVIDER_ID,
  displayName: "Stripe",
  signatureHeaderName: "stripe-signature",
  supportsNativeTrials: true,
  defaultCurrency: "USD",

  async createCheckoutSession(
    params,
  ): Promise<ProviderResult<CheckoutSession>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    if (
      Array.isArray(params.channels) &&
      params.channels.length > 0 &&
      !params.channels.includes("card")
    ) {
      return Result.err({
        code: "unsupported",
        message: "Stripe adapter currently supports card checkout only",
        providerId: PROVIDER_ID,
      });
    }

    if (!params.callbackUrl) {
      return Result.err({
        code: "invalid_request",
        message: "Stripe checkout requires a callbackUrl",
        providerId: PROVIDER_ID,
      });
    }

    const customerId = isStripeCustomerId(params.customer.id)
      ? params.customer.id
      : undefined;
    const sessionMetadata: Record<string, unknown> = {
      ...(params.metadata || {}),
      ...(params.customer.email
        ? { customer_email: params.customer.email }
        : {}),
      ...(params.plan?.id ? { provider_plan_id: params.plan.id } : {}),
    };

    if (
      params.lineItems &&
      params.lineItems.length === 1 &&
      params.amount > 0 &&
      params.lineItems[0]?.quantity
    ) {
      const quantity = params.lineItems[0].quantity;
      const unitAmount = Math.round(params.amount / quantity);
      if (Number.isFinite(unitAmount) && unitAmount > 0) {
        sessionMetadata.checkout_unit_amount = String(unitAmount);
        sessionMetadata.checkout_price_id = params.lineItems[0].priceId;
      }
    }

    const metadata = coerceMetadata(sessionMetadata);
    const isSubscriptionCheckout = !!params.plan?.id;
    const sessionBody: Record<string, unknown> = {
      mode: isSubscriptionCheckout ? "subscription" : "payment",
      success_url: params.callbackUrl,
      cancel_url: params.callbackUrl,
      metadata,
      payment_method_types: ["card"],
    };

    if (customerId) {
      sessionBody.customer = customerId;
    } else {
      sessionBody.customer_email = params.customer.email;
      if (!isSubscriptionCheckout) {
        sessionBody.customer_creation = "always";
      }
    }

    if (isSubscriptionCheckout) {
      sessionBody.line_items = [{ price: params.plan!.id, quantity: 1 }];
      sessionBody.subscription_data = {
        metadata,
        ...(params.trialDays && params.trialDays > 0
          ? {
              trial_period_days: params.trialDays,
              trial_settings: {
                end_behavior: { missing_payment_method: "cancel" },
              },
            }
          : {}),
      };

      if (params.trialDays && params.trialDays > 0) {
        sessionBody.payment_method_collection = "always";
      }
    } else {
      sessionBody.payment_intent_data = {
        setup_future_usage: "off_session",
        metadata,
      };

      const lineItems =
        params.lineItems && params.lineItems.length > 0
          ? params.lineItems.map((item: CheckoutLineItem) => ({
              price: item.priceId,
              quantity: item.quantity,
            }))
          : [
              {
                price_data: {
                  currency: lowercaseCurrency(params.currency),
                  unit_amount: params.amount,
                  product_data: {
                    name: buildCheckoutItemName(params.metadata || {}),
                  },
                },
                quantity: 1,
              },
            ];

      sessionBody.line_items = lineItems;
    }

    const response =
      await clientResult.value.createCheckoutSession(sessionBody);

    // If the customer ID belongs to a different provider, Stripe returns
    // "No such customer". Retry without the customer ID — use email instead.
    if (response.isErr() && customerId) {
      const errMsg = String((response.error as any)?.message ?? "");
      if (errMsg.includes("No such customer") || errMsg.includes("not found")) {
        console.warn(
          `[stripe] Customer ${customerId} not found on Stripe, retrying with email`,
        );
        delete sessionBody.customer;
        sessionBody.customer_email = params.customer.email;
        if (!isSubscriptionCheckout) {
          sessionBody.customer_creation = "always";
        }

        const retry =
          await clientResult.value.createCheckoutSession(sessionBody);
        if (retry.isErr()) return retry;

        if (!retry.value.url) {
          return Result.err({
            code: "request_failed",
            message: "Stripe checkout session response missing URL",
            providerId: PROVIDER_ID,
          });
        }

        return Result.ok({
          url: retry.value.url,
          reference: retry.value.id,
          accessCode: null,
        });
      }
    }

    if (response.isErr()) return response;

    if (!response.value.url) {
      return Result.err({
        code: "request_failed",
        message: "Stripe checkout session response missing URL",
        providerId: PROVIDER_ID,
      });
    }

    return Result.ok({
      url: response.value.url,
      reference: response.value.id,
      accessCode: null,
    });
  },

  async createProduct(params): Promise<ProviderResult<ProviderProductRef>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const metadata = coerceMetadata(params.metadata);
    const productResult = await clientResult.value.createProduct({
      name: params.name,
      description: params.description || undefined,
      metadata,
    });
    if (productResult.isErr()) return productResult;

    const priceResult = await clientResult.value.createPrice({
      product: productResult.value.id,
      unit_amount: params.amount,
      currency: lowercaseCurrency(params.currency),
      metadata,
    });
    if (priceResult.isErr()) return priceResult;

    return Result.ok({
      productId: productResult.value.id,
      priceId: priceResult.value.id,
      metadata: {
        currency: params.currency,
      },
    });
  },

  async createCustomer(params): Promise<ProviderResult<ProviderCustomerRef>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.createCustomer({
      email: params.email,
      name: params.name || undefined,
      metadata: coerceMetadata(params.metadata),
    });
    if (response.isErr()) return response;

    return Result.ok({
      id: response.value.id,
      email: response.value.email || params.email,
      metadata: params.metadata,
    });
  },

  async createPlan(params): Promise<ProviderResult<ProviderPlanRef>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const metadata = coerceMetadata({
      interval: params.interval,
      currency: params.currency,
    });

    const productResult = await clientResult.value.createProduct({
      name: params.name,
      description: params.description || undefined,
      metadata,
    });
    if (productResult.isErr()) return productResult;

    const recurring = intervalToStripe(params.interval);
    const priceResult = await clientResult.value.createPrice({
      product: productResult.value.id,
      unit_amount: params.amount,
      currency: lowercaseCurrency(params.currency),
      recurring,
      metadata,
    });
    if (priceResult.isErr()) return priceResult;

    return Result.ok({
      id: priceResult.value.id,
      metadata: {
        productId: productResult.value.id,
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
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const priceResult = await clientResult.value.getPrice(params.planId);
    if (priceResult.isErr()) {
      return priceResult as ProviderResult<{
        updated: boolean;
        nextPlanId?: string;
        metadata?: Record<string, unknown>;
      }>;
    }

    const currentPrice = priceResult.value;
    const productId = extractPriceProductId(currentPrice);
    if (!productId) {
      return Result.err({
        code: "request_failed",
        message: "Stripe price is missing its product reference",
        providerId: PROVIDER_ID,
      });
    }

    const amountChanged =
      typeof params.amount === "number" &&
      currentPrice.unit_amount !== params.amount;
    const currencyChanged =
      typeof params.currency === "string" &&
      lowercaseCurrency(params.currency) !==
        lowercaseCurrency(currentPrice.currency || params.currency);
    const intervalChanged =
      typeof params.interval === "string" &&
      !stripeRecurringMatches(currentPrice.recurring, params.interval);
    const requiresNewPrice =
      amountChanged || currencyChanged || intervalChanged;

    let nextPlanId: string | undefined;

    if (requiresNewPrice) {
      if (
        typeof params.amount !== "number" ||
        typeof params.currency !== "string" ||
        typeof params.interval !== "string"
      ) {
        return Result.err({
          code: "invalid_request",
          message:
            "Stripe updatePlan requires amount, currency, and interval when rotating a price",
          providerId: PROVIDER_ID,
        });
      }

      const createPriceResult = await clientResult.value.createPrice({
        product: productId,
        unit_amount: params.amount,
        currency: lowercaseCurrency(params.currency),
        recurring: intervalToStripe(params.interval),
        metadata: coerceMetadata({
          ...(currentPrice.metadata || {}),
          interval: params.interval,
          currency: params.currency,
        }),
      });

      if (createPriceResult.isErr()) {
        return createPriceResult as ProviderResult<{
          updated: boolean;
          nextPlanId?: string;
          metadata?: Record<string, unknown>;
        }>;
      }

      nextPlanId = createPriceResult.value.id;
    }

    const productUpdateBody: Record<string, unknown> = {};
    if (params.name !== undefined) productUpdateBody.name = params.name;
    if (params.description !== undefined)
      productUpdateBody.description = params.description;
    if (nextPlanId) productUpdateBody.default_price = nextPlanId;

    if (Object.keys(productUpdateBody).length > 0) {
      const productUpdateResult = await clientResult.value.updateProduct(
        productId,
        productUpdateBody,
      );

      if (productUpdateResult.isErr()) {
        if (!nextPlanId) {
          return productUpdateResult as ProviderResult<{
            updated: boolean;
            nextPlanId?: string;
            metadata?: Record<string, unknown>;
          }>;
        }

        console.warn(
          `[stripeAdapter] Product update failed after rotating price ${params.planId} -> ${nextPlanId}: ${productUpdateResult.error.message}`,
        );
      }
    }

    if (nextPlanId) {
      const archiveResult = await clientResult.value.updatePrice(
        params.planId,
        {
          active: false,
        },
      );

      if (archiveResult.isErr()) {
        console.warn(
          `[stripeAdapter] Failed to archive previous Stripe price ${params.planId}: ${archiveResult.error.message}`,
        );
      }
    }

    return Result.ok({
      updated: true,
      nextPlanId,
      metadata: {
        productId,
      },
    });
  },

  async createSubscription(
    params,
  ): Promise<ProviderResult<ProviderSubscriptionRef>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    if (!isStripePaymentMethodId(params.authorizationCode || undefined)) {
      return Result.err({
        code: "invalid_request",
        message:
          "Stripe subscription creation requires a saved payment method ID",
        providerId: PROVIDER_ID,
      });
    }

    let customerId = isStripeCustomerId(params.customer.id)
      ? params.customer.id
      : undefined;

    if (!customerId) {
      const customerResult = await clientResult.value.createCustomer({
        email: params.customer.email,
        metadata: coerceMetadata(params.metadata),
      });
      if (customerResult.isErr()) return customerResult;
      customerId = customerResult.value.id;
    }

    const trialEnd = toUnixTimestamp(params.startDate);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const response = await clientResult.value.createSubscription({
      customer: customerId,
      items: [{ price: params.plan.id }],
      default_payment_method: params.authorizationCode,
      payment_settings: {
        save_default_payment_method: "on_subscription",
      },
      ...(trialEnd && trialEnd > nowSeconds ? { trial_end: trialEnd } : {}),
      metadata: coerceMetadata(params.metadata),
    });

    if (response.isErr()) return response;

    return Result.ok({
      id: response.value.id,
      status: response.value.status || "active",
      metadata: params.metadata,
    });
  },

  async cancelSubscription(
    params,
  ): Promise<ProviderResult<{ canceled: boolean }>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.cancelSubscription(
      params.subscription.id,
    );
    if (response.isErr())
      return response as ProviderResult<{ canceled: boolean }>;

    return Result.ok({ canceled: true });
  },

  async chargeAuthorization(
    params,
  ): Promise<ProviderResult<{ reference: string }>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    if (!isStripePaymentMethodId(params.authorizationCode)) {
      return Result.err({
        code: "invalid_request",
        message: "Stripe chargeAuthorization requires a payment method ID",
        providerId: PROVIDER_ID,
      });
    }

    if (!isStripeCustomerId(params.customer.id)) {
      return Result.err({
        code: "invalid_request",
        message: "Stripe chargeAuthorization requires a Stripe customer ID",
        providerId: PROVIDER_ID,
      });
    }

    const response = await clientResult.value.createPaymentIntent(
      {
        amount: params.amount,
        currency: lowercaseCurrency(params.currency),
        customer: params.customer.id,
        payment_method: params.authorizationCode,
        confirm: true,
        off_session: true,
        metadata: coerceMetadata(params.metadata),
        receipt_email: params.customer.email,
        ...(params.reference ? { description: params.reference } : {}),
      },
      params.reference
        ? {
            headers: {
              "Idempotency-Key": params.reference,
            },
          }
        : undefined,
    );

    if (response.isErr()) return response;

    return Result.ok({
      reference: response.value.id,
    });
  },

  async changePlan(params): Promise<ProviderResult<{ changed: boolean }>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const fetchResult = await clientResult.value.getSubscription(
      params.subscriptionId,
    );
    if (fetchResult.isErr()) {
      return fetchResult as ProviderResult<{ changed: boolean }>;
    }

    const subscriptionItemId = extractSubscriptionItemId(fetchResult.value);
    if (!subscriptionItemId) {
      return Result.err({
        code: "request_failed",
        message: "Stripe subscription is missing a subscription item ID",
        providerId: PROVIDER_ID,
      });
    }

    const response = await clientResult.value.updateSubscription(
      params.subscriptionId,
      {
        items: [
          {
            id: subscriptionItemId,
            price: params.newPlanId,
            ...(params.quantity ? { quantity: params.quantity } : {}),
          },
        ],
        proration_behavior: mapProrationMode(params.prorationMode),
        cancel_at_period_end: false,
        metadata: coerceMetadata(params.metadata),
      },
    );

    if (response.isErr()) {
      return response as ProviderResult<{ changed: boolean }>;
    }

    return Result.ok({ changed: true });
  },

  async refundCharge(
    params,
  ): Promise<ProviderResult<{ refunded: boolean; reference: string }>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const refundBody: Record<string, unknown> = {
      ...(params.reference.startsWith("ch_")
        ? { charge: params.reference }
        : { payment_intent: params.reference }),
      ...(typeof params.amount === "number" ? { amount: params.amount } : {}),
      ...(params.reason ? { reason: "requested_by_customer" } : {}),
      ...(params.reason
        ? { metadata: coerceMetadata({ refund_reason: params.reason }) }
        : {}),
    };

    const response = await clientResult.value.createRefund(refundBody);
    if (response.isErr()) return response;

    return Result.ok({ refunded: true, reference: response.value.id });
  },

  async fetchSubscription(
    params,
  ): Promise<ProviderResult<ProviderSubscriptionDetail>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.getSubscription(
      params.subscriptionId,
    );
    if (response.isErr()) {
      return response as ProviderResult<ProviderSubscriptionDetail>;
    }

    return Result.ok({
      id: response.value.id,
      status: response.value.status || "unknown",
      planCode: extractSubscriptionPriceId(response.value as any),
      startDate: fromUnixTimestamp(response.value.current_period_start),
      nextPaymentDate: fromUnixTimestamp(response.value.current_period_end),
      cancelToken: undefined,
      metadata: response.value.metadata || {},
    });
  },

  async verifyWebhook(params): Promise<ProviderResult<boolean>> {
    try {
      const parts = params.signature
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

      const timestampPart = parts.find((part) => part.startsWith("t="));
      const signatures = parts
        .filter((part) => part.startsWith("v1="))
        .map((part) => part.slice(3));

      const timestamp = timestampPart?.slice(2);
      if (!timestamp || signatures.length === 0) {
        return Result.ok(false);
      }

      const timestampNumber = Number(timestamp);
      if (!Number.isFinite(timestampNumber)) {
        return Result.ok(false);
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (Math.abs(nowSeconds - timestampNumber) > WEBHOOK_TOLERANCE_SECONDS) {
        return Result.ok(false);
      }

      const expected = await hmacSha256Hex(
        params.secret,
        `${timestamp}.${params.payload}`,
      );

      return Result.ok(
        signatures.some((signature) => timingSafeEqual(signature, expected)),
      );
    } catch {
      return Result.ok(false);
    }
  },

  parseWebhookEvent(params): ProviderResult<NormalizedWebhookEvent> {
    const raw = params.payload;
    const eventType = asString(raw.type);
    const data = asRecord(asRecord(raw.data)?.object);

    if (!eventType || !data) {
      return Result.err({
        code: "invalid_payload",
        message: "Missing type or data.object in Stripe webhook payload",
        providerId: PROVIDER_ID,
      });
    }

    switch (eventType) {
      case "checkout.session.completed": {
        const metadata = extractStripeMetadata(data);
        const mode = asString(data.mode);
        const email =
          asString(asRecord(data.customer_details)?.email) ||
          asString(data.customer_email) ||
          asString(metadata.customer_email) ||
          "";
        const providerCustomerId = asString(data.customer) || "";
        const subscriptionId = asString(data.subscription);
        const paymentStatus = asString(data.payment_status);
        const amountTotal = asNumber(data.amount_total) || 0;
        const planCode =
          asString(metadata.provider_plan_id) ||
          asString(metadata.provider_price_id);

        const base = {
          provider: PROVIDER_ID,
          customer: {
            email,
            providerCustomerId,
          },
          metadata,
          raw,
        } as const;

        if (mode === "subscription" && subscriptionId) {
          const isNativeTrial =
            isTruthy(metadata.is_trial) ||
            isTruthy(metadata.native_trial) ||
            paymentStatus === "no_payment_required" ||
            amountTotal === 0;

          if (isNativeTrial) {
            return Result.ok({
              ...base,
              type: "charge.success",
              payment: {
                amount: amountTotal,
                currency: uppercaseCurrency(data.currency),
                reference:
                  asString(data.payment_intent) ||
                  asString(data.id) ||
                  subscriptionId,
                paidAt: fromUnixTimestamp(data.created),
              },
              subscription: {
                providerCode: subscriptionId,
                providerSubscriptionId: subscriptionId,
                status: "trialing",
                planCode,
                startDate: fromUnixTimestamp(data.created),
                trialEndDate: asString(metadata.trial_ends_at),
                nextPaymentDate: asString(metadata.trial_ends_at),
              },
              plan: planCode ? { providerPlanCode: planCode } : undefined,
            });
          }

          return Result.ok({
            ...base,
            type: "subscription.created",
            subscription: {
              providerCode: subscriptionId,
              providerSubscriptionId: subscriptionId,
              status: "active",
              planCode,
              startDate: fromUnixTimestamp(data.created),
            },
            plan: planCode ? { providerPlanCode: planCode } : undefined,
          });
        }

        return Result.err({
          code: "unknown_event",
          message: `Unhandled Stripe event: ${eventType}`,
          providerId: PROVIDER_ID,
        });
      }

      case "payment_intent.succeeded": {
        const metadata = extractStripeMetadata(data);
        const cardDetails = extractCardDetails(data);
        const amount =
          asNumber(data.amount_received) || asNumber(data.amount) || 0;
        const lineItems = extractCheckoutQuantity(metadata, amount);

        return Result.ok({
          type: "charge.success",
          provider: PROVIDER_ID,
          customer: {
            email: cardDetails.email || asString(metadata.customer_email) || "",
            providerCustomerId: asString(data.customer) || "",
          },
          payment: {
            amount,
            currency: uppercaseCurrency(data.currency),
            reference: asString(data.id) || "",
            paidAt: fromUnixTimestamp(data.created),
          },
          authorization: asString(data.payment_method)
            ? {
                code: asString(data.payment_method)!,
                reusable: true,
                cardType: cardDetails.cardType,
                last4: cardDetails.last4,
                expMonth: cardDetails.expMonth,
                expYear: cardDetails.expYear,
              }
            : undefined,
          checkout: lineItems ? { lineItems } : undefined,
          metadata,
          raw,
        });
      }

      case "payment_intent.payment_failed": {
        const metadata = extractStripeMetadata(data);
        const cardDetails = extractCardDetails(data);

        return Result.ok({
          type: "charge.failed",
          provider: PROVIDER_ID,
          customer: {
            email: cardDetails.email || asString(metadata.customer_email) || "",
            providerCustomerId: asString(data.customer) || "",
          },
          payment: {
            amount: asNumber(data.amount) || 0,
            currency: uppercaseCurrency(data.currency),
            reference: asString(data.id) || "",
          },
          metadata,
          raw,
        });
      }

      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const invoiceMetadata = mergeMetadata(
          extractStripeMetadata(data),
          extractStripeMetadata(asRecord(data.subscription_details)),
          extractStripeMetadata(
            asRecord(asRecord(data.parent)?.subscription_details),
          ),
          extractStripeMetadata(extractInvoiceLine(data)),
        );
        const planCode = extractInvoicePlanCode(data, invoiceMetadata);
        const period = extractInvoicePeriod(data);
        const subscriptionId = asString(data.subscription);

        return Result.ok({
          type: "charge.success",
          provider: PROVIDER_ID,
          customer: {
            email: asString(data.customer_email) || "",
            providerCustomerId: asString(data.customer) || "",
          },
          subscription: subscriptionId
            ? {
                providerCode: subscriptionId,
                providerSubscriptionId: subscriptionId,
                status: "active",
                planCode,
                startDate: period.startDate,
                nextPaymentDate: period.endDate,
              }
            : undefined,
          payment: {
            amount: asNumber(data.amount_paid) || asNumber(data.total) || 0,
            currency: uppercaseCurrency(data.currency),
            reference:
              asString(data.payment_intent) ||
              asString(data.charge) ||
              asString(data.id) ||
              "",
            paidAt:
              fromUnixTimestamp(asRecord(data.status_transitions)?.paid_at) ||
              fromUnixTimestamp(data.created),
          },
          plan: planCode ? { providerPlanCode: planCode } : undefined,
          metadata: invoiceMetadata,
          raw,
        });
      }

      case "invoice.payment_failed": {
        const invoiceMetadata = mergeMetadata(
          extractStripeMetadata(data),
          extractStripeMetadata(asRecord(data.subscription_details)),
          extractStripeMetadata(
            asRecord(asRecord(data.parent)?.subscription_details),
          ),
        );
        const planCode = extractInvoicePlanCode(data, invoiceMetadata);
        const subscriptionId = asString(data.subscription);

        return Result.ok({
          type: "charge.failed",
          provider: PROVIDER_ID,
          customer: {
            email: asString(data.customer_email) || "",
            providerCustomerId: asString(data.customer) || "",
          },
          subscription: subscriptionId
            ? {
                providerCode: subscriptionId,
                providerSubscriptionId: subscriptionId,
                status: "past_due",
                planCode,
              }
            : undefined,
          payment: {
            amount: asNumber(data.amount_due) || asNumber(data.total) || 0,
            currency: uppercaseCurrency(data.currency),
            reference: asString(data.payment_intent) || asString(data.id) || "",
          },
          plan: planCode ? { providerPlanCode: planCode } : undefined,
          metadata: invoiceMetadata,
          raw,
        });
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const metadata = extractStripeMetadata(data);
        const status = asString(data.status);
        const cancelAtPeriodEnd = asBoolean(data.cancel_at_period_end) || false;
        const normalizedType =
          eventType === "customer.subscription.deleted"
            ? "subscription.canceled"
            : mapSubscriptionEventType(status, cancelAtPeriodEnd);

        if (!normalizedType) {
          return Result.err({
            code: "unknown_event",
            message: `Unhandled Stripe subscription status: ${status || "unknown"}`,
            providerId: PROVIDER_ID,
          });
        }

        const planCode = extractSubscriptionPriceId(data);
        const period = extractSubscriptionPeriod(data);
        return Result.ok({
          type: normalizedType,
          provider: PROVIDER_ID,
          customer: {
            email: "",
            providerCustomerId: asString(data.customer) || "",
          },
          subscription: {
            providerCode: asString(data.id) || "",
            providerSubscriptionId: asString(data.id) || "",
            status:
              normalizedType === "subscription.not_renew"
                ? "pending_cancel"
                : normalizedType === "subscription.canceled"
                  ? "canceled"
                  : status || "active",
            planCode,
            startDate: period.startDate,
            nextPaymentDate: period.endDate,
            trialEndDate: fromUnixTimestamp(data.trial_end),
          },
          plan: planCode ? { providerPlanCode: planCode } : undefined,
          metadata,
          raw,
        });
      }

      case "payment_method.attached": {
        const metadata = extractStripeMetadata(data);
        const billingDetails = asRecord(data.billing_details);
        const card = asRecord(data.card);

        return Result.ok({
          type: "customer.identified",
          provider: PROVIDER_ID,
          customer: {
            email:
              asString(billingDetails?.email) ||
              asString(metadata.customer_email) ||
              "",
            providerCustomerId: asString(data.customer) || "",
          },
          authorization: asString(data.id)
            ? {
                code: asString(data.id)!,
                reusable: true,
                cardType: asString(card?.brand),
                last4: asString(card?.last4),
                expMonth:
                  asNumber(card?.exp_month) !== undefined
                    ? String(asNumber(card?.exp_month))
                    : undefined,
                expYear:
                  asNumber(card?.exp_year) !== undefined
                    ? String(asNumber(card?.exp_year))
                    : undefined,
              }
            : undefined,
          metadata: mergeMetadata(metadata, {
            type: asString(metadata.type) || "payment_method_attached",
          }),
          raw,
        });
      }

      case "charge.refunded": {
        const refunds = asArray<Record<string, any>>(
          asRecord(data.refunds)?.data,
        );
        const latestRefund = asRecord(refunds[0]);
        const metadata = extractStripeMetadata(data);
        const billingDetails = asRecord(data.billing_details);

        return Result.ok({
          type: "refund.success",
          provider: PROVIDER_ID,
          customer: {
            email:
              asString(billingDetails?.email) ||
              asString(metadata.customer_email) ||
              "",
            providerCustomerId: asString(data.customer) || "",
          },
          refund: {
            amount:
              asNumber(latestRefund?.amount) ||
              asNumber(data.amount_refunded) ||
              0,
            currency: uppercaseCurrency(data.currency),
            reference: asString(latestRefund?.id) || asString(data.id) || "",
            reason: asString(latestRefund?.reason),
          },
          metadata,
          raw,
        });
      }

      default:
        return Result.err({
          code: "unknown_event",
          message: `Unhandled Stripe event: ${eventType}`,
          providerId: PROVIDER_ID,
        });
    }
  },
};
