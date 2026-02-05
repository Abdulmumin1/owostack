PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`test_secret_key` text,
	`test_public_key` text,
	`test_webhook_secret` text,
	`live_secret_key` text,
	`live_public_key` text,
	`live_webhook_secret` text,
	`active_environment` text DEFAULT 'test' NOT NULL,
	`paystack_secret_key` text,
	`paystack_public_key` text,
	`webhook_secret` text,
	`environment` text DEFAULT 'test',
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "organization_id", "name", "slug", "test_secret_key", "test_public_key", "test_webhook_secret", "live_secret_key", "live_public_key", "live_webhook_secret", "active_environment", "paystack_secret_key", "paystack_public_key", "webhook_secret", "environment", "metadata", "created_at", "updated_at") SELECT "id", "organization_id", "name", "slug", "test_secret_key", "test_public_key", "test_webhook_secret", "live_secret_key", "live_public_key", "live_webhook_secret", "active_environment", "paystack_secret_key", "paystack_public_key", "webhook_secret", "environment", "metadata", "created_at", "updated_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `projects_org_idx` ON `projects` (`organization_id`);