import { eq } from "drizzle-orm";
import { schema, createDb } from "@owostack/db";
import type {
  AttachRequestContext,
  ProviderAccount,
  ProviderEnvironment,
  ProviderRule,
} from "@owostack/adapters";
import { decrypt } from "./encryption";

export type DB = ReturnType<typeof createDb>;

export async function loadProviderAccounts(
  db: DB,
  organizationId: string,
  encryptionKey?: string,
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

  if (!encryptionKey) {
    return accounts;
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

  return decrypted;
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
  region?: string;
  currency?: string;
  metadata?: Record<string, unknown>;
}): AttachRequestContext {
  return {
    region: params.region,
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

function providerCredentialsNeedingDecrypt(providerId: string): string[] {
  switch (providerId) {
    case "paystack":
      return ["secretKey"];
    default:
      return [];
  }
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
