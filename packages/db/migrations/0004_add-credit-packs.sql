-- Add-on Credit Packs
CREATE TABLE IF NOT EXISTS `credit_packs` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `slug` text NOT NULL,
  `description` text,
  `credits` integer NOT NULL,
  `price` integer NOT NULL,
  `currency` text NOT NULL DEFAULT 'NGN',
  `is_active` integer NOT NULL DEFAULT 1,
  `provider_product_id` text,
  `provider_price_id` text,
  `provider_id` text,
  `metadata` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `credit_packs_org_idx` ON `credit_packs` (`organization_id`);
CREATE INDEX IF NOT EXISTS `credit_packs_slug_idx` ON `credit_packs` (`slug`);

-- Credit Purchase Ledger
CREATE TABLE IF NOT EXISTS `credit_purchases` (
  `id` text PRIMARY KEY NOT NULL,
  `customer_id` text NOT NULL REFERENCES `customers`(`id`) ON DELETE CASCADE,
  `credit_pack_id` text REFERENCES `credit_packs`(`id`),
  `credits` integer NOT NULL,
  `quantity` integer NOT NULL DEFAULT 1,
  `price` integer NOT NULL DEFAULT 0,
  `currency` text NOT NULL DEFAULT 'NGN',
  `payment_reference` text,
  `provider_id` text,
  `metadata` text,
  `created_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `credit_purchases_customer_idx` ON `credit_purchases` (`customer_id`);
CREATE INDEX IF NOT EXISTS `credit_purchases_pack_idx` ON `credit_purchases` (`credit_pack_id`);
