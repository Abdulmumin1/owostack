CREATE UNIQUE INDEX `entitlements_manual_override_uniq_idx`
ON `entitlements` (`customer_id`, `feature_id`, `source`)
WHERE `entity_id` IS NULL
  AND (`source` = 'manual' OR `source` = 'manual_bonus');
