CREATE TABLE `customer_feature_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL REFERENCES `customers`(`id`) ON DELETE cascade,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
	`feature_id` text NOT NULL REFERENCES `features`(`id`) ON DELETE cascade,
	`overage` text,
	`max_overage_units` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_feature_configs_customer_feature_idx` ON `customer_feature_configs` (`customer_id`,`feature_id`);
--> statement-breakpoint
CREATE INDEX `customer_feature_configs_org_idx` ON `customer_feature_configs` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `customer_feature_configs_feature_idx` ON `customer_feature_configs` (`feature_id`);
