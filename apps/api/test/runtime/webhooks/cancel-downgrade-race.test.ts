import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { dodoAdapter } from "@owostack/adapters";
import { WebhookHandler } from "../../../src/lib/webhooks";
import { claimCancelDowngrade } from "../../../src/lib/cancel-downgrade-claim";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
  insertSubscription,
} from "../helpers/workflow-runtime";

/**
 * Sandbox incident: cancelling a Dodo subscription produced two cancel
 * webhooks 33 ms apart, both handlers passed the "already initiated" check,
 * and the customer ended up with two ACTIVE free-plan subscriptions.
 * Real Dodo adapter, real handler, real D1.
 */

const SUB = "sub_0NoEaSK9Ao2gvXxFLkzCm";

function cancelled(type = "subscription.cancelled") {
  const r = dodoAdapter.parseWebhookEvent({
    payload: {
      type,
      data: {
        payload_type: "Subscription",
        subscription_id: SUB,
        product_id: "pdt_business",
        status: "cancelled",
        cancelled_at: "2026-09-23T19:52:00.312484Z",
        customer: { customer_id: "cus_1", email: "pro.dodo@owostack.dev" },
        metadata: { organization_id: "org_1", customer_id: "cust_dodo" },
      },
    },
  });
  if (r.isErr()) throw new Error(r.error.message);
  return r.value;
}

describe("cancel → free-plan downgrade under concurrent delivery", () => {
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
      providerCustomerId: "cus_1",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_free",
      organizationId: "org_1",
      slug: "free",
      name: "Free",
      price: 0,
      type: "free",
      billingType: "recurring",
      providerId: null as unknown as string,
      providerPlanId: null,
      paystackPlanId: null,
    });
    await insertPlan(businessDb.d1, {
      id: "plan_business",
      organizationId: "org_1",
      slug: "business-dodo",
      name: "Business (Dodo)",
      price: 4900,
      currency: "USD",
      providerId: "dodopayments",
      providerPlanId: "pdt_business",
      paystackPlanId: null,
      type: "paid",
      billingType: "recurring",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_paid",
      customerId: "cust_dodo",
      planId: "plan_business",
      providerId: "dodopayments",
      providerSubscriptionCode: SUB,
      status: "active",
    });
    handler = new WebhookHandler(businessDb.db, "org_1", { adapter: dodoAdapter });
  });

  afterEach(() => businessDb.close());

  const activeFree = () =>
    businessDb.db.query.subscriptions.findMany({
      where: and(
        eq(schema.subscriptions.customerId, "cust_dodo"),
        eq(schema.subscriptions.planId, "plan_free"),
        eq(schema.subscriptions.status, "active"),
      ),
    });

  it("only one caller wins the claim on the same row", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimCancelDowngrade(businessDb.db, "sub_paid")),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await claimCancelDowngrade(businessDb.db, "sub_paid")).toBe(false);

    const row = await businessDb.db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.id, "sub_paid"),
    });
    expect((row?.metadata as any).cancel_downgrade_initiated).toBe(true);
  });

  it("creates exactly one free subscription when two cancel events race", async () => {
    const results = await Promise.all([
      handler.handle(cancelled()),
      handler.handle(cancelled()),
      handler.handle(cancelled("subscription.cancelled")),
    ]);
    for (const r of results) expect(r.isOk()).toBe(true);

    const paid = await businessDb.db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.id, "sub_paid"),
    });
    expect(paid?.status).toBe("canceled");
    expect(await activeFree()).toHaveLength(1);
  });

  it("does not create a second free subscription on a later replay", async () => {
    await handler.handle(cancelled());
    await handler.handle(cancelled());
    expect(await activeFree()).toHaveLength(1);
  });
});
