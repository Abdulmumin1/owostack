import { schema } from "@owostack/db";
import { eq, and, or } from "drizzle-orm";
import { provisionEntitlements } from "../../plan-switch";
import { upsertPaymentMethod } from "../../payment-methods";
import type { WebhookContext } from "../types";
import { handleSubscriptionCreated } from "./subscription-created";

export function handleSubscriptionStatus(status: string) {
  return async (ctx: WebhookContext): Promise<void> => {
    const { db, organizationId, event, cache } = ctx;
    const subscriptionCode = event.subscription?.providerCode;
    if (!subscriptionCode) return;

    // -----------------------------------------------------------------------
    // Card setup via on-demand subscription (e.g. Dodo mandate authorization).
    // The subscription ID becomes the payment method token for future charges.
    // -----------------------------------------------------------------------
    if (status === "active" && event.metadata?.type === "card_setup") {
      const customerId = event.metadata.customer_id as string;
      if (customerId) {
        try {
          await upsertPaymentMethod(db, {
            customerId,
            organizationId,
            providerId: event.provider,
            token: subscriptionCode,
            type: "provider_managed",
          });
          console.log(`[WEBHOOK] Card setup complete: stored on-demand sub ${subscriptionCode} as payment method for customer=${customerId}`);
        } catch (pmErr) {
          console.warn(`[WEBHOOK] Failed to store card_setup payment method: ${pmErr}`);
        }
      }
      return;
    }

    // Fetch sub once — needed for cancelAt (pending_cancel) and cache invalidation
    const sub = await db.query.subscriptions.findFirst({
      where: or(
        eq(schema.subscriptions.paystackSubscriptionCode, subscriptionCode),
        eq(schema.subscriptions.providerSubscriptionCode, subscriptionCode),
      ),
    });

    if (!sub) {
      // For providers like Dodo where subscriptions are created via checkout,
      // the first webhook is subscription.active with the real subscription_id.
      // Our DB may not have a matching record yet (it was stored with session_id
      // or doesn't exist at all). Fall through to creation logic.
      if (status === "active") {
        console.log(`[WEBHOOK] No existing sub for code=${subscriptionCode}, status=active — falling through to creation`);
        await handleSubscriptionCreated(ctx);
      }
      return;
    }

    const now = Date.now();

    // Guard: if the subscription is currently trialing and the provider reports
    // "active" (e.g. Dodo sends subscription.active even during trial period),
    // preserve the "trialing" status as long as the trial hasn't ended yet.
    if (
      status === "active" &&
      sub.status === "trialing" &&
      sub.currentPeriodEnd &&
      sub.currentPeriodEnd > now
    ) {
      console.log(`[WEBHOOK] Preserving trialing status for sub=${sub.id} (trial ends ${new Date(sub.currentPeriodEnd).toISOString()})`);
      return;
    }

    const updates: Record<string, unknown> = {
      status,
      updatedAt: now,
    };

    if (status === "canceled") {
      updates.canceledAt = now;
    }

    // For pending_cancel (not_renew): set cancelAt to period end so /check
    // lazy enforcement revokes access when the period expires.
    if (status === "pending_cancel" && sub.currentPeriodEnd) {
      updates.cancelAt = sub.currentPeriodEnd;
    }

    // If the webhook carries a new plan code (e.g. subscription.plan_changed),
    // update the planId so the DB stays in sync with the provider.
    // This acts as a safety net if the original changePlan DB write failed.
    if (status === "active" && event.plan?.providerPlanCode) {
      const newPlan = await db.query.plans.findFirst({
        where: and(
          or(
            eq(schema.plans.providerPlanId, event.plan.providerPlanCode),
            eq(schema.plans.paystackPlanId, event.plan.providerPlanCode),
          ),
          eq(schema.plans.organizationId, organizationId),
        ),
      });
      if (newPlan && newPlan.id !== sub.planId) {
        updates.planId = newPlan.id;
        console.log(`[WEBHOOK] Plan changed: sub=${sub.id}, oldPlan=${sub.planId}, newPlan=${newPlan.id}`);

        // Re-provision entitlements so the customer gets the new plan's features
        await provisionEntitlements(db, sub.customerId, newPlan.id, sub.planId);
      }
    }

    await db
      .update(schema.subscriptions)
      .set(updates)
      .where(eq(schema.subscriptions.id, sub.id));

    // Invalidate cache so /check sees the status change
    if (cache) {
      try {
        await cache.invalidateSubscriptions(organizationId, sub.customerId);
      } catch (e) {
        console.warn(`[WEBHOOK] Status change cache invalidation failed:`, e);
      }
    }
  };
}
