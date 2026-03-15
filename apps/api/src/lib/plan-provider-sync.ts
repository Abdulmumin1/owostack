import { resolveProvider } from "@owostack/adapters";
import type { ProviderAccount, ProviderAdapter } from "@owostack/adapters";
import {
  getProviderRegistry,
  buildProviderContext,
  deriveProviderEnvironment,
  loadProviderAccounts,
  loadProviderRules,
} from "./providers";
import { getMinimumChargeAmount } from "./provider-minimums";

export interface ProviderManagedPlan {
  slug: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  interval: string;
  type: string;
  billingType: string;
  providerId?: string | null;
  providerPlanId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PlanProviderSyncContext {
  db: any;
  organizationId: string;
  environment: string | undefined;
  encryptionKey?: string;
}

export interface ProviderPlanSyncIssue {
  code:
    | "provider_not_registered"
    | "provider_account_missing"
    | "provider_resolution_failed"
    | "minimum_charge"
    | "provider_create_failed"
    | "provider_update_failed";
  message: string;
  providerId?: string | null;
}

export interface ProviderPlanSyncResult {
  action: "skipped" | "created" | "updated" | "unchanged";
  providerId: string | null;
  providerPlanId: string | null;
  paystackPlanId: string | null;
  issue?: ProviderPlanSyncIssue;
}

interface ResolvedProviderTarget {
  providerId: string;
  providerEnv: "test" | "live";
  adapter: ProviderAdapter;
  account: ProviderAccount;
}

export function isProviderManagedPlan(plan: Pick<ProviderManagedPlan, "type" | "billingType">) {
  return plan.type === "paid" && plan.billingType === "recurring";
}

export async function syncProviderPlan(params: {
  context: PlanProviderSyncContext;
  plan: ProviderManagedPlan;
  preferredProviderId?: string | null;
  allowUpdate?: boolean;
}): Promise<ProviderPlanSyncResult> {
  const { context, allowUpdate = false } = params;
  const plan = {
    ...params.plan,
    providerId: params.plan.providerId ?? null,
    providerPlanId: params.plan.providerPlanId ?? null,
    description: params.plan.description ?? null,
    metadata: params.plan.metadata ?? null,
  };

  if (!isProviderManagedPlan(plan)) {
    return {
      action: "skipped",
      providerId: plan.providerId,
      providerPlanId: plan.providerPlanId,
      paystackPlanId: plan.providerId === "paystack" ? plan.providerPlanId : null,
    };
  }

  const target = await resolveProviderTarget({
    context,
    plan,
    preferredProviderId: params.preferredProviderId ?? null,
  });

  if ("issue" in target) {
    return {
      action: "skipped",
      providerId: plan.providerId,
      providerPlanId: plan.providerPlanId,
      paystackPlanId: plan.providerId === "paystack" ? plan.providerPlanId : null,
      issue: target.issue,
    };
  }

  const minimumAmount = getMinimumChargeAmount(target.providerId, plan.currency);
  if (minimumAmount > 0 && plan.price < minimumAmount) {
    const minDisplay = minimumAmount / 100;
    return {
      action: "skipped",
      providerId: target.providerId,
      providerPlanId: plan.providerPlanId,
      paystackPlanId:
        target.providerId === "paystack" ? plan.providerPlanId : null,
      issue: {
        code: "minimum_charge",
        providerId: target.providerId,
        message: `Plan '${plan.slug}' price ${plan.price / 100} ${plan.currency} is below the minimum charge amount of ${minDisplay} ${plan.currency} for ${target.providerId}.`,
      },
    };
  }

  const shouldCreateProviderPlan =
    !plan.providerPlanId || plan.providerId !== target.providerId;

  if (shouldCreateProviderPlan) {
    const createResult = await target.adapter.createPlan({
      name: plan.name,
      amount: plan.price,
      interval: plan.interval,
      currency: plan.currency,
      description: plan.description,
      environment: target.providerEnv,
      account: target.account,
    });

    if (createResult.isErr()) {
      return {
        action: "skipped",
        providerId: target.providerId,
        providerPlanId: plan.providerPlanId,
        paystackPlanId:
          target.providerId === "paystack" ? plan.providerPlanId : null,
        issue: {
          code: "provider_create_failed",
          providerId: target.providerId,
          message: createResult.error.message,
        },
      };
    }

    return {
      action: "created",
      providerId: target.providerId,
      providerPlanId: createResult.value.id,
      paystackPlanId:
        target.providerId === "paystack" ? createResult.value.id : null,
    };
  }

  if (!allowUpdate || !target.adapter.updatePlan || !plan.providerPlanId) {
    return {
      action: "unchanged",
      providerId: target.providerId,
      providerPlanId: plan.providerPlanId,
      paystackPlanId:
        target.providerId === "paystack" ? plan.providerPlanId : null,
    };
  }

  const updateResult = await target.adapter.updatePlan({
    planId: plan.providerPlanId,
    name: plan.name,
    amount: plan.price,
    interval: plan.interval,
    currency: plan.currency,
    description: plan.description,
    environment: target.providerEnv,
    account: target.account,
  });

  if (updateResult.isErr()) {
    return {
      action: "skipped",
      providerId: target.providerId,
      providerPlanId: plan.providerPlanId,
      paystackPlanId:
        target.providerId === "paystack" ? plan.providerPlanId : null,
      issue: {
        code: "provider_update_failed",
        providerId: target.providerId,
        message: updateResult.error.message,
      },
    };
  }

  const nextPlanId =
    typeof updateResult.value.nextPlanId === "string" &&
    updateResult.value.nextPlanId.length > 0
      ? updateResult.value.nextPlanId
      : plan.providerPlanId;

  return {
    action:
      nextPlanId !== plan.providerPlanId || updateResult.value.updated
        ? "updated"
        : "unchanged",
    providerId: target.providerId,
    providerPlanId: nextPlanId,
    paystackPlanId: target.providerId === "paystack" ? nextPlanId : null,
  };
}

async function resolveProviderTarget(params: {
  context: PlanProviderSyncContext;
  plan: ProviderManagedPlan;
  preferredProviderId?: string | null;
}): Promise<ResolvedProviderTarget | { issue: ProviderPlanSyncIssue }> {
  const { context, plan, preferredProviderId } = params;
  const registry = getProviderRegistry();
  const providerEnv = deriveProviderEnvironment(context.environment, null);
  const providerAccounts = await loadProviderAccounts(
    context.db,
    context.organizationId,
    context.encryptionKey,
  );
  const requestedProviderId = preferredProviderId ?? plan.providerId ?? null;

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

  const selectionResult = resolveProvider(registry, {
    organizationId: context.organizationId,
    environment: providerEnv,
    context: buildProviderContext({
      currency: plan.currency,
      metadata: plan.metadata ?? undefined,
    }),
    rules: await loadProviderRules(context.db, context.organizationId),
    accounts: providerAccounts,
  });

  if (selectionResult.isErr()) {
    return {
      issue: {
        code: "provider_resolution_failed",
        message: "No provider matched the organization's routing rules.",
      },
    };
  }

  return {
    providerId: selectionResult.value.adapter.id,
    providerEnv,
    adapter: selectionResult.value.adapter,
    account: selectionResult.value.account,
  };
}
