-- Pipeline SQL transform for owostack-events
-- Routes events to appropriate Iceberg tables based on _table field

-- HTTP Requests table
INSERT INTO http_requests
SELECT
  timestamp,
  environment,
  method,
  path,
  status,
  status_bucket,
  duration_ms,
  organization_id,
  provider_id
FROM owostack_events
WHERE _table = 'http_requests';

-- Business Events table
INSERT INTO business_events
SELECT
  timestamp,
  environment,
  event,
  outcome,
  organization_id,
  provider_id,
  customer_id,
  currency,
  value
FROM owostack_events
WHERE _table = 'business_events';

-- Usage Events table
INSERT INTO usage_events
SELECT
  timestamp,
  environment,
  customer_id,
  feature_id,
  amount,
  organization_id,
  period_start,
  period_end,
  entity_id,
  invoice_id
FROM owostack_events
WHERE _table = 'usage_events';

-- Webhook Events table
INSERT INTO webhook_events
SELECT
  timestamp,
  environment,
  event_id,
  organization_id,
  event_type,
  provider_id,
  customer_email,
  customer_id,
  processed,
  payload,
  created_at
FROM owostack_events
WHERE _table = 'webhook_events';
