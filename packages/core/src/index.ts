import type {
  AttachParams,
  AttachResult,
  CheckParams,
  CheckResult,
  TrackParams,
  TrackResult,
  OwostackConfig,
} from "@owostack/types";

/**
 * Owostack - Billing infrastructure for Africa
 *
 * Three methods to rule them all:
 * - attach(): Start checkout or manage subscriptions
 * - check(): Verify feature access and usage limits
 * - track(): Record usage and trigger billing
 *
 * Customers are auto-created when you pass customerData to any endpoint.
 */
export class Owostack {
  private config: OwostackConfig;
  private apiUrl: string;

  constructor(config: OwostackConfig) {
    this.config = config;
    this.apiUrl = config.apiUrl || "https://api.owostack.dev";
  }

  /**
   * attach() - Checkout & Subscription Management
   *
   * Creates checkout sessions, handles upgrades/downgrades, manages subscriptions.
   * Auto-creates the customer if customerData is provided and the customer doesn't exist.
   *
   * @example
   * ```ts
   * const result = await owo.attach({
   *   customer: 'user_123',
   *   product: 'pro_plan',
   *   customerData: { email: 'user@example.com', name: 'Jane' },
   * });
   *
   * // Redirect user to checkout
   * window.location.href = result.url;
   * ```
   */
  async attach(params: AttachParams): Promise<AttachResult> {
    const response = await this.request("/attach", params);
    return response as AttachResult;
  }

  /**
   * check() - Feature Gating & Access Control
   *
   * Queries whether a customer can access a feature based on their plan,
   * payment status, and usage limits.
   *
   * Pass sendEvent: true to atomically check AND track usage in one call.
   *
   * @example
   * ```ts
   * const access = await owo.check({
   *   customer: 'user_123',
   *   feature: 'api_calls',
   *   customerData: { email: 'user@example.com' },
   * });
   *
   * if (!access.allowed) {
   *   throw new Error(access.code);
   * }
   * ```
   */
  async check(params: CheckParams): Promise<CheckResult> {
    const response = await this.request("/check", params);
    return response as CheckResult;
  }

  /**
   * track() - Usage Metering & Billing
   *
   * Records usage events, decrements quotas, and triggers billing for
   * pay-as-you-go features.
   *
   * @example
   * ```ts
   * await owo.track({
   *   customer: 'user_123',
   *   feature: 'api_calls',
   *   value: 1,
   *   customerData: { email: 'user@example.com' },
   * });
   * ```
   */
  async track(params: TrackParams): Promise<TrackResult> {
    const response = await this.request("/track", params);
    return response as TrackResult;
  }

  /**
   * Internal request handler
   */
  private async request(endpoint: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.apiUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.secretKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new OwostackError(error.code || "unknown_error", error.message || error.error || "Request failed");
    }

    return response.json();
  }
}

/**
 * Custom error class for Owostack-specific errors
 */
export class OwostackError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OwostackError";
    this.code = code;
  }
}

// Re-export types for convenience
export type {
  AttachParams,
  AttachResult,
  CheckParams,
  CheckResult,
  CheckCode,
  TrackParams,
  TrackResult,
  TrackCode,
  OwostackConfig,
  CustomerData,
  ResponseDetails,
  OverageDetails,
} from "@owostack/types";
