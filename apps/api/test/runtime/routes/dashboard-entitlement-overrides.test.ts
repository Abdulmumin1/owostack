import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@owostack/db";
import entitlementOverridesRoute from "../../../src/routes/dashboard/entitlement-overrides";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { RUNTIME_ROUTE_ENV } from "../helpers/catalog-runtime";
import { insertFeature } from "../helpers/overage-runtime";
import { insertCustomer, insertOrganization } from "../helpers/workflow-runtime";

describe("Dashboard entitlement override route runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<
    typeof createRouteTestApp<{
      db: any;
      organizationId: string;
      user: { id: string };
    }>
  >;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_123" });
    await insertCustomer(businessDb.d1, {
      id: "cust_123",
      organizationId: "org_123",
      email: "customer@example.com",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_ai_credits",
      organizationId: "org_123",
      slug: "ai-credits",
      name: "AI Credits",
      type: "metered",
    });

    app = createRouteTestApp(entitlementOverridesRoute, {
      db: businessDb.db,
      organizationId: "org_123",
      user: { id: "user_admin" },
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  it("upserts a manual override without creating duplicate entitlement rows", async () => {
    const firstResponse = await app.request(
      "/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: "cust_123",
          featureId: "feature_ai_credits",
          mode: "replace",
          limitValue: 100,
          resetInterval: "monthly",
          reason: "Initial grant",
        }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(firstResponse.status).toBe(200);

    const secondResponse = await app.request(
      "/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: "cust_123",
          featureId: "feature_ai_credits",
          mode: "replace",
          limitValue: 250,
          resetInterval: "yearly",
          reason: "Expanded grant",
        }),
      },
      RUNTIME_ROUTE_ENV,
    );

    expect(secondResponse.status).toBe(200);

    const entitlements = await businessDb.db.query.entitlements.findMany({
      where: and(
        eq(schema.entitlements.customerId, "cust_123"),
        eq(schema.entitlements.featureId, "feature_ai_credits"),
        inArray(schema.entitlements.source, ["manual", "manual_bonus"]),
      ),
    });

    expect(entitlements).toHaveLength(1);
    expect(entitlements[0]).toMatchObject({
      customerId: "cust_123",
      featureId: "feature_ai_credits",
      source: "manual",
      limitValue: 250,
      resetInterval: "yearly",
      grantedBy: "user_admin",
      grantedReason: "Expanded grant",
    });
  });
});
