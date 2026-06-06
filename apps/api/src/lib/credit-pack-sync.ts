import { and, eq, isNull } from "drizzle-orm";
import { schema, createDb } from "@owostack/db";
import type { ProviderAdapter, ProviderAccount } from "@owostack/adapters";
import { syncCreditPackProductWithResolvedProvider } from "./credit-pack-provider-sync";

type DB = ReturnType<typeof createDb>;

function nullableColumnMatches(column: any, value: string | null) {
  return value === null ? isNull(column) : eq(column, value);
}

/**
 * Ensure a credit pack has a providerProductId + providerPriceId.
 * Creates a one-time product + price on the provider on-the-fly if missing.
 *
 * Idempotent: re-reads from DB before creating and uses atomic write.
 * Used at checkout time so the provider can render a native line item
 * with name, price, and adjustable quantity.
 *
 * Returns { productId, priceId } or null if the adapter doesn't support
 * createProduct (e.g. Paystack — falls back to raw amount checkout).
 */
export async function ensureCreditPackSynced(
  db: DB,
  pack: {
    id: string;
    name: string;
    description: string | null;
    price: number;
    currency: string;
    providerProductId: string | null;
    providerPriceId: string | null;
  },
  adapter: ProviderAdapter,
  account: ProviderAccount,
): Promise<{ productId: string; priceId: string } | null> {
  const result = await syncCreditPackProductWithResolvedProvider({
    db,
    pack: {
      id: pack.id,
      slug: pack.id,
      name: pack.name,
      description: pack.description,
      price: pack.price,
      currency: pack.currency,
      providerId: adapter.id,
      providerProductId: pack.providerProductId,
      providerPriceId: pack.providerPriceId,
    },
    adapter,
    account,
  });

  if (result.issue) {
    console.warn(
      `[credit-pack-sync] Failed to sync pack ${pack.id}: ${result.issue.message}`,
    );
    return null;
  }

  if (!result.providerProductId || !result.providerPriceId) {
    return null;
  }

  const currentProductId = pack.providerProductId;
  const currentPriceId = pack.providerPriceId;
  if (
    currentProductId !== result.providerProductId ||
    currentPriceId !== result.providerPriceId
  ) {
    const updated = await (db as any)
      .update((schema as any).creditPacks)
      .set({
        providerProductId: result.providerProductId,
        providerPriceId: result.providerPriceId,
        providerId: result.providerId,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq((schema as any).creditPacks.id, pack.id),
          nullableColumnMatches(
            (schema as any).creditPacks.providerProductId,
            currentProductId,
          ),
          nullableColumnMatches(
            (schema as any).creditPacks.providerPriceId,
            currentPriceId,
          ),
        ),
      )
      .returning({
        providerProductId: (schema as any).creditPacks.providerProductId,
        providerPriceId: (schema as any).creditPacks.providerPriceId,
      });

    if (updated.length === 0) {
      const winner = await (db.query as any).creditPacks?.findFirst?.({
        where: eq((schema as any).creditPacks.id, pack.id),
        columns: {
          providerProductId: true,
          providerPriceId: true,
        },
      });

      if (winner?.providerProductId && winner?.providerPriceId) {
        console.warn(
          `[credit-pack-sync] Race: pack ${pack.id} already synced, using product=${winner.providerProductId}, price=${winner.providerPriceId}`,
        );
        return {
          productId: winner.providerProductId,
          priceId: winner.providerPriceId,
        };
      }

      return null;
    }
  }

  console.log(
    `[credit-pack-sync] Synced pack ${pack.id} (${pack.name}) → product=${result.providerProductId}, price=${result.providerPriceId}`,
  );
  return {
    productId: result.providerProductId,
    priceId: result.providerPriceId,
  };
}
