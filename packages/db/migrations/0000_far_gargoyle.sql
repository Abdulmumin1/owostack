CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`inviter_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `members_org_idx` ON `members` (`organization_id`);--> statement-breakpoint
CREATE INDEX `members_user_idx` ON `members` (`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`metadata` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`test_secret_key` text,
	`test_public_key` text,
	`test_webhook_secret` text,
	`live_secret_key` text,
	`live_public_key` text,
	`live_webhook_secret` text,
	`active_environment` text DEFAULT 'test' NOT NULL,
	`paystack_secret_key` text,
	`paystack_public_key` text,
	`webhook_secret` text,
	`environment` text DEFAULT 'test',
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projects_org_idx` ON `projects` (`organization_id`);--> statement-breakpoint
CREATE TABLE `credit_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`credits` integer NOT NULL,
	`price` integer NOT NULL,
	`currency` text DEFAULT 'NGN' NOT NULL,
	`credit_system_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`provider_product_id` text,
	`provider_price_id` text,
	`provider_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credit_system_id`) REFERENCES `credit_systems`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `credit_packs_org_idx` ON `credit_packs` (`organization_id`);--> statement-breakpoint
CREATE INDEX `credit_packs_slug_idx` ON `credit_packs` (`slug`);--> statement-breakpoint
CREATE TABLE `credit_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`credit_pack_id` text,
	`credit_system_id` text,
	`credits` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`price` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'NGN' NOT NULL,
	`payment_reference` text,
	`provider_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credit_pack_id`) REFERENCES `credit_packs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credit_system_id`) REFERENCES `credit_systems`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `credit_purchases_customer_idx` ON `credit_purchases` (`customer_id`);--> statement-breakpoint
CREATE INDEX `credit_purchases_pack_idx` ON `credit_purchases` (`credit_pack_id`);--> statement-breakpoint
CREATE TABLE `credit_system_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`credit_system_id` text NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credit_system_id`) REFERENCES `credit_systems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `csb_customer_idx` ON `credit_system_balances` (`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `csb_customer_system_idx` ON `credit_system_balances` (`customer_id`,`credit_system_id`);--> statement-breakpoint
CREATE TABLE `credit_system_features` (
	`id` text PRIMARY KEY NOT NULL,
	`credit_system_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`cost` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`credit_system_id`) REFERENCES `credit_systems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cs_features_cs_idx` ON `credit_system_features` (`credit_system_id`);--> statement-breakpoint
CREATE INDEX `cs_features_feature_idx` ON `credit_system_features` (`feature_id`);--> statement-breakpoint
CREATE TABLE `credit_systems` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `credit_systems_org_idx` ON `credit_systems` (`organization_id`);--> statement-breakpoint
CREATE TABLE `credits` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `credits_customer_idx` ON `credits` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customer_overage_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`max_overage_amount` integer,
	`on_limit_reached` text DEFAULT 'block' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `col_customer_idx` ON `customer_overage_limits` (`customer_id`);--> statement-breakpoint
CREATE INDEX `col_org_idx` ON `customer_overage_limits` (`organization_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider_id` text,
	`provider_customer_id` text,
	`provider_authorization_code` text,
	`provider_metadata` text,
	`paystack_customer_id` text,
	`paystack_authorization_code` text,
	`external_id` text,
	`email` text NOT NULL,
	`name` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `customers_org_idx` ON `customers` (`organization_id`);--> statement-breakpoint
CREATE INDEX `customers_email_idx` ON `customers` (`email`);--> statement-breakpoint
CREATE INDEX `customers_external_idx` ON `customers` (`external_id`);--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`name` text,
	`email` text,
	`metadata` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entities_customer_idx` ON `entities` (`customer_id`);--> statement-breakpoint
CREATE INDEX `entities_feature_idx` ON `entities` (`feature_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entities_customer_feature_entity_idx` ON `entities` (`customer_id`,`feature_id`,`entity_id`);--> statement-breakpoint
CREATE TABLE `entitlements` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`entity_id` text,
	`limit_value` integer,
	`reset_interval` text DEFAULT 'monthly' NOT NULL,
	`last_reset_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entitlements_customer_idx` ON `entitlements` (`customer_id`);--> statement-breakpoint
CREATE INDEX `entitlements_customer_feature_idx` ON `entitlements` (`customer_id`,`feature_id`);--> statement-breakpoint
CREATE INDEX `entitlements_entity_idx` ON `entitlements` (`customer_id`,`feature_id`,`entity_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`type` text NOT NULL,
	`customer_id` text,
	`data` text NOT NULL,
	`processed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_org_idx` ON `events` (`organization_id`);--> statement-breakpoint
CREATE INDEX `events_processed_idx` ON `events` (`processed`);--> statement-breakpoint
CREATE TABLE `features` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`type` text DEFAULT 'metered' NOT NULL,
	`meter_type` text DEFAULT 'consumable',
	`unit` text,
	`source` text DEFAULT 'dashboard' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `features_org_idx` ON `features` (`organization_id`);--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`feature_id` text,
	`description` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price` integer DEFAULT 0 NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`period_start` integer,
	`period_end` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoice_items_invoice_idx` ON `invoice_items` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`subscription_id` text,
	`number` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`currency` text DEFAULT 'NGN' NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`tax` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`amount_paid` integer DEFAULT 0 NOT NULL,
	`amount_due` integer DEFAULT 0 NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`usage_cutoff_at` integer,
	`due_at` integer,
	`paid_at` integer,
	`description` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoices_org_idx` ON `invoices` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invoices_customer_idx` ON `invoices` (`customer_id`);--> statement-breakpoint
CREATE INDEX `invoices_status_idx` ON `invoices` (`status`);--> statement-breakpoint
CREATE TABLE `overage_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`billing_interval` text DEFAULT 'end_of_period' NOT NULL,
	`threshold_amount` integer,
	`auto_collect` integer DEFAULT false NOT NULL,
	`grace_period_hours` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `overage_settings_org_idx` ON `overage_settings` (`organization_id`);--> statement-breakpoint
CREATE TABLE `payment_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'NGN' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider` text,
	`provider_reference` text,
	`provider_metadata` text,
	`attempt_number` integer DEFAULT 1 NOT NULL,
	`next_retry_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payment_attempts_invoice_idx` ON `payment_attempts` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `payment_attempts_status_idx` ON `payment_attempts` (`status`);--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`token` text NOT NULL,
	`type` text DEFAULT 'card' NOT NULL,
	`card_last4` text,
	`card_brand` text,
	`card_exp_month` text,
	`card_exp_year` text,
	`is_default` integer DEFAULT true NOT NULL,
	`is_valid` integer DEFAULT true NOT NULL,
	`verified_at` integer,
	`invalidated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pm_customer_idx` ON `payment_methods` (`customer_id`);--> statement-breakpoint
CREATE INDEX `pm_org_idx` ON `payment_methods` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pm_customer_provider_token_uniq` ON `payment_methods` (`customer_id`,`provider_id`,`token`);--> statement-breakpoint
CREATE TABLE `plan_features` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`limit_value` integer,
	`reset_interval` text DEFAULT 'monthly' NOT NULL,
	`reset_on_enable` integer DEFAULT true NOT NULL,
	`rollover_enabled` integer DEFAULT false NOT NULL,
	`rollover_max_balance` integer,
	`usage_model` text DEFAULT 'included',
	`price_per_unit` integer,
	`billing_units` integer DEFAULT 1,
	`max_purchase_limit` integer,
	`credit_cost` integer DEFAULT 0,
	`overage` text DEFAULT 'block' NOT NULL,
	`overage_price` integer,
	`max_overage_units` integer,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_features_plan_idx` ON `plan_features` (`plan_id`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider_id` text,
	`provider_plan_id` text,
	`provider_metadata` text,
	`paystack_plan_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`price` integer NOT NULL,
	`currency` text DEFAULT 'NGN' NOT NULL,
	`interval` text DEFAULT 'monthly' NOT NULL,
	`type` text DEFAULT 'paid' NOT NULL,
	`billing_model` text DEFAULT 'base' NOT NULL,
	`billing_type` text DEFAULT 'recurring' NOT NULL,
	`auto_enable` integer DEFAULT false NOT NULL,
	`is_addon` integer DEFAULT false NOT NULL,
	`plan_group` text,
	`trial_days` integer DEFAULT 0,
	`trial_card_required` integer DEFAULT false,
	`is_active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`source` text DEFAULT 'dashboard' NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plans_org_idx` ON `plans` (`organization_id`);--> statement-breakpoint
CREATE INDEX `plans_group_idx` ON `plans` (`plan_group`);--> statement-breakpoint
CREATE TABLE `provider_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`environment` text NOT NULL,
	`display_name` text,
	`credentials` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `provider_accounts_org_idx` ON `provider_accounts` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_accounts_org_provider_env_uniq` ON `provider_accounts` (`organization_id`,`provider_id`,`environment`);--> statement-breakpoint
CREATE TABLE `provider_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`priority` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`provider_id` text NOT NULL,
	`conditions` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `provider_rules_org_idx` ON `provider_rules` (`organization_id`);--> statement-breakpoint
CREATE INDEX `provider_rules_priority_idx` ON `provider_rules` (`priority`);--> statement-breakpoint
CREATE TABLE `referral_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`code` text NOT NULL,
	`redemption_count` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `referral_programs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referral_codes_code_unique` ON `referral_codes` (`code`);--> statement-breakpoint
CREATE INDEX `referral_codes_program_idx` ON `referral_codes` (`program_id`);--> statement-breakpoint
CREATE INDEX `referral_codes_customer_idx` ON `referral_codes` (`customer_id`);--> statement-breakpoint
CREATE TABLE `referral_programs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`reward_id` text NOT NULL,
	`trigger_on` text DEFAULT 'signup' NOT NULL,
	`max_redemptions_per_referrer` integer,
	`reward_referrer` integer DEFAULT true NOT NULL,
	`reward_redeemer` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reward_id`) REFERENCES `rewards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `referral_programs_org_idx` ON `referral_programs` (`organization_id`);--> statement-breakpoint
CREATE TABLE `referral_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`code_id` text NOT NULL,
	`redeemer_id` text NOT NULL,
	`applied` integer DEFAULT false NOT NULL,
	`applied_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`code_id`) REFERENCES `referral_codes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`redeemer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `referral_redemptions_code_idx` ON `referral_redemptions` (`code_id`);--> statement-breakpoint
CREATE INDEX `referral_redemptions_redeemer_idx` ON `referral_redemptions` (`redeemer_id`);--> statement-breakpoint
CREATE TABLE `rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`type` text DEFAULT 'fixed' NOT NULL,
	`discount_amount` integer,
	`duration` text DEFAULT 'one_off' NOT NULL,
	`duration_months` integer,
	`rollover_credits` integer DEFAULT false,
	`applies_to_plans` text,
	`max_redemptions` integer,
	`current_redemptions` integer DEFAULT 0,
	`expires_at` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rewards_org_idx` ON `rewards` (`organization_id`);--> statement-breakpoint
CREATE INDEX `rewards_code_idx` ON `rewards` (`code`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`provider_id` text,
	`provider_subscription_id` text,
	`provider_subscription_code` text,
	`provider_metadata` text,
	`paystack_subscription_id` text,
	`paystack_subscription_code` text,
	`status` text DEFAULT 'active' NOT NULL,
	`current_period_start` integer NOT NULL,
	`current_period_end` integer NOT NULL,
	`cancel_at` integer,
	`canceled_at` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `subscriptions_customer_idx` ON `subscriptions` (`customer_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_status_idx` ON `subscriptions` (`status`);--> statement-breakpoint
CREATE TABLE `usage_daily_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `usage_summary_org_idx` ON `usage_daily_summaries` (`organization_id`);--> statement-breakpoint
CREATE INDEX `usage_summary_customer_idx` ON `usage_daily_summaries` (`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `usage_summary_unique_idx` ON `usage_daily_summaries` (`customer_id`,`feature_id`,`date`);--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`entity_id` text,
	`invoice_id` text,
	`amount` integer DEFAULT 1 NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `usage_customer_idx` ON `usage_records` (`customer_id`);--> statement-breakpoint
CREATE INDEX `usage_period_idx` ON `usage_records` (`customer_id`,`period_start`,`period_end`);--> statement-breakpoint
CREATE INDEX `usage_entity_idx` ON `usage_records` (`customer_id`,`feature_id`,`entity_id`);--> statement-breakpoint
CREATE INDEX `usage_invoice_idx` ON `usage_records` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`hash` text NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `api_keys_org_idx` ON `api_keys` (`organization_id`);--> statement-breakpoint
CREATE INDEX `api_keys_hash_idx` ON `api_keys` (`hash`);