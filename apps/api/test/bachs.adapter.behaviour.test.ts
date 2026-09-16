import { afterEach, describe, expect, it } from "vitest";
import { bachsAdapter, type ProviderAccount } from "@owostack/adapters";
import {
  coerceMetadata,
  mapChannelsToPaymentMethodTypes,
  mapIntervalToCadence,
  mapSubscriptionStatus,
  toDecimalString,
  toMinorUnits,
} from "../../packages/adapters/src/bachs";
import {
  SequencedFetchTransport,
  jsonResponse,
  withFetchTransport,
} from "./runtime/helpers/fetch-transport";

const SECRET_KEY = "sk_sandbox_behaviour";
const WEBHOOK_SECRET = "whsec_behaviour_secret";

function buildAccount(
  overrides: Partial<ProviderAccount> = {},
): ProviderAccount {
  const now = Date.now();
  return {
    id: "acct_bachs_1",
    organizationId: "org_1",
    providerId: "bachs",
    environment: "test",
    displayName: "Bachs Test",
    credentials: {
      secretKey: SECRET_KEY,
      webhookSecret: WEBHOOK_SECRET,
    },
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function signBachs(secret: string, timestamp: string, payload: string) {
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

async function withMutedConsole<T>(run: () => Promise<T>): Promise<T> {
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    return await run();
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
}

describe("Bachs adapter behaviour", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("money conversion", () => {
    it("renders Owostack minor units as two-decimal strings", () => {
      expect(toDecimalString(2999)).toBe("29.99");
      expect(toDecimalString(100)).toBe("1.00");
      expect(toDecimalString(1)).toBe("0.01");
      expect(toDecimalString(0)).toBe("0.00");
      expect(toDecimalString(7500000)).toBe("75000.00");
      expect(toDecimalString(-250)).toBe("-2.50");
      expect(toDecimalString(1234.6)).toBe("12.35");
    });

    it("parses Bachs decimal strings into minor units without float drift", () => {
      expect(toMinorUnits("29.99")).toBe(2999);
      expect(toMinorUnits("75000")).toBe(7500000);
      expect(toMinorUnits("75000.00")).toBe(7500000);
      expect(toMinorUnits("0.1")).toBe(10);
      expect(toMinorUnits("0.10")).toBe(10);
      expect(toMinorUnits("1.005")).toBe(101);
      expect(toMinorUnits("1.004")).toBe(100);
      expect(toMinorUnits("-2.50")).toBe(-250);
      expect(toMinorUnits(" 10.00 ")).toBe(1000);
      expect(toMinorUnits(19.99)).toBe(1999);
      expect(toMinorUnits(null)).toBe(0);
      expect(toMinorUnits(undefined)).toBe(0);
      expect(toMinorUnits("not-money")).toBe(0);
    });

    it("round-trips every amount in the checkout range", () => {
      for (const minor of [1, 50, 99, 100, 101, 2999, 100000, 7500000]) {
        expect(toMinorUnits(toDecimalString(minor))).toBe(minor);
      }
    });
  });

  describe("mapping helpers", () => {
    it("maps Owostack plan intervals to Bachs cadences", () => {
      expect(mapIntervalToCadence("monthly")).toEqual({
        interval: "month",
        frequency: 1,
      });
      expect(mapIntervalToCadence("quarterly")).toEqual({
        interval: "month",
        frequency: 3,
      });
      expect(mapIntervalToCadence("biannually")).toEqual({
        interval: "month",
        frequency: 6,
      });
      expect(mapIntervalToCadence("yearly")).toEqual({
        interval: "year",
        frequency: 1,
      });
      expect(mapIntervalToCadence("weekly")).toEqual({
        interval: "week",
        frequency: 1,
      });
      expect(mapIntervalToCadence("daily")).toEqual({
        interval: "day",
        frequency: 1,
      });
      expect(mapIntervalToCadence("")).toEqual({
        interval: "month",
        frequency: 1,
      });
    });

    it("maps Paystack-style channels to Bachs payment method types", () => {
      expect(
        mapChannelsToPaymentMethodTypes(["card", "bank", "ussd", "qr"]),
      ).toEqual(["card", "bank_transfer"]);
      expect(
        mapChannelsToPaymentMethodTypes([
          "mobile_money",
          "crypto",
          "MOBILE_MONEY",
        ]),
      ).toEqual(["mobile_money", "crypto"]);
      expect(mapChannelsToPaymentMethodTypes(["ussd"])).toBeUndefined();
      expect(mapChannelsToPaymentMethodTypes([])).toBeUndefined();
      expect(mapChannelsToPaymentMethodTypes(undefined)).toBeUndefined();
    });

    it("maps Bachs subscription statuses to Owostack statuses", () => {
      expect(mapSubscriptionStatus("active")).toBe("active");
      expect(mapSubscriptionStatus("trialing")).toBe("trialing");
      expect(mapSubscriptionStatus("past_due")).toBe("past_due");
      expect(mapSubscriptionStatus("unpaid")).toBe("past_due");
      expect(mapSubscriptionStatus("paused")).toBe("past_due");
      expect(mapSubscriptionStatus("canceled")).toBe("canceled");
      expect(mapSubscriptionStatus("active", true)).toBe("pending_cancel");
      expect(mapSubscriptionStatus("canceled", true)).toBe("canceled");
      expect(mapSubscriptionStatus(null)).toBe("active");
    });

    it("stringifies metadata, drops nulls, and caps at 20 keys", async () => {
      const input: Record<string, unknown> = {};
      for (let index = 0; index < 25; index++) {
        input[`key_${index}`] = index;
      }
      input.key_3 = null;
      input.key_4 = undefined;
      input.flag = true;

      const result = await withMutedConsole(async () => coerceMetadata(input));
      expect(result).toBeDefined();
      expect(Object.keys(result!)).toHaveLength(20);
      expect(result!.key_0).toBe("0");
      expect(result!.key_3).toBeUndefined();
      expect(result!.key_4).toBeUndefined();
      expect(coerceMetadata({ only: null })).toBeUndefined();
      expect(coerceMetadata(undefined)).toBeUndefined();
      expect(coerceMetadata({ is_trial: true, amount: 5000 })).toEqual({
        is_trial: "true",
        amount: "5000",
      });
    });
  });

  describe("webhook verification", () => {
    const payload = JSON.stringify({
      id: "evt_1",
      type: "collection.succeeded",
      data: { payment_id: "pay_1", amount: "10.00", currency: "USD" },
    });

    it("accepts a fresh, correctly signed delivery", async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = await signBachs(WEBHOOK_SECRET, timestamp, payload);

      const result = await bachsAdapter.verifyWebhook({
        signature,
        payload,
        secret: WEBHOOK_SECRET,
        headers: { "x-bachs-timestamp": timestamp },
      });

      expect(result.isOk() && result.value).toBe(true);
    });

    it("accepts upper-case hex signatures", async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = await signBachs(WEBHOOK_SECRET, timestamp, payload);

      const result = await bachsAdapter.verifyWebhook({
        signature: signature.toUpperCase(),
        payload,
        secret: WEBHOOK_SECRET,
        headers: { "x-bachs-timestamp": timestamp },
      });

      expect(result.isOk() && result.value).toBe(true);
    });

    it("rejects a signature produced with a different secret", async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = await signBachs("whsec_other", timestamp, payload);

      const result = await bachsAdapter.verifyWebhook({
        signature,
        payload,
        secret: WEBHOOK_SECRET,
        headers: { "x-bachs-timestamp": timestamp },
      });

      expect(result.isOk() && result.value).toBe(false);
    });

    it("rejects deliveries older than the 300 second tolerance (replay protection)", async () => {
      const timestamp = String(Math.floor(Date.now() / 1000) - 301);
      const signature = await signBachs(WEBHOOK_SECRET, timestamp, payload);

      const result = await withMutedConsole(() =>
        bachsAdapter.verifyWebhook({
          signature,
          payload,
          secret: WEBHOOK_SECRET,
          headers: { "x-bachs-timestamp": timestamp },
        }),
      );

      expect(result.isOk() && result.value).toBe(false);
    });

    it("accepts deliveries within the tolerance window", async () => {
      const timestamp = String(Math.floor(Date.now() / 1000) - 299);
      const signature = await signBachs(WEBHOOK_SECRET, timestamp, payload);

      const result = await bachsAdapter.verifyWebhook({
        signature,
        payload,
        secret: WEBHOOK_SECRET,
        headers: { "x-bachs-timestamp": timestamp },
      });

      expect(result.isOk() && result.value).toBe(true);
    });

    it("rejects when the timestamp header is missing (signature cannot be reconstructed)", async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = await signBachs(WEBHOOK_SECRET, timestamp, payload);

      const result = await withMutedConsole(() =>
        bachsAdapter.verifyWebhook({
          signature,
          payload,
          secret: WEBHOOK_SECRET,
        }),
      );

      expect(result.isOk() && result.value).toBe(false);
    });

    it("rejects when the timestamp header is tampered", async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = await signBachs(WEBHOOK_SECRET, timestamp, payload);

      const result = await bachsAdapter.verifyWebhook({
        signature,
        payload,
        secret: WEBHOOK_SECRET,
        headers: { "x-bachs-timestamp": String(Number(timestamp) - 5) },
      });

      expect(result.isOk() && result.value).toBe(false);
    });
  });

  describe("checkout session shapes", () => {
    it("builds a product-less pricing checkout for one-off amounts with a new customer", async () => {
      const transport = new SequencedFetchTransport([
        {
          method: "POST",
          origin: "https://sandbox-api.bachs.io",
          path: "/v1/checkout-sessions",
          assert(request) {
            expect(request.headers["idempotency-key"]).toBe(
              "checkout:inv_local_1",
            );
            expect(request.json<Record<string, any>>()).toEqual({
              customer: { email: "jane@example.com", name: "jane" },
              pricing: {
                currency: "NGN",
                amount: "75000.00",
                price_type: "fixed",
              },
              success_url: "https://app.example.com/billing",
              cancel_url: "https://app.example.com/billing",
              metadata: { type: "invoice_payment", invoice_id: "inv_local_1" },
            });
          },
          respond: jsonResponse({
            checkout_id: "chk_1",
            checkout_url: "https://checkout.bachs.io/c/chk_1",
          }),
        },
      ]);

      const result = await withFetchTransport(transport, () =>
        bachsAdapter.createCheckoutSession({
          customer: { id: "jane@example.com", email: "jane@example.com" },
          plan: null,
          amount: 7500000,
          currency: "ngn",
          callbackUrl: "https://app.example.com/billing",
          metadata: { type: "invoice_payment", invoice_id: "inv_local_1" },
          environment: "test",
          account: buildAccount(),
        }),
      );

      transport.assertComplete();
      expect(result.isOk() && result.value).toEqual({
        url: "https://checkout.bachs.io/c/chk_1",
        reference: "chk_1",
        accessCode: null,
      });
    });

    it("builds a product cart from credit-pack line items with quantities", async () => {
      const transport = new SequencedFetchTransport([
        {
          method: "POST",
          origin: "https://sandbox-api.bachs.io",
          path: "/v1/checkout-sessions",
          assert(request) {
            expect(request.headers["idempotency-key"]).toBeUndefined();
            expect(request.json<Record<string, any>>()).toEqual({
              customer: { customer_id: "cust_1" },
              product_cart: [
                { product_id: "prod_pack_1", quantity: 3 },
                { product_id: "prod_pack_2", quantity: 1 },
              ],
              metadata: { type: "credit_pack", credits: "300" },
            });
          },
          respond: jsonResponse({
            checkout_id: "chk_2",
            checkout_url: "https://checkout.bachs.io/c/chk_2",
          }),
        },
      ]);

      const result = await withFetchTransport(transport, () =>
        bachsAdapter.createCheckoutSession({
          customer: { id: "cust_1", email: "jane@example.com" },
          amount: 9000,
          currency: "USD",
          lineItems: [
            { priceId: "prod_pack_1", quantity: 3 },
            { priceId: "prod_pack_2", quantity: 0 },
            { priceId: "", quantity: 1 },
          ],
          metadata: { type: "credit_pack", credits: 300 },
          environment: "test",
          account: buildAccount(),
        }),
      );

      transport.assertComplete();
      expect(result.isOk()).toBe(true);
    });

    it("uses the production base URL for live accounts", async () => {
      const transport = new SequencedFetchTransport([
        {
          method: "POST",
          origin: "https://api.bachs.io",
          path: "/v1/checkout-sessions",
          assert(request) {
            expect(request.headers.authorization).toBe("Bearer sk_live_x");
          },
          respond: jsonResponse({
            checkout_id: "chk_live",
            checkout_url: "https://checkout.bachs.io/c/chk_live",
          }),
        },
      ]);

      const result = await withFetchTransport(transport, () =>
        bachsAdapter.createCheckoutSession({
          customer: { id: "cust_1", email: "jane@example.com" },
          plan: { id: "prod_pro" },
          amount: 1000,
          currency: "USD",
          environment: "live",
          account: buildAccount({
            environment: "live",
            credentials: { secretKey: "sk_live_x", webhookSecret: "w" },
          }),
        }),
      );

      transport.assertComplete();
      expect(result.isOk()).toBe(true);
    });

    it("refuses mandate-only and card_setup checkouts without a network call", async () => {
      const transport = new SequencedFetchTransport([]);

      const mandate = await withFetchTransport(transport, () =>
        bachsAdapter.createCheckoutSession({
          customer: { id: "cust_1", email: "jane@example.com" },
          amount: 100,
          currency: "USD",
          onDemand: { mandateOnly: true },
          environment: "test",
          account: buildAccount(),
        }),
      );
      const cardSetup = await withFetchTransport(transport, () =>
        bachsAdapter.createCheckoutSession({
          customer: { id: "cust_1", email: "jane@example.com" },
          amount: 100,
          currency: "USD",
          metadata: { type: "card_setup" },
          environment: "test",
          account: buildAccount(),
        }),
      );

      transport.assertComplete();
      expect(mandate.isErr() && mandate.error.code).toBe("unsupported");
      expect(cardSetup.isErr() && cardSetup.error.code).toBe("unsupported");
    });

    it("rejects a zero-amount product-less checkout before calling Bachs", async () => {
      const transport = new SequencedFetchTransport([]);
      const result = await withFetchTransport(transport, () =>
        bachsAdapter.createCheckoutSession({
          customer: { id: "cust_1", email: "jane@example.com" },
          amount: 0,
          currency: "USD",
          environment: "test",
          account: buildAccount(),
        }),
      );
      transport.assertComplete();
      expect(result.isErr() && result.error.code).toBe("invalid_request");
    });
  });

  describe("error handling", () => {
    it("surfaces Bachs error detail and does not retry 4xx responses", async () => {
      const transport = new SequencedFetchTransport([
        {
          method: "POST",
          origin: "https://sandbox-api.bachs.io",
          path: "/v1/checkout-sessions",
          respond: jsonResponse(
            {
              detail: "product_cart[0].product_id: product not found",
              error_code: "NOT_FOUND",
            },
            { status: 404 },
          ),
        },
      ]);

      const result = await withFetchTransport(transport, () =>
        bachsAdapter.createCheckoutSession({
          customer: { id: "cust_1", email: "jane@example.com" },
          plan: { id: "prod_missing" },
          amount: 1000,
          currency: "USD",
          environment: "test",
          account: buildAccount(),
        }),
      );

      transport.assertComplete();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe("request_failed");
        expect(result.error.message).toContain("Bachs API 404");
        expect(result.error.message).toContain("product not found");
      }
    });

    it("maps 400 validation failures to invalid_request so plan-switch can fall back", async () => {
      const transport = new SequencedFetchTransport([
        {
          method: "PATCH",
          origin: "https://sandbox-api.bachs.io",
          path: "/v1/subscriptions/sub_1",
          respond: jsonResponse(
            {
              detail: "Target product must bill at the same interval",
              error_code: "BAD_REQUEST",
            },
            { status: 400 },
          ),
        },
      ]);

      const result = await withFetchTransport(transport, () =>
        bachsAdapter.changePlan!({
          subscriptionId: "sub_1",
          newPlanId: "prod_yearly",
          environment: "test",
          account: buildAccount(),
        }),
      );

      transport.assertComplete();
      expect(result.isErr() && result.error.code).toBe("invalid_request");
    });

    it("retries 5xx responses and succeeds on a later attempt", async () => {
      const transport = new SequencedFetchTransport([
        {
          method: "GET",
          origin: "https://sandbox-api.bachs.io",
          path: "/v1/subscriptions/sub_1",
          respond: jsonResponse({ detail: "upstream" }, { status: 502 }),
        },
        {
          method: "GET",
          origin: "https://sandbox-api.bachs.io",
          path: "/v1/subscriptions/sub_1",
          respond: jsonResponse({
            id: "sub_1",
            status: "trialing",
            trial_end: "2026-06-01T00:00:00Z",
            product: { id: "prod_pro" },
          }),
        },
      ]);

      const result = await withFetchTransport(transport, () =>
        bachsAdapter.fetchSubscription({
          subscriptionId: "sub_1",
          environment: "test",
          account: buildAccount(),
        }),
      );

      transport.assertComplete();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe("trialing");
        expect(result.value.planCode).toBe("prod_pro");
      }
    });

    it("recovers an existing customer when Bachs reports a duplicate email", async () => {
      const transport = new SequencedFetchTransport([
        {
          method: "POST",
          origin: "https://sandbox-api.bachs.io",
          path: "/v1/customers",
          respond: jsonResponse(
            { detail: "Customer already exists", error_code: "CONFLICT" },
            { status: 409 },
          ),
        },
        {
          method: "GET",
          origin: "https://sandbox-api.bachs.io",
          path: "/v1/customers",
          assert(request) {
            expect(request.url.searchParams.get("search")).toBe(
              "Jane@Example.com",
            );
          },
          respond: jsonResponse({
            items: [
              { customer_id: "cust_other", email: "other@example.com" },
              { customer_id: "cust_jane", email: "jane@example.com" },
            ],
            pagination: {},
          }),
        },
      ]);

      const result = await withFetchTransport(transport, () =>
        bachsAdapter.createCustomer({
          email: "Jane@Example.com",
          name: "Jane",
          environment: "test",
          account: buildAccount(),
        }),
      );

      transport.assertComplete();
      expect(result.isOk() && result.value.id).toBe("cust_jane");
    });

    it("treats an already-canceled subscription as canceled", async () => {
      const transport = new SequencedFetchTransport([
        {
          method: "DELETE",
          origin: "https://sandbox-api.bachs.io",
          path: "/v1/subscriptions/sub_1",
          respond: jsonResponse(
            {
              detail: "Subscription is already canceled",
              error_code: "BAD_REQUEST",
            },
            { status: 400 },
          ),
        },
      ]);

      const result = await withFetchTransport(transport, () =>
        bachsAdapter.cancelSubscription({
          subscription: { id: "sub_1", status: "canceled" },
          environment: "test",
          account: buildAccount(),
        }),
      );

      transport.assertComplete();
      expect(result.isOk() && result.value).toEqual({ canceled: true });
    });
  });

  describe("plans", () => {
    it("refuses non-USD recurring plans before calling Bachs", async () => {
      const transport = new SequencedFetchTransport([]);
      const result = await withFetchTransport(transport, () =>
        bachsAdapter.createPlan({
          name: "Naira Pro",
          amount: 500000,
          interval: "monthly",
          currency: "NGN",
          environment: "test",
          account: buildAccount(),
        }),
      );
      transport.assertComplete();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe("invalid_request");
        expect(result.error.message).toContain("USD");
      }
    });

    it("creates a replacement product and archives the old one when the interval changes", async () => {
      const transport = new SequencedFetchTransport([
        {
          method: "GET",
          origin: "https://sandbox-api.bachs.io",
          path: "/v1/products/prod_monthly",
          respond: jsonResponse({
            id: "prod_monthly",
            name: "Pro",
            billing_cycle: { interval: "month", frequency: 1 },
          }),
        },
        {
          method: "POST",
          origin: "https://sandbox-api.bachs.io",
          path: "/v1/products",
          assert(request) {
            expect(request.json<Record<string, any>>()).toEqual({
              name: "Pro",
              price: { currency: "USD", price_type: "fixed", amount: "500.00" },
              billing_cycle: { interval: "year", frequency: 1 },
            });
          },
          respond: jsonResponse({
            id: "prod_yearly",
            billing_cycle: { interval: "year", frequency: 1 },
          }),
        },
        {
          method: "POST",
          origin: "https://sandbox-api.bachs.io",
          path: "/v1/products/prod_monthly/archive",
          respond: jsonResponse({ id: "prod_monthly", status: "archived" }),
        },
      ]);

      const result = await withFetchTransport(transport, () =>
        bachsAdapter.updatePlan!({
          planId: "prod_monthly",
          amount: 50000,
          currency: "USD",
          interval: "yearly",
          environment: "test",
          account: buildAccount(),
        }),
      );

      transport.assertComplete();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.updated).toBe(true);
        expect(result.value.nextPlanId).toBe("prod_yearly");
      }
    });

    it("patches in place when the interval is unchanged", async () => {
      const transport = new SequencedFetchTransport([
        {
          method: "GET",
          origin: "https://sandbox-api.bachs.io",
          path: "/v1/products/prod_monthly",
          respond: jsonResponse({
            id: "prod_monthly",
            name: "Pro",
            billing_cycle: { interval: "month", frequency: 1 },
          }),
        },
        {
          method: "PATCH",
          origin: "https://sandbox-api.bachs.io",
          path: "/v1/products/prod_monthly",
          assert(request) {
            expect(request.json<Record<string, any>>()).toEqual({
              price: { amount: "55.00" },
            });
          },
          respond: jsonResponse({ id: "prod_monthly" }),
        },
      ]);

      const result = await withFetchTransport(transport, () =>
        bachsAdapter.updatePlan!({
          planId: "prod_monthly",
          amount: 5500,
          currency: "USD",
          interval: "monthly",
          environment: "test",
          account: buildAccount(),
        }),
      );

      transport.assertComplete();
      expect(result.isOk() && result.value).toEqual({ updated: true });
    });
  });

  describe("webhook parsing quirks", () => {
    it("skips paid checkout.completed events so collection.succeeded stays the single payment signal", () => {
      const result = bachsAdapter.parseWebhookEvent({
        payload: {
          id: "evt_1",
          type: "checkout.completed",
          data: {
            checkout_id: "chk_1",
            mode: "payment",
            payment_status: "paid",
            amount: "19.00",
            currency: "USD",
            customer: { customer_id: "cust_1", email: "jane@example.com" },
          },
        },
      });

      expect(result.isErr() && result.error.code).toBe("unknown_event");
    });

    it("skips invoice.paid to avoid double-counting renewals", () => {
      const result = bachsAdapter.parseWebhookEvent({
        payload: {
          type: "invoice.paid",
          data: { invoice_id: "inv_1", total: "10.00", currency: "USD" },
        },
      });

      expect(result.isErr() && result.error.code).toBe("unknown_event");
    });

    it("skips events Owostack does not model", () => {
      for (const type of [
        "payout.paid",
        "dispute.created",
        "customer.created",
        "collection.underpaid",
        "checkout.expired",
        "refund.created",
      ]) {
        const result = bachsAdapter.parseWebhookEvent({
          payload: { type, data: {} },
        });
        expect(result.isErr() && result.error.code).toBe("unknown_event");
      }
    });

    it("tolerates a null charge_id on collection.succeeded (test tool deliveries)", () => {
      const result = bachsAdapter.parseWebhookEvent({
        payload: {
          type: "collection.succeeded",
          data: {
            charge_id: null,
            checkout_id: "chk_test",
            reference: "owo_ref",
            amount: "1.00",
            currency: "USD",
            customer: { id: "cust_1", email: "jane@example.com" },
          },
        },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.payment?.reference).toBe("owo_ref");
      }
    });

    it("reads customer identity from customer_details on guest checkouts", () => {
      const result = bachsAdapter.parseWebhookEvent({
        payload: {
          type: "checkout.completed",
          data: {
            checkout_id: "chk_guest",
            mode: "subscription",
            payment_status: "no_payment_required",
            currency: "USD",
            customer: null,
            customer_details: { email: "guest@example.com", name: "Guest" },
            subscription: { subscription_id: "sub_guest" },
            metadata: {},
          },
        },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.customer).toEqual({
          email: "guest@example.com",
          providerCustomerId: "",
        });
      }
    });
  });
});
