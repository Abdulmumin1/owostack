import type {
  ProviderAdapter,
  ProviderRegistry,
  ProviderRule,
  ProviderAccount,
  ProviderEnvironment,
  AttachRequestContext,
} from "./index";
import { selectProvider } from "./selector";
import { Result } from "better-result";

export interface ProviderFactoryContext {
  organizationId: string;
  environment: ProviderEnvironment;
  context: AttachRequestContext;
  rules: ProviderRule[];
  accounts: ProviderAccount[];
}

export interface ProviderFactoryResult {
  adapter: ProviderAdapter;
  account: ProviderAccount;
  ruleId: string | null;
}

export function resolveProvider(
  registry: ProviderRegistry,
  factoryContext: ProviderFactoryContext,
): Result<ProviderFactoryResult, { code: string; message: string }> {
  const selection = selectProvider(factoryContext.rules, factoryContext.context);
  if (!selection.providerId) {
    return Result.err({
      code: "provider_not_found",
      message: "No provider matched the selection rules",
    });
  }

  const adapter = registry.get(selection.providerId);
  if (!adapter) {
    return Result.err({
      code: "provider_not_registered",
      message: `Provider '${selection.providerId}' is not registered`,
    });
  }

  const account = factoryContext.accounts.find(
    (item) =>
      item.providerId === selection.providerId &&
      item.environment === factoryContext.environment,
  );

  if (!account) {
    return Result.err({
      code: "provider_account_missing",
      message: `Provider '${selection.providerId}' is not configured`,
    });
  }

  return Result.ok({
    adapter,
    account,
    ruleId: selection.ruleId,
  });
}
