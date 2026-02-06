import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { schema } from "@owostack/db";
import type { Env, Variables } from "../../index";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Classify a subscription record into a transaction type
 */
function classifyTransaction(sub: any, plan: any) {
  // One-time purchase
  if (
    plan?.billingType === "one_time" ||
    sub.paystackSubscriptionCode === "one-time" ||
    sub.providerSubscriptionCode === "one-time" ||
    (sub.metadata as any)?.billing_type === "one_time" ||
    (sub.metadata as any)?.type === "one_time_purchase"
  ) {
    return "one_time";
  }

  // Free trial
  if (
    sub.paystackSubscriptionCode?.startsWith("trial-") ||
    sub.providerSubscriptionCode?.startsWith("trial-") ||
    (sub.metadata as any)?.type === "trial"
  ) {
    return "trial";
  }

  // Free plan (price = 0, no paystack code)
  if (plan?.price === 0 || plan?.type === "free") {
    return "free";
  }

  // Regular subscription
  return "subscription";
}

function transactionLabel(type: string) {
  switch (type) {
    case "one_time": return "One-time Purchase";
    case "trial": return "Free Trial";
    case "free": return "Free Plan";
    case "subscription": return "Subscription";
    default: return "Transaction";
  }
}

// =============================================================================
// List all transactions (aggregated from subscriptions table)
// =============================================================================
app.get("/", async (c) => {
  const organizationId = c.req.query("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const db = c.get("db");

  const customers = await db.query.customers.findMany({
    where: eq(schema.customers.organizationId, organizationId),
    with: {
      subscriptions: {
        with: {
          plan: true,
        },
        orderBy: [desc(schema.subscriptions.createdAt)],
      },
    },
  });

  const transactions = customers.flatMap((cust: any) =>
    cust.subscriptions.map((sub: any) => {
      const type = classifyTransaction(sub, sub.plan);
      return {
        id: sub.id,
        type,
        typeLabel: transactionLabel(type),
        status: sub.status,
        customer: {
          id: cust.id,
          email: cust.email,
          name: cust.name,
        },
        plan: sub.plan
          ? {
              id: sub.plan.id,
              name: sub.plan.name,
              slug: sub.plan.slug,
              price: sub.plan.price,
              currency: sub.plan.currency,
              interval: sub.plan.interval,
              billingType: sub.plan.billingType,
            }
          : null,
        providerId: sub.providerId || null,
        amount: sub.plan?.price || 0,
        currency: sub.plan?.currency || "NGN",
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        createdAt: sub.createdAt,
      };
    }),
  );

  // Sort all transactions by createdAt descending
  transactions.sort((a: any, b: any) => b.createdAt - a.createdAt);

  return c.json({ success: true, data: transactions });
});

// =============================================================================
// Transaction detail (entitlements granted, timeline)
// =============================================================================
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  try {
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.id, id),
      with: { plan: true, customer: true },
    });

    if (!subscription) {
      return c.json({ success: false, error: "Transaction not found" }, 404);
    }

    const type = classifyTransaction(subscription, subscription.plan);

    // Get entitlements granted to this customer
    const entitlements = await db
      .select({
        id: schema.entitlements.id,
        featureId: schema.features.id,
        featureName: schema.features.name,
        featureSlug: schema.features.slug,
        featureType: schema.features.type,
        unit: schema.features.unit,
        limitValue: schema.entitlements.limitValue,
        resetInterval: schema.entitlements.resetInterval,
        lastResetAt: schema.entitlements.lastResetAt,
        expiresAt: schema.entitlements.expiresAt,
      })
      .from(schema.entitlements)
      .innerJoin(
        schema.features,
        eq(schema.entitlements.featureId, schema.features.id),
      )
      .where(eq(schema.entitlements.customerId, subscription.customerId));

    // Get plan features (what was supposed to be granted)
    const planFeatures = await db
      .select({
        featureId: schema.planFeatures.featureId,
        featureName: schema.features.name,
        featureSlug: schema.features.slug,
        featureType: schema.features.type,
        unit: schema.features.unit,
        limitValue: schema.planFeatures.limitValue,
        resetInterval: schema.planFeatures.resetInterval,
      })
      .from(schema.planFeatures)
      .innerJoin(
        schema.features,
        eq(schema.planFeatures.featureId, schema.features.id),
      )
      .where(eq(schema.planFeatures.planId, subscription.planId));

    // Recent events for this customer
    const events = await db
      .select({
        id: schema.events.id,
        type: schema.events.type,
        data: schema.events.data,
        createdAt: schema.events.createdAt,
      })
      .from(schema.events)
      .where(eq(schema.events.customerId, subscription.customerId))
      .orderBy(desc(schema.events.createdAt))
      .limit(20);

    return c.json({
      success: true,
      data: {
        transaction: {
          id: subscription.id,
          type,
          typeLabel: transactionLabel(type),
          status: subscription.status,
          providerId: subscription.providerId || null,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          paystackSubscriptionCode: subscription.paystackSubscriptionCode,
          providerSubscriptionCode: subscription.providerSubscriptionCode,
          metadata: subscription.metadata,
          createdAt: subscription.createdAt,
        },
        plan: {
          id: subscription.plan.id,
          name: subscription.plan.name,
          slug: subscription.plan.slug,
          price: subscription.plan.price,
          currency: subscription.plan.currency,
          interval: subscription.plan.interval,
          billingType: subscription.plan.billingType,
        },
        customer: {
          id: subscription.customer.id,
          email: subscription.customer.email,
          name: subscription.customer.name,
        },
        entitlements,
        planFeatures,
        events,
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
