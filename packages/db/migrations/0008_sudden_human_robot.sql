CREATE TABLE `credit_system_features` (
	`id` text PRIMARY KEY NOT NULL,
	`credit_system_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`cost` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`credit_system_id`) REFERENCES `credit_systems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cs_features_cs_idx` ON `credit_system_features` (`credit_system_id`);--> statement-breakpoint
CREATE INDEX `cs_features_feature_idx` ON `credit_system_features` (`feature_id`);--> statement-breakpoint
CREATE TABLE `credit_systems` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `credit_systems_org_idx` ON `credit_systems` (`organization_id`);