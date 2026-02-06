ALTER TABLE `entitlements` ADD `entity_id` text;--> statement-breakpoint
CREATE INDEX `entitlements_entity_idx` ON `entitlements` (`customer_id`,`feature_id`,`entity_id`);--> statement-breakpoint
ALTER TABLE `usage_records` ADD `entity_id` text;--> statement-breakpoint
CREATE INDEX `usage_entity_idx` ON `usage_records` (`customer_id`,`feature_id`,`entity_id`);