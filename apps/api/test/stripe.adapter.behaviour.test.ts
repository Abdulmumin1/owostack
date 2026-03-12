import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderAccount } from "@owostack/adapters";
import { stripeAdapter } from "../../packages/adapters/src/stripe";

function buildAccount(): ProviderAccount {
  const now = Date.now();
  return {
    id: "acct_stripe_1",
    organizationId: "org_1",
    providerId: "stripe",
    environment: "test",
    displayName: "Stripe Test",
    credentials: {
      secretKey: "sk_test_123",
      webhookSecret: "whsec_test_123",
    },
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function signStripePayload(
  secret: string,
  payload: string,
  timestamp: string,
) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${payload}`),
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("Stripe adapter behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies Stripe webhook signatures from the Stripe-Signature header format", async () => {
    const secret = "whsec_test_123";
    const payload = JSON.stringify({
      id: "evt_123",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_123" } },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await signStripePayload(secret, payload, timestamp);

    const result = await stripeAdapter.verifyWebhook({
      signature: `t=${timestamp},v1=${signature}`,
      payload,
      secret,
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toBe(true);
  });

  it("creates payment-mode checkout sessions that save cards for off-session reuse", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "cs_test_payment_1",
          url: "https://checkout.stripe.com/c/pay/cs_test_payment_1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await stripeAdapter.createCheckoutSession({
      customer: { id: "local_customer_1", email: "alice@example.com" },
      plan: null,
      amount: 5000,
      currency: "USD",
      callbackUrl: "https://example.com/success",
      metadata: {
        type: "card_setup",
        customer_id: "cust_local_1",
      },
      environment: "test",
      account: buildAccount(),
    });

    expect(result.isOk()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const body = new URLSearchParams(String((init as RequestInit).body || ""));

    expect(body.get("mode")).toBe("payment");
    expect(body.get("customer_email")).toBe("alice@example.com");
    expect(body.get("customer_creation")).toBe("always");
    expect(body.get("success_url")).toBe("https://example.com/success");
    expect(body.get("cancel_url")).toBe("https://example.com/success");
    expect(body.get("payment_intent_data[setup_future_usage]")).toBe(
      "off_session",
    );
    expect(body.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("5000");
    expect(body.get("metadata[type]")).toBe("card_setup");
    expect(body.get("metadata[customer_email]")).toBe("alice@example.com");
    expect(body.get("payment_intent_data[metadata][type]")).toBe("card_setup");
    expect(body.get("payment_intent_data[metadata][customer_email]")).toBe(
      "alice@example.com",
    );
  });

  it("creates subscription-mode checkout sessions for native trials", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "cs_test_sub_1",
          url: "https://checkout.stripe.com/c/pay/cs_test_sub_1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await stripeAdapter.createCheckoutSession({
      customer: { id: "cus_stripe_123", email: "trial@example.com" },
      plan: { id: "price_monthly_123" },
      amount: 0,
      currency: "USD",
      callbackUrl: "https://example.com/stripe-trial",
      metadata: {
        type: "plan_checkout",
        plan_id: "plan_local_1",
        is_trial: true,
      },
      trialDays: 14,
      environment: "test",
      account: buildAccount(),
    });

    expect(result.isOk()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const body = new URLSearchParams(String((init as RequestInit).body || ""));

    expect(body.get("mode")).toBe("subscription");
    expect(body.get("customer")).toBe("cus_stripe_123");
    expect(body.get("line_items[0][price]")).toBe("price_monthly_123");
    expect(body.get("subscription_data[trial_period_days]")).toBe("14");
    expect(body.get("payment_method_collection")).toBe("always");
    expect(body.get("metadata[provider_plan_id]")).toBe("price_monthly_123");
    expect(body.get("subscription_data[metadata][provider_plan_id]")).toBe(
      "price_monthly_123",
    );
  });

  it("rotates immutable Stripe prices during updatePlan and returns nextPlanId", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "price_old_123",
            product: "prod_123",
            currency: "usd",
            unit_amount: 5000,
            recurring: { interval: "month", interval_count: 1 },
            metadata: { existing: "true" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "price_new_123",
            product: "prod_123",
            currency: "usd",
            unit_amount: 6500,
            recurring: { interval: "month", interval_count: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "prod_123",
            default_price: "price_new_123",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "price_old_123",
            active: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await stripeAdapter.updatePlan?.({
      planId: "price_old_123",
      name: "Pro",
      amount: 6500,
      interval: "monthly",
      currency: "USD",
      description: "Updated description",
      environment: "test",
      account: buildAccount(),
    });

    expect(result?.isOk()).toBe(true);
    if (!result || result.isErr()) return;

    expect(result.value.updated).toBe(true);
    expect(result.value.nextPlanId).toBe("price_new_123");
    expect(result.value.metadata?.productId).toBe("prod_123");
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    const [, createPriceInit] = fetchSpy.mock.calls[1] ?? [];
    const createPriceBody = new URLSearchParams(
      String((createPriceInit as RequestInit).body || ""),
    );
    expect(createPriceBody.get("product")).toBe("prod_123");
    expect(createPriceBody.get("unit_amount")).toBe("6500");
    expect(createPriceBody.get("currency")).toBe("usd");
    expect(createPriceBody.get("recurring[interval]")).toBe("month");

    const [, updateProductInit] = fetchSpy.mock.calls[2] ?? [];
    const updateProductBody = new URLSearchParams(
      String((updateProductInit as RequestInit).body || ""),
    );
    expect(updateProductBody.get("name")).toBe("Pro");
    expect(updateProductBody.get("description")).toBe("Updated description");
    expect(updateProductBody.get("default_price")).toBe("price_new_123");

    const [, archivePriceInit] = fetchSpy.mock.calls[3] ?? [];
    const archivePriceBody = new URLSearchParams(
      String((archivePriceInit as RequestInit).body || ""),
    );
    expect(archivePriceBody.get("active")).toBe("false");
  });

  it("maps zero-amount subscription checkout completion to charge.success for native trials", () => {
    const parsed = stripeAdapter.parseWebhookEvent({
      payload: {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_trial_1",
            mode: "subscription",
            payment_status: "no_payment_required",
            created: 1770057600,
            amount_total: 0,
            currency: "usd",
            customer: "cus_stripe_123",
            customer_details: {
              email: "trial@example.com",
            },
            subscription: "sub_stripe_123",
            metadata: {
              is_trial: "true",
              native_trial: "true",
              trial_ends_at: "2026-02-17T00:00:00.000Z",
              provider_plan_id: "price_monthly_123",
              plan_id: "plan_local_1",
            },
          },
        },
      },
    });

    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;

    expect(parsed.value.type).toBe("charge.success");
    expect(parsed.value.subscription?.providerCode).toBe("sub_stripe_123");
    expect(parsed.value.subscription?.status).toBe("trialing");
    expect(parsed.value.subscription?.trialEndDate).toBe(
      "2026-02-17T00:00:00.000Z",
    );
    expect(parsed.value.plan?.providerPlanCode).toBe("price_monthly_123");
  });

  it("maps payment_intent.succeeded to a reusable authorization and derives checkout quantity", () => {
    const parsed = stripeAdapter.parseWebhookEvent({
      payload: {
        type: "payment_intent.succeeded",
        data: {
          object: {
            id: "pi_test_123",
            customer: "cus_stripe_123",
            payment_method: "pm_card_visa_123",
            amount_received: 4500,
            currency: "usd",
            created: 1770057600,
            metadata: {
              type: "credit_purchase",
              checkout_unit_amount: "1500",
              checkout_price_id: "price_credit_123",
            },
            charges: {
              data: [
                {
                  billing_details: {
                    email: "buyer@example.com",
                  },
                  payment_method_details: {
                    card: {
                      brand: "visa",
                      last4: "4242",
                      exp_month: 12,
                      exp_year: 2030,
                    },
                  },
                },
              ],
            },
          },
        },
      },
    });

    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;

    expect(parsed.value.type).toBe("charge.success");
    expect(parsed.value.authorization?.code).toBe("pm_card_visa_123");
    expect(parsed.value.authorization?.reusable).toBe(true);
    expect(parsed.value.authorization?.last4).toBe("4242");
    expect(parsed.value.checkout?.lineItems?.[0]?.priceId).toBe(
      "price_credit_123",
    );
    expect(parsed.value.checkout?.lineItems?.[0]?.quantity).toBe(3);
  });

  it("maps customer.subscription.updated with cancel_at_period_end to subscription.not_renew", () => {
    const parsed = stripeAdapter.parseWebhookEvent({
      payload: {
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_stripe_123",
            customer: "cus_stripe_123",
            status: "active",
            cancel_at_period_end: true,
            current_period_start: 1770057600,
            current_period_end: 1772736000,
            items: {
              data: [
                {
                  id: "si_123",
                  price: { id: "price_monthly_123" },
                },
              ],
            },
            metadata: {
              plan_id: "plan_local_1",
            },
          },
        },
      },
    });

    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;

    expect(parsed.value.type).toBe("subscription.not_renew");
    expect(parsed.value.subscription?.status).toBe("pending_cancel");
    expect(parsed.value.plan?.providerPlanCode).toBe("price_monthly_123");
  });

  it("maps subscription renewal dates from subscription items when Stripe omits top-level current_period_* fields", () => {
    const parsed = stripeAdapter.parseWebhookEvent({
      payload: {
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_stripe_trial_123",
            customer: "cus_stripe_123",
            status: "active",
            trial_end: 1773246029,
            billing_cycle_anchor: 1773246029,
            items: {
              data: [
                {
                  id: "si_123",
                  current_period_start: 1773246029,
                  current_period_end: 1775924429,
                  price: { id: "price_monthly_123" },
                },
              ],
            },
            metadata: {
              plan_id: "plan_local_1",
            },
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

  it("maps payment_method.attached to customer.identified with reusable card metadata", () => {
    const parsed = stripeAdapter.parseWebhookEvent({
      payload: {
        type: "payment_method.attached",
        data: {
          object: {
            id: "pm_123",
            customer: "cus_stripe_123",
            billing_details: {
              email: "buyer@example.com",
            },
            card: {
              brand: "visa",
              last4: "4242",
              exp_month: 12,
              exp_year: 2030,
            },
          },
        },
      },
    });

    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;

    expect(parsed.value.type).toBe("customer.identified");
    expect(parsed.value.customer.providerCustomerId).toBe("cus_stripe_123");
    expect(parsed.value.customer.email).toBe("buyer@example.com");
    expect(parsed.value.authorization?.code).toBe("pm_123");
    expect(parsed.value.authorization?.last4).toBe("4242");
    expect(parsed.value.authorization?.cardType).toBe("visa");
  });
});
