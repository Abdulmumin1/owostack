CREATE TABLE `billing_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`trigger` text DEFAULT 'threshold' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`idempotency_key` text NOT NULL,
	`active_lock_key` text,
	`threshold_amount` integer,
	`usage_window_start` integer,
	`usage_window_end` integer NOT NULL,
	`invoice_id` text,
	`failure_reason` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `billing_runs_org_idx` ON `billing_runs` (`organization_id`);--> statement-breakpoint
CREATE INDEX `billing_runs_customer_idx` ON `billing_runs` (`customer_id`);--> statement-breakpoint
CREATE INDEX `billing_runs_status_idx` ON `billing_runs` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_runs_idempotency_key_idx` ON `billing_runs` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_runs_active_lock_key_idx` ON `billing_runs` (`active_lock_key`);--> statement-breakpoint
CREATE TABLE `customer_overage_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`billing_run_id` text,
	`invoice_id` text,
	`reason` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`billing_run_id`) REFERENCES `billing_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_overage_blocks_customer_idx` ON `customer_overage_blocks` (`customer_id`);--> statement-breakpoint
CREATE INDEX `customer_overage_blocks_org_idx` ON `customer_overage_blocks` (`organization_id`);--> statement-breakpoint
CREATE INDEX `customer_overage_blocks_invoice_idx` ON `customer_overage_blocks` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `customer_overage_blocks_run_idx` ON `customer_overage_blocks` (`billing_run_id`);--> statement-breakpoint
ALTER TABLE `invoices` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `usage_window_start` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `usage_window_end` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_idempotency_key_idx` ON `invoices` (`idempotency_key`);