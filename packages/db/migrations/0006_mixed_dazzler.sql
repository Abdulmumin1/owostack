ALTER TABLE `features` ADD `meter_type` text DEFAULT 'consumable';--> statement-breakpoint
ALTER TABLE `plan_features` ADD `credit_cost` integer DEFAULT 0;