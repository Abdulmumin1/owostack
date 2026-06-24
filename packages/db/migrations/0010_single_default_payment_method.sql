UPDATE payment_methods
SET is_default = 0,
    updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE is_default = 1
  AND id IN (
    SELECT id
    FROM (
      SELECT
        id,
        row_number() OVER (
          PARTITION BY customer_id, organization_id
          ORDER BY
            COALESCE(verified_at, 0) DESC,
            updated_at DESC,
            created_at DESC,
            id DESC
        ) AS rank
      FROM payment_methods
      WHERE is_default = 1
    )
    WHERE rank > 1
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `pm_customer_org_default_uniq`
ON `payment_methods` (`customer_id`, `organization_id`)
WHERE `is_default` = 1;
