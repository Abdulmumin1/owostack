CREATE TABLE `credit_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`credits` integer NOT NULL,
	`price` integer NOT NULL,
	`currency` text DEFAULT 'NGN' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`provider_product_id` text,
	`provider_price_id` text,
	`provider_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `credit_packs_org_idx` ON `credit_packs` (`organization_id`);--> statement-breakpoint
CREATE INDEX `credit_packs_slug_idx` ON `credit_packs` (`slug`);--> statement-breakpoint
CREATE TABLE `credit_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`credit_pack_id` text,
	`credits` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`price` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'NGN' NOT NULL,
	`payment_reference` text,
	`provider_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credit_pack_id`) REFERENCES `credit_packs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `credit_purchases_customer_idx` ON `credit_purchases` (`customer_id`);--> statement-breakpoint
CREATE INDEX `credit_purchases_pack_idx` ON `credit_purchases` (`credit_pack_id`);