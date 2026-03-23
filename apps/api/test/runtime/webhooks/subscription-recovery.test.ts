import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookHandler } from "../../../src/lib/webhooks";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
  insertSubscription,
} from "../helpers/workflow-runtime";

type SubscriptionRow = {
  id: string;
  status: string;
  provider_subscription_code: string | null;
  current_period_start: number;
  current_period_end: number;
};

async function loadSubscription(
  db: D1Database,
  id: string,
): Promise<SubscriptionRow | null> {
  return db
    .prepare(
      `SELECT id, status, provider_subscription_code, current_period_start, current_period_end
       FROM subscriptions
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<SubscriptionRow>();
}

describe("Webhook subscription recovery runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let handler: WebhookHandler;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-23T12:00:00.000Z"));

    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_1" });
    handler = new WebhookHandler(businessDb.db, "org_1");
  });

  afterEach(() => {
    businessDb.close();
    vi.useRealTimers();
  });

  it("keeps renewal webhooks attached to the live row when a stale trial still exists", async () => {
    await insertCustomer(businessDb.d1, {
      id: "cust_1",
      organizationId: "org_1",
      providerId: "stripe",
      providerCustomerId: "cus_stripe_123",
      paystackCustomerId: null,
      paystackAuthorizationCode: null,
      email: "recover@example.com",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_1",
      organizationId: "org_1",
      providerId: "stripe",
      providerPlanId: "price_trial_1",
      paystackPlanId: null,
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_trial_old",
      customerId: "cust_1",
      planId: "plan_1",
      providerId: "stripe",
      providerSubscriptionCode: "trial-temp-1",
      status: "trialing",
      currentPeriodStart: new Date("2026-01-23T00:00:00.000Z").getTime(),
      currentPeriodEnd: new Date("2026-02-23T00:00:00.000Z").getTime(),
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_live_current",
      customerId: "cust_1",
      planId: "plan_1",
      providerId: "stripe",
      providerSubscriptionCode: "sub_live_existing",
      status: "active",
      currentPeriodStart: new Date("2026-02-23T00:00:00.000Z").getTime(),
      currentPeriodEnd: new Date("2026-03-23T00:00:00.000Z").getTime(),
    });

    const createdResult = await handler.handle({
      type: "subscription.created",
      provider: "stripe",
      customer: {
        email: "",
        providerCustomerId: "cus_stripe_123",
      },
      subscription: {
        providerCode: "sub_live_renewed",
        providerSubscriptionId: "sub_live_renewed",
        startDate: "2026-03-23T00:00:00.000Z",
        nextPaymentDate: "2026-04-23T00:00:00.000Z",
      },
      plan: {
        providerPlanCode: "price_trial_1",
      },
      metadata: {
        customer_email: "recover@example.com",
      },
      raw: { event: "customer.subscription.created" },
    } as any);

    expect(createdResult.isOk()).toBe(true);

    const trialAfterCreated = await loadSubscription(
      businessDb.d1,
      "sub_trial_old",
    );
    const liveAfterCreated = await loadSubscription(
      businessDb.d1,
      "sub_live_current",
    );

    expect(trialAfterCreated).toMatchObject({
      status: "trialing",
      provider_subscription_code: "trial-temp-1",
      current_period_end: new Date("2026-02-23T00:00:00.000Z").getTime(),
    });
    expect(liveAfterCreated).toMatchObject({
      status: "active",
      provider_subscription_code: "sub_live_renewed",
      current_period_end: new Date("2026-03-23T00:00:00.000Z").getTime(),
    });

    const activeResult = await handler.handle({
      type: "subscription.active",
      provider: "stripe",
      customer: {
        email: "",
        providerCustomerId: "cus_stripe_123",
      },
      subscription: {
        providerCode: "sub_live_renewed",
        providerSubscriptionId: "sub_live_renewed",
        status: "active",
        startDate: "2026-03-23T00:00:00.000Z",
        nextPaymentDate: "2026-04-23T00:00:00.000Z",
      },
      plan: {
        providerPlanCode: "price_trial_1",
      },
      metadata: {
        customer_email: "recover@example.com",
      },
      raw: { event: "customer.subscription.updated" },
    } as any);

    expect(activeResult.isOk()).toBe(true);

    const trialAfterRenewal = await loadSubscription(businessDb.d1, "sub_trial_old");
    const liveAfterRenewal = await loadSubscription(
      businessDb.d1,
      "sub_live_current",
    );

    expect(trialAfterRenewal).toMatchObject({
      status: "trialing",
      provider_subscription_code: "trial-temp-1",
      current_period_start: new Date("2026-01-23T00:00:00.000Z").getTime(),
      current_period_end: new Date("2026-02-23T00:00:00.000Z").getTime(),
    });
    expect(liveAfterRenewal).toMatchObject({
      status: "active",
      provider_subscription_code: "sub_live_renewed",
      current_period_start: new Date("2026-03-23T00:00:00.000Z").getTime(),
      current_period_end: new Date("2026-04-23T00:00:00.000Z").getTime(),
    });
  });

  it("still promotes the only expired trial row when it is the sole candidate", async () => {
    await insertCustomer(businessDb.d1, {
      id: "cust_2",
      organizationId: "org_1",
      providerId: "stripe",
      providerCustomerId: "cus_stripe_456",
      paystackCustomerId: null,
      paystackAuthorizationCode: null,
      email: "trial@example.com",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_2",
      organizationId: "org_1",
      providerId: "stripe",
      providerPlanId: "price_trial_2",
      paystackPlanId: null,
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_trial_only",
      customerId: "cust_2",
      planId: "plan_2",
      providerId: "stripe",
      providerSubscriptionCode: "trial-temp-2",
      status: "trialing",
      currentPeriodStart: new Date("2026-02-01T00:00:00.000Z").getTime(),
      currentPeriodEnd: new Date("2026-03-01T00:00:00.000Z").getTime(),
    });

    const result = await handler.handle({
      type: "subscription.active",
      provider: "stripe",
      customer: {
        email: "",
        providerCustomerId: "cus_stripe_456",
      },
      subscription: {
        providerCode: "sub_live_456",
        providerSubscriptionId: "sub_live_456",
        status: "active",
        startDate: "2026-03-23T00:00:00.000Z",
        nextPaymentDate: "2026-04-23T00:00:00.000Z",
      },
      plan: {
        providerPlanCode: "price_trial_2",
      },
      metadata: {
        customer_email: "trial@example.com",
      },
      raw: { event: "customer.subscription.updated" },
    } as any);

    expect(result.isOk()).toBe(true);

    const recovered = await loadSubscription(businessDb.d1, "sub_trial_only");
    expect(recovered).toMatchObject({
      status: "active",
      provider_subscription_code: "sub_live_456",
      current_period_start: new Date("2026-03-23T00:00:00.000Z").getTime(),
      current_period_end: new Date("2026-04-23T00:00:00.000Z").getTime(),
    });
  });
});
