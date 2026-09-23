/**
 * Owostack-managed sandbox provider credentials.
 *
 * In sandbox (any non-live worker) users do not connect their own provider
 * test accounts. Instead the sandbox worker carries one shared test account
 * per provider in the `MANAGED_SANDBOX_PROVIDERS` secret, and every
 * organization transparently transacts through it.
 *
 * Secret format (JSON, set with `wrangler secret put MANAGED_SANDBOX_PROVIDERS --env test`):
 *
 *   {
 *     "paystack":     { "secretKey": "sk_test_…", "publicKey": "pk_test_…" },
 *     "stripe":       { "secretKey": "sk_test_…", "publishableKey": "pk_test_…", "webhookSecret": "whsec_…" },
 *     "dodopayments": { "secretKey": "…", "webhookSecret": "…" },
 *     "bachs":        { "secretKey": "sk_sandbox_…", "webhookSecret": "…" }
 *   }
 *
 * Only `secretKey` is required per provider. Values are plaintext — the
 * secret is never persisted to D1, so the ENCRYPTION_KEY round-trip used for
 * user-supplied accounts does not apply.
 *
 * A user-created `provider_accounts` row with `environment = "test"` for the
 * same provider always takes precedence over the managed account, so teams
 * that need their own sandbox keys can still bring them.
 */

import type { ProviderAccount } from "@owostack/adapters";

export const MANAGED_SANDBOX_ACCOUNT_ID_PREFIX = "managed_sandbox_";

/** The subset of worker bindings this module reads. Pass `c.env` directly. */
export interface ManagedSandboxEnv {
  ENVIRONMENT?: string;
  MANAGED_SANDBOX_PROVIDERS?: string;
}

export type ManagedSandboxCredentials = Record<string, unknown> & {
  secretKey: string;
};

/** Sandbox is every runtime that is not the live worker. */
export function isManagedSandboxRuntime(env: ManagedSandboxEnv): boolean {
  return env.ENVIRONMENT !== "live" && env.ENVIRONMENT !== "production";
}

/**
 * Parse the secret into a provider → credentials map. Malformed entries are
 * dropped (and logged) rather than thrown so one bad provider entry cannot
 * take the whole sandbox down.
 */
export function parseManagedSandboxProviders(
  raw: string | undefined | null,
): Map<string, ManagedSandboxCredentials> {
  const out = new Map<string, ManagedSandboxCredentials>();
  if (!raw || raw.trim().length === 0) return out;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(
      "[managed-sandbox] MANAGED_SANDBOX_PROVIDERS is not valid JSON",
      error,
    );
    return out;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error(
      "[managed-sandbox] MANAGED_SANDBOX_PROVIDERS must be a JSON object keyed by provider id",
    );
    return out;
  }

  for (const [providerId, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    const id = providerId.trim().toLowerCase();
    if (!id || !value || typeof value !== "object" || Array.isArray(value)) {
      console.error(
        `[managed-sandbox] Ignoring provider '${providerId}': entry must be an object`,
      );
      continue;
    }
    const credentials = value as Record<string, unknown>;
    if (
      typeof credentials.secretKey !== "string" ||
      credentials.secretKey.trim().length === 0
    ) {
      console.error(
        `[managed-sandbox] Ignoring provider '${providerId}': missing secretKey`,
      );
      continue;
    }
    out.set(id, {
      ...credentials,
      secretKey: credentials.secretKey.trim(),
    });
  }

  return out;
}

export function managedSandboxAccountId(providerId: string): string {
  return `${MANAGED_SANDBOX_ACCOUNT_ID_PREFIX}${providerId}`;
}

export function isManagedSandboxAccount(
  account: Pick<ProviderAccount, "id"> | null | undefined,
): boolean {
  return !!account && account.id.startsWith(MANAGED_SANDBOX_ACCOUNT_ID_PREFIX);
}

/** Provider ids that have a managed sandbox account on this worker. */
export function listManagedSandboxProviderIds(env: ManagedSandboxEnv): string[] {
  if (!isManagedSandboxRuntime(env)) return [];
  return [...parseManagedSandboxProviders(env.MANAGED_SANDBOX_PROVIDERS).keys()];
}

/**
 * Synthesize a `ProviderAccount` per managed provider, scoped to the given
 * organization so downstream code (adapters, webhook handler, analytics) sees
 * exactly the same shape as a user-supplied account.
 */
export function listManagedSandboxAccounts(
  env: ManagedSandboxEnv,
  organizationId: string,
): ProviderAccount[] {
  if (!isManagedSandboxRuntime(env)) return [];

  const now = 0;
  const accounts: ProviderAccount[] = [];
  for (const [providerId, credentials] of parseManagedSandboxProviders(
    env.MANAGED_SANDBOX_PROVIDERS,
  )) {
    accounts.push({
      id: managedSandboxAccountId(providerId),
      organizationId,
      providerId: providerId as ProviderAccount["providerId"],
      environment: "test",
      displayName: "Owostack sandbox",
      credentials,
      metadata: { managed: true },
      createdAt: now,
      updatedAt: now,
    });
  }
  return accounts;
}

/** Managed account for one provider, or null when not managed on this worker. */
export function getManagedSandboxAccount(
  env: ManagedSandboxEnv,
  organizationId: string,
  providerId: string,
): ProviderAccount | null {
  return (
    listManagedSandboxAccounts(env, organizationId).find(
      (account) => account.providerId === providerId,
    ) ?? null
  );
}

/**
 * Merge user-supplied accounts with managed sandbox accounts. A user row with
 * `environment = "test"` for a provider overrides the managed account for that
 * provider; everything else is appended.
 */
export function mergeManagedSandboxAccounts(
  userAccounts: ProviderAccount[],
  managedAccounts: ProviderAccount[],
): ProviderAccount[] {
  if (managedAccounts.length === 0) return userAccounts;

  const overridden = new Set(
    userAccounts
      .filter((account) => account.environment === "test")
      .map((account) => account.providerId),
  );

  return [
    ...userAccounts,
    ...managedAccounts.filter(
      (account) => !overridden.has(account.providerId),
    ),
  ];
}

/**
 * The secret a provider signs sandbox webhooks with. Paystack signs with the
 * secret key itself; every other provider issues a dedicated webhook secret.
 */
export function managedSandboxWebhookSecret(
  account: ProviderAccount,
): string | null {
  const creds = account.credentials as Record<string, unknown>;
  const webhookSecret =
    typeof creds.webhookSecret === "string" ? creds.webhookSecret.trim() : "";
  if (webhookSecret) return webhookSecret;
  if (account.providerId === "paystack" && typeof creds.secretKey === "string") {
    return creds.secretKey.trim() || null;
  }
  return null;
}
