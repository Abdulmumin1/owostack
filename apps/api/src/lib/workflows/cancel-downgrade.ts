import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent,
} from "cloudflare:workers";
import { createDb, schema } from "@owostack/db";
import { eq, and } from "drizzle-orm";
import { provisionEntitlements } from "../plan-switch";
import { EntitlementCache } from "../cache";
import type { WorkflowEnv } from "./utils";

/**
 * Cancel Downgrade Workflow
 * Handles auto-downgrade to free plan when a scheduled cancellation reaches period end.
 *
 * Triggered when: User cancels a paid subscription with immediate=false (cancelAt set)
 * Waits until: The subscription's currentPeriodEnd date
 * Then: Creates free plan subscription and provisions entitlements
 */

export type CancelDowngradeParams = {
  subscriptionId: string;
  customerId: string;
  organizationId: string;
  cancelAt: number;
};

export class CancelDowngradeWorkflow extends WorkflowEntrypoint<
  WorkflowEnv,
  CancelDowngradeParams
> {
  async run(event: WorkflowEvent<CancelDowngradeParams>, step: WorkflowStep) {
    const { subscriptionId, customerId, organizationId, cancelAt } =
      event.payload;
    const db = createDb(this.env.DB);

    // Step 1: Wait until the cancellation date (period end)
    const now = Date.now();
    const waitMs = Math.max(0, cancelAt - now);

    if (waitMs > 0) {
      await step.do("wait-for-cancellation-date", async () => {
        console.log(
          `[CANCEL-DOWNGRADE] Waiting ${Math.round(waitMs / 1000 / 60)} minutes until cancellation date`,
        );
        return { waited: true, waitMs };
      });

      // Actually sleep until the cancellation date
      await step.sleep("wait", waitMs);
    }

    // Step 2: Verify the subscription is still in the right state
    const shouldProceed = await step.do(
      "verify-subscription-state",
      async () => {
        const sub = await db.query.subscriptions.findFirst({
          where: eq(schema.subscriptions.id, subscriptionId),
          with: { plan: true },
        });

        if (!sub) {
          console.log(
            `[CANCEL-DOWNGRADE] Subscription ${subscriptionId} not found, aborting`,
          );
          return { proceed: false, reason: "subscription_not_found" };
        }

        // If subscription was reactivated or plan changed, abort
        if (sub.status === "active" && !sub.cancelAt) {
          console.log(
            `[CANCEL-DOWNGRADE] Subscription ${subscriptionId} was reactivated, aborting`,
          );
          return { proceed: false, reason: "subscription_reactivated" };
        }

        // If already processed via webhook, dashboard, or other means
        // Check both initiated and complete flags to handle race conditions
        if (
          sub.metadata?.cancel_downgrade_initiated === true ||
          sub.metadata?.cancel_downgrade_complete === true
        ) {
          console.log(
            `[CANCEL-DOWNGRADE] Subscription ${subscriptionId} already has cancel_downgrade flag (initiated=${sub.metadata?.cancel_downgrade_initiated}, complete=${sub.metadata?.cancel_downgrade_complete}), aborting`,
          );
          return { proceed: false, reason: "already_processed" };
        }

        // If it's already a free plan, no need to downgrade
        if (sub.plan?.type === "free" || sub.plan?.price === 0) {
          console.log(
            `[CANCEL-DOWNGRADE] Subscription ${subscriptionId} is already free, aborting`,
          );
          return { proceed: false, reason: "already_free" };
        }

        return {
          proceed: true,
          planId: sub.planId,
          providerId: sub.providerId,
        };
      },
    );

    if (!shouldProceed.proceed) {
      console.log(
        `[CANCEL-DOWNGRADE] Aborting workflow: ${shouldProceed.reason}`,
      );
      return { success: false, reason: shouldProceed.reason };
    }

    // Step 3: Set initiated flag to prevent race conditions with webhook
    await step.do("set-initiated-flag", async () => {
      await db
        .update(schema.subscriptions)
        .set({
          metadata: {
            cancel_downgrade_initiated: true,
            cancel_downgrade_at: Date.now(),
          },
          updatedAt: Date.now(),
        })
        .where(eq(schema.subscriptions.id, subscriptionId));
      console.log(
        `[CANCEL-DOWNGRADE] Set initiated flag for subscription ${subscriptionId}`,
      );
    });

    // Step 4: Find organization's free plan
    const freePlan = await step.do("find-free-plan", async () => {
      const plan = await db.query.plans.findFirst({
        where: and(
          eq(schema.plans.organizationId, organizationId),
          eq(schema.plans.type, "free"),
        ),
      });

      if (!plan) {
        console.warn(
          `[CANCEL-DOWNGRADE] No free plan found for org ${organizationId}`,
        );
        return null;
      }

      return { id: plan.id, name: plan.name };
    });

    if (!freePlan) {
      return { success: false, reason: "no_free_plan" };
    }

    // Step 4: Check for existing free plan subscription
    const existingFreeSub = await step.do(
      "check-existing-free-plan",
      async () => {
        const existing = await db.query.subscriptions.findFirst({
          where: and(
            eq(schema.subscriptions.customerId, customerId),
            eq(schema.subscriptions.planId, freePlan.id),
            eq(schema.subscriptions.status, "active"),
          ),
        });

        return existing ? { id: existing.id } : null;
      },
    );

    // Step 5: Create free plan subscription or use existing
    let freeSubId: string;

    if (existingFreeSub) {
      freeSubId = existingFreeSub.id;
      console.log(
        `[CANCEL-DOWNGRADE] Customer ${customerId} already has free plan, using existing`,
      );
    } else {
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const newFreeSub = await step.do("create-free-subscription", async () => {
        const [freeSub] = await db
          .insert(schema.subscriptions)
          .values({
            id: crypto.randomUUID(),
            customerId,
            planId: freePlan.id,
            providerId: shouldProceed.providerId,
            status: "active",
            currentPeriodStart: Date.now(),
            currentPeriodEnd: Date.now() + thirtyDaysMs,
            metadata: {
              switched_from: shouldProceed.planId,
              switch_type: "scheduled_cancel_downgrade",
              canceled_sub_id: subscriptionId,
            },
          })
          .returning();

        return freeSub;
      });

      freeSubId = newFreeSub.id;
      console.log(
        `[CANCEL-DOWNGRADE] Created free subscription ${freeSubId} for customer ${customerId}`,
      );
    }

    // Step 6: Provision entitlements
    await step.do("provision-entitlements", async () => {
      await provisionEntitlements(
        db,
        customerId,
        freePlan.id,
        shouldProceed.planId,
      );
      console.log(
        `[CANCEL-DOWNGRADE] Provisioned entitlements for customer ${customerId}`,
      );
    });

    // Step 7: Mark original subscription as processed
    await step.do("mark-processed", async () => {
      await db
        .update(schema.subscriptions)
        .set({
          status: "canceled",
          canceledAt: Date.now(),
          metadata: {
            cancelAt: cancelAt,
            cancel_downgrade_initiated: true,
            cancel_downgrade_complete: true,
            free_subscription_id: freeSubId,
          },
          updatedAt: Date.now(),
        })
        .where(eq(schema.subscriptions.id, subscriptionId));

      console.log(
        `[CANCEL-DOWNGRADE] Marked subscription ${subscriptionId} as processed`,
      );
    });

    // Step 8: Invalidate cache
    await step.do("invalidate-cache", async () => {
      if (this.env.CACHE) {
        try {
          const cache = new EntitlementCache(this.env.CACHE);
          await cache.invalidateSubscriptions(organizationId, customerId);
          console.log(
            `[CANCEL-DOWNGRADE] Invalidated cache for customer ${customerId}`,
          );
        } catch (e) {
          console.warn(`[CANCEL-DOWNGRADE] Cache invalidation failed:`, e);
        }
      }
    });

    return {
      success: true,
      freeSubscriptionId: freeSubId,
      message: `Customer downgraded to free plan after scheduled cancellation`,
    };
  }
}

export default CancelDowngradeWorkflow;
