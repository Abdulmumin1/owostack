import type {
  AttachParams,
  AttachResult,
  CheckParams,
  CheckResult,
  TrackParams,
  TrackResult,
  AddonParams,
  AddonResult,
  BillingUsageParams,
  BillingUsageResult,
  InvoiceParams,
  InvoiceResult,
  InvoicesParams,
  InvoicesResult,
  PayInvoiceParams,
  PayInvoiceResult,
  OwostackConfig,
  SyncResult,
  WalletResult,
  WalletSetupResult,
  WalletRemoveResult,
  PlansParams,
  PlansResult,
  PublicPlan,
  CustomerParams,
  CustomerResult,
  AddEntityParams,
  AddEntityResult,
  RemoveEntityParams,
  RemoveEntityResult,
  ListEntitiesParams,
  ListEntitiesResult,
} from "@owostack/types";

import { bindFeatureHandles, buildSyncPayload } from "./catalog.js";

/**
 * Owostack - Billing infrastructure for modern SaaS
 *
 * Three methods to rule them all:
 * - attach(): Start checkout or manage subscriptions
 * - check(): Verify feature access and usage limits
 * - track(): Record usage and trigger billing
 *
 * Customers are auto-created when you pass customerData to any endpoint.
 */
export class Owostack {
  /** @internal — exposed for CLI tooling */
  readonly _config: OwostackConfig;
  private apiUrl: string;

  /** Billing: unbilled usage, invoices, and invoice generation */
  readonly billing: BillingNamespace;

  /** Wallet: payment methods — callable + namespace */
  readonly wallet: WalletFn;

  constructor(config: OwostackConfig) {
    this._config = config;
    this.apiUrl = this.resolveApiUrl(config);
    this.billing = new BillingNamespace(this);
    this.wallet = buildWalletFn(this);
    this.plans = buildPlansFn(this);

    // Bind all registered feature handles to this client
    if (config.catalog && config.catalog.length > 0) {
      bindFeatureHandles(this, config.catalog);
    }
  }

  private resolveApiUrl(config: OwostackConfig): string {
    // Explicit apiUrl takes highest precedence
    if (config.apiUrl) {
      return config.apiUrl;
    }

    // Mode-based URLs
    if (config.mode === "sandbox") {
      return "https://sandbox.owostack.com";
    }

    if (config.mode === "live") {
      return "https://api.owostack.com";
    }

    // Default fallback
    return "https://api.owostack.com";
  }

  /**
   * Override the API key at runtime (used by CLI).
   * @internal
   */
  setSecretKey(key: string) {
    this._config.secretKey = key;
  }

  /**
   * Override the API URL at runtime (used by CLI).
   * @internal
   */
  setApiUrl(url: string) {
    this._config.apiUrl = url;
    this.apiUrl = url;
  }

  /**
   * sync() - Push catalog to the API
   *
   * Reconciles features and plans defined in the catalog with the server.
   * Idempotent — safe to call multiple times with the same config.
   * Only creates/updates; never deletes.
   *
   * @example
   * ```ts
   * const result = await owo.sync();
   * console.log(`Created ${result.features.created.length} features`);
   * ```
   */
  async sync(): Promise<SyncResult> {
    if (!this._config.catalog || this._config.catalog.length === 0) {
      return {
        success: true,
        features: { created: [], updated: [], unchanged: [] },
        creditSystems: { created: [], updated: [], unchanged: [] },
        plans: { created: [], updated: [], unchanged: [] },
        warnings: ["No catalog entries to sync."],
      };
    }

    const payload = buildSyncPayload(
      this._config.catalog,
      this._config.provider,
    );
    const response = await this.post("/sync", payload);
    return response as SyncResult;
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
    const response = await this.post("/attach", params);
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
    const response = await this.post("/check", params);
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
    const response = await this.post("/track", params);
    return response as TrackResult;
  }

  /**
   * addon() - Purchase Add-on Credit Pack
   *
   * Buy additional credits scoped to a credit system.
   * If the customer has a card on file, charges immediately.
   * Otherwise returns a checkout URL.
   *
   * @example
   * ```ts
   * const result = await owo.addon({
   *   customer: 'user_123',
   *   pack: '250-credits',
   *   quantity: 2,
   * });
   *
   * if (result.requiresCheckout) {
   *   window.location.href = result.checkoutUrl!;
   * } else {
   *   console.log(`Balance: ${result.balance} credits`);
   * }
   * ```
   */
  async addon(params: AddonParams): Promise<AddonResult> {
    const response = await this.post("/addon", params);
    return response as AddonResult;
  }

  /**
   * customer() - Create or resolve a customer
   *
   * Creates a new customer or resolves an existing one by email or ID.
   * If customerData is provided and customer doesn't exist, creates a new customer.
   *
   * @example
   * ```ts
   * // Create new customer
   * const customer = await owo.customer({
   *   email: 'org@acme.com',
   *   name: 'Acme Corp',
   *   metadata: { plan: 'enterprise' }
   * });
   *
   * // Get existing customer
   * const existing = await owo.customer({ email: 'org@acme.com' });
   * ```
   */
  async customer(params: CustomerParams): Promise<CustomerResult> {
    const response = await this.post("/customers", params);
    return response as CustomerResult;
  }

  /**
   * addEntity() - Add a feature entity (e.g., seat)
   *
   * Creates a new entity scoped to a feature. Validates against the feature limit.
   * Throws if the limit would be exceeded.
   *
   * @example
   * ```ts
   * await owo.addEntity({
   *   customer: 'org@acme.com',
   *   feature: 'seats',
   *   entity: 'user_123',
   *   name: 'John Doe',
   *   metadata: { role: 'admin' }
   * });
   * ```
   */
  async addEntity(params: AddEntityParams): Promise<AddEntityResult> {
    const response = await this.post("/entities", params);
    return response as AddEntityResult;
  }

  /**
   * removeEntity() - Remove a feature entity
   *
   * Removes an entity and frees up the slot for the feature limit.
   *
   * @example
   * ```ts
   * await owo.removeEntity({
   *   customer: 'org@acme.com',
   *   feature: 'seats',
   *   entity: 'user_123'
   * });
   * ```
   */
  async removeEntity(params: RemoveEntityParams): Promise<RemoveEntityResult> {
    const response = await this.post("/entities/remove", params);
    return response as RemoveEntityResult;
  }

  /**
   * listEntities() - List feature entities
   *
   * Returns all entities for a customer, optionally filtered by feature.
   *
   * @example
   * ```ts
   * // List all entities
   * const { entities } = await owo.listEntities({ customer: 'org@acme.com' });
   *
   * // List seats only
   * const { entities: seats } = await owo.listEntities({
   *   customer: 'org@acme.com',
   *   feature: 'seats'
   * });
   * ```
   */
  async listEntities(params: ListEntitiesParams): Promise<ListEntitiesResult> {
    const query: Record<string, string> = { customer: params.customer };
    if (params.feature) query.feature = params.feature;
    const response = await this.get("/entities", query);
    return response as ListEntitiesResult;
  }

  /**
   * plans() - List Plans
   *
   * Returns all active plans for the organization. Useful for building
   * pricing pages and plan selection UIs.
   *
   * @example
   * ```ts
   * const { plans } = await owo.plans();
   * plans.forEach(p => console.log(p.name, p.price));
   *
   * // Filter by group
   * const { plans: support } = await owo.plans({ group: 'support' });
   *
   * // Get a single plan by slug
   * const plan = await owo.plans.get('pro');
   * ```
   */
  readonly plans: PlansFn;

  /**
   * Internal POST request handler
   * @internal
   */
  async post(endpoint: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.apiUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this._config.secretKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const resp = await response.json();
      const errorData = resp.error || resp;
      throw new OwostackError(
        errorData.code || "unknown_error",
        errorData.message || errorData.error || "Request failed",
      );
    }

    return response.json();
  }

  /**
   * Internal GET request handler
   * @internal
   */
  async get(
    endpoint: string,
    query?: Record<string, string>,
  ): Promise<unknown> {
    const url = new URL(`${this.apiUrl}${endpoint}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== "")
          url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this._config.secretKey}`,
      },
    });

    if (!response.ok) {
      const resp = await response.json();
      const errorData = resp.error || resp;
      throw new OwostackError(
        errorData.code || "unknown_error",
        errorData.message || errorData.error || "Request failed",
      );
    }

    return response.json();
  }
}

// ---------------------------------------------------------------------------
// Plans — callable + .get(slug)
//
// owo.plans()                  → PlansResult
// owo.plans({ group: '...' })  → PlansResult (filtered)
// owo.plans.get('pro')         → PublicPlan
// ---------------------------------------------------------------------------

type PlansFn = {
  (params?: PlansParams): Promise<PlansResult>;
  get(slug: string): Promise<PublicPlan>;
};

function buildPlansFn(client: Owostack): PlansFn {
  const fn = ((params?: PlansParams) => {
    const query: Record<string, string> = {};
    if (params?.group) query.group = params.group;
    if (params?.interval) query.interval = params.interval;
    if (params?.currency) query.currency = params.currency;
    if (params?.includeInactive) query.includeInactive = "true";
    return client.get("/plans", query) as Promise<PlansResult>;
  }) as PlansFn;

  fn.get = async (slug: string) => {
    const response = await client.get(`/plans/${encodeURIComponent(slug)}`);
    return (response as any).plan as PublicPlan;
  };

  return fn;
}

// ---------------------------------------------------------------------------
// Wallet — callable + namespace
//
// owo.wallet("user@email.com")           → WalletResult
// owo.wallet.setup("user@email.com", {}) → WalletSetupResult
// owo.wallet.list("user@email.com")      → { methods: PaymentMethodInfo[] }
// owo.wallet.remove("user@email.com", id)→ WalletRemoveResult
// ---------------------------------------------------------------------------

type WalletFn = {
  (customer: string): Promise<WalletResult>;
  setup(
    customer: string,
    opts?: { callbackUrl?: string; provider?: string },
  ): Promise<WalletSetupResult>;
  list(customer: string): Promise<WalletResult>;
  remove(customer: string, id: string): Promise<WalletRemoveResult>;
};

function buildWalletFn(client: Owostack): WalletFn {
  const fn = ((customer: string) =>
    client.get("/wallet", { customer })) as WalletFn;

  fn.setup = (
    customer: string,
    opts?: { callbackUrl?: string; provider?: string },
  ) =>
    client.post("/wallet/setup", {
      customer,
      ...opts,
    }) as Promise<WalletSetupResult>;

  fn.list = (customer: string) =>
    client.get("/wallet", { customer }) as Promise<WalletResult>;

  fn.remove = (customer: string, id: string) =>
    client.post("/wallet/remove", {
      customer,
      id,
    }) as Promise<WalletRemoveResult>;

  return fn;
}

/**
 * Billing namespace — unbilled usage, invoice generation, invoice history
 */
class BillingNamespace {
  constructor(private client: Owostack) {}

  /**
   * usage() - Get Unbilled Overage Usage
   *
   * Returns a breakdown of all billable usage that hasn't been invoiced yet.
   *
   * @example
   * ```ts
   * const usage = await owo.billing.usage({ customer: 'user_123' });
   * console.log(`Owes: ${usage.currency} ${usage.totalEstimated / 100}`);
   * ```
   */
  async usage(params: BillingUsageParams): Promise<BillingUsageResult> {
    const response = await this.client.get("/billing/usage", {
      customer: params.customer,
    });
    return response as BillingUsageResult;
  }

  /**
   * invoice() - Generate an Invoice
   *
   * Creates an invoice for the customer's unbilled overage usage.
   * Fails if there's no unbilled usage to invoice.
   *
   * @example
   * ```ts
   * const result = await owo.billing.invoice({ customer: 'user_123' });
   * console.log(`Invoice ${result.invoice.number}: ${result.invoice.total}`);
   * ```
   */
  async invoice(params: InvoiceParams): Promise<InvoiceResult> {
    const response = await this.client.post("/billing/invoice", params);
    return response as InvoiceResult;
  }

  /**
   * invoices() - List Past Invoices
   *
   * Returns all invoices for a customer.
   *
   * @example
   * ```ts
   * const result = await owo.billing.invoices({ customer: 'user_123' });
   * result.invoices.forEach(inv => console.log(inv.number, inv.status));
   * ```
   */
  async invoices(params: InvoicesParams): Promise<InvoicesResult> {
    const response = await this.client.get("/billing/invoices", {
      customer: params.customer,
    });
    return response as InvoicesResult;
  }

  /**
   * pay() - Pay an Invoice
   *
   * Attempts to auto-charge the customer's saved payment method.
   * If no card on file or charge fails, returns a checkout URL instead.
   *
   * @example
   * ```ts
   * const result = await owo.billing.pay({ invoiceId: 'inv_xxx' });
   * if (!result.paid) {
   *   // Redirect customer to checkout
   *   window.location.href = result.checkoutUrl!;
   * }
   * ```
   */
  async pay(params: PayInvoiceParams): Promise<PayInvoiceResult> {
    const response = await this.client.post(
      `/billing/invoice/${encodeURIComponent(params.invoiceId)}/pay`,
      { callbackUrl: params.callbackUrl },
    );
    return response as PayInvoiceResult;
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

// Re-export catalog builder functions
export {
  metered,
  boolean,
  entity,
  creditSystem,
  plan,
  buildSyncPayload,
} from "./catalog.js";
export { MeteredHandle, BooleanHandle, EntityHandle, CreditSystemHandle } from "./catalog.js";

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
  AddonParams,
  AddonResult,
  BillingUsageParams,
  BillingUsageResult,
  BillingFeatureUsage,
  InvoiceParams,
  InvoiceResult,
  InvoicesParams,
  InvoicesResult,
  Invoice,
  InvoiceLineItem,
  PayInvoiceParams,
  PayInvoiceResult,
  OwostackConfig,
  CustomerData,
  ResponseDetails,
  OverageDetails,
  PlanCredits,
  CatalogEntry,
  PlanDefinition,
  PlanFeatureEntry,
  MeteredFeatureConfig,
  BooleanFeatureConfig,
  SyncPayload,
  SyncResult,
  SyncChanges,
  CardInfo,
  PaymentMethodInfo,
  WalletResult,
  WalletSetupResult,
  WalletRemoveResult,
  PlansParams,
  PlansResult,
  PublicPlan,
  PublicPlanFeature,
  CustomerParams,
  CustomerResult,
  AddEntityParams,
  AddEntityResult,
  RemoveEntityParams,
  RemoveEntityResult,
  ListEntitiesParams,
  ListEntitiesResult,
} from "@owostack/types";
