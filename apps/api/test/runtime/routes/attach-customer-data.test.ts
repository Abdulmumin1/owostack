import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import checkoutRoute from "../../../src/routes/api/checkout";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { insertApiKey, RUNTIME_ROUTE_ENV } from "../helpers/catalog-runtime";
import {
  jsonResponse,
  SequencedFetchTransport,
  withFetchTransport,
} from "../helpers/fetch-transport";
import { insertOrganization, insertPlan } from "../helpers/workflow-runtime";

/**
 * `attach()` with an external id + `customerData`, end to end: real route,
 * real D1, real Paystack adapter over a captured transport. Reproduces the
 * sandbox failure where the external id was persisted as the customer's
 * email and every provider rejected the checkout.
 */

const API_KEY = "owo_sk_test_attach0123456789abcdef0123456789abcdef";
const MANAGED = { MANAGED_SANDBOX_PAYSTACK: "sk_test_managed" };

describe("POST /attach customer resolution", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<typeof createRouteTestApp<{ db: any; authDb: any }>>;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_attach" });
    await insertApiKey(businessDb.d1, {
      id: "key_attach",
      organizationId: "org_attach",
      apiKey: API_KEY,
    });
    await insertPlan(businessDb.d1, {
      id: "plan_pro",
      organizationId: "org_attach",
      slug: "pro",
      name: "Pro",
      price: 250000,
      currency: "NGN",
      providerId: "paystack",
      providerPlanId: "PLN_remote",
      paystackPlanId: "PLN_remote",
      type: "paid",
      billingType: "recurring",
    });
    app = createRouteTestApp(checkoutRoute, {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => businessDb.close());

  function attach(body: Record<string, unknown>) {
    return app.request(
      "/attach",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      { ...RUNTIME_ROUTE_ENV, ENVIRONMENT: "test", ...MANAGED },
    );
  }

  function paystackInitialize(expectedEmail: string) {
    return new SequencedFetchTransport([
      {
        method: "POST",
        origin: "https://api.paystack.co",
        path: "/transaction/initialize",
        assert: (request) => {
          expect(request.json<{ email: string }>().email).toBe(expectedEmail);
        },
        respond: jsonResponse({
          status: true,
          data: {
            authorization_url: "https://checkout.paystack.com/x",
            access_code: "ac_x",
            reference: "ref_x",
          },
        }),
      },
    ]);
  }

  it("creates the customer from customerData when `customer` is an external id", async () => {
    const transport = paystackInitialize("jane@example.com");
    const response = await withFetchTransport(transport, () =>
      attach({
        customer: "user_123",
        product: "pro",
        customerData: { email: "Jane@Example.com", name: "Jane" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      requiresCheckout: true,
      checkoutUrl: "https://checkout.paystack.com/x",
    });
    transport.assertComplete();

    const customer = await businessDb.db.query.customers.findFirst({
      where: eq(schema.customers.externalId, "user_123"),
    });
    expect(customer).toMatchObject({
      externalId: "user_123",
      email: "jane@example.com",
      name: "Jane",
    });
  });

  it("still accepts a bare email as the identifier", async () => {
    const transport = paystackInitialize("bob@example.com");
    const response = await withFetchTransport(transport, () =>
      attach({ customer: "Bob@Example.com", product: "pro" }),
    );

    expect(response.status).toBe(200);
    transport.assertComplete();

    const customer = await businessDb.db.query.customers.findFirst({
      where: eq(schema.customers.email, "bob@example.com"),
    });
    expect(customer?.externalId).toBeNull();
  });

  it("refuses to invent an email from an unknown external id", async () => {
    const transport = new SequencedFetchTransport([]);
    const response = await withFetchTransport(transport, () =>
      attach({ customer: "user_unknown", product: "pro" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: expect.stringContaining("customerData.email"),
    });
    transport.assertComplete();

    const rows = await businessDb.db.query.customers.findMany({
      where: eq(schema.customers.organizationId, "org_attach"),
    });
    expect(rows).toHaveLength(0);
  });
});
