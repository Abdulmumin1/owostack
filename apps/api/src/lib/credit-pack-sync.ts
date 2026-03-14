import { eq, and, isNull } from "drizzle-orm";
import { schema, createDb } from "@owostack/db";
import type { ProviderAdapter, ProviderAccount } from "@owostack/adapters";

type DB = ReturnType<typeof createDb>;

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
  // Already synced (in-memory check)
  if (pack.providerProductId && pack.providerPriceId) {
    return { productId: pack.providerProductId, priceId: pack.providerPriceId };
  }

  // Adapter doesn't support product creation (e.g. Paystack)
  if (!adapter.createProduct) {
    return null;
  }

  // Re-read from DB to catch concurrent syncs (TOCTOU guard)
  const fresh = await (db.query as any).creditPacks?.findFirst?.({
    where: eq((schema as any).creditPacks.id, pack.id),
    columns: { providerProductId: true, providerPriceId: true },
  });

  if (fresh?.providerProductId && fresh?.providerPriceId) {
    return {
      productId: fresh.providerProductId,
      priceId: fresh.providerPriceId,
    };
  }

  const createResult = await adapter.createProduct({
    name: pack.name,
    description: pack.description || undefined,
    amount: pack.price,
    currency: pack.currency,
    environment: account.environment as "test" | "live",
    account,
    metadata: { credit_pack_id: pack.id },
  });

  if (createResult.isErr()) {
    console.warn(
      `[credit-pack-sync] Failed to sync pack ${pack.id}: ${createResult.error.message}`,
    );
    return null;
  }

  const { productId, priceId } = createResult.value;

  // Atomic write: only set if still NULL
  const updated = await (db as any)
    .update((schema as any).creditPacks)
    .set({
      providerProductId: productId,
      providerPriceId: priceId,
      providerId: adapter.id,
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq((schema as any).creditPacks.id, pack.id),
        isNull((schema as any).creditPacks.providerProductId),
      ),
    )
    .returning({
      providerProductId: (schema as any).creditPacks.providerProductId,
    });

  if (updated.length === 0) {
    // Lost the race — read the winning value
    const winner = await (db.query as any).creditPacks?.findFirst?.({
      where: eq((schema as any).creditPacks.id, pack.id),
      columns: { providerProductId: true, providerPriceId: true },
    });
    console.warn(
      `[credit-pack-sync] Race: pack ${pack.id} already synced, using ${winner?.providerProductId}`,
    );
    return winner?.providerProductId && winner?.providerPriceId
      ? { productId: winner.providerProductId, priceId: winner.providerPriceId }
      : null;
  }

  console.log(
    `[credit-pack-sync] Synced pack ${pack.id} (${pack.name}) → product=${productId}, price=${priceId}`,
  );
  return { productId, priceId };
}
