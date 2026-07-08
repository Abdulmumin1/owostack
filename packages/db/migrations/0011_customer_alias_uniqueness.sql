CREATE UNIQUE INDEX `customers_org_email_uniq` ON `customers` (`organization_id`, `email`);--> statement-breakpoint
CREATE UNIQUE INDEX `customers_org_external_uniq` ON `customers` (`organization_id`, `external_id`) WHERE `external_id` IS NOT NULL;
