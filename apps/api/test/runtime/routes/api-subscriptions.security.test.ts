import { afterEach, beforeEach, describe, expect, it } from "vitest";
import subscriptionsRoute from "../../../src/routes/api/subscriptions";
import { hashApiKey } from "../../../src/lib/api-keys";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
  insertSubscription,
} from "../helpers/workflow-runtime";

type SubscriptionStatusRow = {
  status: string;
};

async function insertApiKey(
  db: D1Database,
  organizationId: string,
  apiKey: string,
) {
  const now = Date.now();
  const hash = await hashApiKey(apiKey);
  await db
    .prepare(
      `INSERT INTO api_keys
       (id, organization_id, name, prefix, hash, created_at, revoked_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `key_${organizationId}`,
      organizationId,
      `Key ${organizationId}`,
      "owo_sk_",
      hash,
      now,
      null,
      null,
    )
    .run();
}

async function loadSubscriptionStatus(
  db: D1Database,
  id: string,
): Promise<SubscriptionStatusRow | null> {
  return db
    .prepare(`SELECT status FROM subscriptions WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<SubscriptionStatusRow>();
}

describe("API subscriptions route runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<
    typeof createRouteTestApp<{ db: any; authDb: any }>
  >;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_owner" });
    await insertOrganization(businessDb.d1, { id: "org_victim" });

    await insertCustomer(businessDb.d1, {
      id: "cust_victim",
      organizationId: "org_victim",
      email: "victim@example.com",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_victim",
      organizationId: "org_victim",
      name: "Victim Plan",
      slug: "victim-plan",
      price: 0,
      type: "free",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_victim_pending",
      customerId: "cust_victim",
      planId: "plan_victim",
      status: "pending",
    });

    await insertApiKey(businessDb.d1, "org_owner", "owo_sk_owner_123");

    app = createRouteTestApp(subscriptionsRoute, {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  it("does not allow one organization's API key to activate another organization's pending subscription", async () => {
    const response = await app.request(
      "/sub_victim_pending/checkout",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer owo_sk_owner_123",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
      {
        DASHBOARD_URL: "http://localhost:5173",
      },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Pending subscription not found",
    });

    expect(
      await loadSubscriptionStatus(businessDb.d1, "sub_victim_pending"),
    ).toEqual({ status: "pending" });
  });
});
