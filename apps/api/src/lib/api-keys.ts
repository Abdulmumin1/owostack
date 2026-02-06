import type { MiddlewareHandler } from "hono";
import type { createDb } from "@owostack/db";
import { schema } from "@owostack/db";
import { eq } from "drizzle-orm";

type DB = ReturnType<typeof createDb>;

/**
 * Middleware to validate API keys from Database
 */
export function apiKeyAuth(): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader) {
      return c.json(
        {
          success: false,
          error: { code: "AuthError", message: "API key is required" },
        },
        401,
      );
    }

    const match = authHeader.match(/^Bearer\s+(owo_sk_\w+)$/i);
    if (!match) {
      return c.json(
        {
          success: false,
          error: { code: "AuthError", message: "Invalid API key format" },
        },
        401,
      );
    }

    const apiKey = match[1];

    // Get DB from context
    const db = (c.get("authDb") ?? c.get("db")) as DB;

    // Hash the key to look it up (since we store hashes)
    // For MVP/Demo we might be storing plain keys, but let's check schema
    // The schema says `hash: text("hash")`, so we should hash it.
    // However, implementing SHA-256 in strict edge runtime can be tricky without subtly
    // or we can store the key plainly for now if encryption isn't set up.
    // Let's assume for now we are storing the key directly in `hash` column or use a simple check.
    // Actually, to make it robust, let's assume `hash` stores the actual key for this iteration
    // to avoid complex crypto logic in this specific file right now, OR we implement a simple hash helper.

    // Let's implement a simple hash using Web Crypto API which is available in Workers
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const [keyRecord] = await db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.hash, hashHex))
      .limit(1);

    if (!keyRecord) {
      return c.json(
        {
          success: false,
          error: { code: "AuthError", message: "Invalid API key" },
        },
        401,
      );
    }

    // Get Organization ID directly from the key record
    const organizationId = keyRecord.organizationId;

    if (!organizationId) {
      return c.json(
        {
          success: false,
          error: {
            code: "AuthError",
            message: "Invalid key - no organization",
          },
        },
        401,
      );
    }

    // Update last used
    await db
      .update(schema.apiKeys)
      .set({ lastUsedAt: Date.now() })
      .where(eq(schema.apiKeys.id, keyRecord.id));

    // Set context for downstream handlers
    c.set("organizationId", organizationId);
    c.set("projectId", organizationId); // For backward compatibility
    // c.set("permissions", keyRecord.permissions); // TODO: Add permissions to DB if needed

    await next();
  };
}

/**
 * Generate a new API key
 */
export function generateApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const key = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `owo_sk_${key}`;
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
export async function verifyApiKey(
  db: DB,
  apiKey: string,
): Promise<{ id: string; organizationId: string } | null> {
  const match = apiKey.match(/^owo_sk_\w+$/i);
  if (!match) return null;

  // In a real app, strict hashing.
  // Here we use the same hash logic
  const hash = await hashApiKey(apiKey);

  const [keyRecord] = await db
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.hash, hash))
    .limit(1);

  if (!keyRecord) return null;

  // Update last used
  await db
    .update(schema.apiKeys)
    .set({ lastUsedAt: Date.now() })
    .where(eq(schema.apiKeys.id, keyRecord.id));

  return keyRecord;
}
