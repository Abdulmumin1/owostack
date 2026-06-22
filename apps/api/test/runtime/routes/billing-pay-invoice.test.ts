import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import billingRoute, {
  billingRouteDependencies,
  resetBillingRouteDependencies,
} from "../../../src/routes/api/billing";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  createSimulatedProviderRegistry,
  insertApiKey,
} from "../helpers/catalog-runtime";
import { insertInvoice } from "../helpers/overage-runtime";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
  insertProviderAccount,
  insertSubscription,
  SimulatedProviderAdapter,
  TEST_ENCRYPTION_KEY,
} from "../helpers/workflow-runtime";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("Pay invoice route runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<
    typeof createRouteTestApp<{ db: any; authDb: any; organizationId: string }>
  >;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_1" });
    await insertApiKey(businessDb.d1, {
      id: "key_1",
      organizationId: "org_1",
      apiKey: "owo_sk_test_invoice_pay",
    });
    await insertProviderAccount({
      db: businessDb.d1,
      id: "acct_paystack_test",
      organizationId: "org_1",
      providerId: "paystack",
      environment: "test",
    });
    await insertCustomer(businessDb.d1, {
      id: "cust_1",
      organizationId: "org_1",
      providerId: "paystack",
      providerCustomerId: "cus_provider_1",
      providerAuthorizationCode: "AUTH_saved_card",
      email: "ada@example.com",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_1",
      organizationId: "org_1",
      providerId: "paystack",
      price: 10000,
      currency: "NGN",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_1",
      customerId: "cust_1",
      planId: "plan_1",
      providerId: "paystack",
      status: "active",
    });
    await insertInvoice(businessDb.d1, {
      id: "inv_1",
      organizationId: "org_1",
      customerId: "cust_1",
      subscriptionId: "sub_1",
      number: "INV-00001",
      currency: "NGN",
      total: 10000,
      amountDue: 10000,
    });

    app = createRouteTestApp(billingRoute, {
      db: businessDb.db,
      authDb: businessDb.db,
      organizationId: "org_1",
    });
  });

  afterEach(() => {
    resetBillingRouteDependencies();
    businessDb.close();
  });

  it("claims an open invoice before charging so concurrent pay requests cannot double-charge", async () => {
    const chargeGate = deferred<void>();
    const firstChargeStarted = deferred<void>();
    let chargeCount = 0;
    const paystack = new SimulatedProviderAdapter({
      id: "paystack",
      expectedEnvironment: "test",
      onChargeAuthorization: async (params) => {
        chargeCount += 1;
        firstChargeStarted.resolve();
        await chargeGate.promise;
        return Result.ok({ reference: params.reference || "charge_inv_1" });
      },
    });
    billingRouteDependencies.getProviderRegistry = () =>
      createSimulatedProviderRegistry([paystack]);

    const requestInit = {
      method: "POST",
      headers: {
        Authorization: "Bearer owo_sk_test_invoice_pay",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    };
    const env = {
      ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      ENVIRONMENT: "test",
    };

    const first = app.request("/invoice/inv_1/pay", requestInit, env);
    await firstChargeStarted.promise;
    const second = app.request("/invoice/inv_1/pay", requestInit, env);
    const secondResponse = await second;

    expect(secondResponse.status).toBe(409);
    expect(chargeCount).toBe(1);

    chargeGate.resolve();

    const firstResponse = await first;
    expect(firstResponse.status).toBe(200);
    expect(chargeCount).toBe(1);

    const invoice = await businessDb.db.query.invoices.findFirst({
      where: eq(schema.invoices.id, "inv_1"),
    });
    expect(invoice?.status).toBe("paid");
    expect(invoice?.amountDue).toBe(0);
    expect(invoice?.amountPaid).toBe(10000);

    const attempts = await businessDb.d1
      .prepare(
        `SELECT provider_reference, status
         FROM payment_attempts
         WHERE invoice_id = ?
         ORDER BY created_at`,
      )
      .bind("inv_1")
      .all<{ provider_reference: string; status: string }>();
    expect(attempts.results).toEqual([
      { provider_reference: "inv_1", status: "succeeded" },
    ]);
  });
});
