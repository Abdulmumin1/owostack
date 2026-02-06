import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { organizations } from "./organizations";

/**
 * Owostack Billing Core
 * Customers, Plans, Features, Subscriptions, Entitlements, Usage
 * All tables reference organizations (not projects) since orgs are the primary entity
 */

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    paystackCustomerId: text("paystack_customer_id"),
    paystackAuthorizationCode: text("paystack_authorization_code"), // For charging saved cards
    externalId: text("external_id"), // Developer's user ID
    email: text("email").notNull(),
    name: text("name"),
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("customers_org_idx").on(table.organizationId),
    index("customers_email_idx").on(table.email),
    index("customers_external_idx").on(table.externalId),
  ],
);

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    paystackPlanId: text("paystack_plan_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    price: integer("price").notNull(), // In smallest unit (kobo, pesewas)
    currency: text("currency").notNull().default("NGN"),
    interval: text("interval").notNull().default("monthly"),
    type: text("type").notNull().default("paid"), // free, paid
    billingModel: text("billing_model").notNull().default("base"), // base, per_unit, variable
    billingType: text("billing_type").notNull().default("recurring"), // recurring, one_time

    // Plan properties
    autoEnable: integer("auto_enable", { mode: "boolean" })
      .notNull()
      .default(false), // Auto-assign to new customers
    isAddon: integer("is_addon", { mode: "boolean" }).notNull().default(false), // Add-on that stacks on base plans
    planGroup: text("plan_group"), // Group plans by product line (e.g., "support", "sales")

    // Trial config
    trialDays: integer("trial_days").default(0),
    trialCardRequired: integer("trial_card_required", {
      mode: "boolean",
    }).default(false),

    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull().default(1), // For versioning
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("plans_org_idx").on(table.organizationId),
    index("plans_group_idx").on(table.planGroup),
  ],
);

export const features = sqliteTable(
  "features",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    type: text("type").notNull().default("metered"), // metered, boolean, static
    meterType: text("meter_type").default("consumable"), // consumable (uses up), non_consumable (persistent)
    unit: text("unit"), // "call", "message", "GB"
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [index("features_org_idx").on(table.organizationId)],
);

export const planFeatures = sqliteTable(
  "plan_features",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    featureId: text("feature_id")
      .notNull()
      .references(() => features.id, { onDelete: "cascade" }),

    // Included feature config
    limitValue: integer("limit_value"), // NULL = unlimited, grant amount

    // Reset config (for consumable features)
    resetInterval: text("reset_interval").notNull().default("monthly"), // none, hour, day, week, month, quarter, semi_annual, year
    resetOnEnable: integer("reset_on_enable", { mode: "boolean" })
      .notNull()
      .default(true), // Reset usage when plan enabled

    // Rollover config
    rolloverEnabled: integer("rollover_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    rolloverMaxBalance: integer("rollover_max_balance"), // Cap for rollovers, NULL = no cap

    // Priced feature config (for usage-based billing)
    usageModel: text("usage_model").default("included"), // included, usage_based, prepaid
    pricePerUnit: integer("price_per_unit"), // In cents per billing unit
    billingUnits: integer("billing_units").default(1), // Package size (e.g., $5 per 1000 = billingUnits: 1000)
    maxPurchaseLimit: integer("max_purchase_limit"), // Cap on purchasable quantity

    // Credit system
    creditCost: integer("credit_cost").default(0), // Cost in credits per unit

    // Overage handling
    overage: text("overage").notNull().default("block"), // block, charge, notify
    overagePrice: integer("overage_price"), // In cents
  },
  (table) => [index("plan_features_plan_idx").on(table.planId)],
);

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    paystackSubscriptionId: text("paystack_subscription_id"),
    paystackSubscriptionCode: text("paystack_subscription_code"),
    status: text("status").notNull().default("active"),
    currentPeriodStart: integer("current_period_start").notNull(),
    currentPeriodEnd: integer("current_period_end").notNull(),
    cancelAt: integer("cancel_at"),
    canceledAt: integer("canceled_at"),
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("subscriptions_customer_idx").on(table.customerId),
    index("subscriptions_status_idx").on(table.status),
  ],
);

export const entitlements = sqliteTable(
  "entitlements",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    featureId: text("feature_id")
      .notNull()
      .references(() => features.id),
    limitValue: integer("limit_value"),
    resetInterval: text("reset_interval").notNull().default("monthly"),
    lastResetAt: integer("last_reset_at"),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("entitlements_customer_idx").on(table.customerId),
    index("entitlements_customer_feature_idx").on(
      table.customerId,
      table.featureId,
    ),
  ],
);

export const usageRecords = sqliteTable(
  "usage_records",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    featureId: text("feature_id")
      .notNull()
      .references(() => features.id),
    amount: integer("amount").notNull().default(1),
    periodStart: integer("period_start").notNull(),
    periodEnd: integer("period_end").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("usage_customer_idx").on(table.customerId),
    index("usage_period_idx").on(
      table.customerId,
      table.periodStart,
      table.periodEnd,
    ),
  ],
);

export const credits = sqliteTable(
  "credits",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    balance: integer("balance").notNull().default(0),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [index("credits_customer_idx").on(table.customerId)],
);

export const creditSystems = sqliteTable(
  "credit_systems",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [index("credit_systems_org_idx").on(table.organizationId)],
);

export const creditSystemFeatures = sqliteTable(
  "credit_system_features",
  {
    id: text("id").primaryKey(),
    creditSystemId: text("credit_system_id")
      .notNull()
      .references(() => creditSystems.id, { onDelete: "cascade" }),
    featureId: text("feature_id")
      .notNull()
      .references(() => features.id, { onDelete: "cascade" }),
    cost: integer("cost").notNull().default(1), // Cost in credits per unit of feature
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("cs_features_cs_idx").on(table.creditSystemId),
    index("cs_features_feature_idx").on(table.featureId),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    customerId: text("customer_id").references(() => customers.id),
    data: text("data", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    processed: integer("processed", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("events_org_idx").on(table.organizationId),
    index("events_processed_idx").on(table.processed),
  ],
);

// =============================================================================
// Rewards & Referrals
// =============================================================================

export const rewards = sqliteTable(
  "rewards",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(), // Promo code
    type: text("type").notNull().default("fixed"), // fixed, percentage, free_product
    discountAmount: integer("discount_amount"), // In cents for fixed, percentage for percentage
    duration: text("duration").notNull().default("one_off"), // one_off, repeating, forever
    durationMonths: integer("duration_months"), // For repeating, how many months
    rolloverCredits: integer("rollover_credits", { mode: "boolean" }).default(
      false,
    ),
    appliesToPlans: text("applies_to_plans", { mode: "json" }).$type<
      string[]
    >(), // NULL = all plans
    maxRedemptions: integer("max_redemptions"), // NULL = unlimited
    currentRedemptions: integer("current_redemptions").default(0),
    expiresAt: integer("expires_at"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("rewards_org_idx").on(table.organizationId),
    index("rewards_code_idx").on(table.code),
  ],
);

export const referralPrograms = sqliteTable(
  "referral_programs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rewardId: text("reward_id")
      .notNull()
      .references(() => rewards.id, { onDelete: "cascade" }),
    triggerOn: text("trigger_on").notNull().default("signup"), // signup, purchase
    maxRedemptionsPerReferrer: integer("max_redemptions_per_referrer"),
    rewardReferrer: integer("reward_referrer", { mode: "boolean" })
      .notNull()
      .default(true),
    rewardRedeemer: integer("reward_redeemer", { mode: "boolean" })
      .notNull()
      .default(true),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [index("referral_programs_org_idx").on(table.organizationId)],
);

export const referralCodes = sqliteTable(
  "referral_codes",
  {
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => referralPrograms.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    code: text("code").notNull().unique(),
    redemptionCount: integer("redemption_count").default(0),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("referral_codes_program_idx").on(table.programId),
    index("referral_codes_customer_idx").on(table.customerId),
  ],
);

export const referralRedemptions = sqliteTable(
  "referral_redemptions",
  {
    id: text("id").primaryKey(),
    codeId: text("code_id")
      .notNull()
      .references(() => referralCodes.id, { onDelete: "cascade" }),
    redeemerId: text("redeemer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    applied: integer("applied", { mode: "boolean" }).notNull().default(false),
    appliedAt: integer("applied_at"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("referral_redemptions_code_idx").on(table.codeId),
    index("referral_redemptions_redeemer_idx").on(table.redeemerId),
  ],
);
