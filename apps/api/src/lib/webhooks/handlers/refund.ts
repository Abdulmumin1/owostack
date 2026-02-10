import { schema } from "@owostack/db";
import { eq, and, or, sql } from "drizzle-orm";
import type { WebhookContext } from "../types";

export async function handleRefund(ctx: WebhookContext): Promise<void> {
  const { db, organizationId, event, adapter, providerAccount, cache } = ctx;
  const email = event.customer.email?.toLowerCase();
  if (!email) {
    console.warn(`[WEBHOOK] refund.success without customer email for org=${organizationId}`);
    return;
  }

  const refundAmount = event.refund?.amount || 0;
  console.log(`[WEBHOOK] Processing refund for org=${organizationId}, customer=${email}, amount=${refundAmount}, ref=${event.refund?.reference}`);

  // 1. Find customer
  const dbCustomer = await db.query.customers.findFirst({
    where: and(
      eq(schema.customers.email, email),
      eq(schema.customers.organizationId, organizationId),
    ),
  });

  if (!dbCustomer) {
    console.warn(`[WEBHOOK] Refund: customer ${email} not found in org ${organizationId}`);
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
  const isFullRefund = refundAmount === 0 || activeSubs.some(
    (sub: { plan?: { price: number } | null }) => sub.plan && refundAmount >= sub.plan.price,
  );

  if (!isFullRefund) {
    // Partial refund — record on subscription metadata, don't revoke access
    console.log(`[WEBHOOK] Partial refund (${refundAmount}) for customer ${dbCustomer.id} — recording without revoking access`);
    for (const sub of activeSubs) {
      const existingMeta = typeof sub.metadata === "object" && sub.metadata ? sub.metadata as Record<string, unknown> : {};
      const refunds = Array.isArray(existingMeta.refunds) ? existingMeta.refunds : [];
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
    const subCode = sub.providerSubscriptionCode || sub.paystackSubscriptionCode;
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
        console.warn(`[WEBHOOK] Refund: provider cancel failed for sub ${subCode}:`, e);
      }
    }

    await db
      .update(schema.subscriptions)
      .set({ status: "refunded", canceledAt: now, updatedAt: now })
      .where(eq(schema.subscriptions.id, sub.id));

    console.log(`[WEBHOOK] Refund: canceled subscription ${sub.id} (plan=${sub.planId})`);
  }

  // 5. Revoke all entitlements for this customer
  await db
    .delete(schema.entitlements)
    .where(eq(schema.entitlements.customerId, dbCustomer.id));

  // 5b. Invalidate cache so /check returns denied immediately
  if (cache) {
    try {
      await Promise.all([
        cache.invalidateCustomer(organizationId, email),
        cache.invalidateSubscriptions(organizationId, dbCustomer.id),
      ]);
    } catch (e) {
      console.warn(`[WEBHOOK] Refund: cache invalidation failed:`, e);
    }
  }

  console.log(`[WEBHOOK] Refund: revoked all entitlements for customer ${dbCustomer.id}`);

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
      console.log(`[WEBHOOK] Refund: deducted ${refundCredits} credits (atomic)`);
    }
  }
}
