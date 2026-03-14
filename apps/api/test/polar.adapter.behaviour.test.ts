import { beforeEach, describe, expect, it, vi } from "vitest";
import { polarAdapter, type ProviderAccount } from "@owostack/adapters";

function buildAccount(): ProviderAccount {
  const now = Date.now();
  return {
    id: "acct_polar_1",
    organizationId: "org_1",
    providerId: "polar",
    environment: "test",
    displayName: "Polar Test",
    credentials: {
      secretKey: "polar_test_token",
    },
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("Polar adapter behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies webhook signature for polar_whs_ base64url secrets", async () => {
    const keyBytes = new TextEncoder().encode(
      "0123456789abcdef0123456789abcdef",
    );
    const base64 = btoa(String.fromCharCode(...keyBytes));
    const base64Url = base64
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    const secret = `polar_whs_${base64Url}`;

    const webhookId = "327a3073-eb31-497d-8a3c-c77c6556a4c9";
    const webhookTimestamp = String(Math.floor(Date.now() / 1000));
    const payload = JSON.stringify({
      type: "order.paid",
      data: {
        id: "ord_1",
        customer: { id: "cus_1", email: "alice@example.com" },
      },
    });

    const signedMessage = `${webhookId}.${webhookTimestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signedMessage),
    );
    const signature = btoa(
      String.fromCharCode(...new Uint8Array(signatureBuffer)),
    );

    const verify = await polarAdapter.verifyWebhook({
      signature: `v1,${signature}`,
      payload,
      secret,
      headers: {
        "webhook-id": webhookId,
        "webhook-timestamp": webhookTimestamp,
        "webhook-signature": `v1,${signature}`,
      },
    });

    expect(verify.isOk()).toBe(true);
    if (verify.isErr()) return;
    expect(verify.value).toBe(true);
  });

  it("verifies webhook signature when key bytes are raw polar_whs secret text", async () => {
    const secret = "polar_whs_lkqTLUW7hdoMsolxWladq8NWfBE9yHHGck7l54gAFGl";
    const keyBytes = new TextEncoder().encode(secret);

    const webhookId = "bd9df8cc-2444-4042-888f-cfd4363582f3";
    const webhookTimestamp = String(Math.floor(Date.now() / 1000));
    const payload = JSON.stringify({
      type: "order.paid",
      data: {
        id: "ord_2",
        customer: { id: "cus_2", email: "bob@example.com" },
      },
    });

    const signedMessage = `${webhookId}.${webhookTimestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signedMessage),
    );
    const signature = btoa(
      String.fromCharCode(...new Uint8Array(signatureBuffer)),
    );

    const verify = await polarAdapter.verifyWebhook({
      signature: `v1,${signature}`,
      payload,
      secret,
      headers: {
        "webhook-id": webhookId,
        "webhook-timestamp": webhookTimestamp,
        "webhook-signature": `v1,${signature}`,
      },
    });

    expect(verify.isOk()).toBe(true);
    if (verify.isErr()) return;
    expect(verify.value).toBe(true);
  });

  it("maps subscription.canceled to subscription.not_renew with pending_cancel status", () => {
    const parsed = polarAdapter.parseWebhookEvent({
      payload: {
        type: "subscription.canceled",
        data: {
          id: "sub_1",
          status: "canceled",
          customer: { id: "cus_1", email: "alice@example.com" },
          product: { id: "prod_1" },
          current_period_end: "2026-03-01T00:00:00Z",
        },
      },
    });

    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;

    expect(parsed.value.type).toBe("subscription.not_renew");
    expect(parsed.value.subscription?.status).toBe("pending_cancel");
  });

  it("maps subscription.updated with cancel_at_period_end to subscription.not_renew", () => {
    const parsed = polarAdapter.parseWebhookEvent({
      payload: {
        type: "subscription.updated",
        data: {
          id: "sub_2",
          status: "active",
          cancel_at_period_end: true,
          customer: { id: "cus_2", email: "bob@example.com" },
          product: { id: "prod_2" },
          current_period_end: "2026-03-10T00:00:00Z",
        },
      },
    });

    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;

    expect(parsed.value.type).toBe("subscription.not_renew");
    expect(parsed.value.subscription?.status).toBe("pending_cancel");
  });

  it("maps subscription.revoked to immediate cancellation", () => {
    const parsed = polarAdapter.parseWebhookEvent({
      payload: {
        type: "subscription.revoked",
        data: {
          id: "sub_3",
          status: "unpaid",
          customer: { id: "cus_3", email: "charlie@example.com" },
          product: { id: "prod_3" },
        },
      },
    });

    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;

    expect(parsed.value.type).toBe("subscription.canceled");
    expect(parsed.value.subscription?.status).toBe("canceled");
  });

  it("uses external_customer_id for checkout and sets explicit trial interval fields", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chk_1",
          url: "https://checkout.polar.sh/checkout/chk_1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await polarAdapter.createCheckoutSession({
      customer: { id: "local_customer_uuid", email: "dora@example.com" },
      plan: { id: "prod_plan_1" },
      amount: 1500,
      currency: "USD",
      callbackUrl: "https://example.com/success",
      metadata: { type: "plan_checkout" },
      trialDays: 14,
      environment: "test",
      account: buildAccount(),
    });

    expect(result.isOk()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(String((init as RequestInit).body || "{}"));

    expect(body.customer_id).toBeUndefined();
    expect(body.external_customer_id).toBe("local_customer_uuid");
    expect(body.allow_trial).toBe(true);
    expect(body.trial_interval).toBe("day");
    expect(body.trial_interval_count).toBe(14);
  });

  it("creates a Polar customer session with customer_id for wallet setup", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "cssn_1",
          customer_portal_url: "https://polar.sh/customer-portal/test",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await polarAdapter.createCustomerSession?.({
      customer: { id: "cus_polar_999", email: "wallet@example.com" },
      metadata: { type: "card_setup", customer_id: "cust_local_1" },
      environment: "test",
      account: buildAccount(),
    });

    expect(result?.isOk()).toBe(true);
    if (!result || result.isErr()) return;
    expect(result.value.url).toBe("https://polar.sh/customer-portal/test");
    expect(result.value.token).toBe("cssn_1");

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(String((init as RequestInit).body || "{}"));
    expect(body.customer_id).toBe("cus_polar_999");
  });

  it("charges off-session via checkout client_secret confirmation when payment form is not required", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "prod_charge_1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chk_charge_1",
            url: "https://checkout.polar.sh/checkout/chk_charge_1",
            client_secret: "cs_test_123",
            status: "open",
            is_payment_form_required: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chk_charge_1",
            status: "confirmed",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chk_charge_1",
            status: "succeeded",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await polarAdapter.chargeAuthorization({
      customer: { id: "cus_polar_123", email: "dora@example.com" },
      authorizationCode: "pm_token",
      amount: 2500,
      currency: "USD",
      metadata: { type: "invoice_payment", invoice_id: "inv_1" },
      environment: "test",
      account: buildAccount(),
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.reference).toBe("chk_charge_1");
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    const confirmCall = fetchSpy.mock.calls[2];
    expect(String(confirmCall?.[0])).toContain(
      "/v1/checkouts/client/cs_test_123/confirm",
    );
  });

  it("returns invalid_request when off-session checkout still requires payment form", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "prod_charge_2",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chk_charge_2",
            url: "https://checkout.polar.sh/checkout/chk_charge_2",
            client_secret: "cs_test_456",
            status: "open",
            is_payment_form_required: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await polarAdapter.chargeAuthorization({
      customer: { id: "cus_polar_456", email: "nina@example.com" },
      authorizationCode: "pm_token",
      amount: 1800,
      currency: "USD",
      metadata: { type: "overage_billing", invoice_id: "inv_2" },
      environment: "test",
      account: buildAccount(),
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe("invalid_request");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not treat confirmed-only checkout status as successful off-session charge", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "prod_charge_3" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chk_charge_3",
            client_secret: "cs_test_789",
            status: "open",
            is_payment_form_required: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chk_charge_3",
            status: "confirmed",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              id: "chk_charge_3",
              status: "confirmed",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      );

    const result = await polarAdapter.chargeAuthorization({
      customer: { id: "cus_polar_789", email: "confirm-only@example.com" },
      authorizationCode: "pm_token",
      amount: 2200,
      currency: "USD",
      metadata: { type: "invoice_payment", invoice_id: "inv_3" },
      environment: "test",
      account: buildAccount(),
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe("request_failed");
    expect(result.error.message).toContain("last_status=confirmed");
    expect(fetchSpy).toHaveBeenCalledTimes(8);
  });
});
