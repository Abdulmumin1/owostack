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
// The only shared resource is DB_AUTH (legacy project keys with both
// test_secret_key and live_secret_key) — for that fallback we use
// env.ENVIRONMENT to pick the right column.
// ---------------------------------------------------------------------------

export async function resolveProviderAccount(
  env: WorkflowEnv,
  organizationId: string,
  providerId: string,
): Promise<ProviderAccount | null> {
  const db = createDb(env.DB);
  const workerEnv = deriveEnvironment(env.ENVIRONMENT);

  // 1. Try provider_accounts table (new multi-provider system)
  //    The billing DB is already scoped to this worker's environment,
  //    so all accounts in it belong to the correct env.
  const accounts = await db.query.providerAccounts.findMany({
    where: and(
      eq(schema.providerAccounts.organizationId, organizationId),
      eq(schema.providerAccounts.providerId, providerId),
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

  // 2. Fallback: legacy project keys (raw D1 — projects live in shared DB_AUTH)
  //    Both test and live keys are stored in the same row, so we pick based
  //    on this worker's ENVIRONMENT.
  const project = await env.DB_AUTH.prepare(
    `SELECT test_secret_key, live_secret_key FROM projects WHERE organization_id = ? LIMIT 1`,
  ).bind(organizationId).first<{ test_secret_key: string | null; live_secret_key: string | null }>();

  if (!project) return null;

  const encryptedKey = workerEnv === "live" ? project.live_secret_key : project.test_secret_key;
  if (!encryptedKey) return null;

  let secretKey: string;
  try {
    secretKey = await decrypt(encryptedKey, env.ENCRYPTION_KEY);
  } catch {
    return null;
  }

  return {
    id: `legacy-${organizationId}`,
    organizationId,
    providerId: "paystack",
    environment: workerEnv,
    credentials: { secretKey },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
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
