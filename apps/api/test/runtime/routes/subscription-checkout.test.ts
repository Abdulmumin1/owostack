import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import subscriptionsRoute from "../../../src/routes/api/subscriptions";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { insertApiKey } from "../helpers/catalog-runtime";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
  insertSubscription,
} from "../helpers/workflow-runtime";

describe("Subscription checkout route tenant boundary", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let apiKey: string;
  let app: ReturnType<
    typeof createRouteTestApp<{
      db: ReturnType<typeof createRuntimeBusinessDb>["db"];
      authDb: ReturnType<typeof createRuntimeBusinessDb>["db"];
    }>
  >;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_key_owner" });
    await insertOrganization(businessDb.d1, { id: "org_other" });
    apiKey = await insertApiKey(businessDb.d1, {
      id: "key_key_owner",
      organizationId: "org_key_owner",
      apiKey: "owo_sk_subscription_checkout_owner",
    });
    app = createRouteTestApp(subscriptionsRoute, {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  async function checkout(subscriptionId: string) {
    return app.request(`/${subscriptionId}/checkout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  }

  it("does not activate another organization's free pending subscription", async () => {
    await insertCustomer(businessDb.d1, {
      id: "cust_other",
      organizationId: "org_other",
      email: "other@example.com",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_other_free",
      organizationId: "org_other",
      name: "Other Free",
      slug: "other-free",
      price: 0,
      type: "free",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_other_free",
      customerId: "cust_other",
      planId: "plan_other_free",
      status: "pending",
    });

    const response = await checkout("sub_other_free");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Pending subscription not found",
    });

    const subscription = await businessDb.db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.id, "sub_other_free"),
    });
    expect(subscription?.status).toBe("pending");

    const entitlements = await businessDb.db.query.entitlements.findMany({
      where: eq(schema.entitlements.customerId, "cust_other"),
    });
    expect(entitlements).toEqual([]);
  });

  it("returns 404 when either side of a subscription tuple is outside the API key organization", async () => {
    await insertCustomer(businessDb.d1, {
      id: "cust_key_owner",
      organizationId: "org_key_owner",
      email: "owner@example.com",
    });
    await insertCustomer(businessDb.d1, {
      id: "cust_other",
      organizationId: "org_other",
      email: "other@example.com",
    });
    await insertPlan(businessDb.d1, {
      id: "plan_key_owner",
      organizationId: "org_key_owner",
      name: "Owner Paid",
      slug: "owner-paid",
      price: 5000,
    });
    await insertPlan(businessDb.d1, {
      id: "plan_other",
      organizationId: "org_other",
      name: "Other Paid",
      slug: "other-paid",
      price: 5000,
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_other_plan",
      customerId: "cust_key_owner",
      planId: "plan_other",
      status: "pending",
    });
    await insertSubscription(businessDb.d1, {
      id: "sub_other_customer",
      customerId: "cust_other",
      planId: "plan_key_owner",
      status: "pending",
    });

    for (const subscriptionId of ["sub_other_plan", "sub_other_customer"]) {
      const response = await checkout(subscriptionId);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "Pending subscription not found",
      });
    }
  });
});
