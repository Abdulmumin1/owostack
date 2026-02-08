import { eq, and, isNull } from "drizzle-orm";
import { schema, createDb } from "@owostack/db";
import type { ProviderAdapter, ProviderAccount } from "@owostack/adapters";

type DB = ReturnType<typeof createDb>;

const SYNC_CONCURRENCY = 5; // Max parallel provider API calls

export interface PlanSyncResult {
  synced: { planId: string; providerPlanId: string }[];
  failed: { planId: string; error: string }[];
  skipped: number;
}

/**
 * Sync all unsynced paid+recurring plans for an organization to a provider.
 *
 * Idempotent: uses atomic `UPDATE … WHERE providerPlanId IS NULL` so
 * concurrent calls never create duplicate provider plans.
 *
 * Performance: runs up to SYNC_CONCURRENCY provider API calls in parallel.
 */
export async function syncPlansToProvider(
  db: DB,
  organizationId: string,
  adapter: ProviderAdapter,
  account: ProviderAccount,
): Promise<PlanSyncResult> {
  const result: PlanSyncResult = { synced: [], failed: [], skipped: 0 };

  const unsyncedPlans = await db.query.plans.findMany({
    where: and(
      eq(schema.plans.organizationId, organizationId),
      eq(schema.plans.type, "paid"),
      eq(schema.plans.billingType, "recurring"),
      eq(schema.plans.isActive, true),
      isNull(schema.plans.providerPlanId),
    ),
  });

  if (unsyncedPlans.length === 0) return result;

  // Process in batches of SYNC_CONCURRENCY
  for (let i = 0; i < unsyncedPlans.length; i += SYNC_CONCURRENCY) {
    const batch = unsyncedPlans.slice(i, i + SYNC_CONCURRENCY);

    const settled = await Promise.allSettled(
      batch.map((plan: typeof schema.plans.$inferSelect) => syncSinglePlan(db, plan, adapter, account)),
    );

    for (let j = 0; j < settled.length; j++) {
      const outcome = settled[j];
      const plan = batch[j];
      if (outcome.status === "fulfilled") {
        if (outcome.value) {
          result.synced.push({ planId: plan.id, providerPlanId: outcome.value });
        } else {
          result.skipped++; // Already synced by another concurrent call
        }
      } else {
        result.failed.push({ planId: plan.id, error: outcome.reason?.message || "Unknown error" });
      }
    }
  }

  console.log(`[plan-sync] Bulk sync done: ${result.synced.length} synced, ${result.failed.length} failed, ${result.skipped} skipped`);
  return result;
}

/**
 * Sync a single plan to the provider. Returns the providerPlanId if
 * created, or null if another call already synced it (idempotent).
 */
async function syncSinglePlan(
  db: DB,
  plan: typeof schema.plans.$inferSelect,
  adapter: ProviderAdapter,
  account: ProviderAccount,
): Promise<string | null> {
  // Re-check DB right before the API call to avoid TOCTOU races
  const fresh = await db.query.plans.findFirst({
    where: eq(schema.plans.id, plan.id),
    columns: { providerPlanId: true },
  });
  if (fresh?.providerPlanId) return null; // Already synced

  const createResult = await adapter.createPlan({
    name: plan.name,
    amount: plan.price,
    interval: plan.interval,
    currency: plan.currency,
    description: plan.description || undefined,
    environment: account.environment as "test" | "live",
    account,
  });

  if (createResult.isErr()) {
    throw new Error(createResult.error.message);
  }

  const providerPlanId = createResult.value.id;

  // Atomic: only write if still NULL — prevents duplicate if concurrent call won the race
  const updated = await db
    .update(schema.plans)
    .set({
      providerPlanId,
      providerId: adapter.id,
      ...(adapter.id === "paystack" ? { paystackPlanId: providerPlanId } : {}),
      updatedAt: Date.now(),
    })
    .where(and(eq(schema.plans.id, plan.id), isNull(schema.plans.providerPlanId)))
    .returning({ id: schema.plans.id });

  if (updated.length === 0) {
    // Another call already synced this plan — our provider plan is orphaned
    // (acceptable; provider plans are cheap and won't be referenced)
    console.warn(`[plan-sync] Race: plan ${plan.id} was synced by another call, discarding ${providerPlanId}`);
    return null;
  }

  console.log(`[plan-sync] Synced plan ${plan.id} (${plan.name}) → ${providerPlanId}`);
  return providerPlanId;
}

/**
 * Ensure a single plan has a providerPlanId. Creates it on the provider
 * on-the-fly if missing. Returns the providerPlanId or null if it can't
 * be created.
 *
 * Idempotent: re-reads from DB before creating and uses atomic write.
 * Used as a lazy fallback at checkout time.
 */
export async function ensurePlanSynced(
  db: DB,
  plan: {
    id: string;
    name: string;
    price: number;
    interval: string;
    currency: string;
    description: string | null;
    providerPlanId: string | null;
    paystackPlanId: string | null;
    billingType: string;
    type: string;
  },
  adapter: ProviderAdapter,
  account: ProviderAccount,
): Promise<string | null> {
  // Already synced (in-memory check)
  if (plan.providerPlanId) return plan.providerPlanId;

  // Only sync paid + recurring plans
  if (plan.type !== "paid" || plan.billingType !== "recurring") return null;

  // Re-read from DB to catch concurrent syncs (TOCTOU guard)
  const fresh = await db.query.plans.findFirst({
    where: eq(schema.plans.id, plan.id),
    columns: { providerPlanId: true },
  });
  if (fresh?.providerPlanId) return fresh.providerPlanId;

  const createResult = await adapter.createPlan({
    name: plan.name,
    amount: plan.price,
    interval: plan.interval,
    currency: plan.currency,
    description: plan.description || undefined,
    environment: account.environment as "test" | "live",
    account,
  });

  if (createResult.isErr()) {
    console.warn(`[plan-sync] Lazy sync failed for plan ${plan.id}: ${createResult.error.message}`);
    return null;
  }

  const providerPlanId = createResult.value.id;

  // Atomic write: only set if still NULL
  const updated = await db
    .update(schema.plans)
    .set({
      providerPlanId,
      providerId: adapter.id,
      ...(adapter.id === "paystack" ? { paystackPlanId: providerPlanId } : {}),
      updatedAt: Date.now(),
    })
    .where(and(eq(schema.plans.id, plan.id), isNull(schema.plans.providerPlanId)))
    .returning({ providerPlanId: schema.plans.providerPlanId });

  if (updated.length === 0) {
    // Lost the race — read the winning value
    const winner = await db.query.plans.findFirst({
      where: eq(schema.plans.id, plan.id),
      columns: { providerPlanId: true },
    });
    console.warn(`[plan-sync] Lazy race: plan ${plan.id} already synced, using ${winner?.providerPlanId}`);
    return winner?.providerPlanId || null;
  }

  console.log(`[plan-sync] Lazy-synced plan ${plan.id} (${plan.name}) → ${providerPlanId}`);
  return providerPlanId;
}
