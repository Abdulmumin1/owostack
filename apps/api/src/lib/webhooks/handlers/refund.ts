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

  const refundAmount = event.refund?.amount;
  // Adapters put the *original payment* on event.payment.reference and the
  // provider's refund id on event.refund.reference. Only the former can be
  // correlated with anything we stored.
  const refundReference =
    event.payment?.reference || event.refund?.reference || undefined;
  console.log(
    `[WEBHOOK] Processing refund for org=${organizationId}, customer=${email}, amount=${refundAmount ?? "unknown"}, payment=${refundReference}, refund=${event.refund?.reference}`,
  );

  if (!refundReference) {
    console.warn(
      `[WEBHOOK] refund.success without payment reference for org=${organizationId}, customer=${email}`,
    );
    return;
  }

  if (refundAmount === undefined || refundAmount === null) {
    console.warn(
      `[WEBHOOK] refund.success with unknown amount for org=${organizationId}, customer=${email}, ref=${refundReference}`,
    );
    return;
  }

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

  // 2. Correlate the refund to the original payment attempt before side effects.
  const paymentAttempt = await db.query.paymentAttempts.findFirst({
    where: and(
      eq(schema.paymentAttempts.providerReference, refundReference),
      eq(schema.paymentAttempts.status, "succeeded"),
    ),
    with: { invoice: true },
  });

  let targetSub:
    | (typeof schema.subscriptions.$inferSelect & {
        plan: typeof schema.plans.$inferSelect | null;
      })
    | undefined;

  if (
    paymentAttempt?.invoice &&
    paymentAttempt.invoice.organizationId === organizationId &&
    paymentAttempt.invoice.customerId === dbCustomer.id &&
    paymentAttempt.invoice.subscriptionId
  ) {
    targetSub = await db.query.subscriptions.findFirst({
      where: and(
        eq(schema.subscriptions.id, paymentAttempt.invoice.subscriptionId),
        eq(schema.subscriptions.customerId, dbCustomer.id),
        or(
          eq(schema.subscriptions.status, "active"),
          eq(schema.subscriptions.status, "trialing"),
        ),
      ),
      with: { plan: true },
    });
  }

  // 2b. Checkout-originated payments (the first charge of a subscription,
  //     a proration) have no invoice/payment_attempt. Match the payment
  //     reference the subscription webhooks recorded on the row instead.
  if (!targetSub) {
    const candidates = await db.query.subscriptions.findMany({
      where: and(
        eq(schema.subscriptions.customerId, dbCustomer.id),
        or(
          eq(schema.subscriptions.status, "active"),
          eq(schema.subscriptions.status, "trialing"),
        ),
      ),
      with: { plan: true },
    });
    targetSub = candidates.find((sub: (typeof candidates)[number]) =>
      subscriptionPaymentReferences(sub.metadata).has(refundReference),
    );
  }

  if (!targetSub) {
    console.warn(
      `[WEBHOOK] Refund: payment reference ${refundReference} did not match an active subscription for customer ${dbCustomer.id}`,
    );
    return;
  }

  // 3. Determine if this is a full or partial refund.
  //    Full refund: refund amount >= matched active plan's price (minor units).
  //    Missing refund amounts are treated as unknown above and do not revoke access.
  //    IMPORTANT: Only compare amounts when currencies match to avoid incorrect comparisons
  //    (e.g., 10000 kobo NGN != 10000 cents USD)
  const refundCurrency = event.refund?.currency?.toUpperCase();
  const isFullRefund = (() => {
    // The provider knows whether it refunded the whole payment; trust that
    // before comparing amounts that may be in a different currency.
    if (typeof event.refund?.isPartial === "boolean") {
      return !event.refund.isPartial;
    }
    if (!targetSub.plan) return false;
    if (
      refundCurrency &&
      targetSub.plan.currency &&
      targetSub.plan.currency.toUpperCase() !== refundCurrency
    ) {
      return false;
    }
    return refundAmount >= targetSub.plan.price;
  })();

  if (!isFullRefund) {
    // Partial refund — record on the matched subscription metadata, don't revoke access
    console.log(
      `[WEBHOOK] Partial refund (${refundAmount}) for subscription ${targetSub.id} — recording without revoking access`,
    );
    const existingMeta =
      typeof targetSub.metadata === "object" && targetSub.metadata
        ? (targetSub.metadata as Record<string, unknown>)
        : {};
    const refunds = Array.isArray(existingMeta.refunds)
      ? existingMeta.refunds
      : [];
    refunds.push({
      amount: refundAmount,
      currency: event.refund?.currency,
      reference: refundReference,
      reason: event.refund?.reason,
      at: now,
    });
    await db
      .update(schema.subscriptions)
      .set({ metadata: { ...existingMeta, refunds }, updatedAt: now })
      .where(eq(schema.subscriptions.id, targetSub.id));
    return;
  }

  // 4. Full refund — cancel only the matched subscription (on provider + locally)
  const subCode =
    targetSub.providerSubscriptionCode || targetSub.paystackSubscriptionCode;
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
        subscription: { id: subCode, status: targetSub.status || "active" },
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
    .where(eq(schema.subscriptions.id, targetSub.id));

  console.log(
    `[WEBHOOK] Refund: canceled subscription ${targetSub.id} (plan=${targetSub.planId})`,
  );

  // 5. Revoke plan entitlements for this customer. Entitlements are customer/feature scoped today,
  // so this is the narrowest safe persisted predicate available without subscription-scoped grants.
  await db
    .delete(schema.entitlements)
    .where(
      and(
        eq(schema.entitlements.customerId, dbCustomer.id),
        eq(schema.entitlements.source, "plan"),
      ),
    );

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
    `[WEBHOOK] Refund: revoked plan entitlements for refunded subscription ${targetSub.id}`,
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

/**
 * Every provider payment reference a subscription row is known to carry:
 * references recorded by charge.success, and the payment id embedded in the
 * raw provider payload the row was created from.
 */
export function subscriptionPaymentReferences(metadata: unknown): Set<string> {
  const refs = new Set<string>();
  if (!metadata || typeof metadata !== "object") return refs;
  const meta = metadata as Record<string, unknown>;

  const add = (v: unknown) => {
    if (typeof v === "string" && v.length > 0) refs.add(v);
  };
  add(meta.last_payment_reference);
  add(meta.initial_payment_reference);
  add((meta.last_proration_payment as Record<string, unknown> | undefined)?.reference);

  const data = (meta.data as Record<string, unknown> | undefined) ?? meta;
  add(data.payment_id);
  add(data.reference);
  add(data.charge_id);
  const payment = data.payment as Record<string, unknown> | undefined;
  add(payment?.reference);
  return refs;
}
