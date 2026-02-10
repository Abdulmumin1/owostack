import { schema } from "@owostack/db";
import { eq, and, or } from "drizzle-orm";
import { provisionEntitlements } from "../../plan-switch";
import { upsertPaymentMethod } from "../../payment-methods";
import type { WebhookContext } from "../types";
import { safeParseDate } from "../types";

export async function handleSubscriptionCreated(ctx: WebhookContext): Promise<void> {
  const { db, organizationId, event } = ctx;
  const providerCode = event.subscription?.providerCode;
  const planCode = event.plan?.providerPlanCode;

  if (!event.customer.email) {
    console.warn(`[WEBHOOK] subscription.created/active with no customer email — skipping. provider=${event.provider}`);
    return;
  }

  // Find or create customer scoped to this organization
  const email = event.customer.email.toLowerCase();
  let dbCustomer = await db.query.customers.findFirst({
    where: and(
      eq(schema.customers.email, email),
      eq(schema.customers.organizationId, organizationId),
    ),
  });

  if (!dbCustomer) {
    const [newCustomer] = await db
      .insert(schema.customers)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        email,
        providerId: event.provider,
        providerCustomerId: event.customer.providerCustomerId,
        paystackCustomerId: event.provider === "paystack" ? event.customer.providerCustomerId : null,
      })
      .returning();
    dbCustomer = newCustomer;
  }

  if (!planCode) {
    console.warn(`[WEBHOOK] subscription.created without plan code for org ${organizationId}`);
    // Try to link the subscription code to an existing active sub for this customer
    if (providerCode) {
      const existingSubForCustomer = await db.query.subscriptions.findFirst({
        where: and(
          eq(schema.subscriptions.customerId, dbCustomer.id),
          eq(schema.subscriptions.status, "active"),
        ),
      });
      if (existingSubForCustomer) {
        await db
          .update(schema.subscriptions)
          .set({
            providerSubscriptionId: providerCode,
            providerSubscriptionCode: providerCode,
            paystackSubscriptionId: event.provider === "paystack" ? providerCode : existingSubForCustomer.paystackSubscriptionId,
            paystackSubscriptionCode: event.provider === "paystack" ? providerCode : existingSubForCustomer.paystackSubscriptionCode,
            updatedAt: Date.now(),
          })
          .where(eq(schema.subscriptions.id, existingSubForCustomer.id));
      }
    }
    return;
  }

  const dbPlan = await db.query.plans.findFirst({
    where: and(
      or(
        eq(schema.plans.paystackPlanId, planCode),
        eq(schema.plans.providerPlanId, planCode),
      ),
      eq(schema.plans.organizationId, organizationId),
    ),
  });

  if (!dbPlan) {
    // Plan not found — try to link to existing active sub
    if (providerCode) {
      const existingSubForCustomer = await db.query.subscriptions.findFirst({
        where: and(
          eq(schema.subscriptions.customerId, dbCustomer.id),
          eq(schema.subscriptions.status, "active"),
        ),
      });
      if (existingSubForCustomer) {
        await db
          .update(schema.subscriptions)
          .set({
            providerSubscriptionId: providerCode,
            providerSubscriptionCode: providerCode,
            paystackSubscriptionId: event.provider === "paystack" ? providerCode : existingSubForCustomer.paystackSubscriptionId,
            paystackSubscriptionCode: event.provider === "paystack" ? providerCode : existingSubForCustomer.paystackSubscriptionCode,
            updatedAt: Date.now(),
          })
          .where(eq(schema.subscriptions.id, existingSubForCustomer.id));
      } else {
        console.warn(`Plan ${planCode} not found in org ${organizationId}, no existing sub to link`);
      }
    }
    return;
  }

  // Check for existing subscription by provider code (idempotency — same webhook twice)
  if (providerCode) {
    const existing = await db.query.subscriptions.findFirst({
      where: or(
        eq(schema.subscriptions.paystackSubscriptionCode, providerCode),
        eq(schema.subscriptions.providerSubscriptionCode, providerCode),
      ),
    });
    if (existing) return;
  }

  // Check for existing subscription by customer+plan (race condition guard).
  // When our code calls createSubscription on the provider, the webhook can
  // arrive before we've updated the local DB with the provider sub code.
  // If we find an existing trialing/active sub, update it instead of creating a duplicate.
  if (providerCode) {
    const existingByPlan = await db.query.subscriptions.findFirst({
      where: and(
        eq(schema.subscriptions.customerId, dbCustomer.id),
        eq(schema.subscriptions.planId, dbPlan.id),
        or(
          eq(schema.subscriptions.status, "trialing"),
          eq(schema.subscriptions.status, "active"),
        ),
      ),
    });

    if (existingByPlan) {
      await db
        .update(schema.subscriptions)
        .set({
          providerSubscriptionId: providerCode,
          providerSubscriptionCode: providerCode,
          paystackSubscriptionCode: event.provider === "paystack" ? providerCode : existingByPlan.paystackSubscriptionCode,
          updatedAt: Date.now(),
        })
        .where(eq(schema.subscriptions.id, existingByPlan.id));
      console.log(`[WEBHOOK] subscription.created linked to existing sub ${existingByPlan.id} (was ${existingByPlan.status})`);
      return;
    }
  }

  const now = Date.now();
  const periodStart = safeParseDate(event.subscription?.startDate) || now;
  const periodEnd = safeParseDate(event.subscription?.nextPaymentDate) ||
    periodStart + 30 * 24 * 60 * 60 * 1000;

  const fallbackCode = providerCode || crypto.randomUUID();
  await db.insert(schema.subscriptions).values([
    {
      id: crypto.randomUUID(),
      customerId: dbCustomer.id,
      planId: dbPlan.id,
      providerId: event.provider,
      providerSubscriptionId: fallbackCode,
      providerSubscriptionCode: fallbackCode,
      paystackSubscriptionId: event.provider === "paystack" ? providerCode : null,
      paystackSubscriptionCode: event.provider === "paystack" ? providerCode : null,
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      providerMetadata: event.raw,
      metadata: event.raw,
    },
  ]);

  // Provision entitlements for the new subscription
  await provisionEntitlements(db, dbCustomer.id, dbPlan.id);

  // For providers without card auth codes (e.g. Dodo), the subscription ID
  // itself is the chargeable token. Store it as a provider_managed payment method.
  if (providerCode && event.provider !== "paystack") {
    try {
      await upsertPaymentMethod(db, {
        customerId: dbCustomer.id,
        organizationId,
        providerId: event.provider,
        token: providerCode,
        type: "provider_managed",
      });
    } catch (pmErr) {
      console.warn(`[WEBHOOK] Failed to upsert provider_managed payment method: ${pmErr}`);
    }
  }

  // Invalidate cache so /check sees the new subscription immediately
  if (ctx.cache) {
    try {
      await ctx.cache.invalidateSubscriptions(organizationId, dbCustomer.id);
    } catch (e) {
      console.warn(`[WEBHOOK] subscription.created cache invalidation failed:`, e);
    }
  }
}
