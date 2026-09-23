/**
 * Owostack-managed sandbox providers.
 *
 * On the sandbox API every organization transacts through shared test
 * accounts owned by Owostack, so there are no `provider_accounts` rows to
 * list. The dashboard asks the API which providers are managed and renders
 * them as ready-to-use accounts. A user-created sandbox row for the same
 * provider takes precedence (mirrors `apps/api/src/lib/managed-sandbox.ts`).
 */

import { apiFetch } from "$lib/auth-client";
import { getActiveEnvironment } from "$lib/env";
import type { ProviderAccount } from "$lib/components/settings/types";

export const MANAGED_SANDBOX_ACCOUNT_ID_PREFIX = "managed_sandbox_";

export function isManagedSandboxAccount(
  account: Pick<ProviderAccount, "id"> | null | undefined,
): boolean {
  return !!account && account.id.startsWith(MANAGED_SANDBOX_ACCOUNT_ID_PREFIX);
}

/**
 * Provider ids managed on the API the dashboard is currently pointed at.
 * Always empty on the live API, so callers can use this unconditionally.
 */
export async function loadManagedSandboxProviderIds(): Promise<string[]> {
  if (getActiveEnvironment() !== "test") return [];
  try {
    const res = await apiFetch("/api/dashboard/providers/managed-sandbox");
    const providers = res.data?.data?.providers;
    return Array.isArray(providers) ? providers : [];
  } catch (e) {
    console.error("Failed to load managed sandbox providers", e);
    return [];
  }
}

export function managedSandboxAccount(
  providerId: string,
  organizationId: string,
): ProviderAccount {
  return {
    id: `${MANAGED_SANDBOX_ACCOUNT_ID_PREFIX}${providerId}`,
    organizationId,
    providerId,
    environment: "test",
    displayName: null,
    credentials: {},
    metadata: { managed: true },
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * Append managed sandbox accounts to the organization's own accounts. A user
 * sandbox row for a provider hides the managed entry for that provider.
 */
export function withManagedSandboxAccounts(
  accounts: ProviderAccount[],
  managedProviderIds: string[],
  organizationId: string,
): ProviderAccount[] {
  if (managedProviderIds.length === 0) return accounts;
  const overridden = new Set(
    accounts.filter((a) => a.environment === "test").map((a) => a.providerId),
  );
  return [
    ...accounts,
    ...managedProviderIds
      .filter((id) => !overridden.has(id))
      .map((id) => managedSandboxAccount(id, organizationId)),
  ];
}
