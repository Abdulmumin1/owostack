import { schema } from "@owostack/db";
import { eq, and, or, sql } from "drizzle-orm";
import {
  isCustomerResolutionConflictError,
  resolveCustomerByEmail,
} from "../../customer-resolution";
import type { WebhookContext } from "../types";

export async function handleRefund(ctx: WebhookContext): Promise<void> {
  const { db, organizationId, event, adapter, providerAccount, cache } = ctx;
  const email = event.customer.email?.toLowerCase();
  if (!email) {
    console.warn(
      `[WEBHOOK] refund.success without customer email for org=${organizationId}`,
    );
    return;
  }

  const refundAmount = event.refund?.amount || 0;
  console.log(
    `[WEBHOOK] Processing refund for org=${organizationId}, customer=${email}, amount=${refundAmount}, ref=${event.refund?.reference}`,
  );

  // 1. Find customer
  let dbCustomer = null;
  try {
    const resolvedCustomer = await resolveCustomerByEmail({
      db,
      organizationId,
      email,
    });
    dbCustomer = resolvedCustomer?.customer ?? null;
  } catch (error) {
    if (isCustomerResolutionConflictError(error)) {
      console.warn(
        `[WEBHOOK] refund.success resolution conflict: ${error.message}`,
      );
      return;
    }
    throw error;
  }

  if (!dbCustomer) {
    console.warn(
      `[WEBHOOK] Refund: customer ${email} not found in org ${organizationId}`,
    );
    return;
  }

  const now = Date.now();

  // 2. Find all active/trialing subscriptions (with plan prices for comparison)
  const activeSubs = await db.query.subscriptions.findMany({
    where: and(
      eq(schema.subscriptions.customerId, dbCustomer.id),
      or(
        eq(schema.subscriptions.status, "active"),
        eq(schema.subscriptions.status, "trialing"),
      ),
    ),
    with: { plan: true },
  });

  // 3. Determine if this is a full or partial refund
  //    Full refund: refund amount >= any active plan's price (provider amounts are in smallest unit)
  //    Partial refund: refund amount < all plan prices → record it but keep access
  //    NOTE: refundAmount === 0 is treated as full refund — when a provider sends a refund
  //    event without an amount, we assume the entire charge was refunded (conservative default).
  //    IMPORTANT: Only compare amounts when currencies match to avoid incorrect comparisons
  //    (e.g., 10000 kobo NGN != 10000 cents USD)
  const refundCurrency = event.refund?.currency?.toUpperCase();
  const isFullRefund =
    refundAmount === 0 ||
    activeSubs.some(
      (sub: { plan?: { price: number; currency?: string | null } | null }) => {
        if (!sub.plan) return false;
        // If currency info is available, only match when currencies are the same
        if (
          refundCurrency &&
          sub.plan.currency &&
          sub.plan.currency.toUpperCase() !== refundCurrency
        ) {
          return false;
        }
        return refundAmount >= sub.plan.price;
      },
    );

  if (!isFullRefund) {
    // Partial refund — record on subscription metadata, don't revoke access
    console.log(
      `[WEBHOOK] Partial refund (${refundAmount}) for customer ${dbCustomer.id} — recording without revoking access`,
    );
    for (const sub of activeSubs) {
      const existingMeta =
        typeof sub.metadata === "object" && sub.metadata
          ? (sub.metadata as Record<string, unknown>)
          : {};
      const refunds = Array.isArray(existingMeta.refunds)
        ? existingMeta.refunds
        : [];
      refunds.push({
        amount: refundAmount,
        currency: event.refund?.currency,
        reference: event.refund?.reference,
        reason: event.refund?.reason,
        at: now,
      });
      await db
        .update(schema.subscriptions)
        .set({ metadata: { ...existingMeta, refunds }, updatedAt: now })
        .where(eq(schema.subscriptions.id, sub.id));
    }
    return;
  }

  // 4. Full refund — cancel each subscription (on provider + locally)
  for (const sub of activeSubs) {
    const subCode =
      sub.providerSubscriptionCode || sub.paystackSubscriptionCode;
    if (
      adapter &&
      providerAccount &&
      subCode &&
      subCode !== "one-time" &&
      !subCode.startsWith("trial-") &&
      !subCode.startsWith("charge") &&
      !subCode.startsWith("upgrade")
    ) {
      try {
        await adapter.cancelSubscription({
          subscription: { id: subCode, status: sub.status || "active" },
          environment: providerAccount.environment,
          account: providerAccount,
        });
      } catch (e) {
        console.warn(
          `[WEBHOOK] Refund: provider cancel failed for sub ${subCode}:`,
          e,
        );
      }
    }

    await db
      .update(schema.subscriptions)
      .set({ status: "refunded", canceledAt: now, updatedAt: now })
      .where(eq(schema.subscriptions.id, sub.id));

    console.log(
      `[WEBHOOK] Refund: canceled subscription ${sub.id} (plan=${sub.planId})`,
    );
  }

  // 5. Revoke all entitlements for this customer
  await db
    .delete(schema.entitlements)
    .where(eq(schema.entitlements.customerId, dbCustomer.id));

  // 5b. Invalidate cache so /check returns denied immediately
  if (cache) {
    try {
      const cacheAny = cache as any;
      const dashboardInvalidate =
        typeof cacheAny.invalidateDashboardCustomer === "function"
          ? cacheAny.invalidateDashboardCustomer(dbCustomer.id)
          : Promise.resolve();
      if (typeof cacheAny.invalidateCustomerAliases === "function") {
        await Promise.all([
          cacheAny.invalidateCustomerAliases(organizationId, {
            id: dbCustomer.id,
            email: dbCustomer.email,
            externalId: dbCustomer.externalId,
          }),
          cache.invalidateSubscriptions(organizationId, dbCustomer.id),
          dashboardInvalidate,
        ]);
      } else {
        await Promise.all([
          cache.invalidateCustomer(organizationId, dbCustomer.id),
          cache.invalidateCustomer(organizationId, email),
          cache.invalidateSubscriptions(organizationId, dbCustomer.id),
          dashboardInvalidate,
        ]);
      }
    } catch (e) {
      console.warn(`[WEBHOOK] Refund: cache invalidation failed:`, e);
    }
  }

  console.log(
    `[WEBHOOK] Refund: revoked all entitlements for customer ${dbCustomer.id}`,
  );

  // 6. Deduct credits if the original charge added them
  // Providers may stringify metadata values, so coerce with Number()
  const refundMeta = event.metadata;
  const refundCredits = Number(refundMeta.credits);
  if (!isNaN(refundCredits) && refundCredits > 0) {
    const existingCredits = await db.query.credits.findFirst({
      where: eq(schema.credits.customerId, dbCustomer.id),
    });

    if (existingCredits) {
      // Atomic deduction with floor at 0 to avoid read-then-write race
      await db
        .update(schema.credits)
        .set({
          balance: sql`MAX(0, ${schema.credits.balance} - ${refundCredits})`,
          updatedAt: now,
        })
        .where(eq(schema.credits.id, existingCredits.id));
      console.log(
        `[WEBHOOK] Refund: deducted ${refundCredits} credits (atomic)`,
      );
    }
  }
}
