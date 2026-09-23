import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { bachsAdapter, dodoAdapter } from "@owostack/adapters";
import { WebhookHandler } from "../../../src/lib/webhooks";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
  insertSubscription,
} from "../helpers/workflow-runtime";
import { insertFeature, insertPlanFeature } from "../helpers/overage-runtime";

/**
 * Prorated plan-change charges are not renewals, and a staged (Bachs) plan
 * change must resolve from the provider's follow-up webhooks. Real adapters
 * parse payloads shaped like the ones the sandbox delivered; real handler;
 * real D1.
 */

const PERIOD_START = Date.parse("2026-09-23T15:45:48.000Z");
const PERIOD_END = Date.parse("2026-10-23T15:45:48.000Z");

function parseWith(adapter: typeof dodoAdapter | typeof bachsAdapter) {
  return (payload: Record<string, unknown>) => {
    const r = adapter.parseWebhookEvent({ payload });
    if (r.isErr()) throw new Error(r.error.message);
    return r.value;
  };
}

describe("proration payments and pending plan changes", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_1" });
    await insertCustomer(businessDb.d1, {
      id: "cust_1",
      organizationId: "org_1",
      email: "buyer@owostack.dev",
    });
    for (const [id, slug, price, provider, product] of [
      ["plan_pro", "pro", 1900, "dodopayments", "pdt_pro"],
      ["plan_business", "business", 4900, "dodopayments", "pdt_business"],
      ["plan_pro_b", "pro-bachs", 1900, "bachs", "prod_pro"],
      ["plan_business_b", "business-bachs", 4900, "bachs", "prod_business"],
    ] as const) {
      await insertPlan(businessDb.d1, {
        id,
        organizationId: "org_1",
        slug,
        name: slug,
        price,
        currency: "USD",
        interval: "monthly",
        planGroup: "main",
        providerId: provider,
        providerPlanId: product,
        paystackPlanId: null,
        type: "paid",
        billingType: "recurring",
      });
    }
    await insertFeature(businessDb.d1, {
      id: "feat_seats",
      organizationId: "org_1",
      slug: "seats",
      type: "metered",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_business_b_seats",
      planId: "plan_business_b",
      featureId: "feat_seats",
      limitValue: 10,
    });
  });

  afterEach(() => businessDb.close());

  const sub = () =>
    businessDb.db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.id, "sub_1"),
    });

  describe("Dodo: provider applied the change, then bills the difference", () => {
    const parse = parseWith(dodoAdapter);

    // What Dodo sent after changePlan: payment.succeeded carrying the
    // changePlan metadata (old/new plan, no plan_id) and no next_billing_date.
    const prorationPayment = {
      type: "payment.succeeded",
      data: {
        payload_type: "Payment",
        payment_id: "pay_0NoEiNziEb1SE5kl3zR00",
        subscription_id: "sub_dodo",
        status: "succeeded",
        total_amount: 2997,
        currency: "USD",
        created_at: "2026-09-23T16:29:24.000Z",
        customer: { customer_id: "cus_1", email: "buyer@owostack.dev" },
        metadata: {
          old_plan_id: "plan_pro",
          new_plan_id: "plan_business",
          organization_id: "org_1",
          environment: "test",
          provider_id: "dodopayments",
        },
      },
    };

    beforeEach(async () => {
      await insertSubscription(businessDb.d1, {
        id: "sub_1",
        customerId: "cust_1",
        planId: "plan_business", // executeSwitch already flipped it (Dodo applies immediately)
        providerId: "dodopayments",
        providerSubscriptionCode: "sub_dodo",
        status: "active",
        currentPeriodStart: PERIOD_START,
        currentPeriodEnd: PERIOD_END,
      });
    });

    it("does not advance the billing period or create a subscription", async () => {
      const handler = new WebhookHandler(businessDb.db, "org_1", {
        adapter: dodoAdapter,
      });
      const result = await handler.handle(parse(prorationPayment));
      expect(result.isOk()).toBe(true);

      const row = await sub();
      expect(row?.planId).toBe("plan_business");
      expect(row?.currentPeriodStart).toBe(PERIOD_START);
      expect(row?.currentPeriodEnd).toBe(PERIOD_END);
      expect(row?.metadata).toMatchObject({
        last_proration_payment: {
          reference: "pay_0NoEiNziEb1SE5kl3zR00",
          amount: 2997,
        },
      });

      const all = await businessDb.db.query.subscriptions.findMany({
        where: eq(schema.subscriptions.customerId, "cust_1"),
      });
      expect(all).toHaveLength(1);
    });
  });

  describe("Bachs: provider staged the change behind a proration invoice", () => {
    const parse = parseWith(bachsAdapter);
    const INVOICE = "inv_c6d0632c75fa413287ba";

    beforeEach(async () => {
      await insertSubscription(businessDb.d1, {
        id: "sub_1",
        customerId: "cust_1",
        planId: "plan_pro_b",
        providerId: "bachs",
        providerSubscriptionCode: "sub_bachs",
        status: "active",
        currentPeriodStart: PERIOD_START,
        currentPeriodEnd: PERIOD_END,
      });
      await businessDb.db
        .update(schema.subscriptions)
        .set({
          metadata: {
            pending_plan_change: {
              new_plan_id: "plan_business_b",
              old_plan_id: "plan_pro_b",
              provider_reference: INVOICE,
              staged_at: Date.now(),
            },
          },
        })
        .where(eq(schema.subscriptions.id, "sub_1"));
    });

    const handler = () =>
      new WebhookHandler(businessDb.db, "org_1", { adapter: bachsAdapter });

    it("applies the pending plan when the proration charge is collected", async () => {
      const r = await handler().handle(
        parse({
          id: "evt_1",
          type: "collection.succeeded",
          data: {
            charge_id: "ch_027e7ce7725443ccad65baf9ce133d11",
            subscription_id: "sub_bachs",
            billing_reason: "subscription_update",
            status: "succeeded",
            amount: "29.97",
            currency: "USD",
            customer: { id: "cust_b", email: "buyer@owostack.dev" },
            metadata: { organization_id: "org_1" },
          },
        }),
      );
      expect(r.isOk()).toBe(true);

      const row = await sub();
      expect(row?.planId).toBe("plan_business_b");
      expect(row?.status).toBe("active");
      expect(row?.currentPeriodEnd).toBe(PERIOD_END);
      expect((row?.metadata as any).pending_plan_change).toBeUndefined();
      expect(row?.metadata).toMatchObject({
        plan_change_applied_by: "proration_payment",
      });

      const entitlements = await businessDb.db.query.entitlements.findMany({
        where: eq(schema.entitlements.customerId, "cust_1"),
      });
      expect(entitlements.map((e) => e.featureId)).toEqual(["feat_seats"]);
    });

    it("clears the pending change and keeps the paid plan when the proration charge fails", async () => {
      const r = await handler().handle(
        parse({
          id: "evt_2",
          type: "invoice.payment_failed",
          data: {
            invoice_id: INVOICE,
            subscription: { subscription_id: "sub_bachs", status: "active" },
            charge: { id: "ch_failed", payment_id: "pay_failed" },
            total: "29.97",
            amount_remaining: "29.97",
            currency: "USD",
            customer: { id: "cust_b", email: "buyer@owostack.dev" },
          },
        }),
      );
      expect(r.isOk()).toBe(true);

      const row = await sub();
      expect(row?.planId).toBe("plan_pro_b");
      expect(row?.status).toBe("active"); // NOT past_due: current period is paid
      expect((row?.metadata as any).pending_plan_change).toBeUndefined();
      expect(row?.metadata).toMatchObject({
        failed_plan_change: { new_plan_id: "plan_business_b", reference: "pay_failed" },
      });
    });

    it("applies and clears the pending change when Bachs reports the new product on subscription.updated", async () => {
      const r = await handler().handle(
        parse({
          id: "evt_3",
          type: "customer.subscription.updated",
          data: {
            subscription_id: "sub_bachs",
            status: "active",
            product_id: "prod_business",
            product: { id: "prod_business", name: "Business (Bachs)" },
            amount: "49.00",
            currency: "USD",
            current_period_start: "2026-09-23T15:45:48.000Z",
            current_period_end: "2026-10-23T15:45:48.000Z",
            next_billed_at: "2026-10-23T15:45:48.000Z",
            customer: { customer_id: "cust_b", email: "buyer@owostack.dev" },
          },
        }),
      );
      expect(r.isOk()).toBe(true);

      const row = await sub();
      expect(row?.planId).toBe("plan_business_b");
      expect((row?.metadata as any).pending_plan_change).toBeUndefined();
      expect(row?.metadata).toMatchObject({
        plan_change_applied_by: "subscription_event",
      });
    });

    it("still marks a genuine renewal failure past_due", async () => {
      await businessDb.db
        .update(schema.subscriptions)
        .set({ metadata: {} })
        .where(eq(schema.subscriptions.id, "sub_1"));

      await handler().handle(
        parse({
          id: "evt_4",
          type: "invoice.payment_failed",
          data: {
            invoice_id: "inv_renewal",
            subscription: { subscription_id: "sub_bachs", status: "past_due" },
            charge: { id: "ch_r", payment_id: "pay_r" },
            total: "19.00",
            currency: "USD",
            customer: { id: "cust_b", email: "buyer@owostack.dev" },
          },
        }),
      );

      expect((await sub())?.status).toBe("past_due");
    });
  });
});
