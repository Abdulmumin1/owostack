CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`name` text,
	`email` text,
	`metadata` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entities_customer_idx` ON `entities` (`customer_id`);--> statement-breakpoint
CREATE INDEX `entities_feature_idx` ON `entities` (`feature_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entities_customer_feature_entity_idx` ON `entities` (`customer_id`,`feature_id`,`entity_id`);