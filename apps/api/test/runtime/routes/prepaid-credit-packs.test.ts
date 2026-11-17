import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import entitlementsRoute from "../../../src/routes/api/entitlements";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  insertApiKey,
  insertCreditSystem,
  RUNTIME_ROUTE_ENV,
} from "../helpers/catalog-runtime";
import { insertFeature, insertPlanFeature } from "../helpers/overage-runtime";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
  insertSubscription,
} from "../helpers/workflow-runtime";

describe("Prepaid credit-pack entitlements", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<typeof createRouteTestApp<{ db: any; authDb: any }>>;
  let apiKey: string;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_123" });
    apiKey = await insertApiKey(businessDb.d1, {
      organizationId: "org_123",
      apiKey: "owo_sk_test_prepaid_packs",
    });
    app = createRouteTestApp(entitlementsRoute, {
      db: businessDb.db,
      authDb: businessDb.db,
    });

    await insertFeature(businessDb.d1, {
      id: "feature_song",
      organizationId: "org_123",
      slug: "song",
      name: "Song",
      type: "metered",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_songs",
      organizationId: "org_123",
      slug: "songs",
      name: "Song credits",
      type: "metered",
    });
    await insertCreditSystem(businessDb.d1, {
      id: "credit_system_songs",
      organizationId: "org_123",
      slug: "songs",
      name: "Song credits",
    });
    const now = Date.now();
    await businessDb.d1
      .prepare(
        `INSERT INTO credit_system_features
         (id, credit_system_id, feature_id, cost, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        "credit_system_feature_song",
        "credit_system_songs",
        "feature_song",
        5,
        now,
      )
      .run();
  });

  afterEach(() => {
    businessDb.close();
  });

  const request = (path: "/check" | "/track", body: Record<string, unknown>) =>
    app.request(
      path,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      RUNTIME_ROUTE_ENV,
    );

  async function seedPackBalance(customerId: string, balance: number) {
    await insertCustomer(businessDb.d1, {
      id: customerId,
      organizationId: "org_123",
      externalId: customerId,
      email: `${customerId}@example.com`,
    });
    await businessDb.d1
      .prepare(
        `INSERT INTO credit_system_balances
         (id, customer_id, credit_system_id, balance, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        `balance_${customerId}`,
        customerId,
        "credit_system_songs",
        balance,
        Date.now(),
      )
      .run();
  }

  it("checks and spends a feature's pack credits without a subscription", async () => {
    await seedPackBalance("cust_pack_only", 10);

    const check = await request("/check", {
      customer: "cust_pack_only",
      feature: "song",
      value: 1,
    });
    expect(check.status).toBe(200);
    expect(await check.json()).toMatchObject({
      allowed: true,
      code: "addon_credits_used",
      balance: 10,
      credits: {
        source: "credit_system",
        systemSlug: "songs",
        costPerUnit: 5,
        addonBalance: 10,
      },
    });

    const track = await request("/track", {
      customer: "cust_pack_only",
      feature: "song",
      value: 1,
    });
    expect(track.status).toBe(200);
    expect(await track.json()).toMatchObject({
      allowed: true,
      code: "addon_credits_used",
      balance: 5,
      credits: {
        source: "credit_system",
        systemSlug: "songs",
        addonBalance: 5,
      },
    });

    const persisted = await businessDb.db.query.creditSystemBalances.findFirst({
      where: eq(schema.creditSystemBalances.customerId, "cust_pack_only"),
    });
    expect(persisted?.balance).toBe(5);
  });

  it("accepts a metered feature slug when a zero-limit plan grants its credit system", async () => {
    await seedPackBalance("cust_zero_plan", 10);
    await insertPlan(businessDb.d1, {
      id: "plan_payg",
      organizationId: "org_123",
      slug: "payg",
      name: "Pay as you go",
      price: 0,
      type: "free",
    });
    await insertPlanFeature(businessDb.d1, {
      id: "plan_feature_songs",
      planId: "plan_payg",
      featureId: "feature_songs",
      limitValue: 0,
      overage: "block",
    });
    await insertSubscription(businessDb.d1, {
      id: "subscription_payg",
      customerId: "cust_zero_plan",
      planId: "plan_payg",
      status: "active",
      currentPeriodStart: Date.now() - 1_000,
      currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1_000,
    });

    const response = await request("/check", {
      customer: "cust_zero_plan",
      feature: "song",
      value: 1,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      allowed: true,
      code: "addon_credits_used",
      credits: {
        systemSlug: "songs",
        costPerUnit: 5,
        addonBalance: 10,
      },
    });
  });

  it("returns the first atomic consume result on retry without spending twice", async () => {
    await seedPackBalance("cust_retry", 10);
    const pending: Promise<unknown>[] = [];
    const executionCtx = {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
      passThroughOnException() {},
    };
    const body = {
      customer: "cust_retry",
      feature: "song",
      value: 1,
      sendEvent: true,
      idempotencyKey: "generate:track_42",
    };

    const first = await app.request(
      "/check",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      RUNTIME_ROUTE_ENV,
      executionCtx,
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({
      allowed: true,
      code: "addon_credits_used",
      credits: { addonBalance: 5, totalBalance: 5 },
    });
    await Promise.all(pending.splice(0));

    const retry = await app.request(
      "/check",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      RUNTIME_ROUTE_ENV,
      executionCtx,
    );
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(firstBody);

    const persisted = await businessDb.db.query.creditSystemBalances.findFirst({
      where: eq(schema.creditSystemBalances.customerId, "cust_retry"),
    });
    expect(persisted?.balance).toBe(5);
  });
});
