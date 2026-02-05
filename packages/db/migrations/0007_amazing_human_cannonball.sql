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
ALTER TABLE `plan_features` ADD `reset_on_enable` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `plan_features` ADD `rollover_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `plan_features` ADD `rollover_max_balance` integer;--> statement-breakpoint
ALTER TABLE `plan_features` ADD `usage_model` text DEFAULT 'included';--> statement-breakpoint
ALTER TABLE `plan_features` ADD `price_per_unit` integer;--> statement-breakpoint
ALTER TABLE `plan_features` ADD `billing_units` integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE `plan_features` ADD `max_purchase_limit` integer;--> statement-breakpoint
ALTER TABLE `plans` ADD `auto_enable` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `is_addon` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `plan_group` text;--> statement-breakpoint
ALTER TABLE `plans` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `plans_group_idx` ON `plans` (`plan_group`);