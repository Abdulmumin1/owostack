ALTER TABLE `plans` ADD `type` text DEFAULT 'paid' NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `billing_model` text DEFAULT 'base' NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `billing_type` text DEFAULT 'recurring' NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `trial_card_required` integer DEFAULT false;