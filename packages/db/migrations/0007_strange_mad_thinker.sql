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
ALTER TABLE `plan_features` ADD `max_overage_units` integer;