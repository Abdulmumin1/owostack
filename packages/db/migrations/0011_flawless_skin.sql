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
CREATE UNIQUE INDEX `usage_summary_unique_idx` ON `usage_daily_summaries` (`customer_id`,`feature_id`,`date`);