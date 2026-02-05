PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`hash` text NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_api_keys`("id", "organization_id", "name", "prefix", "hash", "last_used_at", "expires_at", "created_at", "revoked_at") SELECT "id", "organization_id", "name", "prefix", "hash", "last_used_at", "expires_at", "created_at", "revoked_at" FROM `api_keys`;--> statement-breakpoint
DROP TABLE `api_keys`;--> statement-breakpoint
ALTER TABLE `__new_api_keys` RENAME TO `api_keys`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `api_keys_org_idx` ON `api_keys` (`organization_id`);--> statement-breakpoint
CREATE INDEX `api_keys_hash_idx` ON `api_keys` (`hash`);