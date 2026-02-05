import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

/**
 * Organizations & Team Management
 * Better Auth Organization Plugin compatible + Projects
 */

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // owner, admin, member
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("members_org_idx").on(table.organizationId),
    index("members_user_idx").on(table.userId),
  ],
);

export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  status: text("status").notNull().default("pending"), // pending, accepted, expired
  invitedBy: text("invited_by")
    .notNull()
    .references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // Test environment keys (sandbox)
    testSecretKey: text("test_secret_key"), // Encrypted
    testPublicKey: text("test_public_key"),
    testWebhookSecret: text("test_webhook_secret"),
    // Live environment keys (production)
    liveSecretKey: text("live_secret_key"), // Encrypted
    livePublicKey: text("live_public_key"),
    liveWebhookSecret: text("live_webhook_secret"),
    // Active environment toggle
    activeEnvironment: text("active_environment").notNull().default("test"), // "test" | "live"
    // Legacy fields for migration (will be removed)
    paystackSecretKey: text("paystack_secret_key"), // @deprecated
    paystackPublicKey: text("paystack_public_key"), // @deprecated
    webhookSecret: text("webhook_secret"), // @deprecated
    environment: text("environment").default("test"), // @deprecated
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("projects_org_idx").on(table.organizationId)],
);
