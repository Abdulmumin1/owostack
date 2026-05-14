import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebhookHandler } from "../../../src/lib/webhooks";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
  insertSubscription,
} from "../helpers/workflow-runtime";

type SubscriptionStatusRow = {
  status: string;
};

async function loadSubscriptionStatus(
  db: D1Database,
  id: string,
): Promise<SubscriptionStatusRow | null> {
  return db
    .prepare(`SELECT status FROM subscriptions WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<SubscriptionStatusRow>();
}

describe("Webhook charge.success organization scoping", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let handler: WebhookHandler;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_1" });
    await insertOrganization(businessDb.d1, { id: "org_2" });

    await insertCustomer(businessDb.d1, {
      id: "cust_org_1",
      organizationId: "org_1",
      providerId: "stripe",
      providerCustomerId: "cus_org_1",
      paystackCustomerId: null,
      paystackAuthorizationCode: null,
      email: "owner@example.com",
    });

    await insertCustomer(businessDb.d1, {
      id: "cust_org_2",
      organizationId: "org_2",
      providerId: "stripe",
      providerCustomerId: "cus_org_2",
      paystackCustomerId: null,
      paystackAuthorizationCode: null,
      email: "victim@example.com",
    });

    await insertPlan(businessDb.d1, {
      id: "plan_org_2",
      organizationId: "org_2",
      providerId: "stripe",
      providerPlanId: "price_org_2",
      paystackPlanId: null,
      name: "Victim Plan",
      slug: "victim-plan",
      price: 5000,
      currency: "USD",
    });

    await insertSubscription(businessDb.d1, {
      id: "sub_org_2_pending",
      customerId: "cust_org_2",
      planId: "plan_org_2",
      providerId: "stripe",
      status: "pending",
    });

    handler = new WebhookHandler(businessDb.db, "org_1");
  });

  afterEach(() => {
    businessDb.close();
  });

  it("ignores pending activation metadata that points at another organization's subscription", async () => {
    const result = await handler.handle({
      type: "charge.success",
      provider: "stripe",
      customer: {
        email: "owner@example.com",
        providerCustomerId: "cus_org_1",
      },
      payment: {
        amount: 5000,
        currency: "USD",
        paidAt: "2026-03-23T00:00:00.000Z",
        reference: "pay_ref_1",
      },
      subscription: {
        providerCode: "sub_remote_1",
        providerSubscriptionId: "sub_remote_1",
        nextPaymentDate: "2026-04-23T00:00:00.000Z",
      },
      metadata: {
        pending_activation: "true",
        subscription_id: "sub_org_2_pending",
        plan_id: "plan_org_2",
      },
      raw: { event: "checkout.session.completed" },
    } as any);

    expect(result.isOk()).toBe(true);
    expect(
      await loadSubscriptionStatus(businessDb.d1, "sub_org_2_pending"),
    ).toEqual({ status: "pending" });
  });
});
