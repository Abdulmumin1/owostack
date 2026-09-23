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
import { insertFeature, insertPlanFeature } from "../helpers/overage-runtime";

/**
 * Sandbox incident: refunding the $19 Dodo checkout payment did nothing.
 *  1. the refund webhook has no checkout metadata (routing — see the route test)
 *  2. the handler correlated on the refund id (`ref_…`) instead of the payment
 *  3. checkout payments have no payment_attempt row, so nothing matched
 *  4. Dodo reports the amount in the customer's currency (₦26,163 for a $19
 *     plan), so an amount comparison could never say "full refund"
 *
 * Real Dodo adapter, real handler, real D1.
 */

const PAYMENT = "pay_0NoEaSJybOqgiJmYywcQK";
const SUB = "sub_0NoEaSK9Ao2gvXxFLkzCm";

function parse(payload: Record<string, unknown>) {
  const r = dodoAdapter.parseWebhookEvent({ payload });
  if (r.isErr()) throw new Error(r.error.message);
  return r.value;
}

const firstPayment = {
  type: "payment.succeeded",
  data: {
    payload_type: "Payment",
    payment_id: PAYMENT,
    subscription_id: SUB,
    status: "succeeded",
    total_amount: 1900,
    currency: "USD",
    created_at: "2026-09-23T15:47:43.000Z",
    customer: { customer_id: "cus_0NoEaSJooW061VPPncTSS", email: "pro.dodo@owostack.dev" },
    product_cart: [{ product_id: "pdt_pro", quantity: 1 }],
    metadata: {
      type: "new_subscription",
      organization_id: "org_1",
      plan_id: "plan_pro",
      customer_id: "cust_dodo",
      provider_id: "dodopayments",
    },
  },
};

// Exactly what Dodo delivered for the refund.
const refundSucceeded = (overrides: Record<string, unknown> = {}) => ({
  type: "refund.succeeded",
  data: {
    payload_type: "Refund",
    refund_id: "ref_0NoFA2qXB8JYuPzSl6ZZH",
    payment_id: PAYMENT,
    business_id: "bus_1",
    amount: 2616323,
    currency: "NGN",
    status: "succeeded",
    reason: "lifecycle test",
    is_partial: false,
    created_at: "2026-09-23T18:54:50.763264Z",
    metadata: {},
    customer: { customer_id: "cus_0NoEaSJooW061VPPncTSS", email: "pro.dodo@owostack.dev" },
    ...overrides,
  },
});

describe("Dodo refund of a checkout payment", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let handler: WebhookHandler;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_1" });
    await insertCustomer(businessDb.d1, {
      id: "cust_dodo",
      organizationId: "org_1",
      email: "pro.dodo@owostack.dev",
      providerId: "dodopayments",
      providerCustomerId: "cus_0NoEaSJooW061VPPncTSS",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_pro",
      organizationId: "org_1",
      slug: "pro-dodo",
      name: "Pro (Dodo)",
      price: 1900,
      currency: "USD",
      providerId: "dodopayments",
      providerPlanId: "pdt_pro",
      paystackPlanId: null,
      type: "paid",
      billingType: "recurring",
    });
    await insertFeature(businessDb.d1, {
      id: "feat_analytics",
      organizationId: "org_1",
      slug: "analytics",
      type: "boolean",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_analytics",
      planId: "plan_pro",
      featureId: "feat_analytics",
      limitValue: null,
    });
    handler = new WebhookHandler(businessDb.db, "org_1", { adapter: dodoAdapter });

    // Subscribe through the real first-payment webhook so the row carries
    // whatever references production rows carry.
    expect((await handler.handle(parse(firstPayment))).isOk()).toBe(true);
  });

  afterEach(() => businessDb.close());

  const sub = () =>
    businessDb.db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.customerId, "cust_dodo"),
    });
  const entitlements = () =>
    businessDb.db.query.entitlements.findMany({
      where: eq(schema.entitlements.customerId, "cust_dodo"),
    });

  it("revokes the subscription on a full refund even though the amount is in another currency", async () => {
    expect((await sub())?.status).toBe("active");
    expect(await entitlements()).toHaveLength(1);

    const result = await handler.handle(parse(refundSucceeded()));
    expect(result.isOk()).toBe(true);

    const row = await sub();
    expect(row?.status).toBe("refunded");
    expect(row?.canceledAt).toBeTruthy();
    expect(await entitlements()).toHaveLength(0);
  });

  it("records a partial refund without revoking access", async () => {
    const result = await handler.handle(
      parse(refundSucceeded({ amount: 500000, is_partial: true })),
    );
    expect(result.isOk()).toBe(true);

    const row = await sub();
    expect(row?.status).toBe("active");
    expect(row?.metadata).toMatchObject({
      refunds: [{ reference: PAYMENT, currency: "NGN", amount: 500000 }],
    });
    expect(await entitlements()).toHaveLength(1);
  });

  it("ignores a refund for a payment this customer never made", async () => {
    await handler.handle(
      parse(refundSucceeded({ payment_id: "pay_someone_else" })),
    );
    expect((await sub())?.status).toBe("active");
    expect(await entitlements()).toHaveLength(1);
  });
});
