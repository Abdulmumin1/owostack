import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { organizations } from "./organizations";

/**
 * API Keys for authenticating requests
 * Note: Using organization_id instead of project_id since organizations
 * are the primary entity created by Better Auth
 */

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(), // sk_live_ or sk_test_
    hash: text("hash").notNull(), // SHA-256 hash of the full key
    lastUsedAt: integer("last_used_at"),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    revokedAt: integer("revoked_at"),
  },
  (table) => [
    index("api_keys_org_idx").on(table.organizationId),
    index("api_keys_hash_idx").on(table.hash),
  ],
);
