/**
 * Core configuration types
 */

export interface OwostackConfig {
  /** API secret key */
  secretKey: string;

  /** Optional: Default provider for all plans (e.g., "paystack", "dodo") */
  provider?: string;

  /** Optional: Environment mode (sandbox or live) */
  mode?: "sandbox" | "live";

  /** Optional: Custom API URL for self-hosted deployments (takes precedence over mode) */
  apiUrl?: string;

  /** Optional: Enable debug mode */
  debug?: boolean;

  /** Optional: Declarative catalog of plans and features */
  catalog?: CatalogEntry[];
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
}

export interface AttachResult {
  /** Checkout URL to redirect user */
  checkoutUrl: string;

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
  | "overage_allowed"
  | "addon_credits_used"
  | "limit_exceeded"
  | "insufficient_credits"
  | "customer_not_found"
  | "feature_not_found"
  | "no_active_subscription"
  | "feature_not_in_plan"
  | "unknown_feature_type";

/** Machine-readable codes returned by track() */
export type TrackCode =
  | "tracked"
  | "tracked_overage"
  | "addon_credits_used"
  | "limit_exceeded"
  | "customer_not_found"
  | "feature_not_found"
  | "no_active_subscription"
  | "feature_not_in_plan"
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

/** A single tier in a usage pricing model */
export interface PricingTier {
  /** Inclusive upper bound for this tier; null means infinity */
  upTo: number | null;

  /** Optional price per unit in minor currency units */
  unitPrice?: number;

  /** Optional flat fee charged when this tier is entered */
  flatFee?: number;
}

/** How billable usage is converted into money */
export type RatingModel = "package" | "graduated" | "volume";

/** Current tier for tiered pricing responses */
export interface CurrentPricingTier {
  /** Zero-based tier index */
  index: number;

  /** Usage at which this tier starts */
  startsAt: number;

  /** Inclusive upper bound of the tier; null means infinity */
  endsAt: number | null;

  /** Price per unit for this tier; 0 when the tier is flat-only */
  unitPrice: number;

  /** Optional flat fee charged when this tier is entered */
  flatFee?: number;
}

/** Pricing metadata returned alongside access/billing responses */
export interface PricingDetails {
  /** Entitlement model for this feature */
  usageModel?: "included" | "usage_based" | "prepaid";

  /** Rating model used when usage is billable */
  ratingModel?: RatingModel;

  /** Package or per-unit price in minor currency units */
  pricePerUnit?: number | null;

  /** Package size for package pricing */
  billingUnits?: number | null;

  /** Current tier when using graduated or volume pricing */
  currentTier?: CurrentPricingTier;
}

/** Per-tier billing breakdown for rated usage */
export interface BillingTierBreakdown {
  /** Zero-based tier index */
  tier: number;

  /** Units billed in this tier */
  units: number;

  /** Price per unit for this tier; 0 when the tier is flat-only */
  unitPrice: number;

  /** Optional flat fee applied for the tier */
  flatFee?: number;

  /** Amount billed for this tier in minor currency units */
  amount: number;
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

  /** Credit system slug (when feature resolved via credit system) */
  creditSystem?: string;

  /** Credit cost per unit of the child feature */
  creditCostPerUnit?: number;

  /** Overage billing details (present when usage exceeds plan limit) */
  overage?: OverageDetails;

  /** Number of add-on credits used in this request */
  addonCreditsUsed?: number;

  /** Remaining add-on credits after this request */
  addonCreditsRemaining?: number;

  /** Pricing metadata for chargeable metered features */
  pricing?: PricingDetails;
}

/** Plan credit breakdown for credit system features */
export interface PlanCredits {
  /** Credits used this period */
  used: number;

  /** Plan credit limit */
  limit: number | null;

  /** ISO timestamp when plan credits reset */
  resetsAt: string;
}

export interface CheckResult {
  /** Whether access is allowed */
  allowed: boolean;

  /** Machine-readable code */
  code: CheckCode | string;

  /** Current usage this period (null for boolean features) */
  usage: number | null;

  /** Plan limit (null = unlimited) */
  limit: number | null;

  /** Remaining plan units: limit - usage (null = unlimited) */
  balance: number | null;

  /** ISO timestamp when usage resets (null for boolean/non-resetting) */
  resetsAt: string | null;

  /** Reset interval (null for boolean features) */
  resetInterval: string | null;

  /** Add-on credit balance for this credit system (only for credit system features) */
  addonCredits?: number;

  /** Plan credit breakdown (only for credit system features) */
  planCredits?: PlanCredits;

  /** Contextual details (trial info, plan name, overage, human message) */
  details: ResponseDetails;
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

  /** Current usage this period after tracking (null for unlimited) */
  usage: number | null;

  /** Plan limit (null = unlimited) */
  limit: number | null;

  /** Remaining plan units after tracking: limit - usage (null = unlimited) */
  balance: number | null;

  /** ISO timestamp when usage resets */
  resetsAt: string | null;

  /** Reset interval */
  resetInterval: string | null;

  /** Add-on credit balance for this credit system (only for credit system features) */
  addonCredits?: number;

  /** Plan credit breakdown (only for credit system features) */
  planCredits?: PlanCredits;

  /** Contextual details (trial info, plan name, overage, human message) */
  details: ResponseDetails;
}

/**
 * billing.usage() - Get Unbilled Overage Usage
 */

export interface BillingUsageParams {
  /** Customer ID or email */
  customer: string;
}

export interface BillingFeatureUsage {
  /** Feature ID */
  featureId: string;

  /** Human-readable feature name */
  featureName: string;

  /** Total usage this period */
  usage: number;

  /** Included in plan (null = unlimited) */
  included: number | null;

  /** Billable overage units */
  billableQuantity: number;

  /** Estimated overage charge in minor currency units */
  estimatedAmount: number;

  /** Usage billing model */
  usageModel: string;

  /** Rating model used to calculate the estimated amount */
  ratingModel?: RatingModel;

  /** Package or per-unit price in minor currency units */
  pricePerUnit?: number | null;

  /** Package size when using package pricing */
  billingUnits?: number | null;

  /** Optional tier breakdown for graduated or volume pricing */
  tierBreakdown?: BillingTierBreakdown[];
}

export interface BillingUsageResult {
  /** Whether the request succeeded */
  success: boolean;

  /** Total estimated overage amount in minor currency units */
  totalEstimated: number;

  /** Currency code */
  currency: string;

  /** Per-feature breakdown */
  features: BillingFeatureUsage[];
}

/**
 * billing.invoice() - Generate an Invoice
 */

export interface InvoiceParams {
  /** Customer ID or email */
  customer: string;
}

export interface InvoiceLineItem {
  /** Feature or item description */
  description: string;

  /** Quantity */
  quantity: number;

  /** Unit price component in minor currency units; tiered lines rely on tierBreakdown for exact pricing */
  unitPrice: number;

  /** Line total in minor currency units; may include package rounding or flat tier amounts */
  amount: number;

  /** Rating model used for tiered usage lines */
  ratingModel?: RatingModel;

  /** Optional tier breakdown for graduated or volume usage lines */
  tierBreakdown?: BillingTierBreakdown[];
}

export interface Invoice {
  /** Invoice ID */
  id: string;

  /** Human-readable invoice number */
  number: string;

  /** Total amount in minor currency units */
  total: number;

  /** Currency code */
  currency: string;

  /** Invoice status */
  status: "draft" | "open" | "paid" | "void";

  /** Line items */
  lineItems?: InvoiceLineItem[];

  /** ISO timestamp */
  createdAt: string;
}

export interface InvoiceResult {
  /** Whether the request succeeded */
  success: boolean;

  /** Generated invoice */
  invoice: Invoice;
}

/**
 * billing.pay() - Pay an Invoice
 */

export interface PayInvoiceParams {
  /** Invoice ID */
  invoiceId: string;

  /** URL to redirect to after checkout payment (used when auto-charge fails) */
  callbackUrl?: string;
}

export interface PayInvoiceResult {
  /** Whether the request succeeded */
  success: boolean;

  /** Whether the invoice was auto-charged (true) or needs manual checkout (false) */
  paid: boolean;

  /** Checkout URL — present when paid=false (customer must pay manually) */
  checkoutUrl?: string;

  /** The invoice */
  invoice: Invoice;
}

/**
 * billing.invoices() - List Invoices
 */

export interface InvoicesParams {
  /** Customer ID or email */
  customer: string;
}

export interface InvoicesResult {
  /** Whether the request succeeded */
  success: boolean;

  /** List of invoices */
  invoices: Invoice[];
}

/**
 * addon() - Purchase Add-on Credit Pack
 */

export interface AddonParams {
  /** Customer ID or email */
  customer: string;

  /** Credit pack slug or ID */
  pack: string;

  /** Number of packs to buy (default: 1) */
  quantity?: number;

  /** Optional: Currency override */
  currency?: string;

  /** Optional: Redirect URL after checkout */
  callbackUrl?: string;

  /** Optional: Custom metadata */
  metadata?: Record<string, unknown>;
}

export interface AddonResult {
  /** Whether the purchase succeeded immediately */
  success: boolean;

  /** Whether the customer needs to complete a checkout */
  requiresCheckout: boolean;

  /** Total credits added (only if immediate charge succeeded) */
  credits?: number;

  /** Updated scoped balance (only if immediate charge succeeded) */
  balance?: number;

  /** Credit system the credits were added to */
  creditSystemId?: string;

  /** Checkout URL (only if requiresCheckout is true) */
  checkoutUrl?: string;

  /** Payment reference */
  reference?: string;

  /** Human-readable message */
  message?: string;
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

export type Currency =
  | "NGN"
  | "GHS"
  | "ZAR"
  | "KES" // Africa
  | "USD"
  | "CAD" // North America
  | "EUR"
  | "GBP"
  | "CHF"
  | "SEK"
  | "NOK"
  | "DKK"
  | "PLN"
  | "CZK" // Europe
  | "JPY"
  | "CNY"
  | "INR"
  | "SGD"
  | "HKD"
  | "AUD"
  | "NZD" // Asia-Pacific
  | "BRL"
  | "MXN"
  | "ARS"
  | "COP" // Latin America
  | "AED"
  | "SAR"
  | "EGP" // Middle East
  | (string & {}); // Allow any ISO 4217 code

export type PlanInterval =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export type ResetInterval =
  | "none"
  | "never"
  | "5min"
  | "15min"
  | "30min"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semi_annual"
  | "yearly";

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

/**
 * Catalog Builder Types
 * Used by metered(), boolean(), and plan() builder functions.
 */

/** Union of all catalog entries passed to OwostackConfig.catalog */
export type CatalogEntry =
  | PlanDefinition
  | CreditSystemDefinition
  | CreditPackDefinition;

/** Configuration for a metered feature within a plan */
export interface MeteredFeatureConfig {
  /** Limit for this plan (null = unlimited) */
  limit?: number | null;

  /** Limit for this plan during a trial period (null = unlimited) */
  trialLimit?: number | null;

  /** Reset interval (default: "monthly") */
  reset?: ResetInterval;

  /** Overage behavior (default: "block") */
  overage?: "block" | "charge";

  /** Price per overage unit in minor currency units */
  overagePrice?: number;

  /** Max overage units per period */
  maxOverageUnits?: number;

  /** Billing units for overage */
  billingUnits?: number;

  /** Entitlement model for this feature */
  usageModel?: "included" | "usage_based" | "prepaid";

  /** Package or per-unit price in minor currency units */
  pricePerUnit?: number;

  /** Rating model used for billable usage */
  ratingModel?: RatingModel;

  /** Tiers used for graduated or volume pricing */
  tiers?: PricingTier[];

  /** Credit cost for credit systems */
  creditCost?: number;

  /** Whether feature is enabled (default: true) */
  enabled?: boolean;
}

/** Configuration for a boolean feature within a plan */
export interface BooleanFeatureConfig {
  /** Whether feature is included in this plan (default: true) */
  enabled?: boolean;
}

/** A feature entry inside a plan's features array */
export interface PlanFeatureEntry {
  /** @internal */
  _type: "plan_feature";

  /** Feature slug */
  slug: string;

  /** Feature type */
  featureType: "metered" | "boolean";

  /** Human-readable name (auto-generated from slug if omitted) */
  name?: string;

  /** Whether feature is included in this plan */
  enabled: boolean;

  /** Metered config (only for metered features) */
  config?: MeteredFeatureConfig;
}

/** A plan definition in the catalog */
export interface PlanDefinition {
  /** @internal */
  _type: "plan";

  /** Plan slug (used as unique identifier) */
  slug: string;

  /** Human-readable plan name */
  name: string;

  /** Plan description */
  description?: string;

  /** Price in minor currency units (e.g. kobo) */
  price: number;

  /** Currency code */
  currency: Currency;

  /** Billing interval */
  interval: PlanInterval;

  /** Whether this plan is recurring or one-time */
  billingType: "recurring" | "one_time";

  /** Features included in this plan */
  features: PlanFeatureEntry[];

  /** Plan group for upgrade/downgrade logic */
  planGroup?: string;

  /** Trial period in days */
  trialDays?: number;

  /** Provider for this plan (overrides default) */
  provider?: string;

  /** Custom metadata */
  metadata?: Record<string, unknown>;

  /** Auto-assign this plan to new customers */
  autoEnable?: boolean;

  /** Optional: Is this an add-on plan? */
  isAddon?: boolean;
}

/** A feature entry within a credit system */
export interface CreditSystemFeatureEntry {
  /** Feature slug */
  feature: string;

  /** Credit cost per unit of this feature */
  creditCost: number;
}

/** A credit system definition in the catalog */
export interface CreditSystemDefinition {
  /** @internal */
  _type: "credit_system";

  /** Credit system slug (used as unique identifier) */
  slug: string;

  /** Human-readable credit system name */
  name: string;

  /** Credit system description */
  description?: string;

  /** Features that consume credits from this system with their credit costs */
  features: CreditSystemFeatureEntry[];
}

/** A credit pack definition in the catalog */
export interface CreditPackDefinition {
  /** @internal */
  _type: "credit_pack";

  /** Credit pack slug (used as unique identifier) */
  slug: string;

  /** Human-readable credit pack name */
  name: string;

  /** Credit pack description */
  description?: string;

  /** Number of credits included in this pack */
  credits: number;

  /** Price in minor currency units (e.g. kobo) */
  price: number;

  /** Currency code */
  currency: Currency;

  /** Credit system this pack is tied to (required) */
  creditSystem: string;

  /** Provider for this pack (overrides default) */
  provider?: string;

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * wallet() - Payment Methods
 */

export interface CardInfo {
  /** Card ID (payment method ID) */
  id: string;

  /** Last 4 digits */
  last4: string;

  /** Card brand (visa, mastercard, verve) */
  brand: string;

  /** Expiry as "MM/YY" */
  exp: string;

  /** Provider that captured this card */
  provider: string;
}

export interface PaymentMethodInfo {
  /** Payment method ID */
  id: string;

  /** Type: card (Paystack/Stripe) or provider_managed (Dodo) */
  type: "card" | "provider_managed";

  /** Provider ID */
  provider: string;

  /** Whether this is the default payment method */
  isDefault: boolean;

  /** Whether the token is still valid for charging */
  isValid: boolean;

  /** Card details (null for provider_managed) */
  card: CardInfo | null;
}

export interface WalletResult {
  /** Whether the customer has a chargeable payment method */
  hasCard: boolean;

  /** Default card details (shortcut for the default method's card) */
  card: CardInfo | null;

  /** All stored payment methods */
  methods: PaymentMethodInfo[];
}

export interface WalletSetupParams {
  /** Customer ID or email */
  customer: string;

  /** Optional: Redirect URL after card setup */
  callbackUrl?: string;

  /** Optional: Override provider */
  provider?: string;
}

export interface WalletSetupResult {
  /** Checkout URL to redirect user for card capture */
  url: string;

  /** Payment reference */
  reference: string;
}

export interface WalletRemoveResult {
  /** Whether the removal succeeded */
  success: boolean;
}

/**
 * plans() - List Plans
 */

export interface PlansParams {
  /** Optional: Filter by plan group */
  group?: string;

  /** Optional: Filter by billing interval */
  interval?: PlanInterval;

  /** Optional: Filter by currency */
  currency?: string;

  /** Optional: Include inactive plans (default: false) */
  includeInactive?: boolean;
}

/** A plan feature as returned by the public API */
export interface PublicPlanFeature {
  /** Feature slug */
  slug: string;

  /** Human-readable feature name */
  name: string;

  /** Feature type */
  type: "metered" | "boolean" | "static";

  /** Whether this feature is enabled in this plan */
  enabled: boolean;

  /** Usage limit (null = unlimited) */
  limit: number | null;

  /** Trial usage limit (null = unlimited) */
  trialLimit?: number | null;

  /** Reset interval */
  resetInterval: string | null;

  /** Unit label (e.g. "call", "message", "GB") */
  unit: string | null;

  /** Overage behavior */
  overage?: "block" | "charge";

  /** Overage price per unit in minor currency units */
  overagePrice?: number | null;

  /** Entitlement model for metered features */
  usageModel?: "included" | "usage_based" | "prepaid";

  /** Package or per-unit price in minor currency units */
  pricePerUnit?: number | null;

  /** Package size for package pricing */
  billingUnits?: number | null;

  /** Rating model used for billable usage */
  ratingModel?: RatingModel;

  /** Tier definitions for graduated or volume pricing */
  tiers?: PricingTier[] | null;
}

/** A plan as returned by the public API — safe for client-side consumption */
export interface PublicPlan {
  /** Plan ID */
  id: string;

  /** URL-safe slug */
  slug: string;

  /** Human-readable name */
  name: string;

  /** Description */
  description: string | null;

  /** Price in minor currency units */
  price: number;

  /** Currency code */
  currency: string;

  /** Billing interval */
  interval: PlanInterval;

  /** "free" or "paid" */
  type: string;

  /** Whether this is a recurring or one-time plan */
  billingType: string;

  /** Whether this is an add-on plan */
  isAddon: boolean;

  /** Plan group (for upgrade/downgrade) */
  planGroup: string | null;

  /** Trial period in days (0 = no trial) */
  trialDays: number;

  /** Whether a card is required to start the trial */
  trialCardRequired: boolean;

  /** Features included in this plan */
  features: PublicPlanFeature[];
}

export interface PlansResult {
  /** Whether the request succeeded */
  success: boolean;

  /** List of plans */
  plans: PublicPlan[];
}

/** Serialized catalog sent to POST /api/sync */
export interface SyncPayload {
  /** Optional: Default provider for all plans */
  defaultProvider?: string;
  features: Array<{
    slug: string;
    type: "metered" | "boolean";
    name: string;
    meterType?: "consumable" | "non_consumable";
  }>;
  creditSystems: Array<{
    slug: string;
    name: string;
    description?: string;
    features: Array<{
      feature: string;
      creditCost: number;
    }>;
  }>;
  creditPacks: Array<{
    slug: string;
    name: string;
    description?: string;
    credits: number;
    price: number;
    currency: Currency;
    creditSystem: string;
    provider?: string;
    metadata?: Record<string, unknown>;
  }>;
  plans: Array<{
    slug: string;
    name: string;
    description?: string;
    price: number;
    currency: Currency;
    interval: PlanInterval;
    billingType?: "recurring" | "one_time";
    planGroup?: string;
    trialDays?: number;
    provider?: string;
    metadata?: Record<string, unknown>;
    autoEnable?: boolean;
    isAddon?: boolean;
    features: Array<{
      slug: string;
      enabled: boolean;
      limit?: number | null;
      trialLimit?: number | null;
      reset?: ResetInterval;
      usageModel?: "included" | "usage_based" | "prepaid";
      pricePerUnit?: number;
      ratingModel?: RatingModel;
      tiers?: PricingTier[];
      overage?: "block" | "charge";
      overagePrice?: number;
      maxOverageUnits?: number;
      billingUnits?: number;
      creditCost?: number;
    }>;
  }>;
}

/** Changes reported for a single resource type */
export interface SyncChanges {
  created: string[];
  updated: string[];
  unchanged: string[];
}

/** Result returned by owo.sync() */
export interface SyncResult {
  success: boolean;
  features: SyncChanges;
  creditSystems: SyncChanges;
  creditPacks: SyncChanges;
  plans: SyncChanges;
  warnings: string[];
}

/**
 * customer() - Create or resolve a customer
 */

export interface CustomerParams {
  /** Customer ID (optional - auto-generated if not provided) */
  id?: string;

  /** Customer email (required) */
  email: string;

  /** Customer display name */
  name?: string;

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

export interface CustomerResult {
  /** Customer ID */
  id: string;

  /** Customer email */
  email: string;

  /** Customer display name */
  name?: string;

  /** Custom metadata */
  metadata?: Record<string, unknown>;

  /** ISO timestamp when created */
  createdAt: string;

  /** ISO timestamp when last updated */
  updatedAt: string;
}

/**
 * addEntity() - Add a feature entity (e.g., seat)
 */

export interface AddEntityParams {
  /** Customer ID or email */
  customer: string;

  /** Feature slug that this entity consumes (e.g., "seats") */
  feature: string;

  /** Entity ID (unique per feature) */
  entity: string;

  /** Display name for the entity */
  name?: string;

  /** Email for the entity */
  email?: string;

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

export interface AddEntityResult {
  /** Whether the entity was created successfully */
  success: boolean;

  /** The entity ID */
  entityId: string;

  /** The feature slug */
  featureId: string;

  /** Current count of entities for this feature */
  count: number;

  /** Limit for this feature (null = unlimited) */
  limit: number | null;

  /** Remaining slots (null = unlimited) */
  remaining: number | null;
}

/**
 * removeEntity() - Remove a feature entity
 */

export interface RemoveEntityParams {
  /** Customer ID or email */
  customer: string;

  /** Feature slug */
  feature: string;

  /** Entity ID to remove */
  entity: string;
}

export interface RemoveEntityResult {
  /** Whether the entity was removed successfully */
  success: boolean;

  /** The entity ID that was removed */
  entityId: string;

  /** Current count of entities for this feature after removal */
  count: number;
}

/**
 * listEntities() - List feature entities
 */

export interface ListEntitiesParams {
  /** Customer ID or email */
  customer: string;

  /** Feature slug (optional - lists all entities if not provided) */
  feature?: string;
}

export interface Entity {
  /** Entity ID */
  id: string;

  /** Feature slug */
  featureId: string;

  /** Display name */
  name?: string;

  /** Email */
  email?: string;

  /** Custom metadata */
  metadata?: Record<string, unknown>;

  /** Entity status */
  status: "active" | "pending_removal";

  /** ISO timestamp when created */
  createdAt: string;
}

export interface ListEntitiesResult {
  /** Whether the request succeeded */
  success: boolean;

  /** List of entities */
  entities: Entity[];

  /** Total count */
  total: number;
}
