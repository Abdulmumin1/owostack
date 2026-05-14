const RESERVED_BILLING_METADATA_KEYS = new Set([
  "type",
  "invoice_id",
  "subscription_id",
  "old_subscription_id",
  "new_plan_id",
  "old_plan_id",
  "plan_id",
  "plan_slug",
  "customer_id",
  "organization_id",
  "pending_activation",
  "prorated_amount",
  "provider_id",
  "environment",
]);

export function mergeBillingMetadata(
  userMetadata: Record<string, unknown> | undefined,
  reservedMetadata: Record<string, unknown>,
) {
  const safeUserMetadata = Object.fromEntries(
    Object.entries(userMetadata || {}).filter(
      ([key]) => !RESERVED_BILLING_METADATA_KEYS.has(key),
    ),
  );

  return {
    ...safeUserMetadata,
    ...reservedMetadata,
  };
}
