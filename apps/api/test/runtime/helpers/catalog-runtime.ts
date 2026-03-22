import { Result } from "better-result";
import {
  createProviderRegistry,
  type ProviderAdapter,
  type ProviderEnvironment,
  type ProviderError,
  type ProviderResult,
} from "@owostack/adapters";
import { hashApiKey } from "../../../src/lib/api-keys";
import { TEST_ENCRYPTION_KEY, insertProviderAccount } from "./workflow-runtime";

type CreatePlanParams = Parameters<ProviderAdapter["createPlan"]>[0];
type UpdatePlanParams = NonNullable<ProviderAdapter["updatePlan"]> extends (
  params: infer TParams,
) => unknown
  ? TParams
  : never;
type CreateProductParams = NonNullable<
  ProviderAdapter["createProduct"]
> extends (params: infer TParams) => unknown
  ? TParams
  : never;

export type CatalogProviderOperation =
  | {
      kind: "createPlan";
      providerId: string;
      environment: ProviderEnvironment;
      accountId: string;
      name: string;
      amount: number;
      currency: string;
      interval: string;
      description?: string | null;
    }
  | {
      kind: "updatePlan";
      providerId: string;
      environment: ProviderEnvironment;
      accountId: string;
      planId: string;
      name?: string;
      amount?: number;
      currency?: string;
      interval?: string;
      description?: string | null;
    }
  | {
      kind: "createProduct";
      providerId: string;
      environment: ProviderEnvironment;
      accountId: string;
      name: string;
      amount: number;
      currency: string;
      description?: string | null;
    };

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

export class SimulatedCatalogProviderAdapter implements ProviderAdapter {
  readonly operations: CatalogProviderOperation[] = [];

  constructor(
    readonly id: string,
    readonly displayName: string,
    private readonly options: {
      expectedEnvironment?: ProviderEnvironment;
      createPlanId?: string;
      createProductResult?: { productId: string; priceId: string };
      updatePlanResult?: { updated: boolean; nextPlanId?: string };
      onCreatePlan?: ProviderBehavior<CreatePlanParams, { id: string }>;
      onUpdatePlan?: ProviderBehavior<
        UpdatePlanParams,
        { updated: boolean; nextPlanId?: string }
      >;
      onCreateProduct?: ProviderBehavior<
        CreateProductParams,
        { productId: string; priceId: string }
      >;
    } = {},
  ) {}

  readonly supportsNativeTrials = false;

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

  async createPlan(params: CreatePlanParams) {
    this.operations.push({
      kind: "createPlan",
      providerId: this.id,
      environment: params.environment,
      accountId: params.account.id,
      name: params.name,
      amount: params.amount,
      currency: params.currency,
      interval: params.interval,
      description: params.description,
    });

    const environmentError = this.checkEnvironment(params.environment);
    if (environmentError) return environmentError;

    if (this.options.onCreatePlan) {
      return await this.options.onCreatePlan(params, this.operations.length);
    }

    return Result.ok({
      id: this.options.createPlanId || `${this.id}_plan_${this.operations.length}`,
    });
  }

  async updatePlan(params: UpdatePlanParams) {
    this.operations.push({
      kind: "updatePlan",
      providerId: this.id,
      environment: params.environment,
      accountId: params.account.id,
      planId: params.planId,
      name: params.name,
      amount: params.amount,
      currency: params.currency,
      interval: params.interval,
      description: params.description,
    });

    const environmentError = this.checkEnvironment(params.environment);
    if (environmentError) return environmentError;

    if (this.options.onUpdatePlan) {
      return await this.options.onUpdatePlan(params, this.operations.length);
    }

    return Result.ok(this.options.updatePlanResult || { updated: true });
  }

  async createProduct(params: CreateProductParams) {
    this.operations.push({
      kind: "createProduct",
      providerId: this.id,
      environment: params.environment,
      accountId: params.account.id,
      name: params.name,
      amount: params.amount,
      currency: params.currency,
      description: params.description,
    });

    const environmentError = this.checkEnvironment(params.environment);
    if (environmentError) return environmentError;

    if (this.options.onCreateProduct) {
      return await this.options.onCreateProduct(params, this.operations.length);
    }

    return Result.ok(
      this.options.createProductResult || {
        productId: `${this.id}_product_${this.operations.length}`,
        priceId: `${this.id}_price_${this.operations.length}`,
      },
    );
  }

  async createCheckoutSession(_params: any) {
    return providerError(this.id, "unsupported", "Not used in catalog tests");
  }

  async createCustomer(_params: any) {
    return providerError(this.id, "unsupported", "Not used in catalog tests");
  }

  async createSubscription(_params: any) {
    return providerError(this.id, "unsupported", "Not used in catalog tests");
  }

  async cancelSubscription(_params: any) {
    return providerError(this.id, "unsupported", "Not used in catalog tests");
  }

  async chargeAuthorization(_params: any) {
    return providerError(this.id, "unsupported", "Not used in catalog tests");
  }

  async fetchSubscription(_params: any) {
    return providerError(this.id, "unsupported", "Not used in catalog tests");
  }

  async verifyWebhook(_params: any) {
    return providerError(this.id, "unsupported", "Not used in catalog tests");
  }

  parseWebhookEvent(_params: any) {
    return providerError(this.id, "unsupported", "Not used in catalog tests");
  }
}

export function createSimulatedProviderRegistry(
  adapters: ProviderAdapter[],
) {
  const registry = createProviderRegistry();
  for (const adapter of adapters) {
    registry.register(adapter);
  }
  return registry;
}

export async function insertProviderRule(
  db: D1Database,
  params: {
    id?: string;
    organizationId?: string;
    providerId: string;
    priority?: number;
    isDefault?: number;
    conditions?: Record<string, unknown>;
  },
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO provider_rules
       (id, organization_id, provider_id, priority, is_default, conditions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id || `rule_${params.providerId}`,
      params.organizationId || "org_123",
      params.providerId,
      params.priority ?? 100,
      params.isDefault ?? 1,
      JSON.stringify(params.conditions || {}),
      now,
      now,
    )
    .run();
}

export async function insertCreditSystem(
  db: D1Database,
  params: {
    id?: string;
    organizationId?: string;
    name?: string;
    slug?: string;
    description?: string | null;
  } = {},
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO credit_systems
       (id, organization_id, name, slug, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id || "cs_wallet",
      params.organizationId || "org_123",
      params.name || "Wallet",
      params.slug || "wallet",
      params.description ?? null,
      now,
      now,
    )
    .run();
}

export async function insertCreditPack(
  db: D1Database,
  params: {
    id?: string;
    organizationId?: string;
    name?: string;
    slug?: string;
    description?: string | null;
    credits?: number;
    price?: number;
    currency?: string;
    creditSystemId?: string | null;
    isActive?: number;
    providerId?: string | null;
    providerProductId?: string | null;
    providerPriceId?: string | null;
    metadata?: Record<string, unknown> | null;
  } = {},
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO credit_packs
       (id, organization_id, name, slug, description, credits, price, currency, credit_system_id, is_active, provider_product_id, provider_price_id, provider_id, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id || "pack_1",
      params.organizationId || "org_123",
      params.name || "Starter Pack",
      params.slug || "starter-pack",
      params.description ?? null,
      params.credits ?? 100,
      params.price ?? 500,
      params.currency || "USD",
      params.creditSystemId ?? "cs_wallet",
      params.isActive ?? 1,
      params.providerProductId ?? null,
      params.providerPriceId ?? null,
      params.providerId ?? null,
      JSON.stringify(params.metadata || null),
      now,
      now,
    )
    .run();
}

export async function insertApiKey(
  db: D1Database,
  params: {
    id?: string;
    organizationId?: string;
    name?: string;
    apiKey?: string;
  } = {},
) {
  const apiKey = params.apiKey || "owo_sk_test";
  const hash = await hashApiKey(apiKey);
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO api_keys
       (id, organization_id, name, prefix, hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id || "key_123",
      params.organizationId || "org_123",
      params.name || "Test Key",
      apiKey.slice(0, 10),
      hash,
      now,
    )
    .run();

  return apiKey;
}

export async function insertRuntimeProviderAccount(
  db: D1Database,
  params: {
    id?: string;
    organizationId?: string;
    providerId: string;
    environment?: ProviderEnvironment;
    secretKey?: string;
  },
) {
  await insertProviderAccount({
    db,
    id: params.id,
    organizationId: params.organizationId || "org_123",
    providerId: params.providerId,
    environment: params.environment || "test",
    secretKey: params.secretKey || `${params.providerId}_secret`,
  });
}

export const RUNTIME_ROUTE_ENV = {
  ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  ENVIRONMENT: "test",
};
