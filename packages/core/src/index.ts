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
 * Owostack - Paystack made delightful
 *
 * Three methods to rule them all:
 * - attach(): Start checkout or manage subscriptions
 * - check(): Verify feature access and usage limits
 * - track(): Record usage and trigger billing
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
   * Returns a URL to redirect users or an inline payment reference.
   *
   * @example
   * ```ts
   * const { url, reference } = await owo.attach({
   *   customer: 'customer@example.com',
   *   product: 'pro_plan',
   *   metadata: { source: 'homepage' }
   * });
   *
   * // Redirect user to checkout
   * window.location.href = url;
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
   * @example
   * ```ts
   * const access = await owo.check({
   *   customer: 'customer@example.com',
   *   feature: 'api_calls'
   * });
   *
   * if (!access.allowed) {
   *   throw new Error(access.reason); // "Quota exceeded"
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
   *   customer: 'customer@example.com',
   *   feature: 'api_calls',
   *   amount: 1,
   *   metadata: { endpoint: '/v1/analyze' }
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
      throw new OwostackError(error.code, error.message);
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
  TrackParams,
  TrackResult,
  OwostackConfig,
} from "@owostack/types";
