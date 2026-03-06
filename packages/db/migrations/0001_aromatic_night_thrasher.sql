ALTER TABLE `entitlements` ADD `source` text DEFAULT 'plan' NOT NULL;--> statement-breakpoint
ALTER TABLE `entitlements` ADD `granted_by` text;--> statement-breakpoint
ALTER TABLE `entitlements` ADD `granted_reason` text;