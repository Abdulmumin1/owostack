import { Result } from "better-result";

export type ProviderId = string;

export type ProviderEnvironment = "test" | "live";

export type ProviderErrorCode =
  | "configuration_missing"
  | "request_failed"
  | "unsupported"
  | "invalid_request"
  | "invalid_payload"
  | "unknown_event";

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  providerId?: string;
  cause?: unknown;
}

export type ProviderResult<T> = Result<T, ProviderError>;

export interface ProviderAccount {
  id: string;
  organizationId: string;
  providerId: ProviderId;
  environment: ProviderEnvironment;
  displayName?: string | null;
  credentials: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderRule {
  id: string;
  organizationId: string;
  priority: number;
  isDefault: boolean;
  providerId: ProviderId;
  conditions: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface AttachRequestContext {
  region?: string;
  currency?: string;
  metadata?: Record<string, unknown>;
  environment?: ProviderEnvironment;
}

export interface CheckoutSession {
  url: string;
  reference: string;
  accessCode?: string | null;
}

export interface ProviderCustomerRef {
  id: string;
  email: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderSubscriptionRef {
  id: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderSubscriptionDetail {
  id: string;
  status: string;
  planCode?: string;
  startDate?: string;
  nextPaymentDate?: string;
  cancelToken?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderPlanRef {
  id: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderProductRef {
  productId: string;
  priceId: string;
  metadata?: Record<string, unknown>;
}

export interface CheckoutLineItem {
  priceId: string;
  quantity: number;
  adjustableQuantity?: { enabled: boolean; minimum?: number; maximum?: number };
}

// =============================================================================
// Normalized Webhook Events
// =============================================================================

export type WebhookEventType =
  | "subscription.created"
  | "subscription.active"
  | "subscription.canceled"
  | "subscription.not_renew"
  | "subscription.past_due"
  | "charge.success"
  | "charge.failed"
  | "refund.success"
  | "refund.failed"
  | "customer.identified";

export interface NormalizedWebhookEvent {
  type: WebhookEventType;
  provider: ProviderId;
  customer: {
    email: string;
    providerCustomerId: string;
  };
  subscription?: {
    providerCode: string;
    providerSubscriptionId?: string;
    status: string;
    planCode?: string;
    startDate?: string;
    nextPaymentDate?: string;
  };
  payment?: {
    amount: number;
    currency: string;
    reference: string;
    paidAt?: string;
  };
  authorization?: {
    code: string;
    reusable: boolean;
    cardType?: string;
    last4?: string;
    expMonth?: string;
    expYear?: string;
  };
  plan?: {
    providerPlanCode: string;
  };
  refund?: {
    amount: number;
    currency: string;
    reference: string;
    reason?: string;
  };
  checkout?: {
    lineItems?: Array<{ priceId?: string; quantity: number }>;
  };
  metadata: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface ProviderAdapter {
  id: ProviderId;
  displayName: string;
  signatureHeaderName?: string;

  /**
   * Whether the provider supports native trial periods on subscriptions.
   * - true  → pass plan + trialDays to checkout; provider defers first charge.
   * - false → checkout is a small auth-capture charge; our workflow handles billing at trial end.
   */
  supportsNativeTrials?: boolean;

  /** Primary/default currency code for this provider (e.g. "NGN" for Paystack, "USD" for Dodo). */
  defaultCurrency?: string;

  createCheckoutSession(params: {
    customer: ProviderCustomerRef;
    plan?: ProviderPlanRef | null;
    amount: number;
    currency: string;
    callbackUrl?: string;
    metadata?: Record<string, unknown>;
    channels?: string[];
    lineItems?: CheckoutLineItem[];
    trialDays?: number;
    onDemand?: { mandateOnly: boolean };
    environment: ProviderEnvironment;
    account: ProviderAccount;
  }): Promise<ProviderResult<CheckoutSession>>;

  // Optional: create a one-time product + price on the provider (for credit packs)
  createProduct?(params: {
    name: string;
    description?: string | null;
    amount: number;
    currency: string;
    environment: ProviderEnvironment;
    account: ProviderAccount;
    metadata?: Record<string, unknown>;
  }): Promise<ProviderResult<ProviderProductRef>>;

  createCustomer(params: {
    email: string;
    name?: string | null;
    metadata?: Record<string, unknown>;
    environment: ProviderEnvironment;
    account: ProviderAccount;
  }): Promise<ProviderResult<ProviderCustomerRef>>;

  createPlan(params: {
    name: string;
    amount: number;
    interval: string;
    currency: string;
    description?: string | null;
    environment: ProviderEnvironment;
    account: ProviderAccount;
  }): Promise<ProviderResult<ProviderPlanRef>>;

  updatePlan?(params: {
    planId: string;
    name?: string;
    amount?: number;
    interval?: string;
    currency?: string;
    description?: string | null;
    environment: ProviderEnvironment;
    account: ProviderAccount;
  }): Promise<ProviderResult<{ updated: boolean }>>;

  createSubscription(params: {
    customer: ProviderCustomerRef;
    plan: ProviderPlanRef;
    authorizationCode?: string | null;
    startDate?: string; // ISO date — delays first charge (e.g. after trial conversion)
    environment: ProviderEnvironment;
    account: ProviderAccount;
    metadata?: Record<string, unknown>;
  }): Promise<ProviderResult<ProviderSubscriptionRef>>;

  cancelSubscription(params: {
    subscription: ProviderSubscriptionRef;
    environment: ProviderEnvironment;
    account: ProviderAccount;
  }): Promise<ProviderResult<{ canceled: boolean }>>;

  chargeAuthorization(params: {
    customer: ProviderCustomerRef;
    authorizationCode: string;
    amount: number;
    currency: string;
    reference?: string;
    metadata?: Record<string, unknown>;
    environment: ProviderEnvironment;
    account: ProviderAccount;
  }): Promise<ProviderResult<{ reference: string }>>;

  // Optional: change an existing subscription to a different plan with provider-managed proration.
  // Providers like Dodo handle proration natively; Paystack doesn't support this.
  changePlan?(params: {
    subscriptionId: string;
    newPlanId: string;
    prorationMode?: "prorated_immediately" | "full_immediately" | "difference_immediately";
    quantity?: number;
    metadata?: Record<string, unknown>;
    environment: ProviderEnvironment;
    account: ProviderAccount;
  }): Promise<ProviderResult<{ changed: boolean }>>;

  refundCharge?(params: {
    reference: string;
    amount?: number;
    currency?: string;
    reason?: string;
    environment: ProviderEnvironment;
    account: ProviderAccount;
  }): Promise<ProviderResult<{ refunded: boolean; reference: string }>>;

  fetchSubscription(params: {
    subscriptionId: string;
    environment: ProviderEnvironment;
    account: ProviderAccount;
  }): Promise<ProviderResult<ProviderSubscriptionDetail>>;

  verifyWebhook(params: {
    signature: string;
    payload: string;
    secret: string;
    headers?: Record<string, string>;
  }): Promise<ProviderResult<boolean>>;

  parseWebhookEvent(params: {
    payload: Record<string, unknown>;
  }): ProviderResult<NormalizedWebhookEvent>;
}

export type ProviderSelector = (context: {
  region?: string;
  currency?: string;
  metadata?: Record<string, unknown>;
  organizationId: string;
}) => ProviderId | null;

export interface ProviderRegistry {
  register: (adapter: ProviderAdapter) => void;
  get: (providerId: ProviderId) => ProviderAdapter | undefined;
  list: () => ProviderAdapter[];
}

export function createProviderRegistry(): ProviderRegistry {
  const adapters = new Map<ProviderId, ProviderAdapter>();

  return {
    register(adapter) {
      adapters.set(adapter.id, adapter);
    },
    get(providerId) {
      return adapters.get(providerId);
    },
    list() {
      return Array.from(adapters.values());
    },
  };
}

export { paystackAdapter } from "./paystack";
export { dodoAdapter } from "./dodo";
export { selectProvider } from "./selector";
export { resolveProvider } from "./provider-factory";

export function matchProviderRule(
  rules: ProviderRule[],
  context: AttachRequestContext,
): ProviderRule | null {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (rule.isDefault) continue;

    const conditions = rule.conditions || {};
    if (matchesConditions(conditions, context)) {
      return rule;
    }
  }

  return sorted.find((rule) => rule.isDefault) || null;
}

function matchesConditions(
  conditions: Record<string, unknown>,
  context: AttachRequestContext,
): boolean {
  const region = conditions.region;
  if (typeof region === "string" && context.region !== region) {
    return false;
  }
  if (Array.isArray(region) && !region.includes(context.region)) {
    return false;
  }

  const currency = conditions.currency;
  if (typeof currency === "string" && context.currency !== currency) {
    return false;
  }
  if (Array.isArray(currency) && !currency.includes(context.currency)) {
    return false;
  }

  const metadata = conditions.metadata;
  if (metadata && typeof metadata === "object") {
    for (const [key, value] of Object.entries(metadata)) {
      if ((context.metadata ?? {})[key] !== value) {
        return false;
      }
    }
  }

  return true;
}
