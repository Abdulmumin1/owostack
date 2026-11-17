import { afterEach, beforeEach, describe, expect, it } from "vitest";
import publicCreditPacksRoute from "../../../src/routes/api/credit-packs";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  insertApiKey,
  insertCreditPack,
  insertCreditSystem,
  RUNTIME_ROUTE_ENV,
} from "../helpers/catalog-runtime";
import { insertOrganization } from "../helpers/workflow-runtime";

describe("Public credit-pack reads", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<typeof createRouteTestApp<{ db: any; authDb: any }>>;
  let apiKey: string;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_123" });
    apiKey = await insertApiKey(businessDb.d1, {
      organizationId: "org_123",
      apiKey: "owo_sk_test_pack_reads",
    });
    await insertCreditSystem(businessDb.d1, {
      id: "cs_songs",
      organizationId: "org_123",
      slug: "songs",
      name: "Songs",
    });
    await insertCreditPack(businessDb.d1, {
      id: "pack_ten",
      organizationId: "org_123",
      slug: "ten-songs",
      name: "Ten songs",
      credits: 10,
      price: 2500,
      currency: "NGN",
      creditSystemId: "cs_songs",
      providerId: "paystack",
    });
    app = createRouteTestApp(publicCreditPacksRoute, {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => businessDb.close());

  it("returns the synced price, provider, and credit-system slug by pack slug", async () => {
    const response = await app.request(
      "/ten-songs",
      { headers: { Authorization: `Bearer ${apiKey}` } },
      RUNTIME_ROUTE_ENV,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        slug: "ten-songs",
        price: 2500,
        currency: "NGN",
        provider: "paystack",
        creditSystem: "songs",
      },
    });
  });
});
