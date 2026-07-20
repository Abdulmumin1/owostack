ALTER TABLE `credit_purchases` ADD `status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `credit_purchases` ADD `applied_at` integer;
