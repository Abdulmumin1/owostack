import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebhookRoutes } from "../../../src/routes/webhooks";
import { encrypt } from "../../../src/lib/encryption";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  TEST_ENCRYPTION_KEY,
  insertCustomer,
  insertOrganization,
  insertPlan,
} from "../helpers/workflow-runtime";

const WEBHOOK_SECRET = "whsec_bachs_runtime_secret";

type SubscriptionRow = {
  id: string;
  status: string;
  plan_id: string;
  provider_id: string;
  provider_subscription_id: string | null;
  provider_subscription_code: string | null;
  current_period_end: number;
};

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

async function loadSubscriptions(
  db: D1Database,
  customerId: string,
): Promise<SubscriptionRow[]> {
  const result = await db
    .prepare(
      `SELECT id, status, plan_id, provider_id, provider_subscription_id, provider_subscription_code, current_period_end
       FROM subscriptions
       WHERE customer_id = ?
       ORDER BY created_at ASC`,
    )
    .bind(customerId)
    .all<SubscriptionRow>();
  return result.results ?? [];
}

const env = {
  ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  ENVIRONMENT: "test",
  CACHE: undefined,
  ANALYTICS: undefined,
  TRIAL_END_WORKFLOW: { create: async () => null },
  PLAN_UPGRADE_WORKFLOW: { create: async () => null },
  RENEWAL_SETUP_WORKFLOW: { create: async () => null },
};

describe("Bachs webhook lifecycle runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<
    typeof createRouteTestApp<{ db: unknown; authDb: unknown }>
  >;
  let originalConsoleError: typeof console.error;
  let originalConsoleLog: typeof console.log;

  async function deliver(
    event: Record<string, unknown>,
    options: {
      secret?: string;
      timestampOffsetSeconds?: number;
      omitSignature?: boolean;
      omitTimestamp?: boolean;
    } = {},
  ) {
    const payload = JSON.stringify(event);
    const timestamp = String(
      Math.floor(Date.now() / 1000) + (options.timestampOffsetSeconds ?? 0),
    );
    const signature = await signBachs(
      options.secret ?? WEBHOOK_SECRET,
      timestamp,
      payload,
    );

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (!options.omitSignature) headers["x-bachs-signature"] = signature;
    if (!options.omitTimestamp) headers["x-bachs-timestamp"] = timestamp;

    return app.request(
      "/webhooks/org_1/bachs",
      { method: "POST", headers, body: payload },
      env,
    );
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T12:00:05.000Z"));

    originalConsoleError = console.error;
    originalConsoleLog = console.log;
    console.error = () => {};
    console.log = () => {};

    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_1" });

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
          webhookSecret: await encrypt(WEBHOOK_SECRET, TEST_ENCRYPTION_KEY),
        }),
        null,
        now,
        now,
      )
      .run();

    await insertCustomer(businessDb.d1, {
      id: "cust_local_1",
      organizationId: "org_1",
      providerId: "bachs",
      providerCustomerId: "cust_bachs_1",
      providerAuthorizationCode: null,
      paystackCustomerId: null,
      paystackAuthorizationCode: null,
      email: "jane@example.com",
      name: "Jane Doe",
    });

    await insertPlan(businessDb.d1, {
      id: "plan_pro",
      organizationId: "org_1",
      providerId: "bachs",
      providerPlanId: "prod_pro",
      paystackPlanId: null,
      name: "Pro",
      slug: "pro",
      price: 1000,
      currency: "USD",
      interval: "monthly",
    });

    // The shared migrations create both the auth and business tables, so a
    // single runtime DB can stand in for both bindings.
    app = createRouteTestApp(createWebhookRoutes(), {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    businessDb.close();
    vi.useRealTimers();
  });

  const checkoutMetadata = {
    organization_id: "org_1",
    plan_id: "plan_pro",
    plan_slug: "pro",
    customer_id: "cust_local_1",
    environment: "test",
    provider_id: "bachs",
    amount: "1000",
    currency: "USD",
  };

  it("rejects deliveries that are unsigned, mis-signed, or stale without touching state", async () => {
    const event = {
      id: "evt_bad",
      type: "collection.succeeded",
      created_at: "2026-04-27T12:00:00.000000+00:00",
      organization_id: "acct_bachs_org",
      data: {
        payment_id: "pay_bad",
        amount: "10.00",
        currency: "USD",
        customer: { id: "cust_bachs_1", email: "jane@example.com" },
        metadata: checkoutMetadata,
      },
    };

    const missingSignature = await deliver(event, { omitSignature: true });
    expect(missingSignature.status).toBe(401);

    const wrongSecret = await deliver(event, { secret: "whsec_someone_else" });
    expect(wrongSecret.status).toBe(401);

    const stale = await deliver(event, { timestampOffsetSeconds: -600 });
    expect(stale.status).toBe(401);

    const missingTimestamp = await deliver(event, { omitTimestamp: true });
    expect(missingTimestamp.status).toBe(401);

    expect(await loadSubscriptions(businessDb.d1, "cust_local_1")).toEqual([]);
  });

  it("acknowledges but skips events Owostack does not act on", async () => {
    const response = await deliver({
      id: "evt_invoice_paid",
      type: "invoice.paid",
      created_at: "2026-05-01T00:00:00.000000+00:00",
      organization_id: "acct_bachs_org",
      data: {
        invoice_id: "inv_1",
        subscription: { subscription_id: "sub_bachs_1" },
        customer: { customer_id: "cust_bachs_1", email: "jane@example.com" },
        status: "paid",
        currency: "USD",
        total: "10.00",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ skipped: true });
    expect(await loadSubscriptions(businessDb.d1, "cust_local_1")).toEqual([]);
  });

  it("activates, links, schedules cancellation, and cancels a subscription across the Bachs event sequence", async () => {
    // 1. First cycle collected at checkout.
    const collected = await deliver({
      id: "evt_collection_1",
      type: "collection.succeeded",
      created_at: "2026-04-27T12:00:00.000000+00:00",
      organization_id: "acct_bachs_org",
      data: {
        payment_id: "pay_bachs_1",
        checkout_id: "chk_bachs_1",
        reference: null,
        status: "SUCCEEDED",
        amount: "10.00",
        currency: "USD",
        payment_method: "CARD",
        billing_reason: "subscription_create",
        subscription_id: "sub_bachs_1",
        customer: {
          id: "cust_bachs_1",
          email: "jane@example.com",
          name: "Jane Doe",
        },
        metadata: checkoutMetadata,
      },
    });
    expect(collected.status).toBe(200);
    expect(await collected.json()).toMatchObject({ success: true });

    const afterCollection = await loadSubscriptions(
      businessDb.d1,
      "cust_local_1",
    );
    expect(afterCollection).toHaveLength(1);
    expect(afterCollection[0]).toMatchObject({
      status: "active",
      plan_id: "plan_pro",
      provider_id: "bachs",
    });
    expect(afterCollection[0]?.current_period_end).toBeGreaterThan(Date.now());

    // 2. Bachs reports the subscription it created.
    const created = await deliver({
      id: "evt_sub_created_1",
      type: "customer.subscription.created",
      created_at: "2026-04-27T12:00:01.000000+00:00",
      organization_id: "acct_bachs_org",
      data: {
        subscription_id: "sub_bachs_1",
        customer: {
          customer_id: "cust_bachs_1",
          email: "jane@example.com",
          name: "Jane Doe",
        },
        product_id: "prod_pro",
        status: "active",
        collection_method: "charge_automatically",
        currency: "USD",
        amount: "10.00",
        billing_cycle: { interval: "month", frequency: 1 },
        quantity: 1,
        current_period_start: "2026-04-27T12:00:00Z",
        current_period_end: "2026-05-27T12:00:00Z",
        next_billed_at: "2026-05-27T12:00:00Z",
        trial_end: null,
        cancel_at_period_end: false,
        canceled_at: null,
        created_at: "2026-04-27T12:00:00Z",
        items: [],
        metadata: checkoutMetadata,
      },
    });
    expect(created.status).toBe(200);

    const afterCreated = await loadSubscriptions(businessDb.d1, "cust_local_1");
    const active = afterCreated.filter((row) => row.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0]?.provider_subscription_code).toBe("sub_bachs_1");

    // 3. Customer schedules cancellation at period end.
    const scheduled = await deliver({
      id: "evt_sub_updated_1",
      type: "customer.subscription.updated",
      created_at: "2026-05-10T12:00:00.000000+00:00",
      organization_id: "acct_bachs_org",
      data: {
        subscription_id: "sub_bachs_1",
        customer: { customer_id: "cust_bachs_1", email: "jane@example.com" },
        product_id: "prod_pro",
        status: "active",
        currency: "USD",
        amount: "10.00",
        current_period_start: "2026-04-27T12:00:00Z",
        current_period_end: "2026-05-27T12:00:00Z",
        next_billed_at: null,
        cancel_at_period_end: true,
        canceled_at: null,
        metadata: checkoutMetadata,
      },
    });
    expect(scheduled.status).toBe(200);

    const afterScheduled = await loadSubscriptions(
      businessDb.d1,
      "cust_local_1",
    );
    const linked = afterScheduled.find(
      (row) => row.provider_subscription_code === "sub_bachs_1",
    );
    expect(linked?.status).toBe("pending_cancel");

    // 4. Period ends; Bachs deletes the subscription.
    const deleted = await deliver({
      id: "evt_sub_deleted_1",
      type: "customer.subscription.deleted",
      created_at: "2026-05-27T12:00:00.000000+00:00",
      organization_id: "acct_bachs_org",
      data: {
        subscription_id: "sub_bachs_1",
        customer: { customer_id: "cust_bachs_1", email: "jane@example.com" },
        product_id: "prod_pro",
        status: "canceled",
        currency: "USD",
        amount: "10.00",
        current_period_start: "2026-04-27T12:00:00Z",
        current_period_end: "2026-05-27T12:00:00Z",
        next_billed_at: null,
        cancel_at_period_end: true,
        canceled_at: "2026-05-27T12:00:00Z",
        metadata: checkoutMetadata,
      },
    });
    expect(deleted.status).toBe(200);

    const afterDeleted = await loadSubscriptions(businessDb.d1, "cust_local_1");
    const finalRow = afterDeleted.find(
      (row) => row.provider_subscription_code === "sub_bachs_1",
    );
    expect(finalRow?.status).toBe("canceled");
    expect(afterDeleted.some((row) => row.status === "active")).toBe(false);
  });

  it("is idempotent when Bachs redelivers the same collection.succeeded event", async () => {
    const event = {
      id: "evt_collection_dup",
      type: "collection.succeeded",
      created_at: "2026-04-27T12:00:00.000000+00:00",
      organization_id: "acct_bachs_org",
      data: {
        payment_id: "pay_bachs_dup",
        checkout_id: "chk_bachs_dup",
        status: "SUCCEEDED",
        amount: "10.00",
        currency: "USD",
        customer: { id: "cust_bachs_1", email: "jane@example.com" },
        metadata: checkoutMetadata,
      },
    };

    expect((await deliver(event)).status).toBe(200);
    expect((await deliver(event)).status).toBe(200);

    const rows = await loadSubscriptions(businessDb.d1, "cust_local_1");
    expect(rows.filter((row) => row.status === "active")).toHaveLength(1);
  });
});
