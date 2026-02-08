DROP INDEX `csb_customer_system_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `csb_customer_system_idx` ON `credit_system_balances` (`customer_id`,`credit_system_id`);