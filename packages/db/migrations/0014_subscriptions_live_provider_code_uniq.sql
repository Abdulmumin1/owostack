-- One live subscription row per provider subscription code. Guards the
-- webhook check-then-insert race (payment.succeeded vs subscription.active,
-- provider retries). Sentinel codes and NULL codes (free plans) stay repeatable.
CREATE UNIQUE INDEX IF NOT EXISTS `subscriptions_live_provider_code_uniq`
  ON `subscriptions` (`provider_id`, `provider_subscription_code`)
  WHERE `provider_subscription_code` IS NOT NULL
    AND `provider_subscription_code` NOT IN ('one-time', 'charge')
    AND `status` IN ('active', 'trialing', 'pending', 'past_due', 'pending_cancel');
