CREATE TABLE `customer_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`alias` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `customer_aliases_customer_idx` ON `customer_aliases` (`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `customer_aliases_org_alias_uniq` ON `customer_aliases` (`organization_id`,`alias`);
