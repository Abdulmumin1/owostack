import { createDb, schema } from "@owostack/db";
import { eq, and } from "drizzle-orm";
import { provisionEntitlements as provisionEntitlementsShared } from "../plan-switch";
import type { ProviderAdapter, ProviderAccount } from "@owostack/adapters";
import { decrypt } from "../encryption";
import { getProviderRegistry } from "../providers";

// ---------------------------------------------------------------------------
// Env subset that workflows need
// ---------------------------------------------------------------------------

export interface WorkflowEnv {
  DB: D1Database;
  DB_AUTH: D1Database;
  ENCRYPTION_KEY: string;
  ENVIRONMENT?: string; // "test" | "live" | "development" — set per worker deployment
}

// ---------------------------------------------------------------------------
// Provider adapter registry (delegates to centralized registry)
// ---------------------------------------------------------------------------

export function getAdapter(providerId: string): ProviderAdapter | undefined {
  return getProviderRegistry().get(providerId);
}

// ---------------------------------------------------------------------------
// Resolve a ProviderAccount for an org + provider
//
// The billing DB is environment-scoped (test worker → test DB, live worker →
// live DB), so provider accounts in it already belong to the correct env.
// ---------------------------------------------------------------------------

export async function resolveProviderAccount(
  env: WorkflowEnv,
  organizationId: string,
  providerId: string,
): Promise<ProviderAccount | null> {
  const db = createDb(env.DB);
  const workerEnv = deriveEnvironment(env.ENVIRONMENT);

  // 1. Try provider_accounts table (new multi-provider system)
  //    Filter by environment to avoid using a live secret key with a test
  //    authorization code (or vice-versa) — auth codes are scoped to the
  //    specific Paystack integration / secret key.
  const accounts = await db.query.providerAccounts.findMany({
    where: and(
      eq(schema.providerAccounts.organizationId, organizationId),
      eq(schema.providerAccounts.providerId, providerId),
      eq(schema.providerAccounts.environment, workerEnv),
    ),
  });

  const matched = accounts[0];

  if (matched) {
    const credentials = { ...((matched as any).credentials || {}) };

    // Decrypt sensitive credential fields (provider-agnostic)
    if (typeof credentials.secretKey === "string") {
      try {
        credentials.secretKey = await decrypt(credentials.secretKey, env.ENCRYPTION_KEY);
      } catch {
        console.warn(`[workflow-utils] Failed to decrypt secretKey for account ${(matched as any).id}`);
      }
    }

    return {
      id: (matched as any).id,
      organizationId: (matched as any).organizationId,
      providerId: (matched as any).providerId,
      environment: (matched as any).environment || workerEnv,
      credentials,
      createdAt: (matched as any).createdAt,
      updatedAt: (matched as any).updatedAt,
    };
  }

  return null;
}

/** Derive "test" | "live" from the worker's ENVIRONMENT var */
function deriveEnvironment(envVar: string | undefined): "test" | "live" {
  if (envVar === "live" || envVar === "production") return "live";
  return "test";
}

// ---------------------------------------------------------------------------
// Provision entitlements (remove old plan features, add new plan features)
// ---------------------------------------------------------------------------

export async function provisionEntitlements(
  env: WorkflowEnv,
  customerId: string,
  newPlanId: string,
  oldPlanId?: string,
): Promise<void> {
  const db = createDb(env.DB);
  await provisionEntitlementsShared(db, customerId, newPlanId, oldPlanId);
}

// ---------------------------------------------------------------------------
// Interval helpers
// ---------------------------------------------------------------------------

export function intervalToMs(interval: string): number {
  switch (interval) {
    case "hourly": return 60 * 60 * 1000;
    case "daily": return 24 * 60 * 60 * 1000;
    case "weekly": return 7 * 24 * 60 * 60 * 1000;
    case "monthly": return 30 * 24 * 60 * 60 * 1000;
    case "quarterly": return 90 * 24 * 60 * 60 * 1000;
    case "biannually": case "semi_annual": return 180 * 24 * 60 * 60 * 1000;
    case "annually": case "yearly": return 365 * 24 * 60 * 60 * 1000;
    default: return 30 * 24 * 60 * 60 * 1000;
  }
}
