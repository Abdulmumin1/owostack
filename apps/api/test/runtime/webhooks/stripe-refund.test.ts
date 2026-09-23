import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { stripeAdapter } from "@owostack/adapters";
import { WebhookHandler } from "../../../src/lib/webhooks";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
} from "../helpers/workflow-runtime";
import { insertFeature, insertPlanFeature } from "../helpers/overage-runtime";

/**
 * Sandbox: refunding the Stripe checkout charge from the API produced a
 * `charge.refunded` with empty metadata, no `invoice`, no embedded refunds
 * list (API 2026-02-25.clover) — and nothing happened on our side. The row
 * had been created by checkout.session.completed, whose payment reference is
 * the payment_intent. Real adapter, real handler, real D1.
 */

const PI = "pi_3UIsoqK5fox6jwYt1Nj5wVdt";
const SUB = "sub_1UIsopK5fox6jwYt";

function parse(payload: Record<string, unknown>) {
  const r = stripeAdapter.parseWebhookEvent({ payload });
  if (r.isErr()) throw new Error(r.error.message);
  return r.value;
}

const checkoutCompleted = {
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_a1",
      object: "checkout.session",
      mode: "subscription",
      payment_status: "paid",
      amount_total: 1900,
      currency: "usd",
      customer: "cus_VJVqx2r2ylFBqV",
      customer_details: { email: "pro.stripe2@owostack.dev" },
      payment_intent: PI,
      subscription: SUB,
      created: 1790180000,
      metadata: {
        type: "new_subscription",
        organization_id: "org_1",
        plan_id: "plan_pro",
        customer_id: "cust_stripe",
        provider_id: "stripe",
        provider_plan_id: "price_pro",
      },
    },
  },
};

const chargeRefunded = (overrides: Record<string, unknown> = {}) => ({
  type: "charge.refunded",
  data: {
    object: {
      id: "ch_3UIsoqK5fox6jwYt13QqQ96N",
      object: "charge",
      amount: 1900,
      amount_refunded: 1900,
      currency: "usd",
      customer: "cus_VJVqx2r2ylFBqV",
      invoice: null,
      payment_intent: PI,
      refunded: true,
      paid: true,
      billing_details: { email: "pro.stripe2@owostack.dev" },
      metadata: {},
      ...overrides,
    },
  },
});

describe("Stripe refund of a checkout charge", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let handler: WebhookHandler;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_1" });
    await insertCustomer(businessDb.d1, {
      id: "cust_stripe",
      organizationId: "org_1",
      email: "pro.stripe2@owostack.dev",
      providerId: "stripe",
      providerCustomerId: "cus_VJVqx2r2ylFBqV",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_pro",
      organizationId: "org_1",
      slug: "pro-stripe",
      name: "Pro (Stripe)",
      price: 1900,
      currency: "USD",
      providerId: "stripe",
      providerPlanId: "price_pro",
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
    handler = new WebhookHandler(businessDb.db, "org_1", { adapter: stripeAdapter });
    expect((await handler.handle(parse(checkoutCompleted))).isOk()).toBe(true);
  });

  afterEach(() => businessDb.close());

  const sub = () =>
    businessDb.db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.customerId, "cust_stripe"),
    });

  it("exposes the payment and full/partial flag on the normalized event", () => {
    const ev = parse(chargeRefunded());
    expect(ev.type).toBe("refund.success");
    expect(ev.payment?.reference).toBe(PI);
    expect(ev.refund?.isPartial).toBe(false);
    expect(ev.metadata.charge_id).toBe("ch_3UIsoqK5fox6jwYt13QqQ96N");
  });

  it("revokes the subscription created by checkout.session.completed on a full refund", async () => {
    expect((await sub())?.status).toBe("active");

    const result = await handler.handle(parse(chargeRefunded()));
    expect(result.isOk()).toBe(true);

    const row = await sub();
    expect(row?.status).toBe("refunded");
    const ent = await businessDb.db.query.entitlements.findMany({
      where: eq(schema.entitlements.customerId, "cust_stripe"),
    });
    expect(ent).toHaveLength(0);
  });

  it("records a partial refund (refunded: false) without revoking", async () => {
    await handler.handle(parse(chargeRefunded({ amount_refunded: 500, refunded: false })));
    const row = await sub();
    expect(row?.status).toBe("active");
    expect(row?.metadata).toMatchObject({ refunds: [{ amount: 500, currency: "USD" }] });
  });
});
