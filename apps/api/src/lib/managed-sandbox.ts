/**
 * Owostack-managed sandbox provider credentials.
 *
 * In sandbox (any non-live worker) users do not connect their own provider
 * test accounts. Instead the sandbox worker carries one shared test account
 * per provider, and every organization transparently transacts through it.
 *
 * One secret per provider, so each can be set and rotated independently:
 *
 *   MANAGED_SANDBOX_<PROVIDER_ID in upper case>
 *
 *   wrangler secret put MANAGED_SANDBOX_PAYSTACK     --env test
 *   wrangler secret put MANAGED_SANDBOX_STRIPE       --env test
 *   wrangler secret put MANAGED_SANDBOX_DODOPAYMENTS --env test
 *   wrangler secret put MANAGED_SANDBOX_BACHS        --env test
 *
 * The value is either the bare secret key:
 *
 *   sk_test_…
 *
 * or, when the provider needs more than one credential, a JSON object:
 *
 *   {"secretKey":"sk_test_…","publishableKey":"pk_test_…","webhookSecret":"whsec_…"}
 *
 * Only `secretKey` is required. Values are plaintext — they are never
 * persisted to D1, so the ENCRYPTION_KEY round-trip used for user-supplied
 * accounts does not apply.
 *
 * A user-created `provider_accounts` row with `environment = "test"` for the
 * same provider always takes precedence over the managed account, so teams
 * that need their own sandbox keys can still bring them.
 */

import type { ProviderAccount } from "@owostack/adapters";

export const MANAGED_SANDBOX_SECRET_PREFIX = "MANAGED_SANDBOX_";
export const MANAGED_SANDBOX_ACCOUNT_ID_PREFIX = "managed_sandbox_";

/**
 * Any worker env. Only `ENVIRONMENT` and the `MANAGED_SANDBOX_*` bindings are
 * read; pass `c.env` (or a workflow env) directly.
 */
export interface ManagedSandboxEnv {
  ENVIRONMENT?: string;
}

export type ManagedSandboxCredentials = Record<string, unknown> & {
  secretKey: string;
};

/** Sandbox is every runtime that is not the live worker. */
export function isManagedSandboxRuntime(env: ManagedSandboxEnv): boolean {
  return env.ENVIRONMENT !== "live" && env.ENVIRONMENT !== "production";
}

/** `paystack` → `MANAGED_SANDBOX_PAYSTACK` */
export function managedSandboxSecretName(providerId: string): string {
  return `${MANAGED_SANDBOX_SECRET_PREFIX}${providerId.toUpperCase()}`;
}

/** `MANAGED_SANDBOX_PAYSTACK` → `paystack`; null for any other binding name. */
export function providerIdFromSecretName(name: string): string | null {
  if (!name.startsWith(MANAGED_SANDBOX_SECRET_PREFIX)) return null;
  const id = name.slice(MANAGED_SANDBOX_SECRET_PREFIX.length).toLowerCase();
  return id.length > 0 ? id : null;
}

/**
 * Parse one provider's secret value. Accepts a bare secret key or a JSON
 * object with at least `secretKey`. Returns null (and logs) for anything else
 * so one bad secret cannot take the rest of the sandbox down.
 */
export function parseManagedSandboxSecret(
  name: string,
  raw: unknown,
): ManagedSandboxCredentials | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0) return null;

  if (!value.startsWith("{")) {
    return { secretKey: value };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    console.error(`[managed-sandbox] ${name} is not valid JSON`, error);
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error(
      `[managed-sandbox] ${name} must be a bare secret key or a JSON object`,
    );
    return null;
  }

  const credentials = parsed as Record<string, unknown>;
  if (
    typeof credentials.secretKey !== "string" ||
    credentials.secretKey.trim().length === 0
  ) {
    console.error(`[managed-sandbox] ${name} is missing secretKey`);
    return null;
  }

  return { ...credentials, secretKey: credentials.secretKey.trim() };
}

/**
 * Collect every `MANAGED_SANDBOX_*` binding on this worker into a
 * provider → credentials map. Empty on the live worker.
 */
export function parseManagedSandboxProviders(
  env: ManagedSandboxEnv,
): Map<string, ManagedSandboxCredentials> {
  const out = new Map<string, ManagedSandboxCredentials>();
  if (!isManagedSandboxRuntime(env)) return out;

  for (const [name, raw] of Object.entries(
    env as unknown as Record<string, unknown>,
  )) {
    const providerId = providerIdFromSecretName(name);
    if (!providerId) continue;
    const credentials = parseManagedSandboxSecret(name, raw);
    if (credentials) out.set(providerId, credentials);
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
  return [...parseManagedSandboxProviders(env).keys()].sort();
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
  const providers = parseManagedSandboxProviders(env);
  return [...providers.keys()].sort().map((providerId) => ({
    id: managedSandboxAccountId(providerId),
    organizationId,
    providerId: providerId as ProviderAccount["providerId"],
    environment: "test",
    displayName: "Owostack sandbox",
    credentials: providers.get(providerId)!,
    metadata: { managed: true },
    createdAt: 0,
    updatedAt: 0,
  }));
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
