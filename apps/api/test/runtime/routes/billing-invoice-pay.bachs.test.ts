import { afterEach, beforeEach, describe, expect, it } from "vitest";
import apiBilling from "../../../src/routes/api/billing";
import { encrypt } from "../../../src/lib/encryption";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { insertApiKey, RUNTIME_ROUTE_ENV } from "../helpers/catalog-runtime";
import {
  SequencedFetchTransport,
  jsonResponse,
  withFetchTransport,
} from "../helpers/fetch-transport";
import { insertInvoice } from "../helpers/overage-runtime";
import {
  TEST_ENCRYPTION_KEY,
  insertCustomer,
  insertOrganization,
  insertPlan,
  insertSubscription,
} from "../helpers/workflow-runtime";

/**
 * Bachs has no off-session charge API, so a Bachs customer can never have a
 * chargeable token on file. Paying an open invoice must therefore fall through
 * to a hosted checkout link, and the invoice must stay open until the
 * collection.succeeded webhook arrives.
 */
describe("Billing invoice pay with Bachs runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let billingApp: ReturnType<
    typeof createRouteTestApp<{ db: any; authDb: any }>
  >;
  let apiKey: string;
  let originalConsoleLog: typeof console.log;

  beforeEach(async () => {
    originalConsoleLog = console.log;
    console.log = () => {};

    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_1" });
    apiKey = await insertApiKey(businessDb.d1, {
      organizationId: "org_1",
      apiKey: "owo_sk_billing_bachs_runtime",
    });

    const now = Date.now();
    await businessDb.d1
      .prepare(
        `INSERT INTO provider_accounts
         (id, organization_id, provider_id, environment, display_name, credentials, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "acct_bachs_test",
        "org_1",
        "bachs",
        "test",
        "Bachs Sandbox",
        JSON.stringify({
          secretKey: await encrypt("sk_sandbox_runtime", TEST_ENCRYPTION_KEY),
          webhookSecret: await encrypt("whsec_runtime", TEST_ENCRYPTION_KEY),
        }),
        null,
        now,
        now,
      )
      .run();

    await insertCustomer(businessDb.d1, {
      id: "cust_1",
      organizationId: "org_1",
      providerId: "bachs",
      providerCustomerId: "cust_bachs_1",
      email: "jane@example.com",
    });
    // Bachs never exposes a reusable card token, so a real Bachs customer has
    // no saved authorization. The seed helper defaults one; clear it.
    await businessDb.d1
      .prepare(
        "UPDATE customers SET provider_authorization_code = NULL, paystack_authorization_code = NULL WHERE id = ?",
      )
      .bind("cust_1")
      .run();
    await insertPlan(businessDb.d1, {
      id: "plan_1",
      organizationId: "org_1",
      providerId: "bachs",
      providerPlanId: "prod_pro",
      paystackPlanId: null,
      currency: "USD",
      price: 1000,
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_1",
      customerId: "cust_1",
      planId: "plan_1",
      providerId: "bachs",
      providerSubscriptionId: "sub_bachs_1",
      providerSubscriptionCode: "sub_bachs_1",
      status: "active",
      currentPeriodStart: now - 1000,
      currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1000,
    });
    await insertInvoice(businessDb.d1, {
      id: "inv_1",
      organizationId: "org_1",
      customerId: "cust_1",
      subscriptionId: "sub_1",
      number: "INV-00001-TEST",
      status: "open",
      currency: "USD",
      subtotal: 2599,
      total: 2599,
      amountDue: 2599,
    });

    billingApp = createRouteTestApp(apiBilling, {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    businessDb.close();
  });

  it("returns a Bachs checkout link for an open overage invoice and leaves the invoice open", async () => {
    const transport = new SequencedFetchTransport([
      {
        method: "POST",
        origin: "https://sandbox-api.bachs.io",
        path: "/v1/checkout-sessions",
        assert(request) {
          expect(request.headers.authorization).toBe(
            "Bearer sk_sandbox_runtime",
          );
          expect(request.headers["idempotency-key"]).toBe("checkout:inv_1");
          expect(request.json<Record<string, any>>()).toEqual({
            customer: { customer_id: "cust_bachs_1" },
            pricing: { currency: "USD", amount: "25.99", price_type: "fixed" },
            success_url: "https://app.example.com/billing/return",
            cancel_url: "https://app.example.com/billing/return",
            metadata: {
              type: "invoice_payment",
              invoice_id: "inv_1",
              invoice_number: "INV-00001-TEST",
              customer_id: "cust_1",
              customer_email: "jane@example.com",
            },
          });
        },
        respond: jsonResponse({
          checkout_id: "chk_invoice_1",
          checkout_url: "https://checkout.bachs.io/c/chk_invoice_1",
          status: "open",
        }),
      },
    ]);

    const response = await withFetchTransport(transport, () =>
      billingApp.request(
        "/invoice/inv_1/pay",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            callbackUrl: "https://app.example.com/billing/return",
          }),
        },
        RUNTIME_ROUTE_ENV,
      ),
    );

    transport.assertComplete();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      paid: false,
      checkoutUrl: "https://checkout.bachs.io/c/chk_invoice_1",
      invoice: {
        id: "inv_1",
        number: "INV-00001-TEST",
        total: 2599,
        currency: "USD",
        status: "open",
      },
    });

    const invoice = await businessDb.d1
      .prepare("SELECT status, amount_due FROM invoices WHERE id = ?")
      .bind("inv_1")
      .first<{ status: string; amount_due: number }>();
    expect(invoice).toEqual({ status: "open", amount_due: 2599 });

    const attempts = await businessDb.d1
      .prepare(
        "SELECT COUNT(*) AS count FROM payment_attempts WHERE invoice_id = ?",
      )
      .bind("inv_1")
      .first<{ count: number }>();
    expect(attempts?.count).toBe(0);
  });

  it("still returns a checkout link when a stale authorization code is present, recording the unsupported auto-charge", async () => {
    // Defensive path: if a Bachs customer somehow carries an authorization
    // code (e.g. migrated from another provider), the adapter refuses the
    // off-session charge and the route must fall through to checkout.
    await businessDb.d1
      .prepare(
        "UPDATE customers SET provider_authorization_code = 'AUTH_STALE' WHERE id = ?",
      )
      .bind("cust_1")
      .run();

    const transport = new SequencedFetchTransport([
      {
        method: "POST",
        origin: "https://sandbox-api.bachs.io",
        path: "/v1/checkout-sessions",
        respond: jsonResponse({
          checkout_id: "chk_invoice_2",
          checkout_url: "https://checkout.bachs.io/c/chk_invoice_2",
          status: "open",
        }),
      },
    ]);

    const response = await withFetchTransport(transport, () =>
      billingApp.request(
        "/invoice/inv_1/pay",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
        RUNTIME_ROUTE_ENV,
      ),
    );

    transport.assertComplete();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      paid: false,
      checkoutUrl: "https://checkout.bachs.io/c/chk_invoice_2",
    });

    const invoice = await businessDb.d1
      .prepare("SELECT status FROM invoices WHERE id = ?")
      .bind("inv_1")
      .first<{ status: string }>();
    expect(invoice?.status).toBe("open");

    const attempt = await businessDb.d1
      .prepare(
        "SELECT status, provider, last_error FROM payment_attempts WHERE invoice_id = ?",
      )
      .bind("inv_1")
      .first<{ status: string; provider: string; last_error: string }>();
    expect(attempt).toMatchObject({ status: "failed", provider: "bachs" });
    expect(attempt?.last_error).toContain("no off-session charge API");
  });
});
