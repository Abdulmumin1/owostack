import { schema } from "@owostack/db";
import { and, eq, sql } from "drizzle-orm";
import type { createDb } from "@owostack/db";

type DB = ReturnType<typeof createDb>;

/**
 * Atomically claim the right to auto-downgrade a canceled subscription to the
 * free plan.
 *
 * Three actors can react to one cancellation — the provider webhook (often
 * delivered twice, e.g. Dodo `subscription.cancelled` + `subscription.updated`
 * in the same second), the dashboard cancel route, and the cancel-downgrade
 * workflow. Each used to *read* `metadata.cancel_downgrade_initiated` and then
 * *write* it, which is a check-then-set race: two of them passed the check and
 * the customer ended up with two active free subscriptions.
 *
 * This is a single conditional UPDATE, so exactly one caller sees a row come
 * back; everyone else gets `false` and must do nothing.
 */
export async function claimCancelDowngrade(
  db: DB,
  subscriptionId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const claimed = await db
    .update(schema.subscriptions)
    .set({
      metadata: sql`json_set(
        coalesce(${schema.subscriptions.metadata}, '{}'),
        '$.cancel_downgrade_initiated', json('true'),
        '$.cancel_downgrade_at', ${now}
      )`,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.subscriptions.id, subscriptionId),
        sql`coalesce(json_extract(${schema.subscriptions.metadata}, '$.cancel_downgrade_initiated'), 0) != 1`,
        sql`coalesce(json_extract(${schema.subscriptions.metadata}, '$.cancel_downgrade_complete'), 0) != 1`,
      ),
    )
    .returning({ id: schema.subscriptions.id });

  return claimed.length === 1;
}
