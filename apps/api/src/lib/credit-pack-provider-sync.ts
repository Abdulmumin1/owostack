import { eq } from "drizzle-orm";
import { resolveProvider } from "@owostack/adapters";
import type { ProviderAccount, ProviderAdapter } from "@owostack/adapters";
import { schema } from "@owostack/db";
import {
  buildProviderContext,
  deriveProviderEnvironment,
  getProviderRegistry,
  loadProviderAccounts,
  loadProviderRules,
} from "./providers";

export interface CreditPackProviderSyncDependencies {
  resolveProvider: typeof resolveProvider;
  buildProviderContext: typeof buildProviderContext;
  deriveProviderEnvironment: typeof deriveProviderEnvironment;
  getProviderRegistry: typeof getProviderRegistry;
  loadProviderAccounts: typeof loadProviderAccounts;
  loadProviderRules: typeof loadProviderRules;
}

const defaultCreditPackProviderSyncDependencies: CreditPackProviderSyncDependencies =
  {
    resolveProvider,
    buildProviderContext,
    deriveProviderEnvironment,
    getProviderRegistry,
    loadProviderAccounts,
    loadProviderRules,
  };

export const creditPackProviderSyncDependencies: CreditPackProviderSyncDependencies =
  {
    ...defaultCreditPackProviderSyncDependencies,
  };

export function resetCreditPackProviderSyncDependencies() {
  Object.assign(
    creditPackProviderSyncDependencies,
    defaultCreditPackProviderSyncDependencies,
  );
}

export interface ProviderManagedCreditPack {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  providerId?: string | null;
  providerProductId?: string | null;
  providerPriceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreditPackProviderSyncContext {
  db: any;
  organizationId: string;
  environment: string | undefined;
  encryptionKey?: string;
}

export interface CreditPackProviderSyncIssue {
  code:
    | "provider_not_registered"
    | "provider_account_missing"
    | "provider_resolution_failed"
    | "provider_create_failed";
  message: string;
  providerId?: string | null;
}

export interface CreditPackProviderSyncResult {
  action: "skipped" | "created" | "unchanged";
  providerId: string | null;
  providerProductId: string | null;
  providerPriceId: string | null;
  issue?: CreditPackProviderSyncIssue;
}

interface ResolvedCreditPackProvider {
  providerId: string;
  providerEnv: "test" | "live";
  adapter: ProviderAdapter;
  account: ProviderAccount;
}

export async function syncCreditPackProduct(params: {
  context: CreditPackProviderSyncContext;
  pack: ProviderManagedCreditPack;
  preferredProviderId?: string | null;
  forceResync?: boolean;
}): Promise<CreditPackProviderSyncResult> {
  const resolved = await resolveCreditPackProvider({
    context: params.context,
    pack: params.pack,
    preferredProviderId: params.preferredProviderId ?? null,
  });

  if ("issue" in resolved) {
    return {
      action: "skipped",
      providerId: params.preferredProviderId ?? params.pack.providerId ?? null,
      providerProductId: null,
      providerPriceId: null,
      issue: resolved.issue,
    };
  }

  return syncCreditPackProductWithResolvedProvider({
    db: params.context.db,
    pack: params.pack,
    adapter: resolved.adapter,
    account: resolved.account,
    forceResync: params.forceResync ?? false,
  });
}

export async function syncCreditPackProductWithResolvedProvider(params: {
  db: any;
  pack: ProviderManagedCreditPack;
  adapter: ProviderAdapter;
  account: ProviderAccount;
  forceResync?: boolean;
}): Promise<CreditPackProviderSyncResult> {
  const { db, adapter, account } = params;
  const pack = {
    ...params.pack,
    providerId: params.pack.providerId ?? null,
    providerProductId: params.pack.providerProductId ?? null,
    providerPriceId: params.pack.providerPriceId ?? null,
    description: params.pack.description ?? null,
    metadata: params.pack.metadata ?? null,
  };
  const forceResync = params.forceResync ?? false;

  if (!adapter.createProduct) {
    return {
      action: "unchanged",
      providerId: adapter.id,
      providerProductId: null,
      providerPriceId: null,
    };
  }

  if (
    !forceResync &&
    pack.providerId === adapter.id &&
    pack.providerProductId &&
    pack.providerPriceId
  ) {
    return {
      action: "unchanged",
      providerId: adapter.id,
      providerProductId: pack.providerProductId,
      providerPriceId: pack.providerPriceId,
    };
  }

  const fresh = forceResync
    ? null
    : await (db.query as any).creditPacks?.findFirst?.({
        where: eq((schema as any).creditPacks.id, pack.id),
        columns: {
          providerId: true,
          providerProductId: true,
          providerPriceId: true,
        },
      });

  if (
    fresh?.providerId === adapter.id &&
    fresh?.providerProductId &&
    fresh?.providerPriceId
  ) {
    return {
      action: "unchanged",
      providerId: adapter.id,
      providerProductId: fresh.providerProductId,
      providerPriceId: fresh.providerPriceId,
    };
  }

  const createResult = await adapter.createProduct({
    name: pack.name,
    description: pack.description || undefined,
    amount: pack.price,
    currency: pack.currency,
    environment: account.environment as "test" | "live",
    account,
    metadata: { credit_pack_id: pack.id },
  });

  if (createResult.isErr()) {
    return {
      action: "skipped",
      providerId: adapter.id,
      providerProductId: null,
      providerPriceId: null,
      issue: {
        code: "provider_create_failed",
        providerId: adapter.id,
        message: createResult.error.message,
      },
    };
  }

  return {
    action: "created",
    providerId: adapter.id,
    providerProductId: createResult.value.productId,
    providerPriceId: createResult.value.priceId,
  };
}

async function resolveCreditPackProvider(params: {
  context: CreditPackProviderSyncContext;
  pack: ProviderManagedCreditPack;
  preferredProviderId?: string | null;
}): Promise<
  ResolvedCreditPackProvider | { issue: CreditPackProviderSyncIssue }
> {
  const { context, pack, preferredProviderId } = params;
  const registry = creditPackProviderSyncDependencies.getProviderRegistry();
  const providerEnv =
    creditPackProviderSyncDependencies.deriveProviderEnvironment(
      context.environment,
      null,
    );
  const providerAccounts =
    await creditPackProviderSyncDependencies.loadProviderAccounts(
      context.db,
      context.organizationId,
      context.encryptionKey,
    );

  const requestedProviderId = preferredProviderId ?? pack.providerId ?? null;
  if (requestedProviderId) {
    const adapter = registry.get(requestedProviderId);
    if (!adapter) {
      return {
        issue: {
          code: "provider_not_registered",
          providerId: requestedProviderId,
          message: `Provider '${requestedProviderId}' is not registered.`,
        },
      };
    }

    const account = providerAccounts.find(
      (item) =>
        item.providerId === requestedProviderId &&
        item.environment === providerEnv,
    );

    if (!account) {
      return {
        issue: {
          code: "provider_account_missing",
          providerId: requestedProviderId,
          message: `Provider '${requestedProviderId}' is not configured for ${providerEnv}.`,
        },
      };
    }

    return {
      providerId: requestedProviderId,
      providerEnv,
      adapter,
      account,
    };
  }

  const selectionResult = creditPackProviderSyncDependencies.resolveProvider(
    registry,
    {
      organizationId: context.organizationId,
      environment: providerEnv,
      context: creditPackProviderSyncDependencies.buildProviderContext({
        currency: pack.currency,
        metadata: pack.metadata ?? undefined,
      }),
      rules: await creditPackProviderSyncDependencies.loadProviderRules(
        context.db,
        context.organizationId,
      ),
      accounts: providerAccounts,
    },
  );

  if (selectionResult.isOk()) {
    return {
      providerId: selectionResult.value.adapter.id,
      providerEnv,
      adapter: selectionResult.value.adapter,
      account: selectionResult.value.account,
    };
  }

  const defaultAccount = providerAccounts.find(
    (item) => item.environment === providerEnv,
  );
  if (defaultAccount) {
    const adapter = registry.get(defaultAccount.providerId);
    if (!adapter) {
      return {
        issue: {
          code: "provider_not_registered",
          providerId: defaultAccount.providerId,
          message: `Provider '${defaultAccount.providerId}' is not registered.`,
        },
      };
    }

    return {
      providerId: defaultAccount.providerId,
      providerEnv,
      adapter,
      account: defaultAccount,
    };
  }

  return {
    issue: {
      code: "provider_resolution_failed",
      message: "No provider matched the organization's routing rules.",
    },
  };
}
