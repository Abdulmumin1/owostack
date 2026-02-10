CREATE TABLE `payment_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`token` text NOT NULL,
	`type` text DEFAULT 'card' NOT NULL,
	`card_last4` text,
	`card_brand` text,
	`card_exp_month` text,
	`card_exp_year` text,
	`is_default` integer DEFAULT true NOT NULL,
	`is_valid` integer DEFAULT true NOT NULL,
	`verified_at` integer,
	`invalidated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pm_customer_idx` ON `payment_methods` (`customer_id`);--> statement-breakpoint
CREATE INDEX `pm_org_idx` ON `payment_methods` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pm_customer_provider_token_uniq` ON `payment_methods` (`customer_id`,`provider_id`,`token`);