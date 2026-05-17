import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import creditsRoute from "../../../src/routes/dashboard/credits";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { RUNTIME_ROUTE_ENV, insertCreditSystem } from "../helpers/catalog-runtime";
import { insertFeature } from "../helpers/overage-runtime";
import { insertOrganization } from "../helpers/workflow-runtime";

async function insertCreditSystemFeature(
  db: D1Database,
  params: {
    id: string;
    creditSystemId: string;
    featureId: string;
    cost: number;
  },
) {
  await db
    .prepare(
      `INSERT INTO credit_system_features
       (id, credit_system_id, feature_id, cost, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      params.id,
      params.creditSystemId,
      params.featureId,
      params.cost,
      Date.now(),
    )
    .run();
}

describe("Dashboard credits route runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<
    typeof createRouteTestApp<{ db: any; organizationId: string }>
  >;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_123" });
    app = createRouteTestApp(creditsRoute, {
      db: businessDb.db,
      organizationId: "org_123",
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  it("preserves existing mappings when replacement references an unknown feature", async () => {
    await insertCreditSystem(businessDb.d1, {
      id: "cs_wallet",
      organizationId: "org_123",
      name: "Wallet",
      slug: "wallet",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_existing",
      organizationId: "org_123",
      slug: "existing-feature",
      name: "Existing Feature",
    });
    await insertCreditSystemFeature(businessDb.d1, {
      id: "csf_existing",
      creditSystemId: "cs_wallet",
      featureId: "feature_existing",
      cost: 2,
    });

    const response = await app.request(
      "/cs_wallet",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          features: [
            { featureId: "feature_existing", cost: 4 },
            { featureId: "feature_missing", cost: 7 },
          ],
        }),
      },
      {
        ...RUNTIME_ROUTE_ENV,
        DB: businessDb.d1,
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Unknown featureId values: feature_missing",
    });

    const mappings = await businessDb.db.query.creditSystemFeatures.findMany({
      where: eq(schema.creditSystemFeatures.creditSystemId, "cs_wallet"),
    });

    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({
      id: "csf_existing",
      featureId: "feature_existing",
      cost: 2,
    });
  });

  it("rejects invalid feature mappings on create without leaving partial rows behind", async () => {
    const response = await app.request(
      "/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: "org_123",
          name: "AI Wallet",
          features: [{ featureId: "feature_missing", cost: 5 }],
        }),
      },
      {
        ...RUNTIME_ROUTE_ENV,
        DB: businessDb.d1,
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Unknown featureId values: feature_missing",
    });

    const createdSystem = await businessDb.db.query.creditSystems.findFirst({
      where: and(
        eq(schema.creditSystems.organizationId, "org_123"),
        eq(schema.creditSystems.slug, "ai-wallet"),
      ),
    });
    const createdFeature = await businessDb.db.query.features.findFirst({
      where: and(
        eq(schema.features.organizationId, "org_123"),
        eq(schema.features.slug, "ai-wallet"),
      ),
    });

    expect(createdSystem).toBeUndefined();
    expect(createdFeature).toBeUndefined();
  });
});
