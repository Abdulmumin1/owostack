ALTER TABLE `features` ADD `source` text DEFAULT 'dashboard' NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `source` text DEFAULT 'dashboard' NOT NULL;