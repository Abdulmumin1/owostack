import { schema } from "@owostack/db";
import { eq, and, or } from "drizzle-orm";
import { provisionEntitlements } from "../../plan-switch";
import { upsertPaymentMethod } from "../../payment-methods";
import type { WebhookContext } from "../types";
import { handleSubscriptionCreated } from "./subscription-created";
import { safeParseDate } from "../types";

// Note: We no longer enforce a maximum trial duration here.
// Trial dates are validated at creation time in charge-success.ts.

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
          console.log(
            `[WEBHOOK] Card setup complete: stored on-demand sub ${subscriptionCode} as payment method for customer=${customerId}`,
          );
        } catch (pmErr) {
          console.warn(
            `[WEBHOOK] Failed to store card_setup payment method: ${pmErr}`,
          );
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
        console.log(
          `[WEBHOOK] No existing sub for code=${subscriptionCode}, status=active — falling through to creation`,
        );
        await handleSubscriptionCreated(ctx);
      }
      return;
    }

    const now = Date.now();

    // Guard: if the subscription is currently trialing and the provider reports
    // "active" (e.g. Dodo sends subscription.active even during trial period),
    // preserve the "trialing" status as long as the trial hasn't ended yet.
    // Guard: if the subscription is currently trialing and the provider reports
    // "active" (e.g. Dodo sends subscription.active even during trial period),
    // preserve the "trialing" status as long as the trial hasn't ended yet.
    if (status === "active" && sub.status === "trialing") {
      const trialEnd = sub.currentPeriodEnd;
      // Check if trial end date is valid (positive number) and in the future
      const trialEndValid = typeof trialEnd === "number" && trialEnd > 0;
      if (trialEndValid && trialEnd > now) {
        console.log(
          `[WEBHOOK] Preserving trialing status for sub=${sub.id} (trial ends ${new Date(trialEnd).toISOString()})`,
        );
        return;
      }
      console.warn(
        `[WEBHOOK] Trial ended or invalid for sub=${sub.id}; allowing status update to ${status}`,
      );
    }

    const updates: Record<string, unknown> = {
      status,
      providerId: event.provider,
      updatedAt: now,
    };

    // Provider renewal events are authoritative for billing dates.
    if (status === "active") {
      const nextPaymentMs = safeParseDate(event.subscription?.nextPaymentDate);
      if (nextPaymentMs) {
        const providerStartMs = safeParseDate(event.subscription?.startDate);
        updates.currentPeriodStart =
          providerStartMs || safeParseDate(event.payment?.paidAt) || now;
        updates.currentPeriodEnd = nextPaymentMs;
      }
    }

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
        console.log(
          `[WEBHOOK] Plan changed: sub=${sub.id}, oldPlan=${sub.planId}, newPlan=${newPlan.id}`,
        );

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

    // Auto-downgrade to free plan on cancellation (immediate)
    if (status === "canceled") {
      try {
        // Guard: Check if dashboard or workflow already processing/has processed
        // We check BOTH initiated and complete flags to handle race conditions
        const isAlreadyProcessing =
          sub.metadata?.cancel_downgrade_initiated === true ||
          sub.metadata?.cancel_downgrade_complete === true;
        if (isAlreadyProcessing) {
          console.log(
            `[WEBHOOK] Subscription ${sub.id} already has cancel_downgrade flag (initiated=${sub.metadata?.cancel_downgrade_initiated}, complete=${sub.metadata?.cancel_downgrade_complete}), skipping free plan creation`,
          );
          return;
        }

        // CRITICAL: Set initiated flag FIRST to prevent race conditions
        // This ensures any concurrent dashboard/workflow requests see this flag
        await db
          .update(schema.subscriptions)
          .set({
            metadata: {
              ...sub.metadata,
              cancel_downgrade_initiated: true,
              cancel_downgrade_at: now,
            },
            updatedAt: now,
          })
          .where(eq(schema.subscriptions.id, sub.id));

        // Fetch the full subscription details with plan and customer
        const canceledSub = await db.query.subscriptions.findFirst({
          where: eq(schema.subscriptions.id, sub.id),
          with: { plan: true, customer: true },
        });

        if (
          canceledSub?.plan?.type !== "free" &&
          canceledSub?.plan?.price !== 0 &&
          canceledSub?.customer
        ) {
          // Find organization's free plan
          const freePlan = await db.query.plans.findFirst({
            where: and(
              eq(schema.plans.organizationId, organizationId),
              eq(schema.plans.type, "free"),
            ),
          });

          if (freePlan) {
            // Check if customer already has an active free plan subscription
            const existingFreeSub = await db.query.subscriptions.findFirst({
              where: and(
                eq(schema.subscriptions.customerId, canceledSub.customer.id),
                eq(schema.subscriptions.planId, freePlan.id),
                eq(schema.subscriptions.status, "active"),
              ),
            });

            let freeSubId: string | undefined;

            if (existingFreeSub) {
              // Customer already has active free plan, just provision entitlements
              await provisionEntitlements(
                db,
                canceledSub.customer.id,
                freePlan.id,
                canceledSub.planId,
              );
              freeSubId = existingFreeSub.id;
              console.log(
                `[WEBHOOK] Customer ${canceledSub.customer.id} already has free plan ${freePlan.id}, provisioned entitlements only`,
              );
            } else {
              // Create new free subscription
              const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
              const [freeSub] = await db
                .insert(schema.subscriptions)
                .values({
                  id: crypto.randomUUID(),
                  customerId: canceledSub.customer.id,
                  planId: freePlan.id,
                  providerId: canceledSub.providerId,
                  status: "active",
                  currentPeriodStart: now,
                  currentPeriodEnd: now + thirtyDaysMs,
                  metadata: {
                    switched_from: canceledSub.planId,
                    switch_type: "webhook_cancel_downgrade",
                    canceled_sub_id: canceledSub.id,
                  },
                })
                .returning();

              // Provision free plan entitlements
              await provisionEntitlements(
                db,
                canceledSub.customer.id,
                freePlan.id,
                canceledSub.planId,
              );

              freeSubId = freeSub.id;
              console.log(
                `[WEBHOOK] Auto-downgraded customer ${canceledSub.customer.id} to free plan ${freePlan.id}, new sub=${freeSub.id}`,
              );
            }

            // Mark the canceled subscription as complete with free sub ID
            // We use sub.id (from outer scope) which is the definitive subscription ID
            await db
              .update(schema.subscriptions)
              .set({
                metadata: {
                  ...sub.metadata,
                  cancel_downgrade_initiated: true,
                  cancel_downgrade_at: now,
                  cancel_downgrade_complete: true,
                  free_subscription_id: freeSubId,
                },
                updatedAt: now,
              })
              .where(eq(schema.subscriptions.id, sub.id));

            // Invalidate cache again for the new subscription
            if (cache) {
              try {
                await cache.invalidateSubscriptions(
                  organizationId,
                  canceledSub.customer.id,
                );
              } catch (e) {
                console.warn(
                  `[WEBHOOK] Free plan cache invalidation failed:`,
                  e,
                );
              }
            }
          }
        }
      } catch (e) {
        console.warn(
          `[WEBHOOK] Failed to auto-downgrade to free plan after cancellation:`,
          e,
        );
      }
    }
  };
}
