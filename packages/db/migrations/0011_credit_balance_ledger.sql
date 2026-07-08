CREATE TABLE `credit_balance_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`credit_system_id` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `credit_purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credit_system_id`) REFERENCES `credit_systems`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_balance_ledger_purchase_uniq` ON `credit_balance_ledger` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `credit_balance_ledger_balance_idx` ON `credit_balance_ledger` (`customer_id`,`credit_system_id`);
