/**
 * Core configuration types
 */

export interface OwostackConfig {
  /** Paystack secret key (starts with sk_) */
  secretKey: string;

  /** Optional: Custom API URL for self-hosted deployments */
  apiUrl?: string;

  /** Optional: Enable debug mode */
  debug?: boolean;
}

/**
 * attach() - Checkout & Subscription Management
 */

export interface AttachParams {
  /** Customer ID or email */
  customer: string;

  /** Product/plan ID to purchase or upgrade to */
  product: string;

  /** Optional: Custom metadata */
  metadata?: Record<string, unknown>;

  /** Optional: Payment channels to enable */
  channels?: PaymentChannel[];

  /** Optional: Currency (auto-detected if not provided) */
  currency?: Currency;

  /** Optional: Redirect URL after successful payment */
  callbackUrl?: string;
}

export interface AttachResult {
  /** Checkout URL to redirect user */
  url: string;

  /** Payment reference for tracking */
  reference: string;

  /** Access code for inline checkout */
  accessCode: string;
}

/**
 * check() - Feature Gating & Access Control
 */

export interface CheckParams {
  /** Customer ID or email */
  customer: string;

  /** Feature ID to check access for */
  feature: string;

  /** Optional: Amount of usage to check (default: 1) */
  amount?: number;
}

export interface CheckResult {
  /** Whether access is allowed */
  allowed: boolean;

  /** Reason if access is denied */
  reason?:
    | "quota_exceeded"
    | "payment_failed"
    | "plan_missing"
    | "feature_not_included";

  /** Current usage for this feature */
  usage?: {
    current: number;
    limit: number | null;
    percentage: number;
    resetAt?: string;
  };

  /** Upgrade URL if access denied */
  upgradeUrl?: string;
}

/**
 * track() - Usage Metering & Billing
 */

export interface TrackParams {
  /** Customer ID or email */
  customer: string;

  /** Feature ID to track usage for */
  feature: string;

  /** Amount to track (default: 1) */
  amount?: number;

  /** Optional: Event metadata */
  metadata?: Record<string, unknown>;

  /** Optional: Credits to deduct instead of amount */
  credits?: number;
}

export interface TrackResult {
  /** Whether tracking was successful */
  success: boolean;

  /** Updated usage after tracking */
  usage: {
    current: number;
    limit: number | null;
    remaining: number | null;
  };

  /** Amount billed (if pay-as-you-go) */
  billed?: {
    amount: number;
    currency: Currency;
  };
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
  paystackCustomerId?: string;
  email: string;
  name?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Subscription {
  id: string;
  customerId: string;
  paystackSubscriptionId?: string;
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
