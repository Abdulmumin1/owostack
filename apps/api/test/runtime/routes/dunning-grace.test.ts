import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { stripeAdapter } from "@owostack/adapters";
import entitlementsRoute from "../../../src/routes/api/entitlements";
import { publicApiEnvelope } from "../../../src/lib/public-api-envelope";
import { WebhookHandler } from "../../../src/lib/webhooks";
import { DUNNING_GRACE_MS } from "../../../src/lib/dunning";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { insertApiKey, RUNTIME_ROUTE_ENV } from "../helpers/catalog-runtime";
import {
  insertFeature,
  insertPlanFeature,
  SimulatedUsageLedgerNamespace,
  SimulatedUsageMeterNamespace,
} from "../helpers/overage-runtime";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
  insertSubscription,
} from "../helpers/workflow-runtime";

/**
 * Dunning: a failed renewal puts the subscription in past_due while the
 * provider retries. Entitlements keep flowing for the grace window, with a
 * payment prompt in `details`, and stop afterwards.
 *
 * Real check/track routes, real webhook handler, real D1.
 */

const API_KEY = "owo_sk_test_dunning0123456789abcdef0123456789abcd";
const T0 = Date.parse("2026-10-23T16:00:00.000Z");

describe("dunning grace on past_due subscriptions", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<typeof createRouteTestApp<{ db: any; authDb: any }>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));

    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_1" });
    await insertApiKey(businessDb.d1, {
      id: "key_1",
      organizationId: "org_1",
      apiKey: API_KEY,
    });
    await insertCustomer(businessDb.d1, {
      id: "cust_1",
      organizationId: "org_1",
      email: "cardfail@owostack.dev",
      providerId: "stripe",
      providerCustomerId: "cus_1",
    });
    await insertFeature(businessDb.d1, {
      id: "feat_calls",
      organizationId: "org_1",
      slug: "api-calls",
      type: "metered",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_pro",
      organizationId: "org_1",
      slug: "pro",
      name: "Pro",
      price: 1900,
      currency: "USD",
      providerId: "stripe",
      providerPlanId: "price_pro",
      paystackPlanId: null,
      type: "paid",
      billingType: "recurring",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "pf_calls",
      planId: "plan_pro",
      featureId: "feat_calls",
      limitValue: 1000,
      resetInterval: "monthly",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_1",
      customerId: "cust_1",
      planId: "plan_pro",
      providerId: "stripe",
      providerSubscriptionCode: "sub_stripe_1",
      status: "active",
      currentPeriodStart: T0 - 30 * 24 * 3600 * 1000,
      currentPeriodEnd: T0 + 30 * 24 * 3600 * 1000,
    });

    const v1 = new Hono<any>();
    v1.use("*", publicApiEnvelope);
    v1.route("/", entitlementsRoute);
    app = createRouteTestApp(v1, { db: businessDb.db, authDb: businessDb.db });
  });

  afterEach(() => {
    businessDb.close();
    vi.useRealTimers();
  });

  const env = () => ({
    ...RUNTIME_ROUTE_ENV,
    ENVIRONMENT: "test",
    USAGE_LEDGER:
      new SimulatedUsageLedgerNamespace() as unknown as DurableObjectNamespace<any>,
    USAGE_METER:
      new SimulatedUsageMeterNamespace() as unknown as DurableObjectNamespace<any>,
  });

  async function post(path: "/check" | "/track", body: Record<string, unknown>) {
    const res = await app.request(
      path,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      env(),
    );
    return res.json();
  }

  /** The exact clover-shaped invoice.payment_failed Stripe sent in the sandbox. */
  async function failRenewalViaWebhook() {
    const parsed = stripeAdapter.parseWebhookEvent({
      payload: {
        type: "invoice.payment_failed",
        data: {
          object: {
            id: "in_renewal",
            object: "invoice",
            customer: "cus_1",
            customer_email: "cardfail@owostack.dev",
            amount_due: 1900,
            amount_paid: 0,
            currency: "usd",
            status: "open",
            billing_reason: "subscription_cycle",
            parent: {
              subscription_details: {
                subscription: "sub_stripe_1",
                metadata: { organization_id: "org_1", plan_id: "plan_pro" },
              },
            },
            lines: { data: [] },
          },
        },
      },
    });
    if (parsed.isErr()) throw new Error(parsed.error.message);
    const handler = new WebhookHandler(businessDb.db, "org_1", {
      adapter: stripeAdapter,
    });
    expect((await handler.handle(parsed.value)).isOk()).toBe(true);
  }

  it("stamps past_due_since when the renewal fails", async () => {
    await failRenewalViaWebhook();
    const sub = await businessDb.db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.id, "sub_1"),
    });
    expect(sub?.status).toBe("past_due");
    expect((sub?.metadata as any).past_due_since).toBe(T0);
  });

  it("keeps granting access during grace and tells the app why", async () => {
    await failRenewalViaWebhook();

    vi.setSystemTime(new Date(T0 + 3 * 24 * 3600 * 1000)); // day 3 of dunning
    const check = await post("/check", { customer: "cardfail@owostack.dev", feature: "api-calls" });
    expect(check).toMatchObject({
      allowed: true,
      code: "access_granted",
      limit: 1000,
      details: {
        plan: "pro",
        paymentStatus: "past_due",
        graceEndsAt: new Date(T0 + DUNNING_GRACE_MS).toISOString(),
      },
    });

    const track = await post("/track", { customer: "cardfail@owostack.dev", feature: "api-calls", value: 5 });
    expect(track).toMatchObject({
      allowed: true,
      code: "tracked",
      details: { paymentStatus: "past_due" },
    });
  });

  it("revokes access once the grace window closes", async () => {
    await failRenewalViaWebhook();

    vi.setSystemTime(new Date(T0 + DUNNING_GRACE_MS + 60_000));
    const check = await post("/check", { customer: "cardfail@owostack.dev", feature: "api-calls" });
    expect(check).toMatchObject({ allowed: false, code: "no_active_subscription" });
    expect(check.details.paymentStatus).toBeUndefined();
  });

  it("does not decorate healthy subscriptions", async () => {
    const check = await post("/check", { customer: "cardfail@owostack.dev", feature: "api-calls" });
    expect(check.allowed).toBe(true);
    expect(check.details.paymentStatus).toBeUndefined();
    expect(check.details.graceEndsAt).toBeUndefined();
  });
});
