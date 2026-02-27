// Test script to verify pipeline is working
// Run: curl http://localhost:8787/api/test-analytics

export async function testAnalytics(env: any) {
  // Test HTTP request tracking
  const analytics = await import("../../lib/analytics-engine");

  analytics.trackHttpMetric(env, {
    method: "GET",
    path: "/api/test",
    status: 200,
    durationMs: 150,
    organizationId: "test-org-123",
    providerId: "stripe",
  });

  // Test business event
  analytics.trackBusinessEvent(env, {
    event: "payment.success",
    outcome: "success",
    organizationId: "test-org-123",
    providerId: "stripe",
    customerId: "cus_test",
    currency: "USD",
    value: 99.99,
  });

  // Test webhook event
  analytics.trackWebhookEvent(env, {
    id: "evt_test_" + Date.now(),
    organizationId: "test-org-123",
    type: "invoice.payment_succeeded",
    providerId: "stripe",
    customerEmail: "test@example.com",
    customerId: "cus_test",
    processed: true,
    payload: { test: true, amount: 9999 },
    createdAt: Date.now(),
  });

  return {
    success: true,
    message: "Events tracked - check your R2 bucket in ~60 seconds",
    pipeline: "cfe7efb446fb450c8ad07179e9e3a696",
  };
}
