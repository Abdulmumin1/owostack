import { schema } from "@owostack/db";
import { eq, or } from "drizzle-orm";
import type { WebhookContext } from "../types";

export async function handleChargeFailed(ctx: WebhookContext): Promise<void> {
  const { db, organizationId, event, cache } = ctx;
  const subscriptionCode = event.subscription?.providerCode;
  if (!subscriptionCode) return;

  // Fetch sub first for cache invalidation
  const sub = await db.query.subscriptions.findFirst({
    where: or(
      eq(schema.subscriptions.paystackSubscriptionCode, subscriptionCode),
      eq(schema.subscriptions.providerSubscriptionCode, subscriptionCode),
    ),
  });
  if (!sub) return;

  await db
    .update(schema.subscriptions)
    .set({ status: "past_due", updatedAt: Date.now() })
    .where(eq(schema.subscriptions.id, sub.id));

  if (cache) {
    try {
      await cache.invalidateSubscriptions(organizationId, sub.customerId);
    } catch (e) {
      console.warn(`[WEBHOOK] Payment failed cache invalidation failed:`, e);
    }
  }
}
