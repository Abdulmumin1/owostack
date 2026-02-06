import { Result } from "better-result";
import { PaystackError } from "./errors";

// =============================================================================
// Configuration
// =============================================================================

export interface PaystackConfig {
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

// =============================================================================
// Response Types
// =============================================================================

export interface PaystackResponse<T> {
  status: boolean;
  message: string;
  data: T;
}

export interface PaystackCustomer {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}

export interface PaystackInitializeParams {
  email: string;
  amount: string;
  currency?: string;
  reference?: string;
  callback_url?: string;
  plan?: string;
  invoice_limit?: number;
  metadata?: string;
  channels?: string[];
  split_code?: string;
  subaccount?: string;
  transaction_charge?: number;
  bearer?: "account" | "subaccount";
}

export interface PaystackInitializeResponse {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export interface PaystackVerifyResponse {
  id: number;
  status: "success" | "failed" | "abandoned";
  reference: string;
  amount: number;
  message: string;
  gateway_response: string;
  paid_at: string;
  created_at: string;
  channel: string;
  currency: string;
  ip_address: string;
  metadata: Record<string, unknown>;
  customer: {
    id: number;
    customer_code: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    metadata: Record<string, unknown>;
  };
  plan?: {
    id: number;
    name: string;
    plan_code: string;
    amount: number;
    interval: string;
  };
  authorization?: {
    authorization_code: string;
    bin: string;
    last4: string;
    exp_month: string;
    exp_year: string;
    channel: string;
    card_type: string;
    bank: string;
    country_code: string;
    brand: string;
    reusable: boolean;
    signature: string;
    account_name: string;
  };
}

export interface PaystackCustomerResponse {
  id: number;
  customer_code: string;
  email: string;
  integration: number;
  domain: string;
  identified: boolean;
  identifications: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface PaystackSubscriptionResponse {
  id: number;
  domain: string;
  status: string;
  subscription_code: string;
  email_token: string;
  amount: number;
  cron_expression: string;
  next_payment_date: string;
  plan: {
    id: number;
    name: string;
    plan_code: string;
    description: string;
    amount: number;
    interval: string;
    currency: string;
  };
  customer: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    customer_code: string;
    phone: string;
  };
}

// =============================================================================
// Client Implementation
// =============================================================================

export class PaystackClient {
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(private config: PaystackConfig) {
    this.baseUrl = config.baseUrl || DEFAULT_CONFIG.baseUrl;
    this.timeout = config.timeout || DEFAULT_CONFIG.timeout;
    this.maxRetries = config.maxRetries || DEFAULT_CONFIG.maxRetries;
  }

  /**
   * Internal request with retry logic and Result type
   */
  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<Result<T, PaystackError>> {
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
              let paystackMessage = errorBody;
              try {
                const parsed = JSON.parse(errorBody);
                paystackMessage = parsed.message || errorBody;
              } catch {
                // Keep raw text
              }

              throw new PaystackError({
                statusCode: response.status,
                paystackMessage,
              });
            }

            const json = (await response.json()) as PaystackResponse<T>;
            if (!json.status) {
              throw new PaystackError({
                statusCode: 400,
                paystackMessage: json.message,
              });
            }

            return json.data;
          } catch (error) {
            lastError = error as Error;

            // Don't retry on 4xx errors (client errors)
            if (
              error instanceof PaystackError &&
              error.statusCode >= 400 &&
              error.statusCode < 500
            ) {
              throw error;
            }

            // Exponential backoff on retryable errors
            if (attempt < this.maxRetries) {
              await this.delay(Math.pow(2, attempt) * 100);
            }
          }
        }

        throw lastError || new Error("Request failed after retries");
      },
      catch: (e) => {
        if (e instanceof PaystackError) return e;
        return new PaystackError({
          statusCode: 0,
          paystackMessage: e instanceof Error ? e.message : String(e),
          cause: e,
        });
      },
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ===========================================================================
  // Transactions
  // ===========================================================================

  async initializeTransaction(
    params: PaystackInitializeParams,
  ): Promise<Result<PaystackInitializeResponse, PaystackError>> {
    return this.request<PaystackInitializeResponse>(
      "POST",
      "/transaction/initialize",
      params,
    );
  }

  async verifyTransaction(
    reference: string,
  ): Promise<Result<PaystackVerifyResponse, PaystackError>> {
    return this.request<PaystackVerifyResponse>(
      "GET",
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
  }

  // ===========================================================================
  // Customers
  // ===========================================================================

  async createCustomer(
    params: PaystackCustomer,
  ): Promise<Result<PaystackCustomerResponse, PaystackError>> {
    return this.request<PaystackCustomerResponse>("POST", "/customer", params);
  }

  async fetchCustomer(
    emailOrCode: string,
  ): Promise<Result<PaystackCustomerResponse, PaystackError>> {
    return this.request<PaystackCustomerResponse>(
      "GET",
      `/customer/${encodeURIComponent(emailOrCode)}`,
    );
  }

  // ===========================================================================
  // Subscriptions & Plans
  // ===========================================================================

  async createPlan(params: {
    name: string;
    amount: number;
    interval: string;
    description?: string;
    currency?: string;
  }): Promise<
    Result<{ plan_code: string; id: number; name: string }, PaystackError>
  > {
    return this.request<{ plan_code: string; id: number; name: string }>(
      "POST",
      "/plan",
      params,
    );
  }

  async fetchSubscription(
    idOrCode: string,
  ): Promise<Result<PaystackSubscriptionResponse, PaystackError>> {
    return this.request<PaystackSubscriptionResponse>(
      "GET",
      `/subscription/${encodeURIComponent(idOrCode)}`,
    );
  }

  async listSubscriptions(
    params: {
      customer?: string;
      plan?: string;
      perPage?: number;
      page?: number;
    } = {},
  ): Promise<Result<PaystackSubscriptionResponse[], PaystackError>> {
    const query = new URLSearchParams();
    if (params.customer) query.set("customer", params.customer);
    if (params.plan) query.set("plan", params.plan);
    if (params.perPage) query.set("perPage", params.perPage.toString());
    if (params.page) query.set("page", params.page.toString());

    return this.request<PaystackSubscriptionResponse[]>(
      "GET",
      `/subscription?${query.toString()}`,
    );
  }

  async disableSubscription(
    code: string,
    token: string,
  ): Promise<Result<{ status: boolean }, PaystackError>> {
    return this.request<{ status: boolean }>("POST", "/subscription/disable", {
      code,
      token,
    });
  }

  async enableSubscription(
    code: string,
    token: string,
  ): Promise<Result<{ status: boolean }, PaystackError>> {
    return this.request<{ status: boolean }>("POST", "/subscription/enable", {
      code,
      token,
    });
  }

  // ===========================================================================
  // Charge Authorization (for saved cards)
  // ===========================================================================

  async chargeAuthorization(params: {
    authorization_code: string;
    email: string;
    amount: number;
    currency?: string;
    reference?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Result<PaystackVerifyResponse, PaystackError>> {
    return this.request<PaystackVerifyResponse>(
      "POST",
      "/transaction/charge_authorization",
      {
        ...params,
        amount: String(params.amount),
      },
    );
  }

  // ===========================================================================
  // Subscription Management (API-driven)
  // ===========================================================================

  async createSubscription(params: {
    customer: string; // email or customer_code
    plan: string; // plan_code
    authorization?: string; // authorization_code for existing card
    start_date?: string; // ISO date
  }): Promise<
    Result<
      { subscription_code: string; email_token: string; status: string },
      PaystackError
    >
  > {
    return this.request<{
      subscription_code: string;
      email_token: string;
      status: string;
    }>("POST", "/subscription", params);
  }
}
