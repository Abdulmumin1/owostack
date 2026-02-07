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
ALTER TABLE `usage_records` ADD `invoice_id` text;--> statement-breakpoint
CREATE INDEX `usage_invoice_idx` ON `usage_records` (`invoice_id`);