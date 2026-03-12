import { schema } from "@owostack/db";
import { eq, and, or } from "drizzle-orm";
import { provisionEntitlements } from "../../plan-switch";
import { upsertPaymentMethod } from "../../payment-methods";
import { buildRenewalSetupRecoveryUpdate } from "../../renewal-setup";
import type { WebhookContext } from "../types";
import { safeParseDate } from "../types";
import {
  getSubscriptionEventPlanCode,
  resolveSubscriptionEventCustomer,
  resolveSubscriptionEventPlan,
} from "./subscription-resolution";

export type SubscriptionCreatedDependencies = {
  provisionEntitlements: typeof provisionEntitlements;
  upsertPaymentMethod: typeof upsertPaymentMethod;
};

export const subscriptionCreatedDependencies: SubscriptionCreatedDependencies = {
  provisionEntitlements,
  upsertPaymentMethod,
};

async function invalidateSubscriptionCache(
  ctx: WebhookContext,
  customerId: string,
): Promise<void> {
  if (!ctx.cache) return;

  try {
    await ctx.cache.invalidateSubscriptions(ctx.organizationId, customerId);
  } catch (e) {
    console.warn(`[WEBHOOK] subscription.created cache invalidation failed:`, e);
  }
}

export async function handleSubscriptionCreated(
  ctx: WebhookContext,
): Promise<void> {
  const { db, organizationId, event } = ctx;
  const providerCode = event.subscription?.providerCode;
  const planCode = getSubscriptionEventPlanCode(ctx);

  // Find or create customer scoped to this organization
  let dbCustomer = await resolveSubscriptionEventCustomer(ctx, {
    allowCreate: true,
    logContext: "subscription.created",
  });
  if (!dbCustomer) {
    console.warn(
      `[WEBHOOK] subscription.created/active could not resolve customer — skipping. provider=${event.provider}`,
    );
    return;
  }

  const shouldSyncProviderCustomer =
    !!event.customer.providerCustomerId &&
    (dbCustomer.providerId !== event.provider ||
      dbCustomer.providerCustomerId !== event.customer.providerCustomerId ||
      (event.provider === "paystack" &&
        dbCustomer.paystackCustomerId !== event.customer.providerCustomerId));
  if (shouldSyncProviderCustomer) {
    await db
      .update(schema.customers)
      .set({
        providerId: event.provider,
        providerCustomerId:
          event.customer.providerCustomerId || dbCustomer.providerCustomerId,
        paystackCustomerId:
          event.provider === "paystack"
            ? event.customer.providerCustomerId || dbCustomer.paystackCustomerId
            : dbCustomer.paystackCustomerId,
        updatedAt: Date.now(),
      })
      .where(eq(schema.customers.id, dbCustomer.id));

    dbCustomer = {
      ...dbCustomer,
      providerId: event.provider,
      providerCustomerId:
        event.customer.providerCustomerId || dbCustomer.providerCustomerId,
      paystackCustomerId:
        event.provider === "paystack"
          ? event.customer.providerCustomerId || dbCustomer.paystackCustomerId
          : dbCustomer.paystackCustomerId,
    };
  }

  if (ctx.cache) {
    try {
      const cacheAny = ctx.cache as any;
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
          dashboardInvalidate,
        ]);
      } else {
        await Promise.all([
          dbCustomer.email
            ? ctx.cache.invalidateCustomer(organizationId, dbCustomer.email)
            : Promise.resolve(),
          ctx.cache.invalidateCustomer(organizationId, dbCustomer.id),
          dashboardInvalidate,
        ]);
      }
    } catch (e) {
      console.warn(
        `[WEBHOOK] subscription.created customer cache invalidation failed:`,
        e,
      );
    }
  }

  if (!planCode) {
    console.warn(
      `[WEBHOOK] subscription.created without plan code for org ${organizationId}`,
    );
    // Try to link the subscription code to an existing active sub for this customer
    if (providerCode) {
      const existingSubForCustomer = await db.query.subscriptions.findFirst({
        where: and(
          eq(schema.subscriptions.customerId, dbCustomer.id),
          or(
            eq(schema.subscriptions.status, "active"),
            eq(schema.subscriptions.status, "trialing"),
            eq(schema.subscriptions.status, "pending_cancel"),
            eq(schema.subscriptions.status, "past_due"),
          ),
        ),
      });
      if (existingSubForCustomer) {
        const now = Date.now();
        const renewalSetupRecovery = buildRenewalSetupRecoveryUpdate(
          existingSubForCustomer.metadata,
          "subscription_created",
          now,
        );
        await db
          .update(schema.subscriptions)
          .set({
            providerSubscriptionId: providerCode,
            providerSubscriptionCode: providerCode,
            paystackSubscriptionId:
              event.provider === "paystack"
                ? providerCode
                : existingSubForCustomer.paystackSubscriptionId,
            paystackSubscriptionCode:
              event.provider === "paystack"
                ? providerCode
                : existingSubForCustomer.paystackSubscriptionCode,
            providerId: event.provider,
            cancelAt: renewalSetupRecovery?.clearCancelAt ? null : undefined,
            metadata: renewalSetupRecovery?.metadata,
            updatedAt: now,
          })
          .where(eq(schema.subscriptions.id, existingSubForCustomer.id));
        await invalidateSubscriptionCache(ctx, existingSubForCustomer.customerId);
      }
    }
    return;
  }

  const dbPlan = await resolveSubscriptionEventPlan(ctx);

  if (!dbPlan) {
    // Plan not found — try to link to existing active sub
    if (providerCode) {
      const existingSubForCustomer = await db.query.subscriptions.findFirst({
        where: and(
          eq(schema.subscriptions.customerId, dbCustomer.id),
          or(
            eq(schema.subscriptions.status, "active"),
            eq(schema.subscriptions.status, "trialing"),
            eq(schema.subscriptions.status, "pending_cancel"),
            eq(schema.subscriptions.status, "past_due"),
          ),
        ),
      });
      if (existingSubForCustomer) {
        const now = Date.now();
        const renewalSetupRecovery = buildRenewalSetupRecoveryUpdate(
          existingSubForCustomer.metadata,
          "subscription_created",
          now,
        );
        await db
          .update(schema.subscriptions)
          .set({
            providerSubscriptionId: providerCode,
            providerSubscriptionCode: providerCode,
            paystackSubscriptionId:
              event.provider === "paystack"
                ? providerCode
                : existingSubForCustomer.paystackSubscriptionId,
            paystackSubscriptionCode:
              event.provider === "paystack"
                ? providerCode
                : existingSubForCustomer.paystackSubscriptionCode,
            providerId: event.provider,
            cancelAt: renewalSetupRecovery?.clearCancelAt ? null : undefined,
            metadata: renewalSetupRecovery?.metadata,
            updatedAt: now,
          })
          .where(eq(schema.subscriptions.id, existingSubForCustomer.id));
        await invalidateSubscriptionCache(ctx, existingSubForCustomer.customerId);
      } else {
        console.warn(
          `Plan ${planCode} not found in org ${organizationId}, no existing sub to link`,
        );
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
          eq(schema.subscriptions.status, "pending"),
        ),
      ),
    });

    if (existingByPlan) {
      const isActivatingPending = existingByPlan.status === "pending";

      const now = Date.now();
      const periodStart = safeParseDate(event.subscription?.startDate) || now;
      const periodEnd =
        safeParseDate(event.subscription?.nextPaymentDate) ||
        periodStart + 30 * 24 * 60 * 60 * 1000;
      const renewalSetupRecovery = buildRenewalSetupRecoveryUpdate(
        existingByPlan.metadata,
        "subscription_created",
        now,
      );

      await db
        .update(schema.subscriptions)
        .set({
          status: isActivatingPending ? "active" : undefined,
          currentPeriodStart: isActivatingPending ? periodStart : undefined,
          currentPeriodEnd: isActivatingPending ? periodEnd : undefined,
          providerSubscriptionId: providerCode,
          providerSubscriptionCode: providerCode,
          paystackSubscriptionCode:
            event.provider === "paystack"
              ? providerCode
              : existingByPlan.paystackSubscriptionCode,
          providerId: event.provider,
          cancelAt: renewalSetupRecovery?.clearCancelAt ? null : undefined,
          metadata: renewalSetupRecovery?.metadata,
          updatedAt: now,
        })
        .where(eq(schema.subscriptions.id, existingByPlan.id));

      await invalidateSubscriptionCache(ctx, existingByPlan.customerId);

      if (isActivatingPending) {
        await subscriptionCreatedDependencies.provisionEntitlements(
          db,
          dbCustomer.id,
          dbPlan.id,
        );
      }

      console.log(
        `[WEBHOOK] subscription.created linked to existing sub ${existingByPlan.id} (was ${existingByPlan.status})`,
      );
      return;
    }
  }

  const now = Date.now();
  const periodStart = safeParseDate(event.subscription?.startDate) || now;
  const periodEnd =
    safeParseDate(event.subscription?.nextPaymentDate) ||
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
      paystackSubscriptionId:
        event.provider === "paystack" ? providerCode : null,
      paystackSubscriptionCode:
        event.provider === "paystack" ? providerCode : null,
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      providerMetadata: event.raw,
      metadata: event.raw,
    },
  ]);

  // Provision entitlements for the new subscription
  await subscriptionCreatedDependencies.provisionEntitlements(
    db,
    dbCustomer.id,
    dbPlan.id,
  );

  // For providers without card auth codes (e.g. Dodo), the subscription ID
  // itself is the chargeable token. Store it as a provider_managed payment method.
  if (providerCode && event.provider !== "paystack") {
    try {
      await subscriptionCreatedDependencies.upsertPaymentMethod(db, {
        customerId: dbCustomer.id,
        organizationId,
        providerId: event.provider,
        token: providerCode,
        type: "provider_managed",
      });
    } catch (pmErr) {
      console.warn(
        `[WEBHOOK] Failed to upsert provider_managed payment method: ${pmErr}`,
      );
    }
  }

  // Invalidate cache so /check sees the new subscription immediately
  if (ctx.cache) {
    try {
      await ctx.cache.invalidateSubscriptions(organizationId, dbCustomer.id);
    } catch (e) {
      console.warn(
        `[WEBHOOK] subscription.created cache invalidation failed:`,
        e,
      );
    }
  }
}
