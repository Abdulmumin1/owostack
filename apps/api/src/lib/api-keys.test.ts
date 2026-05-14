import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashApiKey, verifyApiKey } from "./api-keys";
import { createRuntimeBusinessDb } from "../../test/runtime/helpers/business-db";
import { insertOrganization } from "../../test/runtime/helpers/workflow-runtime";

async function insertApiKeyRow(
  db: D1Database,
  params: {
    id: string;
    organizationId: string;
    apiKey: string;
    revokedAt?: number | null;
    expiresAt?: number | null;
  },
) {
  const now = Date.now();
  const hash = await hashApiKey(params.apiKey);
  await db
    .prepare(
      `INSERT INTO api_keys
       (id, organization_id, name, prefix, hash, created_at, revoked_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id,
      params.organizationId,
      params.id,
      "owo_sk_",
      hash,
      now,
      params.revokedAt ?? null,
      params.expiresAt ?? null,
    )
    .run();
}

describe("verifyApiKey", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_1" });
  });

  afterEach(() => {
    businessDb.close();
  });

  it("accepts active keys and rejects revoked or expired keys", async () => {
    await insertApiKeyRow(businessDb.d1, {
      id: "key_active",
      organizationId: "org_1",
      apiKey: "owo_sk_active_123",
    });
    await insertApiKeyRow(businessDb.d1, {
      id: "key_revoked",
      organizationId: "org_1",
      apiKey: "owo_sk_revoked_123",
      revokedAt: Date.now(),
    });
    await insertApiKeyRow(businessDb.d1, {
      id: "key_expired",
      organizationId: "org_1",
      apiKey: "owo_sk_expired_123",
      expiresAt: Date.now() - 1,
    });

    expect(await verifyApiKey(businessDb.db, "owo_sk_active_123")).toEqual({
      id: "key_active",
      organizationId: "org_1",
    });
    expect(await verifyApiKey(businessDb.db, "owo_sk_revoked_123")).toBeNull();
    expect(await verifyApiKey(businessDb.db, "owo_sk_expired_123")).toBeNull();
  });
});
