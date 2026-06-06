import { describe, expect, it } from "vitest";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import type { ProviderAccount, ProviderAdapter } from "@owostack/adapters";
import { schema } from "@owostack/db";
import { createRuntimeBusinessDb } from "../../test/runtime/helpers/business-db";
import {
  insertCreditPack,
  insertCreditSystem,
} from "../../test/runtime/helpers/catalog-runtime";
import { insertOrganization } from "../../test/runtime/helpers/workflow-runtime";
import { ensureCreditPackSynced } from "./credit-pack-sync";

describe("credit-pack-sync", () => {
  it("uses the winning provider ids when a concurrent sync wins the compare-and-set", async () => {
    const businessDb = createRuntimeBusinessDb();
    try {
      await insertOrganization(businessDb.d1, { id: "org_123" });
      await insertCreditSystem(businessDb.d1, {
        id: "cs_wallet",
        organizationId: "org_123",
        name: "Wallet",
        slug: "wallet",
      });
      await insertCreditPack(businessDb.d1, {
        id: "pack_race",
        organizationId: "org_123",
        name: "Race Pack",
        slug: "race-pack",
        creditSystemId: "cs_wallet",
        providerId: null,
        providerProductId: null,
        providerPriceId: null,
      });

      const account: ProviderAccount = {
        id: "acct_123",
        organizationId: "org_123",
        providerId: "stripe",
        environment: "test",
        credentials: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const adapter = {
        id: "stripe",
        displayName: "Stripe",
        async createProduct() {
          await businessDb.db
            .update(schema.creditPacks)
            .set({
              providerId: "stripe",
              providerProductId: "prod_winner",
              providerPriceId: "price_winner",
              updatedAt: Date.now(),
            })
            .where(eq(schema.creditPacks.id, "pack_race"));

          return Result.ok({
            productId: "prod_loser",
            priceId: "price_loser",
          });
        },
      } as unknown as ProviderAdapter;

      const result = await ensureCreditPackSynced(
        businessDb.db,
        {
          id: "pack_race",
          name: "Race Pack",
          description: null,
          price: 500,
          currency: "USD",
          providerProductId: null,
          providerPriceId: null,
        },
        adapter,
        account,
      );

      expect(result).toEqual({
        productId: "prod_winner",
        priceId: "price_winner",
      });

      const pack = await businessDb.db.query.creditPacks.findFirst({
        where: eq(schema.creditPacks.id, "pack_race"),
      });
      expect(pack).toMatchObject({
        providerProductId: "prod_winner",
        providerPriceId: "price_winner",
      });
    } finally {
      businessDb.close();
    }
  });
});
