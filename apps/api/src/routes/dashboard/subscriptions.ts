import { Hono } from "hono";
import { z } from "zod";
import { eq, and, or } from "drizzle-orm";
import { schema } from "@owostack/db";
import { listRecentEvents } from "../../lib/analytics-engine";
import {
  previewSwitch,
  executeSwitch,
  provisionEntitlements,
} from "../../lib/plan-switch";
import type { ProviderContext } from "../../lib/plan-switch";
import {
  getProviderRegistry,
  deriveProviderEnvironment,
  loadProviderAccounts,
} from "../../lib/providers";
import { EntitlementCache } from "../../lib/cache";
import type { Env, Variables } from "../../index";
import { errorToResponse, ValidationError } from "../../lib/errors";
import { sendCheckoutEmail } from "../../lib/email";
import {
  getSubscriptionHealthState,
  isPlaceholderSubscriptionCode,
} from "../../lib/subscription-health";
import {
  hasRenewalSetupIssue,
  readRenewalSetupMetadata,
  writeRenewalSetupMetadata,
} from "../../lib/renewal-setup";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function buildSubscriptionHealth(sub: {
  status?: string | null;
  currentPeriodEnd?: number | null;
  providerId?: string | null;
  providerSubscriptionCode?: string | null;
  paystackSubscriptionCode?: string | null;
  plan?: { type?: string | null };
  metadata?: unknown;
}) {
  const state = getSubscriptionHealthState({
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    providerId: sub.providerId,
    providerSubscriptionCode: sub.providerSubscriptionCode,
    paystackSubscriptionCode: sub.paystackSubscriptionCode,
    planType: sub.plan?.type,
  });
  const renewalSetup = readRenewalSetupMetadata(sub.metadata);
  const renewalSetupIssue = hasRenewalSetupIssue(sub.metadata);

  return {
    ...state,
    requiresAction: state.requiresAction || renewalSetupIssue,
    renewalSetup,
    reasons: [
      ...(state.pastGracePeriodEnd ? ["period_end_stale"] : []),
      ...(state.providerLinkMissing ? ["provider_link_missing"] : []),
      ...(renewalSetupIssue ? ["renewal_setup_failed"] : []),
    ],
  };
}

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
    .enum(["active", "pending", "canceled", "incomplete", "past_due"])
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

  // Check if customer already has an active or trialing subscription for this plan
  // to prevent duplicate subscriptions
  const existingSubscription = await db.query.subscriptions.findFirst({
    where: and(
      eq(schema.subscriptions.customerId, customerId),
      eq(schema.subscriptions.planId, planId),
      or(
        eq(schema.subscriptions.status, "active"),
        eq(schema.subscriptions.status, "trialing"),
        eq(schema.subscriptions.status, "pending"),
      ),
    ),
  });

  if (existingSubscription) {
    return c.json(
      {
        success: false,
        error: "Customer already has an active subscription for this plan",
        data: existingSubscription,
      },
      409,
    );
  }

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
  const organizationId = c.get("organizationId");
  const limit = Number(c.req.query("limit")) || 25;
  const offset = Number(c.req.query("offset")) || 0;

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
        health: buildSubscriptionHealth(sub),
        customer: {
          id: cust.id,
          email: cust.email,
          name: cust.name,
        },
      })),
  );

  subscriptions.sort((a: any, b: any) => {
    const aCreatedAt = Number(a.createdAt) || 0;
    const bCreatedAt = Number(b.createdAt) || 0;
    return bCreatedAt - aCreatedAt;
  });

  const total = subscriptions.length;
  const paged = subscriptions.slice(offset, offset + limit);
  return c.json({ success: true, data: paged, total });
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
      listRecentEvents(c.env, {
        customerId: subscription.customerId,
        limit: 30,
      }).then((result) => (result.success ? result.data : [])),

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
          health: buildSubscriptionHealth(subscription),
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
          type: subscription.plan.type,
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

  const { customerId, newPlanId } = parsed.data;
  // Use resolved organization ID from context (middleware resolves slug to UUID)
  const organizationId = c.get("organizationId") ?? parsed.data.organizationId;
  const db = c.get("db");

  // Environment comes directly from ENVIRONMENT variable
  const providerEnv = deriveProviderEnvironment(c.env.ENVIRONMENT, null);

  // Build provider context from DB-stored provider accounts
  let providerCtx: ProviderContext | null = null;
  try {
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

  const { subscriptionId, immediate } = parsed.data;
  // Use resolved organization ID from context (middleware resolves slug to UUID)
  const organizationId = c.get("organizationId") ?? parsed.data.organizationId;
  const db = c.get("db");
  const now = Date.now();

  const sub = await db.query.subscriptions.findFirst({
    where: eq(schema.subscriptions.id, subscriptionId),
    with: { plan: true, customer: true },
  });

  if (!sub) {
    return c.json({ success: false, error: "Subscription not found" }, 404);
  }

  // Cancel on provider if native sub
  const subCode = sub.providerSubscriptionCode || sub.paystackSubscriptionCode;
  if (subCode && subCode !== "one-time" && !subCode.startsWith("trial-")) {
    try {
      // Environment comes directly from ENVIRONMENT variable
      const providerEnv = deriveProviderEnvironment(c.env.ENVIRONMENT, null);

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

    // Trigger workflow for scheduled cancellation with free plan downgrade
    if (
      sub.plan?.type !== "free" &&
      sub.plan?.price !== 0 &&
      sub.customer &&
      c.env.CANCEL_DOWNGRADE_WORKFLOW
    ) {
      try {
        const workflow = await c.env.CANCEL_DOWNGRADE_WORKFLOW.create({
          params: {
            subscriptionId,
            customerId: sub.customer.id,
            organizationId,
            cancelAt: sub.currentPeriodEnd,
          },
        });
        console.log(
          `[subscriptions/cancel] Scheduled cancel downgrade workflow ${workflow.id} for sub ${subscriptionId}`,
        );
      } catch (e) {
        console.warn(
          `[subscriptions/cancel] Failed to schedule cancel downgrade workflow:`,
          e,
        );
      }
    }
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

  // Auto-downgrade to free plan on immediate cancellation (not scheduled)
  let freeSubId: string | undefined;
  if (
    immediate &&
    sub.plan?.type !== "free" &&
    sub.plan?.price !== 0 &&
    sub.customer
  ) {
    try {
      // CRITICAL: Set flag FIRST to prevent race condition with webhook
      // This ensures any concurrent webhook sees the flag and skips
      await db
        .update(schema.subscriptions)
        .set({
          metadata: {
            ...sub.metadata,
            cancel_downgrade_initiated: true,
            cancel_downgrade_at: now,
          },
          updatedAt: now,
        })
        .where(eq(schema.subscriptions.id, subscriptionId));

      // Find organization's free plan
      const freePlan = await db.query.plans.findFirst({
        where: and(
          eq(schema.plans.organizationId, organizationId),
          eq(schema.plans.type, "free"),
        ),
      });

      if (freePlan) {
        // Check if customer already has an active free plan subscription
        const existingFreeSub = await db.query.subscriptions.findFirst({
          where: and(
            eq(schema.subscriptions.customerId, sub.customer.id),
            eq(schema.subscriptions.planId, freePlan.id),
            eq(schema.subscriptions.status, "active"),
          ),
        });

        if (existingFreeSub) {
          // Customer already has active free plan, just provision entitlements
          await provisionEntitlements(
            db,
            sub.customer.id,
            freePlan.id,
            sub.planId,
          );
          freeSubId = existingFreeSub.id;
          console.log(
            `[subscriptions/cancel] Customer ${sub.customer.id} already has free plan, provisioned entitlements only`,
          );
        } else {
          // Create new free subscription
          const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
          const [freeSub] = await db
            .insert(schema.subscriptions)
            .values({
              id: crypto.randomUUID(),
              customerId: sub.customer.id,
              planId: freePlan.id,
              providerId: sub.providerId,
              status: "active",
              currentPeriodStart: now,
              currentPeriodEnd: now + thirtyDaysMs,
              metadata: {
                switched_from: sub.planId,
                switch_type: "cancel_downgrade",
                canceled_sub_id: sub.id,
              },
            })
            .returning();

          // Provision free plan entitlements
          await provisionEntitlements(
            db,
            sub.customer.id,
            freePlan.id,
            sub.planId,
          );

          freeSubId = freeSub.id;

          // Invalidate cache again for the new subscription
          if (c.env.CACHE) {
            try {
              const cache = new EntitlementCache(c.env.CACHE);
              await cache.invalidateSubscriptions(
                organizationId,
                sub.customer.id,
              );
            } catch (e) {
              console.warn(
                "[subscriptions/cancel] Cache invalidation failed:",
                e,
              );
            }
          }
        }

        // Set completion flag AFTER successful free plan creation
        await db
          .update(schema.subscriptions)
          .set({
            metadata: {
              ...sub.metadata,
              cancel_downgrade_initiated: true,
              cancel_downgrade_at: now,
              cancel_downgrade_complete: true,
              free_subscription_id: freeSubId,
            },
            updatedAt: now,
          })
          .where(eq(schema.subscriptions.id, subscriptionId));
      }
    } catch (e) {
      console.warn(
        "[subscriptions/cancel] Failed to auto-downgrade to free plan:",
        e,
      );
      // Don't fail the cancellation if downgrade fails, but flag was already set
      // Webhook will see flag and skip, preventing duplicate attempts
    }
  }

  return c.json({
    success: true,
    data: {
      status: immediate ? "canceled" : "pending_cancel",
      cancelAt: immediate ? now : sub.currentPeriodEnd,
      freeSubscriptionId: freeSubId,
    },
  });
});

app.post("/:id/retry-renewal-setup", async (c) => {
  const subscriptionId = c.req.param("id");
  const db = c.get("db");

  try {
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.id, subscriptionId),
      with: {
        plan: true,
        customer: true,
      },
    });

    if (!subscription) {
      return c.json({ success: false, error: "Subscription not found" }, 404);
    }

    const currentCode =
      subscription.providerSubscriptionCode || subscription.paystackSubscriptionCode;
    const hasRealProviderCode =
      !!currentCode && !isPlaceholderSubscriptionCode(currentCode);

    if (
      subscription.status !== "active" ||
      subscription.plan.type === "free" ||
      subscription.plan.billingType !== "recurring"
    ) {
      return c.json(
        {
          success: false,
          error: "Subscription is not eligible for renewal setup retry",
        },
        400,
      );
    }
    if (!subscription.providerId) {
      return c.json(
        {
          success: false,
          error: "Subscription provider is missing",
        },
        400,
      );
    }

    if (hasRealProviderCode && !hasRenewalSetupIssue(subscription.metadata)) {
      return c.json(
        {
          success: false,
          error: "Subscription already has active provider renewal setup",
        },
        400,
      );
    }

    const now = Date.now();
    const renewalSetup = readRenewalSetupMetadata(subscription.metadata);
    const nextMetadata = writeRenewalSetupMetadata(subscription.metadata, {
      renewal_setup_status: "scheduled",
      renewal_setup_retry_count: renewalSetup.renewal_setup_retry_count || 0,
      renewal_setup_last_error: renewalSetup.renewal_setup_last_error,
      renewal_setup_last_attempt_at: renewalSetup.renewal_setup_last_attempt_at,
      renewal_setup_next_attempt_at: now,
      renewal_setup_updated_at: now,
      renewal_setup_last_source: "dashboard_manual",
    });

    await db
      .update(schema.subscriptions)
      .set({
        metadata: nextMetadata,
        updatedAt: now,
      })
      .where(eq(schema.subscriptions.id, subscription.id));

    const workflow = await c.env.RENEWAL_SETUP_WORKFLOW.create({
      params: {
        subscriptionId: subscription.id,
        customerId: subscription.customerId,
        organizationId: subscription.plan.organizationId,
        providerId: subscription.providerId,
        source: "dashboard_manual",
        immediate: true,
      },
    });

    return c.json({
      success: true,
      data: {
        workflowId: workflow.id,
        status: "scheduled",
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});
// =============================================================================
// Generate checkout link for a pending subscription
// =============================================================================

app.post("/:id/checkout", async (c) => {
  const subscriptionId = c.req.param("id");
  const db = c.get("db");

  try {
    // 1. Load the subscription with plan, customer, and organization
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.id, subscriptionId),
      with: {
        plan: true,
        customer: {
          with: { organization: true },
        },
      },
    });

    if (!subscription) {
      return c.json({ success: false, error: "Subscription not found" }, 404);
    }

    if (subscription.status !== "pending") {
      return c.json(
        {
          success: false,
          error: `Subscription is ${subscription.status}, not pending`,
        },
        400,
      );
    }

    const plan = subscription.plan;
    const customer = subscription.customer;

    if (plan.type === "free" || plan.price === 0) {
      // Free plans: just activate directly
      const now = Date.now();
      await db
        .update(schema.subscriptions)
        .set({
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1000,
          updatedAt: now,
        })
        .where(eq(schema.subscriptions.id, subscriptionId));

      return c.json({
        success: true,
        activated: true,
        message: "Free plan activated directly",
      });
    }

    // 3. Generate activation link (our public API GET route)
    const body = await c.req.json().catch(() => ({}));
    const callbackUrl = body?.callbackUrl;

    // Use URL from request to build the activation link
    // We want the PUBLIC API origin here. If the dashboard is at dashboard.owostack.com,
    // we might need to be smart. But usually the API is at api.owostack.com.
    const url = new URL(c.req.url);
    const activationUrl = `${url.origin}/v1/subscriptions/${subscriptionId}/activate${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`;

    // Simulate sending checkout email:
    try {
      const organization = (subscription.customer as any)?.organization;
      await sendCheckoutEmail(c.env, {
        to: customer.email,
        customerName: customer.name || undefined,
        planName: plan.name,
        checkoutUrl: activationUrl,
        amount: plan.price,
        currency: plan.currency,
        organizationName: organization?.name || "The Merchant",
        organizationLogo: organization?.logo || undefined,
      });
    } catch (e) {
      console.warn("Failed to send checkout email:", e);
    }

    return c.json({
      success: true,
      checkoutUrl: activationUrl,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// =============================================================================
// Activate a pending subscription directly (for free plans or manual override)
// =============================================================================

app.post("/:id/activate", async (c) => {
  const subscriptionId = c.req.param("id");
  const db = c.get("db");

  try {
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.id, subscriptionId),
      with: { plan: true },
    });

    if (!subscription) {
      return c.json({ success: false, error: "Subscription not found" }, 404);
    }

    if (subscription.status !== "pending") {
      return c.json(
        {
          success: false,
          error: `Subscription is ${subscription.status}, not pending`,
        },
        400,
      );
    }

    const now = Date.now();
    await db
      .update(schema.subscriptions)
      .set({
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1000,
        updatedAt: now,
      })
      .where(eq(schema.subscriptions.id, subscriptionId));

    return c.json({
      success: true,
      data: { status: "active" },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
