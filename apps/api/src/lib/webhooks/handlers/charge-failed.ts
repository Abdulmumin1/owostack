import { schema } from "@owostack/db";
import { eq, or } from "drizzle-orm";
import type { WebhookContext } from "../types";
import { markPastDueMetadata } from "../../dunning";
import {
  clearFailedPendingPlanChange,
  eventMatchesPendingReference,
  isProrationPayment,
  readPendingPlanChange,
} from "./pending-plan-change";

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

  // A failed *proration* charge is not a failed renewal: the current period
  // is paid for. Drop the staged plan change and leave the status alone; if
  // the provider later marks the subscription past_due it will say so via
  // its own subscription event.
  const pending = readPendingPlanChange(sub.metadata);
  if (
    pending &&
    (eventMatchesPendingReference(event, pending) || isProrationPayment(event))
  ) {
    await clearFailedPendingPlanChange(ctx, sub, pending);
    return;
  }

  const now = Date.now();
  await db
    .update(schema.subscriptions)
    .set({
      status: "past_due",
      providerId: event.provider,
      // Anchors the dunning grace window (see lib/dunning.ts).
      metadata: markPastDueMetadata(sub, now),
      updatedAt: now,
    })
    .where(eq(schema.subscriptions.id, sub.id));

  if (cache) {
    try {
      await cache.invalidateSubscriptions(organizationId, sub.customerId);
    } catch (e) {
      console.warn(`[WEBHOOK] Payment failed cache invalidation failed:`, e);
    }
  }
}
