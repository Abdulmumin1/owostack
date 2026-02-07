/**
 * Core configuration types
 */

export interface OwostackConfig {
  /** API secret key */
  secretKey: string;

  /** Optional: Custom API URL for self-hosted deployments */
  apiUrl?: string;

  /** Optional: Enable debug mode */
  debug?: boolean;
}

/**
 * CustomerData - Passed to auto-create/update a customer on any endpoint.
 * Email is always required because billing providers need it.
 */
export interface CustomerData {
  /** Customer email (required for billing providers) */
  email: string;

  /** Customer display name */
  name?: string;

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * attach() - Checkout & Subscription Management
 */

export interface AttachParams {
  /** Customer ID or email */
  customer: string;

  /** Product/plan slug or ID to purchase or upgrade to */
  product: string;

  /** Optional: Auto-create or update the customer */
  customerData?: CustomerData;

  /** Optional: Custom metadata */
  metadata?: Record<string, unknown>;

  /** Optional: Payment channels to enable */
  channels?: PaymentChannel[];

  /** Optional: Currency (auto-detected if not provided) */
  currency?: Currency;

  /** Optional: Redirect URL after successful payment */
  callbackUrl?: string;

  /** Optional: Region selector for provider routing */
  region?: string;

  /** Optional: Override provider selection */
  provider?: string;
}

export interface AttachResult {
  /** Checkout URL to redirect user */
  url: string;

  /** Payment reference for tracking */
  reference: string;

  /** Access code for inline checkout */
  accessCode: string;

  /** Resolved internal customer ID */
  customerId: string;

  /** Switch type if customer already had a subscription */
  type: "new" | "upgrade" | "downgrade" | "lateral";
}

/**
 * check() - Feature Gating & Access Control
 */

export interface CheckParams {
  /** Customer ID or email */
  customer: string;

  /** Feature slug or ID to check access for */
  feature: string;

  /** Units to check against limit (default: 1) */
  value?: number;

  /** Optional: Auto-create customer if not found */
  customerData?: CustomerData;

  /** Optional: Atomically track usage if allowed (check + track in one call) */
  sendEvent?: boolean;

  /** Optional: Entity ID to scope usage to (e.g. seat, workspace) */
  entity?: string;
}

/** Machine-readable codes returned by check() */
export type CheckCode =
  | "access_granted"
  | "customer_not_found"
  | "feature_not_found"
  | "no_active_subscription"
  | "feature_not_in_plan"
  | "overage_allowed"
  | "limit_exceeded"
  | "insufficient_balance"
  | "insufficient_credits"
  | "unknown_feature_type";

/** Machine-readable codes returned by track() */
export type TrackCode =
  | "tracked"
  | "tracked_overage"
  | "customer_not_found"
  | "feature_not_found"
  | "no_active_subscription"
  | "feature_not_in_plan"
  | "insufficient_balance"
  | "internal_error";

/** Overage billing details included when usage exceeds the plan limit */
export interface OverageDetails {
  /** Overage handling type */
  type: "charge" | "notify" | "block";

  /** Whether this overage will be billed */
  willBeBilled: boolean;

  /** Price per overage unit in minor currency units (e.g. kobo) */
  pricePerUnit?: number | null;

  /** Number of units per billing increment */
  billingUnits?: number | null;
}

/**
 * Contextual details object returned alongside standard check/track fields.
 * Contains all optional/situational information that isn't part of the
 * core response shape (trial status, plan info, overage billing, etc.).
 */
export interface ResponseDetails {
  /** Human-readable explanation of the result */
  message: string;

  /** Name of the plan granting access */
  planName?: string;

  /** Whether access is via a free trial */
  trial?: boolean;

  /** ISO timestamp when the trial ends */
  trialEndsAt?: string | null;

  /** Overage billing details (present when usage exceeds plan limit) */
  overage?: OverageDetails;
}

export interface CheckResult {
  /** Whether access is allowed */
  allowed: boolean;

  /** Machine-readable code */
  code: CheckCode | string;

  /** Remaining balance (null = unlimited) */
  balance?: number | null;

  /** Current usage this period */
  usage?: number;

  /** Plan limit (null = unlimited) */
  limit?: number | null;

  /** Whether feature is unlimited */
  unlimited?: boolean;

  /** ISO timestamp when usage resets */
  resetsAt?: string;

  /** Reset interval */
  resetInterval?: string;

  /** Contextual details (trial info, plan name, overage, human message) */
  details?: ResponseDetails;
}

/**
 * track() - Usage Metering & Billing
 */

export interface TrackParams {
  /** Customer ID or email */
  customer: string;

  /** Feature slug or ID to track usage for */
  feature: string;

  /** Amount to track (default: 1) */
  value?: number;

  /** Optional: Auto-create customer if not found */
  customerData?: CustomerData;

  /** Optional: Entity ID to scope usage to (e.g. seat, workspace) */
  entity?: string;

  /** Optional: Event metadata */
  metadata?: Record<string, unknown>;
}

export interface TrackResult {
  /** Whether tracking was successful */
  success: boolean;

  /** Whether the tracked usage was within limits */
  allowed: boolean;

  /** Machine-readable code */
  code: TrackCode | string;

  /** Remaining balance after tracking (null = unlimited) */
  balance?: number | null;

  /** ISO timestamp when usage resets */
  resetsAt?: string;

  /** Reset interval */
  resetInterval?: string;

  /** Contextual details (trial info, overage, human message) */
  details?: ResponseDetails;
}

/**
 * Shared types
 */

export type PaymentChannel =
  | "card"
  | "bank"
  | "bank_transfer"
  | "ussd"
  | "mobile_money"
  | "qr";

export type Currency = "NGN" | "GHS" | "ZAR" | "KES" | "USD";

export type PlanInterval =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export type ResetInterval = "never" | "5min" | "15min" | "30min" | "hourly" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

export type SubscriptionStatus =
  | "active"
  | "canceled"
  | "expired"
  | "incomplete"
  | "incomplete_expired"
  | "past_due"
  | "trialing"
  | "unpaid";

/**
 * Plan and feature definitions
 */

export interface Plan {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: Currency;
  interval: PlanInterval;
  features: Record<string, FeatureLimit>;
  metadata?: Record<string, unknown>;
}

export interface FeatureLimit {
  /** Usage limit (null = unlimited) */
  limit: number | null;

  /** Reset interval */
  reset: ResetInterval;

  /** Overage behavior */
  overage?: "block" | "charge";

  /** Overage price per unit */
  overagePrice?: number;
}

export interface Feature {
  id: string;
  name: string;
  description?: string;
  type: "metered" | "boolean" | "seats";
  unit?: string;
}

/**
 * Database models
 */

export interface Customer {
  id: string;
  providerId?: string;
  providerCustomerId?: string;
  providerAuthorizationCode?: string;
  providerMetadata?: Record<string, unknown>;
  paystackCustomerId?: string;
  paystackAuthorizationCode?: string;
  email: string;
  name?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Subscription {
  id: string;
  customerId: string;
  providerId?: string;
  providerSubscriptionId?: string;
  providerSubscriptionCode?: string;
  providerMetadata?: Record<string, unknown>;
  paystackSubscriptionId?: string;
  paystackSubscriptionCode?: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAt?: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Entitlement {
  id: string;
  customerId: string;
  featureId: string;
  limit: number | null;
  resetInterval: ResetInterval;
  lastResetAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsageRecord {
  id: string;
  customerId: string;
  featureId: string;
  amount: number;
  periodStart: Date;
  periodEnd: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}
