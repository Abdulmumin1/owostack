import { Result } from "better-result";
import { WorkflowEvent } from "cloudflare:workers";
import type {
  ProviderAdapter,
  ProviderEnvironment,
  ProviderError,
  ProviderResult,
  ProviderSubscriptionDetail,
  ProviderSubscriptionRef,
} from "@owostack/adapters";
import { encrypt } from "../../../src/lib/encryption";
import type { WorkflowEnv } from "../../../src/lib/workflows/utils";

export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

export type ProviderOperation =
  | {
      kind: "chargeAuthorization";
      environment: ProviderEnvironment;
      customerId: string;
      email: string;
      authorizationCode: string;
      amount: number;
      currency: string;
      reference?: string;
    }
  | {
      kind: "createSubscription";
      environment: ProviderEnvironment;
      customerId: string;
      email: string;
      authorizationCode: string | null;
      planId: string;
      startDate?: string;
    }
  | {
      kind: "fetchSubscription";
      environment: ProviderEnvironment;
      subscriptionId: string;
    };

type ChargeAuthorizationParams = Parameters<
  ProviderAdapter["chargeAuthorization"]
>[0];
type CreateSubscriptionParams = Parameters<
  ProviderAdapter["createSubscription"]
>[0];
type FetchSubscriptionParams = Parameters<ProviderAdapter["fetchSubscription"]>[0];

type ProviderBehavior<TParams, TValue> = (
  params: TParams,
  operationCount: number,
) => Promise<ProviderResult<TValue>> | ProviderResult<TValue>;

function providerError(
  providerId: string,
  code: ProviderError["code"],
  message: string,
): ProviderResult<never> {
  return Result.err({
    code,
    message,
    providerId,
  });
}

export class SimulatedProviderAdapter implements ProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly supportsNativeTrials = false;
  readonly operations: ProviderOperation[] = [];

  constructor(
    private readonly options: {
      id?: string;
      displayName?: string;
      expectedEnvironment?: ProviderEnvironment;
      onChargeAuthorization?: ProviderBehavior<
        ChargeAuthorizationParams,
        { reference: string }
      >;
      onCreateSubscription?: ProviderBehavior<
        CreateSubscriptionParams,
        ProviderSubscriptionRef
      >;
      onFetchSubscription?: ProviderBehavior<
        FetchSubscriptionParams,
        ProviderSubscriptionDetail
      >;
    } = {},
  ) {
    this.id = options.id || "paystack";
    this.displayName = options.displayName || "Simulated Paystack";
  }

  private checkEnvironment(environment: ProviderEnvironment) {
    if (
      this.options.expectedEnvironment &&
      environment !== this.options.expectedEnvironment
    ) {
      return providerError(
        this.id,
        "invalid_request",
        `expected ${this.options.expectedEnvironment}, received ${environment}`,
      );
    }

    return null;
  }

  async createCheckoutSession(_params: any) {
    return providerError(this.id, "unsupported", "Not used in runtime tests");
  }

  async createCustomer(_params: any) {
    return providerError(this.id, "unsupported", "Not used in runtime tests");
  }

  async createPlan(_params: any) {
    return providerError(this.id, "unsupported", "Not used in runtime tests");
  }

  async createSubscription(params: CreateSubscriptionParams) {
    this.operations.push({
      kind: "createSubscription",
      environment: params.environment,
      customerId: params.customer.id,
      email: params.customer.email,
      authorizationCode: params.authorizationCode || null,
      planId: params.plan.id,
      startDate: params.startDate,
    });

    const environmentError = this.checkEnvironment(params.environment);
    if (environmentError) return environmentError;

    if (this.options.onCreateSubscription) {
      return await this.options.onCreateSubscription(
        params,
        this.operations.length,
      );
    }

    return Result.ok({
      id: `sub_remote_${this.operations.length}`,
      status: "active",
      metadata: {},
    });
  }

  async cancelSubscription(_params: any) {
    return providerError(this.id, "unsupported", "Not used in runtime tests");
  }

  async chargeAuthorization(params: ChargeAuthorizationParams) {
    this.operations.push({
      kind: "chargeAuthorization",
      environment: params.environment,
      customerId: params.customer.id,
      email: params.customer.email,
      authorizationCode: params.authorizationCode,
      amount: params.amount,
      currency: params.currency,
      reference: params.reference,
    });

    const environmentError = this.checkEnvironment(params.environment);
    if (environmentError) return environmentError;

    if (this.options.onChargeAuthorization) {
      return await this.options.onChargeAuthorization(
        params,
        this.operations.length,
      );
    }

    return Result.ok({
      reference: params.reference || `charge_${this.operations.length}`,
    });
  }

  async fetchSubscription(_params: any) {
    const params = _params as FetchSubscriptionParams;
    this.operations.push({
      kind: "fetchSubscription",
      environment: params.environment,
      subscriptionId: params.subscriptionId,
    });

    const environmentError = this.checkEnvironment(params.environment);
    if (environmentError) return environmentError;

    if (this.options.onFetchSubscription) {
      return await this.options.onFetchSubscription(
        params,
        this.operations.length,
      );
    }

    return Result.ok({
      id: params.subscriptionId,
      status: "active",
      nextPaymentDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      startDate: new Date(Date.now()).toISOString(),
      metadata: {},
    });
  }

  async verifyWebhook(_params: any) {
    return providerError(this.id, "unsupported", "Not used in runtime tests");
  }

  parseWebhookEvent(_params: any) {
    return providerError(this.id, "unsupported", "Not used in runtime tests");
  }
}

export class ImmediateWorkflowStep {
  readonly sleeps: Array<{ name: string; ms: number }> = [];

  async do<T>(...args: unknown[]): Promise<T> {
    const callback =
      typeof args[1] === "function"
        ? args[1]
        : typeof args[2] === "function"
          ? args[2]
          : null;

    if (!callback) {
      throw new Error("Workflow step callback missing");
    }

    return await (callback as () => Promise<T>)();
  }

  async sleep(name: string, ms: number): Promise<void> {
    this.sleeps.push({ name, ms });
  }
}

type WorkflowClass<TPayload> = new (env: WorkflowEnv) => {
  run(
    event: WorkflowEvent<TPayload>,
    step: ImmediateWorkflowStep,
  ): Promise<unknown>;
};

export function buildWorkflowEnv(
  db: D1Database,
  overrides: Partial<WorkflowEnv> = {},
): WorkflowEnv {
  return {
    DB: db,
    DB_AUTH: db,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    ENVIRONMENT: "production",
    ...overrides,
  };
}

export async function runWorkflow<TPayload>(
  WorkflowEntrypointClass: WorkflowClass<TPayload>,
  env: WorkflowEnv,
  payload: TPayload,
  step: ImmediateWorkflowStep = new ImmediateWorkflowStep(),
) {
  const workflow = new WorkflowEntrypointClass(env);
  await workflow.run(new WorkflowEvent(payload), step);
  return step;
}

export async function insertOrganization(
  db: D1Database,
  params: {
    id?: string;
    name?: string;
    slug?: string;
  } = {},
) {
  const id = params.id || "org_1";
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(id, params.name || "Test Org", params.slug || id, now)
    .run();

  return id;
}

export async function insertProviderAccount(params: {
  db: D1Database;
  id?: string;
  organizationId?: string;
  providerId?: string;
  environment?: ProviderEnvironment;
  displayName?: string;
  secretKey?: string;
}) {
  const now = Date.now();
  const providerId = params.providerId || "paystack";
  const environment = params.environment || "test";
  const encryptedSecret = await encrypt(
    params.secretKey || "sk_runtime_live",
    TEST_ENCRYPTION_KEY,
  );

  await params.db
    .prepare(
      `INSERT INTO provider_accounts
       (id, organization_id, provider_id, environment, display_name, credentials, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id || `acct_${providerId}_${environment}`,
      params.organizationId || "org_1",
      providerId,
      environment,
      params.displayName || "Primary Account",
      JSON.stringify({ secretKey: encryptedSecret }),
      JSON.stringify({ seeded_for: "workflow_runtime_tests" }),
      now,
      now,
    )
    .run();
}

export async function insertCustomer(
  db: D1Database,
  params: {
    id?: string;
    organizationId?: string;
    providerId?: string | null;
    providerCustomerId?: string | null;
    providerAuthorizationCode?: string | null;
    paystackCustomerId?: string | null;
    paystackAuthorizationCode?: string | null;
    email?: string;
    name?: string;
  } = {},
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO customers
       (id, organization_id, provider_id, provider_customer_id, provider_authorization_code, paystack_customer_id, paystack_authorization_code, email, name, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id || "cust_1",
      params.organizationId || "org_1",
      params.providerId || "paystack",
      params.providerCustomerId ?? "cus_remote_1",
      params.providerAuthorizationCode ?? "AUTH_123",
      params.paystackCustomerId ?? "cus_remote_1",
      params.paystackAuthorizationCode ?? "AUTH_123",
      params.email || "customer@example.com",
      params.name || "Customer One",
      JSON.stringify({ seeded_for: "workflow_runtime_tests" }),
      now,
      now,
    )
    .run();
}

export async function insertPlan(
  db: D1Database,
  params: {
    id?: string;
    organizationId?: string;
    providerId?: string;
    providerPlanId?: string | null;
    providerMetadata?: Record<string, unknown> | null;
    paystackPlanId?: string | null;
    name?: string;
    slug?: string;
    description?: string | null;
    price?: number;
    currency?: string;
    interval?: string;
    type?: string;
    billingModel?: string;
    billingType?: string;
    autoEnable?: number;
    isAddon?: number;
    planGroup?: string | null;
    trialDays?: number;
    trialCardRequired?: number;
    isActive?: number;
    version?: number;
    source?: string;
    metadata?: Record<string, unknown> | null;
  } = {},
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO plans
       (id, organization_id, provider_id, provider_plan_id, provider_metadata, paystack_plan_id, name, slug, description, price, currency, interval, type, billing_model, billing_type, auto_enable, is_addon, plan_group, trial_days, trial_card_required, is_active, version, source, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id || "plan_1",
      params.organizationId || "org_1",
      params.providerId === undefined ? "paystack" : params.providerId,
      params.providerPlanId ?? "plan_remote_1",
      params.providerMetadata
        ? JSON.stringify(params.providerMetadata)
        : null,
      params.paystackPlanId ?? "plan_remote_1",
      params.name || "Growth",
      params.slug || "growth",
      params.description ?? null,
      params.price ?? 3000,
      params.currency || "NGN",
      params.interval || "monthly",
      params.type || "paid",
      params.billingModel || "base",
      params.billingType || "recurring",
      params.autoEnable ?? 0,
      params.isAddon ?? 0,
      params.planGroup ?? null,
      params.trialDays ?? 0,
      params.trialCardRequired ?? 0,
      params.isActive ?? 1,
      params.version ?? 1,
      params.source || "dashboard",
      params.metadata ? JSON.stringify(params.metadata) : null,
      now,
      now,
    )
    .run();
}

export async function insertPaymentMethod(
  db: D1Database,
  params: {
    id?: string;
    customerId?: string;
    organizationId?: string;
    providerId?: string;
    token?: string;
    type?: string;
    isDefault?: number;
    isValid?: number;
  } = {},
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO payment_methods
       (id, customer_id, organization_id, provider_id, token, type, is_default, is_valid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id || "pm_1",
      params.customerId || "cust_1",
      params.organizationId || "org_1",
      params.providerId || "paystack",
      params.token || "AUTH_123",
      params.type || "card",
      params.isDefault ?? 1,
      params.isValid ?? 1,
      now,
      now,
    )
    .run();
}

export async function insertSubscription(
  db: D1Database,
  params: {
    id?: string;
    customerId?: string;
    planId?: string;
    providerId?: string | null;
    providerSubscriptionId?: string | null;
    providerSubscriptionCode?: string | null;
    paystackSubscriptionId?: string | null;
    paystackSubscriptionCode?: string | null;
    status?: string;
    currentPeriodStart?: number;
    currentPeriodEnd?: number;
    cancelAt?: number | null;
    metadata?: Record<string, unknown> | string | null;
  } = {},
) {
  const now = Date.now();
  const currentPeriodStart = params.currentPeriodStart ?? now;
  const currentPeriodEnd =
    params.currentPeriodEnd ?? currentPeriodStart + 30 * 24 * 60 * 60 * 1000;
  const metadata =
    typeof params.metadata === "string"
      ? params.metadata
      : JSON.stringify(params.metadata || {});

  await db
    .prepare(
      `INSERT INTO subscriptions
       (id, customer_id, plan_id, provider_id, provider_subscription_id, provider_subscription_code, paystack_subscription_id, paystack_subscription_code, status, current_period_start, current_period_end, cancel_at, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id || "sub_1",
      params.customerId || "cust_1",
      params.planId || "plan_1",
      params.providerId ?? "paystack",
      params.providerSubscriptionId ?? null,
      params.providerSubscriptionCode ?? null,
      params.paystackSubscriptionId ?? null,
      params.paystackSubscriptionCode ?? null,
      params.status || "active",
      currentPeriodStart,
      currentPeriodEnd,
      params.cancelAt ?? null,
      metadata,
      now,
      now,
    )
    .run();
}

export async function seedWorkflowBase(
  db: D1Database,
  params: {
    organizationId?: string;
    providerAccount?: Omit<Parameters<typeof insertProviderAccount>[0], "db">;
    customer?: Parameters<typeof insertCustomer>[1];
    plan?: Parameters<typeof insertPlan>[1];
    paymentMethods?: Array<Parameters<typeof insertPaymentMethod>[1]>;
  } = {},
) {
  const organizationId = params.organizationId || "org_1";
  const customerId = params.customer?.id || "cust_1";

  await insertOrganization(db, { id: organizationId });
  await insertProviderAccount({
    db,
    organizationId,
    ...(params.providerAccount || {}),
  });
  await insertCustomer(db, {
    organizationId,
    ...(params.customer || {}),
  });
  await insertPlan(db, {
    organizationId,
    ...(params.plan || {}),
  });

  for (const paymentMethod of params.paymentMethods || []) {
    await insertPaymentMethod(db, {
      customerId,
      organizationId,
      ...paymentMethod,
    });
  }
}
