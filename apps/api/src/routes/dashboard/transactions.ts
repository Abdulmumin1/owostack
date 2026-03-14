import { Hono } from "hono";
import { eq, desc, inArray } from "drizzle-orm";
import { schema } from "@owostack/db";
import { listRecentEvents } from "../../lib/analytics-engine";
import type { Env, Variables } from "../../index";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

type TransactionSource = "subscription" | "addon" | "invoice";

function parseTransactionId(id: string): {
  source: TransactionSource;
  rawId: string;
  explicit: boolean;
} {
  if (id.startsWith("subscription:")) {
    return {
      source: "subscription",
      rawId: id.slice("subscription:".length),
      explicit: true,
    };
  }
  if (id.startsWith("addon:")) {
    return {
      source: "addon",
      rawId: id.slice("addon:".length),
      explicit: true,
    };
  }
  if (id.startsWith("invoice:")) {
    return {
      source: "invoice",
      rawId: id.slice("invoice:".length),
      explicit: true,
    };
  }

  // Backward compatibility for old IDs from the subscriptions table.
  return { source: "subscription", rawId: id, explicit: false };
}

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
    case "one_time":
      return "One-time Purchase";
    case "trial":
      return "Free Trial";
    case "free":
      return "Free Plan";
    case "subscription":
      return "Subscription";
    case "addon":
      return "Add-on Credits";
    case "overage":
      return "Overage Invoice";
    default:
      return "Transaction";
  }
}

async function getCustomerEvents(env: Env, customerId: string) {
  const result = await listRecentEvents(env, { customerId, limit: 20 });
  if (!result.success) return [];
  return result.data;
}

// =============================================================================
// List all transactions (subscriptions + add-ons + invoices)
// =============================================================================
app.get("/", async (c) => {
  const organizationId = c.get("organizationId");
  const limit = Number(c.req.query("limit")) || 20;
  const offset = Number(c.req.query("offset")) || 0;

  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const db = c.get("db");

  const [subscriptionRows, addonRowsRaw, invoiceRows] = await Promise.all([
    db
      .select({
        subscription: schema.subscriptions,
        customer: schema.customers,
        plan: schema.plans,
      })
      .from(schema.subscriptions)
      .innerJoin(
        schema.customers,
        eq(schema.subscriptions.customerId, schema.customers.id),
      )
      .leftJoin(schema.plans, eq(schema.subscriptions.planId, schema.plans.id))
      .where(eq(schema.customers.organizationId, organizationId)),
    (async () => {
      try {
        return await (db as any)
          .select({
            purchase: (schema as any).creditPurchases,
            customer: schema.customers,
            creditPack: (schema as any).creditPacks,
          })
          .from((schema as any).creditPurchases)
          .innerJoin(
            schema.customers,
            eq((schema as any).creditPurchases.customerId, schema.customers.id),
          )
          .leftJoin(
            (schema as any).creditPacks,
            eq(
              (schema as any).creditPurchases.creditPackId,
              (schema as any).creditPacks.id,
            ),
          )
          .where(eq(schema.customers.organizationId, organizationId));
      } catch (e: any) {
        if (e?.message?.includes("no such table")) {
          return [];
        }
        throw e;
      }
    })(),
    db
      .select({
        invoice: schema.invoices,
        customer: schema.customers,
      })
      .from(schema.invoices)
      .innerJoin(
        schema.customers,
        eq(schema.invoices.customerId, schema.customers.id),
      )
      .where(eq(schema.invoices.organizationId, organizationId)),
  ]);

  const invoiceIds = invoiceRows.map((row: any) => row.invoice.id);
  const invoiceAttempts =
    invoiceIds.length > 0
      ? await db
          .select({
            invoiceId: schema.paymentAttempts.invoiceId,
            provider: schema.paymentAttempts.provider,
            createdAt: schema.paymentAttempts.createdAt,
          })
          .from(schema.paymentAttempts)
          .where(inArray(schema.paymentAttempts.invoiceId, invoiceIds))
          .orderBy(desc(schema.paymentAttempts.createdAt))
      : [];

  const invoiceProviderById = new Map<string, string | null>();
  for (const attempt of invoiceAttempts) {
    if (!invoiceProviderById.has(attempt.invoiceId)) {
      invoiceProviderById.set(attempt.invoiceId, attempt.provider || null);
    }
  }

  const subscriptionTransactions = subscriptionRows.map(
    ({ subscription, customer, plan }: any) => {
      const type = classifyTransaction(subscription, plan);
      return {
        id: subscription.id,
        source: "subscription",
        rawId: subscription.id,
        type,
        typeLabel: transactionLabel(type),
        status: subscription.status,
        customer: {
          id: customer.id,
          email: customer.email,
          name: customer.name,
        },
        plan: {
          id: plan?.id || null,
          name: plan?.name || "Subscription",
          slug: plan?.slug || null,
          price: plan?.price || 0,
          currency: plan?.currency || "USD",
          interval: plan?.interval || null,
          billingType: plan?.billingType || null,
        },
        providerId: subscription.providerId || null,
        amount: plan?.price || 0,
        currency: plan?.currency || "USD",
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        createdAt: subscription.createdAt,
      };
    },
  );

  const addonTransactions = addonRowsRaw.map(
    ({ purchase, customer, creditPack }: any) => ({
      id: purchase.id,
      source: "addon",
      rawId: purchase.id,
      type: "addon",
      typeLabel: transactionLabel("addon"),
      status: "completed",
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
      },
      plan: {
        id: creditPack?.id || purchase.creditPackId || null,
        name: creditPack?.name || "Credit Pack",
        slug: creditPack?.slug || null,
        price: purchase.price || 0,
        currency: purchase.currency || "USD",
        interval: null,
        billingType: "one_time",
      },
      providerId: purchase.providerId || null,
      amount: purchase.price || 0,
      currency: purchase.currency || "USD",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      createdAt: purchase.createdAt,
    }),
  );

  const invoiceTransactions = invoiceRows.map(({ invoice, customer }: any) => ({
    id: invoice.id,
    source: "invoice",
    rawId: invoice.id,
    type: "overage",
    typeLabel: transactionLabel("overage"),
    status: invoice.status,
    customer: {
      id: customer.id,
      email: customer.email,
      name: customer.name,
    },
    plan: {
      id: invoice.id,
      name: invoice.number || "Invoice",
      slug: null,
      price: invoice.total || 0,
      currency: invoice.currency || "USD",
      interval: null,
      billingType: "one_time",
    },
    providerId: invoiceProviderById.get(invoice.id) || null,
    amount: invoice.total || 0,
    currency: invoice.currency || "USD",
    currentPeriodStart: invoice.periodStart || null,
    currentPeriodEnd: invoice.periodEnd || null,
    createdAt: invoice.createdAt,
  }));

  const combined = [
    ...subscriptionTransactions,
    ...addonTransactions,
    ...invoiceTransactions,
  ].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const total = combined.length;
  const paged = combined.slice(offset, offset + limit);
  return c.json({ success: true, data: paged, total });
});

// =============================================================================
// Transaction detail
// =============================================================================
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  try {
    const { source, rawId, explicit } = parseTransactionId(id);

    if (source === "subscription") {
      const subscription = await db.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.id, rawId),
        with: { plan: true, customer: true },
      });

      if (!subscription) {
        if (explicit) {
          return c.json(
            { success: false, error: "Transaction not found" },
            404,
          );
        }
      } else {
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

        const events = await getCustomerEvents(c.env, subscription.customerId);

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
      }
    }

    if (source === "addon" || !explicit) {
      let rows: any[] = [];
      try {
        rows = await (db as any)
          .select({
            purchase: (schema as any).creditPurchases,
            customer: schema.customers,
            creditPack: (schema as any).creditPacks,
          })
          .from((schema as any).creditPurchases)
          .innerJoin(
            schema.customers,
            eq((schema as any).creditPurchases.customerId, schema.customers.id),
          )
          .leftJoin(
            (schema as any).creditPacks,
            eq(
              (schema as any).creditPurchases.creditPackId,
              (schema as any).creditPacks.id,
            ),
          )
          .where(eq((schema as any).creditPurchases.id, rawId))
          .limit(1);
      } catch (e: any) {
        if (!e?.message?.includes("no such table")) {
          throw e;
        }
      }

      const row = rows[0];
      if (!row && source === "addon") {
        return c.json({ success: false, error: "Transaction not found" }, 404);
      }

      if (row) {
        const events = await getCustomerEvents(c.env, row.customer.id);

        return c.json({
          success: true,
          data: {
            transaction: {
              id: row.purchase.id,
              type: "addon",
              typeLabel: transactionLabel("addon"),
              status: "completed",
              providerId: row.purchase.providerId || null,
              currentPeriodStart: null,
              currentPeriodEnd: null,
              paystackSubscriptionCode: null,
              providerSubscriptionCode: null,
              paymentReference: row.purchase.paymentReference || null,
              metadata: row.purchase.metadata || null,
              createdAt: row.purchase.createdAt,
            },
            plan: {
              id: row.creditPack?.id || row.purchase.creditPackId || null,
              name: row.creditPack?.name || "Credit Pack",
              slug: row.creditPack?.slug || null,
              price: row.purchase.price || 0,
              currency: row.purchase.currency || "USD",
              interval: null,
              billingType: "one_time",
            },
            customer: {
              id: row.customer.id,
              email: row.customer.email,
              name: row.customer.name,
            },
            entitlements: [],
            planFeatures: [],
            events,
          },
        });
      }
    }

    // source === "invoice" OR fallback for un-prefixed IDs
    const rows = await db
      .select({
        invoice: schema.invoices,
        customer: schema.customers,
      })
      .from(schema.invoices)
      .innerJoin(
        schema.customers,
        eq(schema.invoices.customerId, schema.customers.id),
      )
      .where(eq(schema.invoices.id, rawId))
      .limit(1);

    const row = rows[0];
    if (!row && source === "invoice") {
      return c.json({ success: false, error: "Transaction not found" }, 404);
    }
    if (!row) {
      return c.json({ success: false, error: "Transaction not found" }, 404);
    }

    const [invoiceItems, paymentAttempts, events] = await Promise.all([
      db.query.invoiceItems.findMany({
        where: eq(schema.invoiceItems.invoiceId, row.invoice.id),
      }),
      db.query.paymentAttempts.findMany({
        where: eq(schema.paymentAttempts.invoiceId, row.invoice.id),
        orderBy: [desc(schema.paymentAttempts.createdAt)],
      }),
      getCustomerEvents(c.env, row.customer.id),
    ]);

    return c.json({
      success: true,
      data: {
        transaction: {
          id: row.invoice.id,
          type: "overage",
          typeLabel: transactionLabel("overage"),
          status: row.invoice.status,
          providerId: paymentAttempts[0]?.provider || null,
          currentPeriodStart: row.invoice.periodStart,
          currentPeriodEnd: row.invoice.periodEnd,
          paystackSubscriptionCode: null,
          providerSubscriptionCode: null,
          metadata: row.invoice.metadata || null,
          createdAt: row.invoice.createdAt,
        },
        plan: {
          id: row.invoice.id,
          name: row.invoice.number || "Invoice",
          slug: null,
          price: row.invoice.total || 0,
          currency: row.invoice.currency || "USD",
          interval: null,
          billingType: "one_time",
        },
        customer: {
          id: row.customer.id,
          email: row.customer.email,
          name: row.customer.name,
        },
        entitlements: [],
        planFeatures: invoiceItems.map(
          (item: { featureId: string | null; description: string }) => ({
            featureId: item.featureId,
            featureName: item.description,
            featureSlug: null,
            featureType: "metered",
            unit: null,
            limitValue: null,
            resetInterval: null,
          }),
        ),
        events,
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
