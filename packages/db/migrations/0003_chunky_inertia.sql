PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`paystack_customer_id` text,
	`external_id` text,
	`email` text NOT NULL,
	`name` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_customers`("id", "organization_id", "paystack_customer_id", "external_id", "email", "name", "metadata", "created_at", "updated_at") SELECT "id", "organization_id", "paystack_customer_id", "external_id", "email", "name", "metadata", "created_at", "updated_at" FROM `customers`;--> statement-breakpoint
DROP TABLE `customers`;--> statement-breakpoint
ALTER TABLE `__new_customers` RENAME TO `customers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `customers_org_idx` ON `customers` (`organization_id`);--> statement-breakpoint
CREATE INDEX `customers_email_idx` ON `customers` (`email`);--> statement-breakpoint
CREATE INDEX `customers_external_idx` ON `customers` (`external_id`);--> statement-breakpoint
CREATE TABLE `__new_events` (
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
INSERT INTO `__new_events`("id", "organization_id", "type", "customer_id", "data", "processed", "created_at") SELECT "id", "organization_id", "type", "customer_id", "data", "processed", "created_at" FROM `events`;--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;--> statement-breakpoint
CREATE INDEX `events_org_idx` ON `events` (`organization_id`);--> statement-breakpoint
CREATE INDEX `events_processed_idx` ON `events` (`processed`);--> statement-breakpoint
CREATE TABLE `__new_features` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`type` text DEFAULT 'metered' NOT NULL,
	`unit` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_features`("id", "organization_id", "name", "slug", "description", "type", "unit", "created_at") SELECT "id", "organization_id", "name", "slug", "description", "type", "unit", "created_at" FROM `features`;--> statement-breakpoint
DROP TABLE `features`;--> statement-breakpoint
ALTER TABLE `__new_features` RENAME TO `features`;--> statement-breakpoint
CREATE INDEX `features_org_idx` ON `features` (`organization_id`);--> statement-breakpoint
CREATE TABLE `__new_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`paystack_plan_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`price` integer NOT NULL,
	`currency` text DEFAULT 'NGN' NOT NULL,
	`interval` text DEFAULT 'monthly' NOT NULL,
	`trial_days` integer DEFAULT 0,
	`is_active` integer DEFAULT true NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_plans`("id", "organization_id", "paystack_plan_id", "name", "slug", "description", "price", "currency", "interval", "trial_days", "is_active", "metadata", "created_at", "updated_at") SELECT "id", "organization_id", "paystack_plan_id", "name", "slug", "description", "price", "currency", "interval", "trial_days", "is_active", "metadata", "created_at", "updated_at" FROM `plans`;--> statement-breakpoint
DROP TABLE `plans`;--> statement-breakpoint
ALTER TABLE `__new_plans` RENAME TO `plans`;--> statement-breakpoint
CREATE INDEX `plans_org_idx` ON `plans` (`organization_id`);