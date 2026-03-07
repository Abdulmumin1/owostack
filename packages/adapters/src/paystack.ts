import { Result } from "better-result";
import type {
  CheckoutSession,
  NormalizedWebhookEvent,
  ProviderAccount,
  ProviderAdapter,
  ProviderCustomerRef,
  ProviderPlanRef,
  ProviderResult,
  ProviderSubscriptionDetail,
  ProviderSubscriptionRef,
} from "./index";

interface PaystackConfig {
  secretKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

const DEFAULT_CONFIG = {
  baseUrl: "https://api.paystack.co",
  timeout: 10000,
  maxRetries: 2,
};

interface PaystackResponse<T> {
  status: boolean;
  message: string;
  data: T;
}

interface PaystackInitializeResponse {
  authorization_url: string;
  access_code: string;
  reference: string;
}

interface PaystackCustomerResponse {
  customer_code: string;
  email: string;
}

interface PaystackSubscriptionResponse {
  subscription_code: string;
  status: string;
}

interface PaystackPlanResponse {
  plan_code: string;
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;
}

function getPaystackSubscriptionSnapshot(data: Record<string, any>) {
  const invoiceSub = asRecord(data.subscription);
  const invoicePlan = asRecord(invoiceSub?.plan);
  const topLevelPlan = asRecord(data.plan);

  return {
    providerCode: invoiceSub?.subscription_code || data.subscription_code || "",
    startDate:
      invoiceSub?.current_period_start ||
      invoiceSub?.createdAt ||
      data.current_period_start ||
      data.createdAt,
    nextPaymentDate:
      invoiceSub?.next_payment_date ||
      invoiceSub?.current_period_end ||
      data.next_payment_date ||
      data.current_period_end,
    planCode:
      invoicePlan?.plan_code ||
      topLevelPlan?.plan_code ||
      invoiceSub?.plan_code ||
      undefined,
  };
}

class PaystackClient {
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(private config: PaystackConfig) {
    this.baseUrl = config.baseUrl || DEFAULT_CONFIG.baseUrl;
    this.timeout = config.timeout || DEFAULT_CONFIG.timeout;
    this.maxRetries = config.maxRetries || DEFAULT_CONFIG.maxRetries;
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
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
                Authorization: `Bearer ${this.config.secretKey}`,
                "Content-Type": "application/json",
              },
              body: body ? JSON.stringify(body) : undefined,
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              const errorBody = await response.text();
              throw new Error(errorBody);
            }

            const json = (await response.json()) as PaystackResponse<T>;
            if (!json.status) {
              throw new Error(json.message);
            }

            return json.data;
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
        providerId: "paystack",
        cause: error,
      }),
    });
  }

  initializeTransaction(params: {
    email: string;
    amount: string;
    currency?: string;
    reference?: string;
    callback_url?: string;
    plan?: string;
    metadata?: string | Record<string, unknown>;
    channels?: string[];
  }): Promise<ProviderResult<PaystackInitializeResponse>> {
    return this.request("POST", "/transaction/initialize", params);
  }

  createCustomer(params: {
    email: string;
    first_name?: string;
    last_name?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ProviderResult<PaystackCustomerResponse>> {
    return this.request("POST", "/customer", params);
  }

  createPlan(params: {
    name: string;
    amount: number;
    interval: string;
    description?: string;
    currency?: string;
  }): Promise<ProviderResult<PaystackPlanResponse>> {
    return this.request("POST", "/plan", params);
  }

  updatePlan(planCode: string, params: {
    name?: string;
    amount?: number;
    interval?: string;
    description?: string;
    currency?: string;
  }): Promise<ProviderResult<Record<string, unknown>>> {
    return this.request("PUT", `/plan/${encodeURIComponent(planCode)}`, params);
  }

  createSubscription(params: {
    customer: string;
    plan: string;
    authorization?: string;
    start_date?: string;
  }): Promise<ProviderResult<PaystackSubscriptionResponse>> {
    return this.request("POST", "/subscription", params);
  }

  fetchSubscription(code: string): Promise<ProviderResult<{
    email_token: string;
    status: string;
    subscription_code: string;
    plan: { plan_code: string } | null;
    createdAt: string;
    next_payment_date: string | null;
  }>> {
    return this.request("GET", `/subscription/${encodeURIComponent(code)}`);
  }

  disableSubscription(code: string, token: string): Promise<ProviderResult<{ status: boolean }>> {
    return this.request("POST", "/subscription/disable", {
      code,
      token,
    });
  }

  chargeAuthorization(params: {
    authorization_code: string;
    email: string;
    amount: number;
    currency?: string;
    reference?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ProviderResult<{ reference: string }>> {
    return this.request("POST", "/transaction/charge_authorization", {
      ...params,
      amount: String(params.amount),
    });
  }

  createRefund(params: {
    transaction: string;
    amount?: number;
    currency?: string;
    merchant_note?: string;
  }): Promise<ProviderResult<{ status: string; transaction: number; id: number }>> {
    return this.request("POST", "/refund", params);
  }
}

function getSecretKey(account: ProviderAccount): string | null {
  const credentials = account.credentials || {};
  const secretKey = credentials.secretKey;
  return typeof secretKey === "string" ? secretKey : null;
}

function resolveClient(account: ProviderAccount): ProviderResult<PaystackClient> {
  const secretKey = getSecretKey(account);
  if (!secretKey) {
    return Result.err({
      code: "configuration_missing",
      message: "Paystack secret key missing",
      providerId: "paystack",
    });
  }

  return Result.ok(new PaystackClient({ secretKey }));
}

export const paystackAdapter: ProviderAdapter = {
  id: "paystack",
  displayName: "Paystack",
  signatureHeaderName: "x-paystack-signature",
  supportsNativeTrials: false,
  defaultCurrency: "NGN",

  async createCheckoutSession(params): Promise<ProviderResult<CheckoutSession>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.initializeTransaction({
      email: params.customer.email,
      amount: String(params.amount),
      currency: params.currency,
      plan: params.plan?.id || undefined,
      callback_url: params.callbackUrl,
      metadata: params.metadata || undefined,
      channels: params.channels,
    });

    if (response.isErr()) return response;

    return Result.ok({
      url: response.value.authorization_url,
      reference: response.value.reference,
      accessCode: response.value.access_code,
    });
  },

  async createCustomer(params): Promise<ProviderResult<ProviderCustomerRef>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.createCustomer({
      email: params.email,
      first_name: params.name || undefined,
      metadata: params.metadata,
    });

    if (response.isErr()) return response;

    return Result.ok({
      id: response.value.customer_code,
      email: response.value.email,
      metadata: params.metadata,
    });
  },

  async createPlan(params): Promise<ProviderResult<ProviderPlanRef>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.createPlan({
      name: params.name,
      amount: params.amount,
      interval: params.interval,
      description: params.description || undefined,
      currency: params.currency,
    });

    if (response.isErr()) return response;

    return Result.ok({
      id: response.value.plan_code,
      metadata: {},
    });
  },

  async updatePlan(params): Promise<ProviderResult<{ updated: boolean }>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const updateBody: Record<string, unknown> = {};
    if (params.name !== undefined) updateBody.name = params.name;
    if (params.amount !== undefined) updateBody.amount = params.amount;
    if (params.interval !== undefined) updateBody.interval = params.interval;
    if (params.currency !== undefined) updateBody.currency = params.currency;
    if (params.description !== undefined) updateBody.description = params.description;

    const response = await clientResult.value.updatePlan(params.planId, updateBody);
    if (response.isErr()) return response;

    return Result.ok({ updated: true });
  },

  async createSubscription(
    params,
  ): Promise<ProviderResult<ProviderSubscriptionRef>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.createSubscription({
      customer: params.customer.id,
      plan: params.plan.id,
      authorization: params.authorizationCode || undefined,
      start_date: params.startDate || undefined,
    });

    if (response.isErr()) return response;

    return Result.ok({
      id: response.value.subscription_code,
      status: response.value.status,
      metadata: params.metadata,
    });
  },

  async cancelSubscription(
    params,
  ): Promise<ProviderResult<{ canceled: boolean }>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const fetchResult = await clientResult.value.fetchSubscription(
      params.subscription.id,
    );
    if (fetchResult.isErr()) return fetchResult as ProviderResult<{ canceled: boolean }>;

    const disableResult = await clientResult.value.disableSubscription(
      params.subscription.id,
      fetchResult.value.email_token,
    );

    if (disableResult.isErr()) return disableResult as ProviderResult<{ canceled: boolean }>;

    return Result.ok({ canceled: true });
  },

  async chargeAuthorization(
    params,
  ): Promise<ProviderResult<{ reference: string }>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.chargeAuthorization({
      authorization_code: params.authorizationCode,
      email: params.customer.email,
      amount: params.amount,
      currency: params.currency,
      reference: params.reference,
      metadata: params.metadata,
    });

    if (response.isErr()) return response;

    return Result.ok({ reference: response.value.reference });
  },

  async refundCharge(params): Promise<ProviderResult<{ refunded: boolean; reference: string }>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.createRefund({
      transaction: params.reference,
      amount: params.amount,
      currency: params.currency,
      merchant_note: params.reason,
    });

    if (response.isErr()) return response;
    return Result.ok({ refunded: true, reference: params.reference });
  },

  async fetchSubscription(
    params,
  ): Promise<ProviderResult<ProviderSubscriptionDetail>> {
    const clientResult = resolveClient(params.account);
    if (clientResult.isErr()) return clientResult;

    const response = await clientResult.value.fetchSubscription(
      params.subscriptionId,
    );
    if (response.isErr()) return response as ProviderResult<ProviderSubscriptionDetail>;

    return Result.ok({
      id: params.subscriptionId,
      status: response.value.status || "unknown",
      planCode: response.value.plan?.plan_code,
      startDate: response.value.createdAt,
      nextPaymentDate: response.value.next_payment_date ?? undefined,
      cancelToken: response.value.email_token,
      metadata: {},
    });
  },

  async verifyWebhook(
    params,
  ): Promise<ProviderResult<boolean>> {
    try {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(params.secret),
        { name: "HMAC", hash: "SHA-512" },
        false,
        ["sign"],
      );

      const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(params.payload),
      );

      const computed = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      return Result.ok(computed === params.signature);
    } catch {
      return Result.ok(false);
    }
  },

  parseWebhookEvent(
    params,
  ): ProviderResult<NormalizedWebhookEvent> {
    const raw = params.payload;
    const event = raw.event as string;
    const data = raw.data as Record<string, any>;

    if (!event || !data) {
      return Result.err({
        code: "invalid_payload",
        message: "Missing event or data in Paystack webhook payload",
        providerId: "paystack",
      });
    }

    const customer = data.customer || {};
    const authorization = data.authorization || {};
    const plan = data.plan || {};
    // Paystack metadata can be a string, object, or null — normalize
    let metadata: Record<string, unknown> = {};
    const rawMeta = data.metadata;
    if (rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)) {
      metadata = rawMeta as Record<string, unknown>;
    } else if (typeof rawMeta === "string") {
      try { metadata = JSON.parse(rawMeta); } catch { metadata = {}; }
    }

    const base = {
      provider: "paystack" as const,
      customer: {
        email: customer.email || data.email || "",
        providerCustomerId: customer.customer_code || "",
      },
      metadata,
      raw,
    };

    switch (event) {
      case "charge.success": {
        const subscription = getPaystackSubscriptionSnapshot(data);
        return Result.ok({
          ...base,
          type: "charge.success",
          payment: {
            amount: data.amount || 0,
            currency: data.currency || "NGN",
            reference: data.reference || "",
            paidAt: data.paid_at,
          },
          authorization: authorization.authorization_code
            ? {
                code: authorization.authorization_code,
                reusable: authorization.reusable ?? false,
                cardType: authorization.card_type,
                last4: authorization.last4,
                expMonth: authorization.exp_month,
                expYear: authorization.exp_year,
              }
            : undefined,
          subscription: subscription.providerCode
            ? {
                providerCode: subscription.providerCode,
                status: "active",
                startDate: subscription.startDate,
                nextPaymentDate: subscription.nextPaymentDate,
              }
            : undefined,
          plan: subscription.planCode
            ? { providerPlanCode: subscription.planCode }
            : undefined,
        });
      }

      case "charge.failed": {
        const subscription = getPaystackSubscriptionSnapshot(data);
        return Result.ok({
          ...base,
          type: "charge.failed",
          payment: {
            amount: data.amount || 0,
            currency: data.currency || "NGN",
            reference: data.reference || "",
          },
          subscription: subscription.providerCode
            ? {
                providerCode: subscription.providerCode,
                status: "past_due",
              }
            : undefined,
        });
      }

      case "subscription.create":
        return Result.ok({
          ...base,
          type: "subscription.created",
          subscription: {
            providerCode: data.subscription_code || "",
            status: data.status || "active",
            planCode: plan.plan_code,
            startDate: data.createdAt,
            nextPaymentDate: data.next_payment_date,
          },
          plan: plan.plan_code
            ? { providerPlanCode: plan.plan_code }
            : undefined,
        });

      case "subscription.not_renew":
        return Result.ok({
          ...base,
          type: "subscription.not_renew",
          subscription: {
            providerCode: data.subscription_code || "",
            status: "canceled",
          },
        });

      case "subscription.enable":
        return Result.ok({
          ...base,
          type: "subscription.active",
          subscription: {
            providerCode: data.subscription_code || "",
            status: "active",
          },
        });

      case "subscription.disable":
        return Result.ok({
          ...base,
          type: "subscription.canceled",
          subscription: {
            providerCode: data.subscription_code || "",
            status: "canceled",
          },
        });

      case "invoice.payment_failed": {
        const subscription = getPaystackSubscriptionSnapshot(data);
        return Result.ok({
          ...base,
          type: "charge.failed",
          payment: {
            amount: data.amount || asRecord(data.subscription)?.amount || 0,
            currency: data.currency || "NGN",
            reference: data.reference || data.invoice_code || "",
          },
          subscription: subscription.providerCode
            ? {
                providerCode: subscription.providerCode,
                status: "past_due",
              }
            : undefined,
        });
      }

      case "refund.processed":
        return Result.ok({
          ...base,
          type: "refund.success",
          refund: {
            amount: data.amount || 0,
            currency: data.currency || "NGN",
            reference: data.transaction_reference || data.reference || "",
            reason: data.customer_note || data.merchant_note || undefined,
          },
          payment: {
            amount: data.amount || 0,
            currency: data.currency || "NGN",
            reference: data.transaction_reference || data.reference || "",
          },
        });

      case "refund.failed":
        return Result.ok({
          ...base,
          type: "refund.failed",
          refund: {
            amount: data.amount || 0,
            currency: data.currency || "NGN",
            reference: data.transaction_reference || data.reference || "",
            reason: data.customer_note || data.merchant_note || undefined,
          },
        });

      case "customeridentification.success":
        return Result.ok({
          ...base,
          type: "customer.identified",
        });

      default:
        return Result.err({
          code: "unknown_event",
          message: `Unsupported Paystack event: ${event}`,
          providerId: "paystack",
        });
    }
  },
};
