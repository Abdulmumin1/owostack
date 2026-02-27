import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import { schema } from "@owostack/db";
import { previewSwitch, executeSwitch } from "../../lib/plan-switch";
import type { ProviderContext } from "../../lib/plan-switch";
import { getProviderRegistry, deriveProviderEnvironment, loadProviderAccounts } from "../../lib/providers";
import { EntitlementCache } from "../../lib/cache";
import type { Env, Variables } from "../../index";
import { errorToResponse, ValidationError } from "../../lib/errors";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function zodErrorToResponse(zodError: {
  flatten: () => {
    formErrors: string[];
    fieldErrors: Record<string, string[] | undefined>;
  };
}) {
  const flattened = zodError.flatten();
  const fieldErrors = Object.entries(flattened.fieldErrors);

  if (fieldErrors.length > 0) {
    const [field, messages] = fieldErrors[0];
    return errorToResponse(
      new ValidationError({ field, details: messages?.[0] || "Invalid value" }),
    );
  }

  const formError = flattened.formErrors[0];
  return errorToResponse(
    new ValidationError({
      field: "input",
      details: formError || "Invalid request body",
    }),
  );
}

const createSubscriptionSchema = z.object({
  customerId: z.string(),
  planId: z.string(),
  status: z
    .enum(["active", "canceled", "incomplete", "past_due"])
    .default("active"),
  currentPeriodStart: z.string().optional(), // ISO Date
  currentPeriodEnd: z.string().optional(), // ISO Date
});

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createSubscriptionSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { customerId, planId, status, currentPeriodStart, currentPeriodEnd } =
    parsed.data;
  const db = c.get("db");

  // Default dates — schema expects integer timestamps (ms)
  const start = currentPeriodStart
    ? new Date(currentPeriodStart).getTime()
    : Date.now();
  const end = currentPeriodEnd
    ? new Date(currentPeriodEnd).getTime()
    : Date.now() + 30 * 24 * 60 * 60 * 1000;

  try {
    const [subscription] = await db
      .insert(schema.subscriptions)
      .values({
        id: crypto.randomUUID(),
        customerId,
        planId,
        status,
        currentPeriodStart: start,
        currentPeriodEnd: end,
      })
      .returning();

    return c.json({ success: true, data: subscription });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

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
      },
    },
  });

  // console.log(customers)
  const subscriptions = customers.flatMap((cust: any) =>
    cust.subscriptions
      .filter((sub: any) => {
        // Exclude one-time purchases
        if (sub.paystackSubscriptionCode === "one-time") return false;
        if (sub.providerSubscriptionCode === "one-time") return false;
        if ((sub.metadata as any)?.billing_type === "one_time") return false;
        if ((sub.metadata as any)?.type === "one_time_purchase") return false;
        if (sub.plan?.billingType === "one_time") return false;
        return true;
      })
      .map((sub: any) => ({
        ...sub,
        customer: {
          id: cust.id,
          email: cust.email,
          name: cust.name,
        },
      })),
  );

  return c.json({ success: true, data: subscriptions });
});

// =============================================================================
// Subscription detail (with timeline, entitlements, plan info)
// =============================================================================

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  try {
    // 1. Get subscription with plan
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.id, id),
      with: { plan: true, customer: true },
    });

    if (!subscription) {
      return c.json({ success: false, error: "Subscription not found" }, 404);
    }

    // Run detail queries in parallel
    const [entitlements, events, availablePlans] = await Promise.all([
      // 2. Customer entitlements (current features)
      db
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
        .where(eq(schema.entitlements.customerId, subscription.customerId)),

      // 3. Recent events for this customer
      db
        .select({
          id: schema.events.id,
          type: schema.events.type,
          data: schema.events.data,
          createdAt: schema.events.createdAt,
        })
        .from(schema.events)
        .where(eq(schema.events.customerId, subscription.customerId))
        .orderBy(desc(schema.events.createdAt))
        .limit(30),

      // 4. Available plans in the same group (for switch actions)
      subscription.plan.planGroup
        ? db.query.plans.findMany({
            where: and(
              eq(schema.plans.organizationId, subscription.plan.organizationId),
              eq(schema.plans.planGroup, subscription.plan.planGroup),
              eq(schema.plans.isActive, true),
            ),
          })
        : db.query.plans.findMany({
            where: and(
              eq(schema.plans.organizationId, subscription.plan.organizationId),
              eq(schema.plans.isActive, true),
              eq(schema.plans.isAddon, false),
            ),
          }),
    ]);

    // 5. Build synthetic timeline from subscription lifecycle + events
    const timelineEntries: Array<{
      type: string;
      label: string;
      timestamp: number;
      detail?: string;
    }> = [];

    // Subscription created
    timelineEntries.push({
      type: "subscription.create",
      label: `Subscribed to ${subscription.plan.name}`,
      timestamp: subscription.createdAt,
      detail: `${subscription.plan.name} — ${subscription.plan.interval}`,
    });

    // Scheduled downgrade?
    const meta = subscription.metadata as Record<string, any> | null;
    if (meta?.scheduled_downgrade) {
      timelineEntries.push({
        type: "subscription.downgrade_scheduled",
        label: `Downgrade scheduled to plan`,
        timestamp: meta.scheduled_downgrade.scheduled_at,
        detail: `Effective ${new Date(meta.scheduled_downgrade.effective_at).toLocaleDateString()}`,
      });
    }

    // Switched from another plan?
    if (meta?.switched_from) {
      timelineEntries.push({
        type: "subscription.switch",
        label: `Switched from previous plan`,
        timestamp: subscription.createdAt,
        detail: `Switch type: ${meta.switch_type || "unknown"}`,
      });
    }

    // Canceled?
    if (subscription.canceledAt) {
      timelineEntries.push({
        type: "subscription.cancel",
        label: "Subscription canceled",
        timestamp: subscription.canceledAt,
      });
    }

    // Scheduled cancel?
    if (subscription.cancelAt && !subscription.canceledAt) {
      timelineEntries.push({
        type: "subscription.cancel_scheduled",
        label: `Cancellation scheduled`,
        timestamp: subscription.updatedAt,
        detail: `Effective ${new Date(subscription.cancelAt).toLocaleDateString()}`,
      });
    }

    // Add real events from events table
    for (const event of events) {
      timelineEntries.push({
        type: event.type,
        label: event.type,
        timestamp: event.createdAt,
        detail: (event.data as any)?.message || undefined,
      });
    }

    // Sort descending
    timelineEntries.sort((a, b) => b.timestamp - a.timestamp);

    return c.json({
      success: true,
      data: {
        subscription: {
          id: subscription.id,
          status: subscription.status,
          providerId: subscription.providerId || null,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAt: subscription.cancelAt,
          canceledAt: subscription.canceledAt,
          paystackSubscriptionCode: subscription.paystackSubscriptionCode,
          providerSubscriptionCode: subscription.providerSubscriptionCode,
          metadata: subscription.metadata,
          createdAt: subscription.createdAt,
          updatedAt: subscription.updatedAt,
        },
        plan: {
          id: subscription.plan.id,
          name: subscription.plan.name,
          slug: subscription.plan.slug,
          price: subscription.plan.price,
          currency: subscription.plan.currency,
          interval: subscription.plan.interval,
          planGroup: subscription.plan.planGroup,
        },
        customer: {
          id: subscription.customer.id,
          email: subscription.customer.email,
          name: subscription.customer.name,
        },
        entitlements,
        timeline: timelineEntries,
        availablePlans: availablePlans.map((p: any) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          price: p.price,
          currency: p.currency,
          interval: p.interval,
        })),
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// =============================================================================
// Preview a plan switch (no side effects)
// =============================================================================

const previewSwitchSchema = z.object({
  customerId: z.string(),
  newPlanId: z.string(),
});

app.post("/preview-switch", async (c) => {
  const body = await c.req.json();
  const parsed = previewSwitchSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { customerId, newPlanId } = parsed.data;
  const db = c.get("db");

  try {
    const preview = await previewSwitch(db, customerId, newPlanId);
    return c.json({ success: true, data: preview });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 400);
  }
});

// =============================================================================
// Execute a plan switch from the dashboard
// =============================================================================

const switchPlanSchema = z.object({
  customerId: z.string(),
  newPlanId: z.string(),
  organizationId: z.string(),
});

app.post("/switch-plan", async (c) => {
  const body = await c.req.json();
  const parsed = switchPlanSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { customerId, newPlanId, organizationId } = parsed.data;
  const db = c.get("db");
  const authDb = c.get("authDb");

  // Fetch project once for credentials + environment
  const project = await authDb.query.projects.findFirst({
    where: eq(schema.projects.organizationId, organizationId),
  });

  const providerEnv = deriveProviderEnvironment(
    c.env.ENVIRONMENT,
    project?.activeEnvironment,
  );

  // Build provider context from DB-stored provider accounts
  let providerCtx: ProviderContext | null = null;
  try {
    if (project) {

      const registry = getProviderRegistry();

      const providerAccounts = await loadProviderAccounts(
        db,
        organizationId,
        c.env.ENCRYPTION_KEY,
      );

      const dbAccount = providerAccounts.find(
        (a) => a.environment === providerEnv,
      );

      if (dbAccount) {
        const adapter = registry.get(dbAccount.providerId);
        if (adapter) {
          providerCtx = { adapter, account: dbAccount };
        }
      }
    }
  } catch (e) {
    console.warn("Failed to get provider credentials for switch:", e);
  }

  try {
    const result = await executeSwitch(db, customerId, newPlanId, providerCtx, {
      downgradeWorkflow: c.env.DOWNGRADE_WORKFLOW,
      organizationId,
      environment: providerEnv,
    });

    if (!result.success) {
      return c.json({ success: false, error: result.message }, 400);
    }

    return c.json({ success: true, data: result });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// =============================================================================
// Cancel a subscription
// =============================================================================

const cancelSchema = z.object({
  subscriptionId: z.string(),
  organizationId: z.string(),
  immediate: z.boolean().default(false),
});

app.post("/cancel", async (c) => {
  const body = await c.req.json();
  const parsed = cancelSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { subscriptionId, organizationId, immediate } = parsed.data;
  const db = c.get("db");
  const authDb = c.get("authDb");
  const now = Date.now();

  const sub = await db.query.subscriptions.findFirst({
    where: eq(schema.subscriptions.id, subscriptionId),
  });

  if (!sub) {
    return c.json({ success: false, error: "Subscription not found" }, 404);
  }

  // Cancel on provider if native sub
  const subCode = sub.providerSubscriptionCode || sub.paystackSubscriptionCode;
  if (
    subCode &&
    subCode !== "one-time" &&
    !subCode.startsWith("trial-")
  ) {
    try {
      const project = await authDb.query.projects.findFirst({
        where: eq(schema.projects.organizationId, organizationId),
      });

      if (project) {
        const providerEnv = deriveProviderEnvironment(
          c.env.ENVIRONMENT,
          project.activeEnvironment,
        );

        const registry = getProviderRegistry();

        const resolvedProviderId = sub.providerId || "paystack";
        const adapter = registry.get(resolvedProviderId);

        if (adapter) {
          // Try provider accounts from DB first
          const providerAccounts = await loadProviderAccounts(
            db,
            organizationId,
            c.env.ENCRYPTION_KEY,
          );
          let account = providerAccounts.find(
            (a) =>
              a.providerId === resolvedProviderId &&
              a.environment === providerEnv,
          );

          if (account) {
            await adapter.cancelSubscription({
              subscription: { id: subCode, status: sub.status || "active" },
              environment: providerEnv,
              account,
            });
          }
        }
      }
    } catch (e) {
      console.warn("Failed to cancel provider subscription:", e);
    }
  }

  if (immediate) {
    await db
      .update(schema.subscriptions)
      .set({ status: "canceled", canceledAt: now, updatedAt: now })
      .where(eq(schema.subscriptions.id, subscriptionId));
  } else {
    // Schedule cancellation at period end
    // For trialing subs, keep "trialing" so trial-end workflow can
    // see cancelAt and expire instead of charging.
    await db
      .update(schema.subscriptions)
      .set({
        status: sub.status === "trialing" ? "trialing" : "active",
        cancelAt: sub.currentPeriodEnd,
        updatedAt: now,
      })
      .where(eq(schema.subscriptions.id, subscriptionId));
  }

  // Invalidate cached subscriptions so /check and /track see the change immediately
  if (c.env.CACHE) {
    try {
      const cache = new EntitlementCache(c.env.CACHE);
      await cache.invalidateSubscriptions(organizationId, sub.customerId);
    } catch (e) {
      console.warn("[subscriptions/cancel] Cache invalidation failed:", e);
    }
  }

  return c.json({
    success: true,
    data: {
      status: immediate ? "canceled" : "pending_cancel",
      cancelAt: immediate ? now : sub.currentPeriodEnd,
    },
  });
});

export default app;
