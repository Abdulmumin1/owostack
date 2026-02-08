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
CREATE INDEX `csb_customer_system_idx` ON `credit_system_balances` (`customer_id`,`credit_system_id`);--> statement-breakpoint
ALTER TABLE `credit_packs` ADD `credit_system_id` text REFERENCES credit_systems(id);--> statement-breakpoint
ALTER TABLE `credit_purchases` ADD `credit_system_id` text REFERENCES credit_systems(id);