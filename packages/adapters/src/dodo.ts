import { Result } from "better-result";
import type {
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

// =============================================================================
// Dodo Payments Configuration
// =============================================================================

interface DodoConfig {
  apiKey: string;
  baseUrl: string;
  timeout?: number;
  maxRetries?: number;
}

const DODO_BASE_URLS = {
  test: "https://test.dodopayments.com",
  live: "https://live.dodopayments.com",
} as const;

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_RETRIES = 2;

// =============================================================================
// Dodo Payments Client
// =============================================================================

class DodoClient {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(config: DodoConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
              },
              body: body ? JSON.stringify(body) : undefined,
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              const errorBody = await response.text();
              throw new Error(
                `Dodo API ${response.status}: ${errorBody}`,
              );
            }

            // Some Dodo endpoints return no body (e.g. changePlan returns void)
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
        code: "request_failed",
        message: error instanceof Error ? error.message : String(error),
        providerId: "dodopayments",
        cause: error,
      }),
    });
  }

  // -------------------------------------------------------------------------
  // Checkout Sessions
  // -------------------------------------------------------------------------

  createCheckoutSession(params: {
    product_cart: Array<{ product_id: string; quantity: number }>;
    customer?: { customer_id?: string; email?: string; name?: string };
    return_url?: string;
    metadata?: Record<string, unknown>;
    subscription_data?: {
      trial_period_days?: number;
      on_demand?: {
        mandate_only?: boolean;
        product_price?: number;
        product_currency?: string;
        product_description?: string;
      };
    };
  }): Promise<ProviderResult<{ session_id: string; checkout_url: string }>> {
    return this.request("POST", "/checkouts", params);
  }

  // -------------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------------

  createProduct(params: {
    name: string;
    description?: string;
    price:
      | {
          currency: string;
          discount: number;
          purchasing_power_parity: boolean;
          price: number;
          type: "one_time_price";
        }
      | {
          currency: string;
          discount: number;
          purchasing_power_parity: boolean;
          price: number;
          type: "recurring_price";
          payment_frequency_count: number;
          payment_frequency_interval: string;
          subscription_period_count: number;
          subscription_period_interval: string;
          trial_period_days?: number;
        };
    tax_category: string;
    metadata?: Record<string, string>;
  }): Promise<ProviderResult<{
    product_id: string;
    name?: string;
    price: { currency: string; price: number };
  }>> {
    return this.request("POST", "/products", params);
  }

  updateProduct(productId: string, params: {
    name?: string;
    description?: string | null;
    price?: {
      currency: string;
      price: number;
      discount?: number;
      purchasing_power_parity?: boolean;
      type: "one_time_price" | "recurring_price";
      payment_frequency_count?: number;
      payment_frequency_interval?: string;
      subscription_period_count?: number;
      subscription_period_interval?: string;
    };
    tax_category?: string;
  }): Promise<ProviderResult<Record<string, unknown>>> {
    return this.request("PATCH", `/products/${encodeURIComponent(productId)}`, params);
  }

  // -------------------------------------------------------------------------
  // Customers
  // -------------------------------------------------------------------------

  createCustomer(params: {
    email: string;
    name?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ProviderResult<{
    customer_id: string;
    email: string;
    name?: string;
  }>> {
    return this.request("POST", "/customers", params);
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  getSubscription(subscriptionId: string): Promise<ProviderResult<{
    subscription_id: string;
    status: string;
    product_id?: string;
    created_at?: string;
    next_billing_date?: string;
    cancel_at_next_billing_date?: boolean;
    customer?: { customer_id: string; email: string; name?: string };
    metadata?: Record<string, unknown>;
    on_demand?: boolean;
  }>> {
    return this.request("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }

  updateSubscription(
    subscriptionId: string,
    params: {
      status?: string;
      metadata?: Record<string, string> | null;
      cancel_at_next_billing_date?: boolean | null;
      next_billing_date?: string | null;
    },
  ): Promise<ProviderResult<{ subscription_id: string; status: string }>> {
    return this.request("PATCH", `/subscriptions/${encodeURIComponent(subscriptionId)}`, params);
  }

  chargeSubscription(
    subscriptionId: string,
    params: {
      product_price: number;
      product_description?: string;
      product_currency?: string | null;
      metadata?: Record<string, string> | null;
    },
  ): Promise<ProviderResult<{ payment_id: string }>> {
    return this.request("POST", `/subscriptions/${encodeURIComponent(subscriptionId)}/charge`, params);
  }

  async changePlan(
    subscriptionId: string,
    params: {
      product_id: string;
      proration_billing_mode: "prorated_immediately" | "full_immediately" | "difference_immediately";
      quantity: number;
      metadata?: Record<string, string> | null;
      on_payment_failure?: "prevent_change" | "apply_change" | null;
    },
  ): Promise<ProviderResult<{ changed: boolean }>> {
    const result = await this.request("POST", `/subscriptions/${encodeURIComponent(subscriptionId)}/change-plan`, params);
    if (result.isErr()) return result as ProviderResult<{ changed: boolean }>;
    return Result.ok({ changed: true });
  }

  createRefund(params: {
    payment_id: string;
    amount?: number;
    reason?: string;
  }): Promise<ProviderResult<{ refund_id: string }>> {
    return this.request("POST", "/refunds", params);
  }
}

// =============================================================================
// Helpers
// =============================================================================

function resolveClient(
  account: ProviderAccount,
  environment: "test" | "live",
): ProviderResult<DodoClient> {
  const credentials = account.credentials || {};
  const apiKey =
    typeof credentials.secretKey === "string" ? credentials.secretKey : null;

  if (!apiKey) {
    return Result.err({
      code: "configuration_missing",
      message: "Dodo Payments API key missing",
      providerId: "dodopayments",
    });
  }

  const baseUrl = DODO_BASE_URLS[environment] || DODO_BASE_URLS.test;

  return Result.ok(new DodoClient({ apiKey, baseUrl }));
}

function coerceMetadata(meta?: Record<string, unknown>): Record<string, string> | undefined {
  if (!meta) return undefined;
  return Object.fromEntries(
    Object.entries(meta).map(([k, v]) => [k, String(v)]),
  );
}

function mapInterval(interval: string): { intervalType: string; count: number } {
  switch (interval.toLowerCase()) {
    case "monthly":
      return { intervalType: "Month", count: 1 };
    case "quarterly":
      return { intervalType: "Month", count: 3 };
    case "biannually":
    case "biannual":
      return { intervalType: "Month", count: 6 };
    case "yearly":
    case "annually":
      return { intervalType: "Year", count: 1 };
    case "weekly":
      return { intervalType: "Week", count: 1 };
    case "daily":
      return { intervalType: "Day", count: 1 };
    default:
      return { intervalType: "Month", count: 1 };
  }
}

// =============================================================================
// Standard Webhooks Verification (HMAC-SHA256)
// =============================================================================

async function verifyStandardWebhook(params: {
  webhookId: string;
  webhookTimestamp: string;
  webhookSignature: string;
  payload: string;
  secret: string;
}): Promise<boolean> {
  const { webhookId, webhookTimestamp, webhookSignature, payload, secret } = params;

  // Standard Webhooks tolerance: 5 minutes
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(webhookTimestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > 300) {
    return false;
  }

  // The secret may be base64-encoded with a "whsec_" prefix
  let keyBytes: Uint8Array;
  const secretStr = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  try {
    // Standard Webhooks secrets are base64-encoded
    const binaryStr = atob(secretStr);
    keyBytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      keyBytes[i] = binaryStr.charCodeAt(i);
    }
  } catch {
    // If not base64, use raw bytes
    keyBytes = new TextEncoder().encode(secretStr);
  }

  // Signed message: "{webhook-id}.{webhook-timestamp}.{body}"
  const signedMessage = `${webhookId}.${webhookTimestamp}.${payload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedMessage).buffer as ArrayBuffer,
  );

  // Convert to base64
  const computed = btoa(
    String.fromCharCode(...new Uint8Array(signatureBytes)),
  );

  // webhook-signature header can contain multiple signatures: "v1,<sig1> v1,<sig2>"
  const signatures = webhookSignature.split(" ");
  for (const sig of signatures) {
    const parts = sig.split(",");
    if (parts.length >= 2) {
      const sigValue = parts.slice(1).join(","); // rejoin in case base64 has commas
      if (sigValue === computed) {
        return true;
      }
    }
  }

  return false;
}

// =============================================================================
// Adapter Implementation
// =============================================================================

export const dodoAdapter: ProviderAdapter = {
  id: "dodopayments",
  displayName: "Dodo Payments",
  signatureHeaderName: "webhook-signature",
  supportsNativeTrials: true,
  defaultCurrency: "USD",

  // ---------------------------------------------------------------------------
  // createCheckoutSession
  // ---------------------------------------------------------------------------
  async createCheckoutSession(params): Promise<ProviderResult<CheckoutSession>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    // Dodo requires a product_id for every checkout. Sources in order:
    // 1. params.plan.id (subscription/plan checkouts)
    // 2. params.lineItems[0].priceId (credit pack checkouts — priceId = Dodo product_id)
    const productId = params.plan?.id || params.lineItems?.[0]?.priceId;
    if (!productId) {
      return Result.err({
        code: "invalid_request",
        message: "Dodo Payments requires a product ID (plan must be synced first)",
        providerId: "dodopayments",
      });
    }

    // Use quantity from lineItems if provided (e.g. credit pack purchases)
    const quantity = params.lineItems?.[0]?.quantity || 1;

    // Only pass customer_id if it's a real Dodo customer ID (not an email fallback)
    const custId = params.customer?.id;
    const isRealCustomerId = custId && !custId.includes("@");

    // Build subscription_data based on trial or on-demand flags
    let subscriptionData: Record<string, unknown> | undefined;
    if (params.onDemand) {
      subscriptionData = {
        on_demand: {
          mandate_only: params.onDemand.mandateOnly,
        },
      };
    } else if (params.trialDays && params.trialDays > 0) {
      subscriptionData = { trial_period_days: params.trialDays };
    }

    const response = await clientResult.value.createCheckoutSession({
      product_cart: [{ product_id: productId, quantity }],
      customer: params.customer
        ? {
            email: params.customer.email,
            ...(isRealCustomerId ? { customer_id: custId } : {}),
          }
        : undefined,
      return_url: params.callbackUrl,
      metadata: coerceMetadata(params.metadata),
      ...(subscriptionData ? { subscription_data: subscriptionData } : {}),
    });

    if (response.isErr()) return response;

    return Result.ok({
      url: response.value.checkout_url,
      reference: response.value.session_id,
      accessCode: null,
    });
  },

  // ---------------------------------------------------------------------------
  // createProduct (for credit packs / one-time products)
  // ---------------------------------------------------------------------------
  async createProduct(params): Promise<ProviderResult<ProviderProductRef>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.createProduct({
      name: params.name,
      description: params.description || undefined,
      price: {
        currency: params.currency,
        price: params.amount,
        discount: 0,
        purchasing_power_parity: false,
        type: "one_time_price",
      },
      tax_category: "digital_products",
    });

    if (response.isErr()) return response;

    return Result.ok({
      productId: response.value.product_id,
      priceId: response.value.product_id, // Dodo doesn't separate price from product
      metadata: {},
    });
  },

  // ---------------------------------------------------------------------------
  // createCustomer
  // ---------------------------------------------------------------------------
  async createCustomer(params): Promise<ProviderResult<ProviderCustomerRef>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.createCustomer({
      email: params.email,
      name: params.name || params.email,
      metadata: coerceMetadata(params.metadata),
    });

    if (response.isErr()) return response;

    return Result.ok({
      id: response.value.customer_id,
      email: response.value.email,
      metadata: params.metadata,
    });
  },

  // ---------------------------------------------------------------------------
  // createPlan → creates a Dodo Product (recurring subscription product)
  // ---------------------------------------------------------------------------
  async createPlan(params): Promise<ProviderResult<ProviderPlanRef>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const { intervalType, count } = mapInterval(params.interval);

    const response = await clientResult.value.createProduct({
      name: params.name,
      description: params.description || undefined,
      price: {
        currency: params.currency,
        price: params.amount,
        discount: 0,
        purchasing_power_parity: false,
        type: "recurring_price",
        payment_frequency_interval: intervalType,
        payment_frequency_count: count,
        subscription_period_interval: intervalType,
        subscription_period_count: count,
      },
      tax_category: "digital_products",
    });

    if (response.isErr()) return response;

    return Result.ok({
      id: response.value.product_id,
      metadata: {},
    });
  },

  // ---------------------------------------------------------------------------
  // updatePlan → updates a Dodo Product (recurring subscription product)
  // ---------------------------------------------------------------------------
  async updatePlan(params): Promise<ProviderResult<{ updated: boolean }>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const updateBody: Record<string, unknown> = {};
    if (params.name !== undefined) updateBody.name = params.name;
    if (params.description !== undefined) updateBody.description = params.description;

    // Rebuild the full price object — Dodo requires complete price data on update
    if (params.amount !== undefined && params.currency !== undefined && params.interval !== undefined) {
      const { intervalType, count } = mapInterval(params.interval);

      updateBody.price = {
        type: "recurring_price",
        currency: params.currency,
        price: params.amount,
        discount: 0,
        purchasing_power_parity: false,
        payment_frequency_interval: intervalType,
        payment_frequency_count: count,
        subscription_period_interval: intervalType,
        subscription_period_count: count,
      };
    }

    const response = await clientResult.value.updateProduct(params.planId, updateBody);
    if (response.isErr()) return response;

    return Result.ok({ updated: true });
  },

  // ---------------------------------------------------------------------------
  // createSubscription
  // Dodo subscriptions are created via checkout sessions.
  // If an on-demand subscription exists (authorizationCode = subscription_id),
  // we can charge it. Otherwise, return unsupported — caller should use checkout.
  // ---------------------------------------------------------------------------
  async createSubscription(params): Promise<ProviderResult<ProviderSubscriptionRef>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    // If authorizationCode is a Dodo subscription ID (on-demand), we can't
    // "create" a new sub via API — Dodo requires checkout flow.
    // Create a checkout session instead and return the URL for the caller.
    const productId = params.plan?.id;
    if (!productId) {
      return Result.err({
        code: "invalid_request",
        message: "Dodo Payments requires a product ID for subscription creation",
        providerId: "dodopayments",
      });
    }

    const response = await clientResult.value.createCheckoutSession({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: {
        email: params.customer.email,
        ...(params.customer.id ? { customer_id: params.customer.id } : {}),
      },
      metadata: coerceMetadata(params.metadata),
    });

    if (response.isErr()) return response;

    // Return session_id as the subscription ref — the actual subscription_id
    // will come via webhook (subscription.active)
    return Result.ok({
      id: response.value.session_id,
      status: "pending",
      metadata: {
        checkout_url: response.value.checkout_url,
        ...params.metadata,
      },
    });
  },

  // ---------------------------------------------------------------------------
  // cancelSubscription
  // ---------------------------------------------------------------------------
  async cancelSubscription(params): Promise<ProviderResult<{ canceled: boolean }>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.updateSubscription(
      params.subscription.id,
      { status: "cancelled" },
    );

    if (response.isErr()) return response as ProviderResult<{ canceled: boolean }>;

    return Result.ok({ canceled: true });
  },

  // ---------------------------------------------------------------------------
  // chargeAuthorization
  // For Dodo, authorizationCode is the on-demand subscription_id.
  // Charges the subscription with a custom amount.
  // ---------------------------------------------------------------------------
  async chargeAuthorization(params): Promise<ProviderResult<{ reference: string }>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    // authorizationCode holds the Dodo subscription_id for on-demand subs
    const subscriptionId = params.authorizationCode;
    if (!subscriptionId) {
      return Result.err({
        code: "invalid_request",
        message: "Dodo Payments requires an on-demand subscription ID for charges",
        providerId: "dodopayments",
      });
    }

    const response = await clientResult.value.chargeSubscription(subscriptionId, {
      product_price: params.amount,
      product_currency: params.currency || undefined,
      metadata: params.metadata
        ? Object.fromEntries(
            Object.entries(params.metadata).map(([k, v]) => [k, String(v)]),
          )
        : undefined,
    });

    if (response.isErr()) return response as ProviderResult<{ reference: string }>;

    return Result.ok({
      reference: response.value.payment_id,
    });
  },

  // ---------------------------------------------------------------------------
  // changePlan — native Dodo plan change with built-in proration
  // ---------------------------------------------------------------------------
  async changePlan(params): Promise<ProviderResult<{ changed: boolean }>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    return clientResult.value.changePlan(params.subscriptionId, {
      product_id: params.newPlanId,
      proration_billing_mode: params.prorationMode || "prorated_immediately",
      quantity: params.quantity || 1,
      metadata: coerceMetadata(params.metadata) || null,
      on_payment_failure: "prevent_change",
    });
  },

  // ---------------------------------------------------------------------------
  // refundCharge
  // Dodo supports refunds via POST /refunds with the payment_id.
  // ---------------------------------------------------------------------------
  async refundCharge(params): Promise<ProviderResult<{ refunded: boolean; reference: string }>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.createRefund({
      payment_id: params.reference,
      amount: params.amount,
      reason: params.reason || "Card capture refund",
    });
    if (response.isErr()) return response;

    return Result.ok({ refunded: true, reference: params.reference });
  },

  // ---------------------------------------------------------------------------
  // fetchSubscription
  // ---------------------------------------------------------------------------
  async fetchSubscription(params): Promise<ProviderResult<ProviderSubscriptionDetail>> {
    const clientResult = resolveClient(params.account, params.environment);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.getSubscription(params.subscriptionId);
    if (response.isErr()) return response as ProviderResult<ProviderSubscriptionDetail>;

    const sub = response.value;

    // Map Dodo status → normalized status
    let status = sub.status || "unknown";
    if (status === "on_hold") status = "past_due";

    return Result.ok({
      id: sub.subscription_id,
      status,
      planCode: sub.product_id,
      startDate: sub.created_at,
      nextPaymentDate: sub.next_billing_date,
      cancelToken: undefined, // Dodo doesn't use cancel tokens
      metadata: sub.metadata || {},
    });
  },

  // ---------------------------------------------------------------------------
  // verifyWebhook — Standard Webhooks (HMAC-SHA256)
  // ---------------------------------------------------------------------------
  async verifyWebhook(params): Promise<ProviderResult<boolean>> {
    try {
      const headers = params.headers || {};
      const webhookId = headers["webhook-id"] || "";
      const webhookTimestamp = headers["webhook-timestamp"] || "";
      const webhookSignature = params.signature || headers["webhook-signature"] || "";

      if (!webhookId || !webhookTimestamp || !webhookSignature) {
        return Result.ok(false);
      }

      const valid = await verifyStandardWebhook({
        webhookId,
        webhookTimestamp,
        webhookSignature,
        payload: params.payload,
        secret: params.secret,
      });

      return Result.ok(valid);
    } catch {
      return Result.ok(false);
    }
  },

  // ---------------------------------------------------------------------------
  // parseWebhookEvent
  // ---------------------------------------------------------------------------
  parseWebhookEvent(params): ProviderResult<NormalizedWebhookEvent> {
    const raw = params.payload;
    const eventType = raw.type as string;
    const data = raw.data as Record<string, any>;

    if (!eventType || !data) {
      return Result.err({
        code: "invalid_payload",
        message: "Missing type or data in Dodo Payments webhook payload",
        providerId: "dodopayments",
      });
    }

    // Dodo payloads have data.customer as an object or data itself may contain customer fields
    const customer = data.customer || {};
    const metadata: Record<string, unknown> = data.metadata || {};

    const base = {
      provider: "dodopayments" as const,
      customer: {
        email: customer.email || "",
        providerCustomerId: customer.customer_id || "",
      },
      metadata,
      raw,
    };

    switch (eventType) {
      // -----------------------------------------------------------------------
      // Payment events
      // -----------------------------------------------------------------------
      case "payment.succeeded": {
        // Dodo signals trial start via a $0 payment with a subscription context.
        // Inject trial flags so downstream handlers detect the trial even if
        // our checkout metadata wasn't preserved in the webhook payload.
        const isTrialPayment = (data.total_amount === 0 || !data.total_amount) && !!data.subscription_id;
        if (isTrialPayment) {
          if (metadata.is_trial === undefined) metadata.is_trial = true;
          if (metadata.native_trial === undefined) metadata.native_trial = true;
        }

        return Result.ok({
          ...base,
          type: "charge.success",
          payment: {
            amount: data.total_amount || 0,
            currency: data.currency || "USD",
            reference: data.payment_id || "",
            paidAt: data.created_at,
          },
          // For Dodo on-demand subscriptions, the subscription_id IS the
          // authorization code equivalent. Store it so the webhook handler
          // saves it to the customer record for future chargeAuthorization calls.
          authorization: data.subscription_id
            ? {
                code: data.subscription_id,
                reusable: true,
              }
            : undefined,
          subscription: data.subscription_id
            ? {
                providerCode: data.subscription_id,
                providerSubscriptionId: data.subscription_id,
                status: "active",
                nextPaymentDate: data.next_billing_date,
              }
            : undefined,
          plan: data.product_cart?.[0]?.product_id
            ? { providerPlanCode: data.product_cart[0].product_id }
            : undefined,
        });
      }

      case "payment.failed":
        return Result.ok({
          ...base,
          type: "charge.failed",
          payment: {
            amount: data.total_amount || 0,
            currency: data.currency || "USD",
            reference: data.payment_id || "",
          },
          subscription: data.subscription_id
            ? {
                providerCode: data.subscription_id,
                status: "past_due",
              }
            : undefined,
        });

      // -----------------------------------------------------------------------
      // Subscription events
      // -----------------------------------------------------------------------
      case "subscription.active":
        return Result.ok({
          ...base,
          type: "subscription.active",
          subscription: {
            providerCode: data.subscription_id || "",
            providerSubscriptionId: data.subscription_id || "",
            status: "active",
            planCode: data.product_id,
            startDate: data.created_at,
            nextPaymentDate: data.next_billing_date,
          },
          plan: data.product_id
            ? { providerPlanCode: data.product_id }
            : undefined,
        });

      case "subscription.renewed":
        // Renewal = successful charge in subscription context
        return Result.ok({
          ...base,
          type: "charge.success",
          subscription: {
            providerCode: data.subscription_id || "",
            providerSubscriptionId: data.subscription_id || "",
            status: "active",
            nextPaymentDate: data.next_billing_date,
          },
          payment: {
            amount: data.recurring_pre_tax_amount || 0,
            currency: data.currency || "USD",
            reference: data.subscription_id || "",
            paidAt: data.previous_billing_date,
          },
        });

      case "subscription.cancelled":
        return Result.ok({
          ...base,
          type: "subscription.canceled",
          subscription: {
            providerCode: data.subscription_id || "",
            providerSubscriptionId: data.subscription_id || "",
            status: "canceled",
          },
        });

      case "subscription.on_hold":
        return Result.ok({
          ...base,
          type: "subscription.past_due",
          subscription: {
            providerCode: data.subscription_id || "",
            providerSubscriptionId: data.subscription_id || "",
            status: "past_due",
          },
        });

      case "subscription.failed":
        return Result.ok({
          ...base,
          type: "charge.failed",
          subscription: {
            providerCode: data.subscription_id || "",
            providerSubscriptionId: data.subscription_id || "",
            status: "past_due",
          },
          payment: {
            amount: data.recurring_pre_tax_amount || 0,
            currency: data.currency || "USD",
            reference: data.subscription_id || "",
          },
        });

      case "subscription.expired":
        return Result.ok({
          ...base,
          type: "subscription.canceled",
          subscription: {
            providerCode: data.subscription_id || "",
            providerSubscriptionId: data.subscription_id || "",
            status: "canceled",
          },
        });

      case "subscription.plan_changed":
        return Result.ok({
          ...base,
          type: "subscription.active",
          subscription: {
            providerCode: data.subscription_id || "",
            providerSubscriptionId: data.subscription_id || "",
            status: "active",
            planCode: data.product_id,
            nextPaymentDate: data.next_billing_date,
          },
          plan: data.product_id
            ? { providerPlanCode: data.product_id }
            : undefined,
        });

      case "subscription.updated":
        return Result.ok({
          ...base,
          type: "subscription.active",
          subscription: {
            providerCode: data.subscription_id || "",
            providerSubscriptionId: data.subscription_id || "",
            status: data.status || "active",
            planCode: data.product_id,
            nextPaymentDate: data.next_billing_date,
          },
          plan: data.product_id
            ? { providerPlanCode: data.product_id }
            : undefined,
        });

      // -----------------------------------------------------------------------
      // Payment lifecycle events (non-terminal)
      // -----------------------------------------------------------------------
      case "payment.processing":
        // Payment is still being processed — NOT yet succeeded.
        // Return unknown_event so the webhook handler ACKs (200) but takes no action.
        // The terminal payment.succeeded or payment.failed will follow.
        return Result.err({
          code: "unknown_event",
          message: "payment.processing is non-terminal — awaiting final status",
          providerId: "dodopayments",
        });

      case "payment.cancelled":
        return Result.ok({
          ...base,
          type: "charge.failed",
          payment: {
            amount: data.total_amount || 0,
            currency: data.currency || "USD",
            reference: data.payment_id || "",
          },
          subscription: data.subscription_id
            ? {
                providerCode: data.subscription_id,
                status: "active",
              }
            : undefined,
        });

      // -----------------------------------------------------------------------
      // Refund events
      // -----------------------------------------------------------------------
      case "refund.succeeded":
        return Result.ok({
          ...base,
          type: "refund.success",
          refund: {
            amount: data.amount || 0,
            currency: data.currency || "USD",
            reference: data.refund_id || data.payment_id || "",
            reason: data.reason,
          },
          payment: {
            amount: data.amount || 0,
            currency: data.currency || "USD",
            reference: data.payment_id || "",
          },
        });

      case "refund.failed":
        return Result.ok({
          ...base,
          type: "refund.failed",
          refund: {
            amount: data.amount || 0,
            currency: data.currency || "USD",
            reference: data.refund_id || data.payment_id || "",
            reason: data.reason,
          },
        });

      default:
        return Result.err({
          code: "unknown_event",
          message: `Unsupported Dodo Payments event: ${eventType}`,
          providerId: "dodopayments",
        });
    }
  },
};
