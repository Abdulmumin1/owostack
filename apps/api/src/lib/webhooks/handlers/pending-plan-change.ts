import { schema } from "@owostack/db";
import { eq, or } from "drizzle-orm";
import type { NormalizedWebhookEvent } from "@owostack/adapters";
import { provisionEntitlements } from "../../plan-switch";
import type { DB, WebhookContext } from "../types";

/**
 * Native plan changes that a provider stages behind a prorated charge
 * (Bachs `pending_update`). `executeSwitch` records the intent as
 * `subscriptions.metadata.pending_plan_change`; the provider's follow-up
 * webhooks decide the outcome:
 *
 *   proration charge succeeds  → apply the plan (or let subscription.updated
 *                                do it) and clear the record
 *   proration charge fails     → clear the record; the customer stays on the
 *                                plan they paid for
 *   subscription.updated with the new product → apply + clear
 *
 * A proration payment must never be read as a renewal: it does not start a
 * new billing period.
 */

export interface PendingPlanChange {
  new_plan_id: string;
  old_plan_id: string;
  provider_reference: string | null;
  staged_at: number;
}

export const pendingPlanChangeDependencies = { provisionEntitlements };

type SubscriptionRow = typeof schema.subscriptions.$inferSelect;

export function readPendingPlanChange(
  metadata: unknown,
): PendingPlanChange | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).pending_plan_change;
  if (!raw || typeof raw !== "object") return null;
  const change = raw as Record<string, unknown>;
  if (typeof change.new_plan_id !== "string") return null;
  return {
    new_plan_id: change.new_plan_id,
    old_plan_id: String(change.old_plan_id ?? ""),
    provider_reference:
      typeof change.provider_reference === "string"
        ? change.provider_reference
        : null,
    staged_at: Number(change.staged_at) || 0,
  };
}

const PRORATION_BILLING_REASONS = new Set([
  "subscription_update",
  "subscription_change",
  "plan_change",
  "proration",
]);

/**
 * Is this charge the prorated difference for a plan change rather than a
 * cycle renewal or first payment?
 *
 * - Native changes carry the metadata `executeSwitch` passed to
 *   `adapter.changePlan` (`old_plan_id` + `new_plan_id`, no `plan_id`).
 * - Providers that label invoices report a proration `billing_reason`.
 * - Checkout-based upgrades (`type: "plan_upgrade"`) have their own handler.
 */
export function isProrationPayment(event: NormalizedWebhookEvent): boolean {
  const metadata = event.metadata ?? {};
  if (metadata.type === "plan_upgrade") return false;
  if (
    typeof metadata.billing_reason === "string" &&
    PRORATION_BILLING_REASONS.has(metadata.billing_reason)
  ) {
    return true;
  }
  return (
    !metadata.plan_id &&
    typeof metadata.new_plan_id === "string" &&
    typeof metadata.old_plan_id === "string"
  );
}

/** Does this event refer to the provider-side invoice/charge a pending change is waiting on? */
export function eventMatchesPendingReference(
  event: NormalizedWebhookEvent,
  pending: PendingPlanChange,
): boolean {
  if (!pending.provider_reference) return false;
  const candidates = [
    event.payment?.reference,
    event.metadata?.invoice_id,
    event.metadata?.charge_id,
  ];
  return candidates.some((c) => c === pending.provider_reference);
}

export async function findSubscriptionByProviderCode(
  db: DB,
  code: string,
): Promise<SubscriptionRow | undefined> {
  return db.query.subscriptions.findFirst({
    where: or(
      eq(schema.subscriptions.providerSubscriptionCode, code),
      eq(schema.subscriptions.paystackSubscriptionCode, code),
    ),
  });
}

function withoutPending(
  metadata: unknown,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    metadata && typeof metadata === "object"
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  delete base.pending_plan_change;
  return { ...base, ...extra };
}

/**
 * The prorated charge for a plan change settled. Apply the change if it is
 * still pending; otherwise just record the payment. Billing periods are left
 * untouched — the provider's subscription event owns those.
 */
export async function handleProrationPayment(
  ctx: WebhookContext,
  sub: SubscriptionRow,
): Promise<void> {
  const { db, organizationId, event, cache } = ctx;
  const now = Date.now();
  const pending = readPendingPlanChange(sub.metadata);
  const paymentRecord = {
    reference: event.payment?.reference ?? null,
    amount: event.payment?.amount ?? null,
    currency: event.payment?.currency ?? null,
    paid_at: event.payment?.paidAt ?? new Date(now).toISOString(),
  };

  if (pending && pending.new_plan_id !== sub.planId) {
    const newPlan = await db.query.plans.findFirst({
      where: eq(schema.plans.id, pending.new_plan_id),
    });
    if (newPlan && newPlan.organizationId === organizationId) {
      await db
        .update(schema.subscriptions)
        .set({
          planId: newPlan.id,
          status: "active",
          metadata: withoutPending(sub.metadata, {
            switched_from: sub.planId,
            switch_type: "upgrade",
            native_plan_change: true,
            plan_change_applied_at: now,
            plan_change_applied_by: "proration_payment",
            last_proration_payment: paymentRecord,
          }),
          updatedAt: now,
        })
        .where(eq(schema.subscriptions.id, sub.id));

      await pendingPlanChangeDependencies.provisionEntitlements(
        db,
        sub.customerId,
        newPlan.id,
        sub.planId,
      );
      console.log(
        `[WEBHOOK] Proration paid: applied pending plan change sub=${sub.id} ${sub.planId} -> ${newPlan.id}`,
      );
    } else {
      console.warn(
        `[WEBHOOK] Proration paid for sub=${sub.id} but pending plan ${pending.new_plan_id} not found; clearing`,
      );
      await db
        .update(schema.subscriptions)
        .set({
          metadata: withoutPending(sub.metadata, {
            last_proration_payment: paymentRecord,
          }),
          updatedAt: now,
        })
        .where(eq(schema.subscriptions.id, sub.id));
    }
  } else {
    // Dodo-style: the provider applied the change itself; the payment is
    // informational. Do not advance the period.
    await db
      .update(schema.subscriptions)
      .set({
        status: sub.status === "past_due" ? "active" : sub.status,
        metadata: withoutPending(sub.metadata, {
          last_proration_payment: paymentRecord,
        }),
        updatedAt: now,
      })
      .where(eq(schema.subscriptions.id, sub.id));
    console.log(
      `[WEBHOOK] Proration payment recorded for sub=${sub.id} (ref=${paymentRecord.reference}); period unchanged`,
    );
  }

  if (cache) {
    try {
      await cache.invalidateSubscriptions(organizationId, sub.customerId);
    } catch (e) {
      console.warn(`[WEBHOOK] Proration cache invalidation failed:`, e);
    }
  }
}

/**
 * The prorated charge failed. The customer keeps the plan they already paid
 * for; drop the pending change so the dashboard and a retry of attach() see
 * the truth. Not a `past_due` — the current period is fully paid.
 */
export async function clearFailedPendingPlanChange(
  ctx: WebhookContext,
  sub: SubscriptionRow,
  pending: PendingPlanChange,
): Promise<void> {
  const { db, organizationId, event, cache } = ctx;
  const now = Date.now();
  await db
    .update(schema.subscriptions)
    .set({
      metadata: withoutPending(sub.metadata, {
        failed_plan_change: {
          ...pending,
          failed_at: now,
          reason:
            (typeof event.metadata?.reason === "string" && event.metadata.reason) ||
            "proration_charge_failed",
          reference: event.payment?.reference ?? null,
        },
      }),
      updatedAt: now,
    })
    .where(eq(schema.subscriptions.id, sub.id));

  console.warn(
    `[WEBHOOK] Proration charge failed: cleared pending plan change sub=${sub.id} -> ${pending.new_plan_id}`,
  );

  if (cache) {
    try {
      await cache.invalidateSubscriptions(organizationId, sub.customerId);
    } catch (e) {
      console.warn(`[WEBHOOK] Failed-proration cache invalidation failed:`, e);
    }
  }
}
