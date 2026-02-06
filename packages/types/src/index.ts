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

export interface CheckResult {
  /** Whether access is allowed */
  allowed: boolean;

  /** Machine-readable code */
  code: string;

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
  code: string;

  /** Remaining balance after tracking (null = unlimited) */
  balance?: number | null;

  /** ISO timestamp when usage resets */
  resetsAt?: string;

  /** Reset interval */
  resetInterval?: string;
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
  overage?: "block" | "charge" | "notify";

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
