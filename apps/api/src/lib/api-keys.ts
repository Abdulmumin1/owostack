import type { createDb } from "@owostack/db";
import { schema } from "@owostack/db";
import { eq } from "drizzle-orm";
import {
  apiKeyPrefixForEnvironment,
  isOwostackApiKey,
  parseApiKeyEnvironment,
  type ApiKeyEnvironment,
} from "./public-environment";

type DB = ReturnType<typeof createDb>;
const API_KEY_CACHE_TTL_SECONDS = 60;

/**
 * Generate a new API key scoped to an environment.
 *
 *   owo_sk_test_<48 hex>  -> accepted by the sandbox API only
 *   owo_sk_live_<48 hex>  -> accepted by the live API only
 */
export function generateApiKey(environment: ApiKeyEnvironment): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const key = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${apiKeyPrefixForEnvironment(environment)}${key}`;
}

/**
 * Hash an API key for storage
 */
export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify an API key and return the key record
 */
export interface VerifyApiKeyOptions {
  cache?: KVNamespace | null;
  cacheTtlSeconds?: number;
  waitUntil?: (promise: Promise<unknown>) => void;
  skipLastUsedTouch?: boolean;
}

function getApiKeyCacheKey(hash: string): string {
  return `auth:api-key:${hash}`;
}

async function touchApiKeyLastUsedAt(
  db: DB,
  keyId: string,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<void> {
  const touchPromise = db
    .update(schema.apiKeys)
    .set({ lastUsedAt: Date.now() })
    .where(eq(schema.apiKeys.id, keyId))
    .catch((error: unknown) => {
      console.warn("[api-keys] Failed to update lastUsedAt:", error);
    });

  if (waitUntil) {
    waitUntil(touchPromise);
    return;
  }

  await touchPromise;
}

export interface VerifiedApiKey {
  id: string;
  organizationId: string;
  /**
   * Environment the key is scoped to, derived from its prefix.
   * null for legacy keys that are accepted by every environment.
   */
  environment: ApiKeyEnvironment | null;
}

export async function verifyApiKey(
  db: DB,
  apiKey: string,
  options: VerifyApiKeyOptions = {},
): Promise<VerifiedApiKey | null> {
  if (!isOwostackApiKey(apiKey)) return null;

  const environment = parseApiKeyEnvironment(apiKey);
  const hash = await hashApiKey(apiKey);
  const cache = options.cache;
  const cacheKey = getApiKeyCacheKey(hash);

  if (cache) {
    const cachedRecord = await cache.get(cacheKey, "json");
    if (cachedRecord) {
      const parsed = cachedRecord as { id: string; organizationId: string };

      if (!options.skipLastUsedTouch) {
        await touchApiKeyLastUsedAt(db, parsed.id, options.waitUntil);
      }

      return {
        id: parsed.id,
        organizationId: parsed.organizationId,
        environment,
      };
    }
  }

  const [keyRecord] = await db
    .select({
      id: schema.apiKeys.id,
      organizationId: schema.apiKeys.organizationId,
    })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.hash, hash))
    .limit(1);

  if (!keyRecord) return null;

  if (cache) {
    const cacheWrite = cache.put(cacheKey, JSON.stringify(keyRecord), {
      expirationTtl: options.cacheTtlSeconds ?? API_KEY_CACHE_TTL_SECONDS,
    });
    if (options.waitUntil) {
      options.waitUntil(
        cacheWrite.catch((error: unknown) => {
          console.warn("[api-keys] Failed to write auth cache:", error);
        }),
      );
    } else {
      await cacheWrite;
    }
  }

  if (!options.skipLastUsedTouch) {
    await touchApiKeyLastUsedAt(db, keyRecord.id, options.waitUntil);
  }

  return { ...keyRecord, environment };
}
