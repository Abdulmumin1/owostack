import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
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
    providerId: text("provider_id"),
    providerCustomerId: text("provider_customer_id"),
    providerAuthorizationCode: text("provider_authorization_code"),
    providerMetadata: text("provider_metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
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
    providerId: text("provider_id"),
    providerPlanId: text("provider_plan_id"),
    providerMetadata: text("provider_metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
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
    source: text("source").notNull().default("dashboard"), // "sdk" or "dashboard" — tracks who owns this resource
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
    source: text("source").notNull().default("dashboard"), // "sdk" or "dashboard" — tracks who owns this resource
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
    trialLimitValue: integer("trial_limit_value"), // NULL = unlimited, grant amount during trial

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
    ratingModel: text("rating_model").default("package"), // package, graduated, volume
    tiers: text("tiers", { mode: "json" }).$type<
      Array<{
        upTo: number | null;
        unitPrice?: number;
        flatFee?: number;
      }>
    >(),
    maxPurchaseLimit: integer("max_purchase_limit"), // Cap on purchasable quantity

    // Credit system
    creditCost: integer("credit_cost").default(0), // Cost in credits per unit

    // Overage handling
    overage: text("overage").notNull().default("block"), // block, charge
    overagePrice: integer("overage_price"), // In cents
    maxOverageUnits: integer("max_overage_units"), // Hard cap on overage units per period
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
    providerId: text("provider_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    providerSubscriptionCode: text("provider_subscription_code"),
    providerMetadata: text("provider_metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
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

export const providerAccounts = sqliteTable(
  "provider_accounts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    environment: text("environment").notNull(),
    displayName: text("display_name"),
    credentials: text("credentials", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
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
    index("provider_accounts_org_idx").on(table.organizationId),
    uniqueIndex("provider_accounts_org_provider_env_uniq").on(
      table.organizationId,
      table.providerId,
      table.environment,
    ),
  ],
);

export const providerRules = sqliteTable(
  "provider_rules",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull(),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    providerId: text("provider_id").notNull(),
    conditions: text("conditions", { mode: "json" }).$type<
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
    index("provider_rules_org_idx").on(table.organizationId),
    index("provider_rules_priority_idx").on(table.priority),
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
    entityId: text("entity_id"),
    limitValue: integer("limit_value"),
    resetInterval: text("reset_interval").notNull().default("monthly"),
    lastResetAt: integer("last_reset_at"),
    expiresAt: integer("expires_at"),
    source: text("source").notNull().default("plan"), // plan, manual, addon
    grantedBy: text("granted_by"),
    grantedReason: text("granted_reason"),
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
    index("entitlements_entity_idx").on(
      table.customerId,
      table.featureId,
      table.entityId,
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
    entityId: text("entity_id"),
    invoiceId: text("invoice_id"),
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
    index("usage_entity_idx").on(
      table.customerId,
      table.featureId,
      table.entityId,
    ),
    index("usage_invoice_idx").on(table.invoiceId),
  ],
);

export const usageDailySummaries = sqliteTable(
  "usage_daily_summaries",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    featureId: text("feature_id")
      .notNull()
      .references(() => features.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // "YYYY-MM-DD"
    amount: integer("amount").notNull().default(0),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("usage_summary_org_idx").on(table.organizationId),
    index("usage_summary_customer_idx").on(table.customerId),
    uniqueIndex("usage_summary_unique_idx").on(
      table.customerId,
      table.featureId,
      table.date,
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

// =============================================================================
// Add-on Credit Packs
// =============================================================================

export const creditPacks = sqliteTable(
  "credit_packs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    credits: integer("credits").notNull(), // Number of credits in this pack
    price: integer("price").notNull(), // Price in smallest currency unit (kobo/cents)
    currency: text("currency").notNull().default("NGN"),
    creditSystemId: text("credit_system_id").references(
      () => creditSystems.id,
      { onDelete: "set null" },
    ), // null = global pool, set = scoped to this credit system
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    providerProductId: text("provider_product_id"), // e.g. Stripe prod_xxx
    providerPriceId: text("provider_price_id"), // e.g. Stripe price_xxx
    providerId: text("provider_id"), // Which provider the product is synced to
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
    index("credit_packs_org_idx").on(table.organizationId),
    index("credit_packs_slug_idx").on(table.slug),
  ],
);

export const creditPurchases = sqliteTable(
  "credit_purchases",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    creditPackId: text("credit_pack_id").references(() => creditPacks.id),
    creditSystemId: text("credit_system_id").references(
      () => creditSystems.id,
      { onDelete: "set null" },
    ), // null = global, set = scoped
    credits: integer("credits").notNull(), // Total credits added (pack.credits * quantity)
    quantity: integer("quantity").notNull().default(1), // Number of packs purchased
    price: integer("price").notNull().default(0), // Total amount paid (pack.price * quantity)
    currency: text("currency").notNull().default("NGN"),
    paymentReference: text("payment_reference"),
    providerId: text("provider_id"),
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("credit_purchases_customer_idx").on(table.customerId),
    index("credit_purchases_pack_idx").on(table.creditPackId),
  ],
);

// Per-credit-system addon balances (scoped pools)
export const creditSystemBalances = sqliteTable(
  "credit_system_balances",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    creditSystemId: text("credit_system_id")
      .notNull()
      .references(() => creditSystems.id, { onDelete: "cascade" }),
    balance: integer("balance").notNull().default(0),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("csb_customer_idx").on(table.customerId),
    uniqueIndex("csb_customer_system_idx").on(
      table.customerId,
      table.creditSystemId,
    ),
  ],
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

// =============================================================================
// Invoices & Billing (for usage-based/priced features)
// =============================================================================

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id").references(() => subscriptions.id),

    // Invoice details
    number: text("number"), // Human-readable invoice number (INV-001)
    idempotencyKey: text("idempotency_key"),
    status: text("status").notNull().default("draft"), // draft, open, paid, void, uncollectible
    currency: text("currency").notNull().default("NGN"),

    // Amounts (in smallest unit - kobo/cents)
    subtotal: integer("subtotal").notNull().default(0),
    tax: integer("tax").notNull().default(0),
    total: integer("total").notNull().default(0),
    amountPaid: integer("amount_paid").notNull().default(0),
    amountDue: integer("amount_due").notNull().default(0),

    // Period this invoice covers
    periodStart: integer("period_start").notNull(),
    periodEnd: integer("period_end").notNull(),
    usageWindowStart: integer("usage_window_start"),
    usageWindowEnd: integer("usage_window_end"),
    usageCutoffAt: integer("usage_cutoff_at"), // Usage before this timestamp is included

    // Payment details
    dueAt: integer("due_at"),
    paidAt: integer("paid_at"),

    // Metadata
    description: text("description"),
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
    index("invoices_org_idx").on(table.organizationId),
    index("invoices_customer_idx").on(table.customerId),
    index("invoices_status_idx").on(table.status),
    uniqueIndex("invoices_idempotency_key_idx").on(table.idempotencyKey),
  ],
);

export const invoiceItems = sqliteTable(
  "invoice_items",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    featureId: text("feature_id").references(() => features.id),

    // Item details
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: integer("unit_price").notNull().default(0), // In smallest unit
    amount: integer("amount").notNull().default(0), // Full line total; tiered lines may include flat charges

    // For usage-based: period this line item covers
    periodStart: integer("period_start"),
    periodEnd: integer("period_end"),

    // Metadata
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),

    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [index("invoice_items_invoice_idx").on(table.invoiceId)],
);

export const paymentAttempts = sqliteTable(
  "payment_attempts",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),

    // Payment details
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("pending"), // pending, succeeded, failed

    // Provider info
    provider: text("provider"), // paystack, flutterwave, etc.
    providerReference: text("provider_reference"),
    providerMetadata: text("provider_metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),

    // Retry logic
    attemptNumber: integer("attempt_number").notNull().default(1),
    nextRetryAt: integer("next_retry_at"),
    lastError: text("last_error"),

    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("payment_attempts_invoice_idx").on(table.invoiceId),
    index("payment_attempts_status_idx").on(table.status),
  ],
);

export const billingRuns = sqliteTable(
  "billing_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull().default("threshold"), // threshold, manual, period_end
    status: text("status").notNull().default("pending"), // pending, processing, completed, blocked, failed, deferred
    idempotencyKey: text("idempotency_key").notNull(),
    activeLockKey: text("active_lock_key"),
    thresholdAmount: integer("threshold_amount"),
    usageWindowStart: integer("usage_window_start"),
    usageWindowEnd: integer("usage_window_end").notNull(),
    invoiceId: text("invoice_id").references(() => invoices.id, {
      onDelete: "set null",
    }),
    failureReason: text("failure_reason"),
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
    index("billing_runs_org_idx").on(table.organizationId),
    index("billing_runs_customer_idx").on(table.customerId),
    index("billing_runs_status_idx").on(table.status),
    uniqueIndex("billing_runs_idempotency_key_idx").on(table.idempotencyKey),
    uniqueIndex("billing_runs_active_lock_key_idx").on(table.activeLockKey),
  ],
);

export const customerOverageBlocks = sqliteTable(
  "customer_overage_blocks",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    billingRunId: text("billing_run_id").references(() => billingRuns.id, {
      onDelete: "set null",
    }),
    invoiceId: text("invoice_id").references(() => invoices.id, {
      onDelete: "set null",
    }),
    reason: text("reason").notNull(),
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
    uniqueIndex("customer_overage_blocks_customer_idx").on(table.customerId),
    index("customer_overage_blocks_org_idx").on(table.organizationId),
    index("customer_overage_blocks_invoice_idx").on(table.invoiceId),
    index("customer_overage_blocks_run_idx").on(table.billingRunId),
  ],
);

// =============================================================================
// Overage Billing Settings
// =============================================================================

export const overageSettings = sqliteTable(
  "overage_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    // Legacy storage field. Canonical behavior is always period-end true-up;
    // threshold_amount enables optional mid-cycle threshold collection.
    billingInterval: text("billing_interval")
      .notNull()
      .default("end_of_period"),
    thresholdAmount: integer("threshold_amount"), // Minor units — optional early-collection trigger
    autoCollect: integer("auto_collect", { mode: "boolean" })
      .notNull()
      .default(false), // Charge card automatically
    gracePeriodHours: integer("grace_period_hours").notNull().default(0), // Wait before collecting

    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [uniqueIndex("overage_settings_org_idx").on(table.organizationId)],
);

export const paymentMethods = sqliteTable(
  "payment_methods",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    token: text("token").notNull(),
    type: text("type").notNull().default("card"), // card, provider_managed
    cardLast4: text("card_last4"),
    cardBrand: text("card_brand"),
    cardExpMonth: text("card_exp_month"),
    cardExpYear: text("card_exp_year"),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(true),
    isValid: integer("is_valid", { mode: "boolean" }).notNull().default(true),
    verifiedAt: integer("verified_at"),
    invalidatedAt: integer("invalidated_at"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("pm_customer_idx").on(table.customerId),
    index("pm_org_idx").on(table.organizationId),
    uniqueIndex("pm_customer_provider_token_uniq").on(
      table.customerId,
      table.providerId,
      table.token,
    ),
  ],
);

export const customerOverageLimits = sqliteTable(
  "customer_overage_limits",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    // Customer's spending cap per billing period (minor units)
    maxOverageAmount: integer("max_overage_amount"),
    // What happens when cap is hit
    onLimitReached: text("on_limit_reached").notNull().default("block"), // block, notify

    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    uniqueIndex("col_customer_idx").on(table.customerId),
    index("col_org_idx").on(table.organizationId),
  ],
);

// =============================================================================
// Feature Entities (for per-seat/org scoped features)
// =============================================================================

export const entities = sqliteTable(
  "entities",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    featureId: text("feature_id")
      .notNull()
      .references(() => features.id, { onDelete: "cascade" }),
    entityId: text("entity_id").notNull(), // User-provided entity ID (e.g., "user_123")

    // Entity metadata
    name: text("name"),
    email: text("email"),
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),

    // Entity status
    status: text("status").notNull().default("active"), // active, pending_removal

    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    removedAt: integer("removed_at"),
  },
  (table) => [
    index("entities_customer_idx").on(table.customerId),
    index("entities_feature_idx").on(table.featureId),
    uniqueIndex("entities_customer_feature_entity_idx").on(
      table.customerId,
      table.featureId,
      table.entityId,
    ),
  ],
);
