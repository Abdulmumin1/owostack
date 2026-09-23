import { eq } from "drizzle-orm";
import { schema, createDb } from "@owostack/db";
import {
  createProviderRegistry,
  paystackAdapter,
  dodoAdapter,
  polarAdapter,
  stripeAdapter,
  bachsAdapter,
} from "@owostack/adapters";
import type {
  AttachRequestContext,
  ProviderAccount,
  ProviderEnvironment,
  ProviderRule,
} from "@owostack/adapters";
import { decrypt } from "./encryption";
import {
  listManagedSandboxAccounts,
  mergeManagedSandboxAccounts,
  type ManagedSandboxEnv,
} from "./managed-sandbox";

export type DB = ReturnType<typeof createDb>;

/**
 * Single source of truth for supported payment providers.
 * To add a new provider: import its adapter and register it here.
 */
export function getProviderRegistry() {
  const registry = createProviderRegistry();
  registry.register(paystackAdapter);
  registry.register(dodoAdapter);
  registry.register(polarAdapter);
  registry.register(stripeAdapter);
  registry.register(bachsAdapter);
  return registry;
}

/**
 * Load every provider account an organization can transact with.
 *
 * Pass the worker env as `managedEnv` (usually `c.env`) to include the
 * Owostack-managed sandbox accounts on non-live workers. User-supplied test
 * rows override managed accounts for the same provider.
 */
export async function loadProviderAccounts(
  db: DB,
  organizationId: string,
  encryptionKey?: string,
  managedEnv?: ManagedSandboxEnv,
): Promise<ProviderAccount[]> {
  const rows = await db.query.providerAccounts.findMany({
    where: eq(schema.providerAccounts.organizationId, organizationId),
  });

  const accounts = rows.map((row: any) => ({
    id: row.id,
    organizationId: row.organizationId,
    providerId: row.providerId,
    environment: row.environment,
    displayName: row.displayName,
    credentials: row.credentials || {},
    metadata: row.metadata || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  const managed = managedEnv
    ? listManagedSandboxAccounts(managedEnv, organizationId)
    : [];

  if (!encryptionKey) {
    return mergeManagedSandboxAccounts(accounts, managed);
  }

  const decrypted = await Promise.all(
    accounts.map(async (account: ProviderAccount) => ({
      ...account,
      credentials: await decryptProviderCredentials(
        account.credentials,
        providerCredentialsNeedingDecrypt(account.providerId),
        encryptionKey,
      ),
    })),
  );

  return mergeManagedSandboxAccounts(decrypted, managed);
}

export async function loadProviderRules(
  db: DB,
  organizationId: string,
): Promise<ProviderRule[]> {
  const rows = await db.query.providerRules.findMany({
    where: eq(schema.providerRules.organizationId, organizationId),
  });

  return rows.map((row: any) => ({
    id: row.id,
    organizationId: row.organizationId,
    priority: row.priority,
    isDefault: row.isDefault,
    providerId: row.providerId,
    conditions: row.conditions || {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export function buildProviderContext(params: {
  currency?: string;
  metadata?: Record<string, unknown>;
}): AttachRequestContext {
  return {
    currency: params.currency,
    metadata: params.metadata,
  };
}

export function deriveProviderEnvironment(
  envVar: string | undefined,
  activeEnvironment?: string | null,
): ProviderEnvironment {
  if (envVar === "production" || envVar === "live") {
    return "live";
  }
  if (envVar === "test" || envVar === "development") {
    return "test";
  }

  return activeEnvironment === "live" ? "live" : "test";
}

function providerCredentialsNeedingDecrypt(_providerId: string): string[] {
  // All providers use "secretKey" as their encrypted credential field.
  // Some providers (e.g. Dodo Payments) also have a separate "webhookSecret".
  return ["secretKey", "webhookSecret"];
}

async function decryptProviderCredentials(
  credentials: Record<string, unknown>,
  keysToDecrypt: string[],
  encryptionKey: string,
): Promise<Record<string, unknown>> {
  const next = { ...credentials };

  for (const key of keysToDecrypt) {
    const value = next[key];
    if (typeof value === "string" && value.length > 0) {
      try {
        next[key] = await decrypt(value, encryptionKey);
      } catch (error) {
        console.warn(`Failed to decrypt provider credential: ${key}`, error);
      }
    }
  }

  return next;
}
