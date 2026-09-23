import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { dodoAdapter } from "@owostack/adapters";
import { WebhookHandler } from "../../../src/lib/webhooks";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
} from "../helpers/workflow-runtime";

/**
 * Reproduces a sandbox incident: Dodo delivered `payment.succeeded` and
 * `subscription.active` for the same new subscription in the same second (and
 * retried both), and we ended up with two ACTIVE subscriptions for one
 * customer — one keyed by `sub_…`, one by the payment id `pay_…`.
 *
 * Real Dodo adapter parses the payloads; real WebhookHandler; real D1.
 */

const SUB = "sub_0NoEaSK9Ao2gvXxFLkzCm";
const PAY = "pay_0NoEaSJybOqgiJmYywcQK";
const PRODUCT = "pdt_0NoEYRjLe2uETUJzRV0Zn";

const checkoutMetadata = {
  type: "new_subscription",
  organization_id: "org_1",
  plan_id: "plan_pro_dodo",
  plan_slug: "pro-dodo",
  customer_id: "cust_dodo",
  environment: "test",
  provider_id: "dodopayments",
};

function paymentSucceeded() {
  return {
    business_id: "bus_1",
    type: "payment.succeeded",
    timestamp: "2026-09-23T15:47:44.000Z",
    data: {
      payload_type: "Payment",
      payment_id: PAY,
      subscription_id: SUB,
      status: "succeeded",
      total_amount: 1900,
      currency: "USD",
      created_at: "2026-09-23T15:47:43.000Z",
      customer: {
        customer_id: "cus_dodo_1",
        email: "pro.dodo@owostack.dev",
        name: "pro.dodo",
      },
      product_cart: [{ product_id: PRODUCT, quantity: 1 }],
      metadata: checkoutMetadata,
    },
  };
}

function subscriptionActive() {
  return {
    business_id: "bus_1",
    type: "subscription.active",
    timestamp: "2026-09-23T15:47:44.000Z",
    data: {
      payload_type: "Subscription",
      subscription_id: SUB,
      product_id: PRODUCT,
      status: "active",
      created_at: "2026-09-23T15:47:43.000Z",
      previous_billing_date: "2026-09-23T15:47:43.000Z",
      next_billing_date: "2026-10-23T15:47:43.000Z",
      recurring_pre_tax_amount: 1900,
      currency: "USD",
      customer: {
        customer_id: "cus_dodo_1",
        email: "pro.dodo@owostack.dev",
        name: "pro.dodo",
      },
      metadata: checkoutMetadata,
    },
  };
}

function parse(payload: Record<string, unknown>) {
  const result = dodoAdapter.parseWebhookEvent({ payload });
  if (result.isErr()) throw new Error(result.error.message);
  return result.value;
}

describe("Dodo first-payment webhooks: one subscription per provider subscription", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let handler: WebhookHandler;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_1" });
    await insertCustomer(businessDb.d1, {
      id: "cust_dodo",
      organizationId: "org_1",
      email: "pro.dodo@owostack.dev",
      providerId: null,
      providerCustomerId: null,
    });
    await insertPlan(businessDb.d1, {
      id: "plan_pro_dodo",
      organizationId: "org_1",
      slug: "pro-dodo",
      name: "Pro (Dodo)",
      price: 1900,
      currency: "USD",
      interval: "monthly",
      providerId: "dodopayments",
      providerPlanId: PRODUCT,
      paystackPlanId: null,
      type: "paid",
      billingType: "recurring",
    });
    handler = new WebhookHandler(businessDb.db, "org_1", {
      adapter: dodoAdapter,
    });
  });

  afterEach(() => businessDb.close());

  async function liveSubscriptions() {
    return businessDb.db.query.subscriptions.findMany({
      where: eq(schema.subscriptions.customerId, "cust_dodo"),
    });
  }

  it("keys the payment-created row by the provider subscription id, not the payment id", async () => {
    const result = await handler.handle(parse(paymentSucceeded()));
    expect(result.isOk()).toBe(true);

    const subs = await liveSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].providerSubscriptionCode).toBe(SUB);
    expect(subs[0].status).toBe("active");
  });

  it("creates exactly one active subscription when payment.succeeded and subscription.active race", async () => {
    const results = await Promise.all([
      handler.handle(parse(paymentSucceeded())),
      handler.handle(parse(subscriptionActive())),
      // Provider retries of both, still in flight.
      handler.handle(parse(paymentSucceeded())),
      handler.handle(parse(subscriptionActive())),
    ]);
    for (const r of results) expect(r.isOk()).toBe(true);

    const subs = await liveSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      planId: "plan_pro_dodo",
      providerId: "dodopayments",
      providerSubscriptionCode: SUB,
      status: "active",
    });
  });

  it("is idempotent when the same events arrive again later, in either order", async () => {
    await handler.handle(parse(subscriptionActive()));
    await handler.handle(parse(paymentSucceeded()));
    await handler.handle(parse(paymentSucceeded()));
    await handler.handle(parse(subscriptionActive()));

    const subs = await liveSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].providerSubscriptionCode).toBe(SUB);
  });
});
