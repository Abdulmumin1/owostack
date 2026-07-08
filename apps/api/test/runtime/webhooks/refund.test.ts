import { describe, expect, it } from "vitest";
import { handleRefund } from "../../../src/lib/webhooks/handlers/refund";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  insertPlan,
  insertSubscription,
  seedWorkflowBase,
} from "../helpers/workflow-runtime";

function refundEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: "refund.success" as const,
    provider: "paystack" as const,
    customer: {
      email: "customer@example.com",
      providerCustomerId: "cus_remote_1",
    },
    refund: {
      amount: 3000,
      currency: "NGN",
      reference: "charge_target",
      ...overrides,
    },
    metadata: {},
  };
}

describe("refund webhook runtime integration", () => {
  it("refunds only the subscription matched by the payment reference", async () => {
    const { d1, db, close } = createRuntimeBusinessDb();
    const now = Date.now();

    try {
      await seedWorkflowBase(d1);
      await insertPlan(d1, {
        id: "plan_2",
        slug: "growth-2",
        price: 3000,
      });
      await insertSubscription(d1, {
        id: "sub_refunded",
        status: "active",
        planId: "plan_1",
      });
      await insertSubscription(d1, {
        id: "sub_unrelated",
        status: "active",
        planId: "plan_2",
      });

      await d1
        .prepare(
          `INSERT INTO invoices
           (id, organization_id, customer_id, subscription_id, status, currency, subtotal, total, amount_paid, amount_due, period_start, period_end, paid_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          "inv_target",
          "org_1",
          "cust_1",
          "sub_refunded",
          "paid",
          "NGN",
          3000,
          3000,
          3000,
          0,
          now - 1000,
          now + 1000,
          now,
          now,
          now,
        )
        .run();
      await d1
        .prepare(
          `INSERT INTO payment_attempts
           (id, invoice_id, amount, currency, status, provider, provider_reference, attempt_number, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          "pa_target",
          "inv_target",
          3000,
          "NGN",
          "succeeded",
          "paystack",
          "charge_target",
          1,
          now,
        )
        .run();

      await handleRefund({
        db,
        organizationId: "org_1",
        event: refundEvent(),
        adapter: null,
        providerAccount: null,
        workflows: { trialEnd: null, planUpgrade: null, renewalSetup: null },
        cache: null,
      });

      const refunded = await d1
        .prepare("SELECT status FROM subscriptions WHERE id = ?")
        .bind("sub_refunded")
        .first<{ status: string }>();
      const unrelated = await d1
        .prepare("SELECT status FROM subscriptions WHERE id = ?")
        .bind("sub_unrelated")
        .first<{ status: string }>();

      expect(refunded?.status).toBe("refunded");
      expect(unrelated?.status).toBe("active");
    } finally {
      close();
    }
  });

  it("does not revoke subscriptions when the refund has no matching payment reference", async () => {
    const { d1, db, close } = createRuntimeBusinessDb();

    try {
      await seedWorkflowBase(d1);
      await insertSubscription(d1, {
        id: "sub_active",
        status: "active",
        planId: "plan_1",
      });

      await handleRefund({
        db,
        organizationId: "org_1",
        event: refundEvent({ reference: "missing_charge" }),
        adapter: null,
        providerAccount: null,
        workflows: { trialEnd: null, planUpgrade: null, renewalSetup: null },
        cache: null,
      });

      const subscription = await d1
        .prepare("SELECT status FROM subscriptions WHERE id = ?")
        .bind("sub_active")
        .first<{ status: string }>();

      expect(subscription?.status).toBe("active");
    } finally {
      close();
    }
  });
});
