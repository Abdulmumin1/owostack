import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderAccount } from "@owostack/adapters";
import { dodoAdapter } from "../../packages/adapters/src/dodo";

function buildAccount(): ProviderAccount {
  const now = Date.now();
  return {
    id: "acct_dodo_1",
    organizationId: "org_1",
    providerId: "dodopayments",
    environment: "test",
    displayName: "Dodo Test",
    credentials: {
      secretKey: "dodo_test_key",
      webhookSecret: "whsec_test_123",
    },
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("Dodo adapter behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps subscription.active billing dates from previous_billing_date and next_billing_date", () => {
    const parsed = dodoAdapter.parseWebhookEvent({
      payload: {
        type: "subscription.active",
        data: {
          subscription_id: "sub_dodo_123",
          customer: {
            customer_id: "cust_dodo_123",
            email: "buyer@example.com",
          },
          product_id: "prod_monthly_123",
          status: "active",
          previous_billing_date: "2026-03-11T16:20:29.000Z",
          next_billing_date: "2026-04-11T16:20:29.000Z",
          created_at: "2026-03-08T16:20:29.000Z",
          metadata: {
            is_trial: true,
            trial_ends_at: "2026-03-11T16:20:29.000Z",
          },
        },
      },
    });

    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;

    expect(parsed.value.type).toBe("subscription.active");
    expect(parsed.value.subscription?.startDate).toBe(
      "2026-03-11T16:20:29.000Z",
    );
    expect(parsed.value.subscription?.nextPaymentDate).toBe(
      "2026-04-11T16:20:29.000Z",
    );
    expect(parsed.value.subscription?.trialEndDate).toBe(
      "2026-03-11T16:20:29.000Z",
    );
  });

  it("maps subscription.updated with cancel_at_next_billing_date to subscription.not_renew", () => {
    const parsed = dodoAdapter.parseWebhookEvent({
      payload: {
        type: "subscription.updated",
        data: {
          subscription_id: "sub_dodo_123",
          customer: {
            customer_id: "cust_dodo_123",
            email: "buyer@example.com",
          },
          product_id: "prod_monthly_123",
          status: "active",
          cancel_at_next_billing_date: true,
          previous_billing_date: "2026-03-11T16:20:29.000Z",
          next_billing_date: "2026-04-11T16:20:29.000Z",
        },
      },
    });

    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;

    expect(parsed.value.type).toBe("subscription.not_renew");
    expect(parsed.value.subscription?.startDate).toBe(
      "2026-03-11T16:20:29.000Z",
    );
    expect(parsed.value.subscription?.nextPaymentDate).toBe(
      "2026-04-11T16:20:29.000Z",
    );
  });

  it("maps subscription.updated status changes to subscription.past_due", () => {
    const parsed = dodoAdapter.parseWebhookEvent({
      payload: {
        type: "subscription.updated",
        data: {
          subscription_id: "sub_dodo_123",
          customer: {
            customer_id: "cust_dodo_123",
            email: "buyer@example.com",
          },
          product_id: "prod_monthly_123",
          status: "on_hold",
          previous_billing_date: "2026-03-11T16:20:29.000Z",
          next_billing_date: "2026-04-11T16:20:29.000Z",
        },
      },
    });

    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;

    expect(parsed.value.type).toBe("subscription.past_due");
    expect(parsed.value.subscription?.status).toBe("on_hold");
  });

  it("fetchSubscription prefers previous_billing_date over created_at for the current period start", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          subscription_id: "sub_dodo_123",
          status: "active",
          product_id: "prod_monthly_123",
          created_at: "2026-03-08T16:20:29.000Z",
          previous_billing_date: "2026-03-11T16:20:29.000Z",
          next_billing_date: "2026-04-11T16:20:29.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await dodoAdapter.fetchSubscription({
      subscriptionId: "sub_dodo_123",
      environment: "test",
      account: buildAccount(),
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.startDate).toBe("2026-03-11T16:20:29.000Z");
    expect(result.value.nextPaymentDate).toBe("2026-04-11T16:20:29.000Z");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
