import { eq, and, inArray } from "drizzle-orm";
import { createDb, schema } from "@owostack/db";
import { PaystackClient } from "./paystack";
import type { SubscriptionSchedulerDO } from "./subscription-scheduler";

type DB = ReturnType<typeof createDb>;

// =============================================================================
// Types
// =============================================================================

export type SwitchType = "upgrade" | "downgrade" | "lateral" | "new";

export interface SwitchPreview {
  type: SwitchType;
  currentPlan: { id: string; name: string; slug: string; price: number; interval: string } | null;
  newPlan: { id: string; name: string; slug: string; price: number; interval: string };
  proratedAmount: number; // Amount to charge/credit (positive = charge, negative = credit)
  effectiveAt: "immediate" | "period_end";
  currentPeriodEnd: number | null;
  message: string;
}

export interface SwitchResult {
  success: boolean;
  type: SwitchType;
  requiresCheckout: boolean;
  checkoutUrl?: string;
  subscriptionId?: string;
  message: string;
  scheduledAt?: number;
}

// =============================================================================
// Detect switch type by comparing prices within the same interval
// =============================================================================

export function detectSwitchType(
  currentPlan: { price: number; interval: string } | null,
  newPlan: { price: number; interval: string },
): SwitchType {
  if (!currentPlan) return "new";

  // Normalize to monthly price for comparison across intervals
  const currentMonthly = normalizeToMonthly(currentPlan.price, currentPlan.interval);
  const newMonthly = normalizeToMonthly(newPlan.price, newPlan.interval);

  if (newMonthly > currentMonthly) return "upgrade";
  if (newMonthly < currentMonthly) return "downgrade";
  return "lateral";
}

function normalizeToMonthly(price: number, interval: string): number {
  switch (interval) {
    case "hourly":
      return price * 720; // ~30 days
    case "daily":
      return price * 30;
    case "weekly":
      return price * 4;
    case "monthly":
      return price;
    case "quarterly":
      return price / 3;
    case "biannually":
    case "semi_annual":
      return price / 6;
    case "annually":
    case "yearly":
      return price / 12;
    default:
      return price;
  }
}

// =============================================================================
// Calculate proration
// =============================================================================

export function calculateProration(
  currentPlan: { price: number },
  newPlan: { price: number },
  periodStart: number,
  periodEnd: number,
  now: number = Date.now(),
): number {
  const totalPeriodMs = periodEnd - periodStart;
  if (totalPeriodMs <= 0) return newPlan.price;

  const elapsedMs = now - periodStart;
  const remainingRatio = Math.max(0, Math.min(1, 1 - elapsedMs / totalPeriodMs));

  // Credit for unused portion of current plan
  const unusedCredit = Math.round(currentPlan.price * remainingRatio);
  // Cost for remaining portion of new plan
  const newCost = Math.round(newPlan.price * remainingRatio);

  // Difference: positive = customer pays, negative = credit
  return newCost - unusedCredit;
}

// =============================================================================
// Preview a plan switch (no side effects)
// =============================================================================

export async function previewSwitch(
  db: DB,
  customerId: string,
  newPlanId: string,
): Promise<SwitchPreview> {
  // Fetch the new plan
  const newPlan = await db.query.plans.findFirst({
    where: eq(schema.plans.id, newPlanId),
  });

  if (!newPlan) {
    throw new Error(`Plan '${newPlanId}' not found`);
  }

  // Find active subscription in the same planGroup (or any active sub if no group)
  const existingSub = await findSwitchableSubscription(db, customerId, newPlan);

  if (!existingSub) {
    return {
      type: "new",
      currentPlan: null,
      newPlan: { id: newPlan.id, name: newPlan.name, slug: newPlan.slug, price: newPlan.price, interval: newPlan.interval },
      proratedAmount: newPlan.price,
      effectiveAt: "immediate",
      currentPeriodEnd: null,
      message: `New subscription to ${newPlan.name}`,
    };
  }

  const currentPlan = existingSub.plan;
  const switchType = detectSwitchType(currentPlan, newPlan);

  let proratedAmount = 0;
  let effectiveAt: "immediate" | "period_end" = "immediate";
  let message = "";

  switch (switchType) {
    case "upgrade":
      proratedAmount = calculateProration(
        currentPlan,
        newPlan,
        existingSub.currentPeriodStart,
        existingSub.currentPeriodEnd,
      );
      effectiveAt = "immediate";
      message = `Upgrade from ${currentPlan.name} to ${newPlan.name}. Prorated charge: ${proratedAmount}`;
      break;

    case "downgrade":
      proratedAmount = 0; // No charge — takes effect at period end
      effectiveAt = "period_end";
      message = `Downgrade from ${currentPlan.name} to ${newPlan.name}. Takes effect at end of current period.`;
      break;

    case "lateral":
      proratedAmount = 0;
      effectiveAt = "immediate";
      message = `Switch from ${currentPlan.name} to ${newPlan.name}. Features update immediately.`;
      break;

    default:
      message = `New subscription to ${newPlan.name}`;
  }

  return {
    type: switchType,
    currentPlan: { id: currentPlan.id, name: currentPlan.name, slug: currentPlan.slug, price: currentPlan.price, interval: currentPlan.interval },
    newPlan: { id: newPlan.id, name: newPlan.name, slug: newPlan.slug, price: newPlan.price, interval: newPlan.interval },
    proratedAmount,
    effectiveAt,
    currentPeriodEnd: existingSub.currentPeriodEnd,
    message,
  };
}

// =============================================================================
// Execute a plan switch
// =============================================================================

export async function executeSwitch(
  db: DB,
  customerId: string,
  newPlanId: string,
  paystack: PaystackClient | null,
  options: {
    callbackUrl?: string;
    metadata?: Record<string, unknown>;
    scheduler?: DurableObjectStub<SubscriptionSchedulerDO>;
    organizationId?: string;
    environment?: string;
  } = {},
): Promise<SwitchResult> {
  const newPlan = await db.query.plans.findFirst({
    where: eq(schema.plans.id, newPlanId),
  });

  if (!newPlan) {
    throw new Error(`Plan '${newPlanId}' not found`);
  }

  const customer = await db.query.customers.findFirst({
    where: eq(schema.customers.id, customerId),
  });

  if (!customer) {
    throw new Error(`Customer '${customerId}' not found`);
  }

  // =========================================================================
  // ONE-TIME purchase — skip subscription switch logic entirely
  // =========================================================================
  if (newPlan.billingType === "one_time") {
    return handleOneTimePurchase(db, customer, newPlan, paystack, options);
  }

  const existingSub = await findSwitchableSubscription(db, customerId, newPlan);

  // Guard: switching to the same plan is a no-op
  if (existingSub && existingSub.planId === newPlan.id) {
    return {
      success: true,
      type: "lateral",
      requiresCheckout: false,
      subscriptionId: existingSub.id,
      message: `Already subscribed to ${newPlan.name}`,
    };
  }

  const switchType = existingSub
    ? detectSwitchType(existingSub.plan, newPlan)
    : "new";

  // =========================================================================
  // FREE plan — handle entirely in DB, no Paystack
  // =========================================================================
  if (newPlan.price === 0) {
    return handleFreePlanSwitch(db, customer, existingSub, newPlan, switchType, paystack);
  }

  // =========================================================================
  // UPGRADE — immediate switch, prorated charge
  // =========================================================================
  if (switchType === "upgrade") {
    return handleUpgrade(db, customer, existingSub!, newPlan, paystack, options);
  }

  // =========================================================================
  // DOWNGRADE — schedule for period end
  // =========================================================================
  if (switchType === "downgrade") {
    return handleDowngrade(db, customer, existingSub!, newPlan, options);
  }

  // =========================================================================
  // LATERAL — same effective price, switch features immediately
  // =========================================================================
  if (switchType === "lateral" && existingSub) {
    return handleLateralSwitch(db, customer, existingSub, newPlan);
  }

  // =========================================================================
  // NEW — no existing subscription in this group
  // =========================================================================
  return handleNewSubscription(db, customer, newPlan, paystack, options);
}

// =============================================================================
// Internal handlers
// =============================================================================

async function handleFreePlanSwitch(
  db: DB,
  customer: any,
  existingSub: any,
  newPlan: any,
  switchType: SwitchType,
  paystack: PaystackClient | null = null,
): Promise<SwitchResult> {
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  // Cancel the old subscription (both in DB and on Paystack)
  if (existingSub) {
    await cancelSubscription(db, existingSub, paystack);
  }

  // Create new free subscription
  const [sub] = await db
    .insert(schema.subscriptions)
    .values({
      id: crypto.randomUUID(),
      customerId: customer.id,
      planId: newPlan.id,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: now + thirtyDaysMs,
      metadata: { switched_from: existingSub?.planId || null, switch_type: switchType },
    })
    .returning();

  // Provision entitlements for the new plan (clean up old plan's entitlements)
  await provisionEntitlements(db, customer.id, newPlan.id, existingSub?.plan?.id);

  return {
    success: true,
    type: switchType,
    requiresCheckout: false,
    subscriptionId: sub.id,
    message: `Switched to free plan ${newPlan.name}`,
  };
}

async function handleUpgrade(
  db: DB,
  customer: any,
  existingSub: any,
  newPlan: any,
  paystack: PaystackClient | null,
  options: { callbackUrl?: string; metadata?: Record<string, unknown> },
): Promise<SwitchResult> {
  const now = Date.now();
  const proratedAmount = calculateProration(
    existingSub.plan,
    newPlan,
    existingSub.currentPeriodStart,
    existingSub.currentPeriodEnd,
  );

  // If prorated amount is 0 or negative (near end of period), just switch directly
  if (proratedAmount <= 0) {
    await cancelSubscription(db, existingSub, paystack);

    let paystackSubCode: string | undefined;
    if (paystack && newPlan.paystackPlanId && customer.paystackAuthorizationCode) {
      const subResult = await paystack.createSubscription({
        customer: customer.email,
        plan: newPlan.paystackPlanId,
        authorization: customer.paystackAuthorizationCode,
      });
      if (subResult.isOk()) {
        paystackSubCode = subResult.value.subscription_code;
      }
    }

    const periodEnd = existingSub.currentPeriodEnd;
    const [sub] = await db
      .insert(schema.subscriptions)
      .values({
        id: crypto.randomUUID(),
        customerId: customer.id,
        planId: newPlan.id,
        paystackSubscriptionCode: paystackSubCode || null,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        metadata: {
          switched_from: existingSub.plan.id,
          switch_type: "upgrade",
          prorated_amount: 0,
          ...options.metadata,
        },
      })
      .returning();

    await provisionEntitlements(db, customer.id, newPlan.id, existingSub.plan.id);

    return {
      success: true,
      type: "upgrade",
      requiresCheckout: false,
      subscriptionId: sub.id,
      message: `Upgraded to ${newPlan.name}. No prorated charge (near end of period).`,
    };
  }

  // If customer has a saved card and Paystack is configured, charge directly
  if (paystack && customer.paystackAuthorizationCode && proratedAmount > 0) {
    const chargeResult = await paystack.chargeAuthorization({
      authorization_code: customer.paystackAuthorizationCode,
      email: customer.email,
      amount: proratedAmount,
      metadata: {
        type: "plan_upgrade_proration",
        old_plan_id: existingSub.plan.id,
        new_plan_id: newPlan.id,
        customer_id: customer.id,
        ...options.metadata,
      },
    });

    if (chargeResult.isErr()) {
      // Charge failed — fall through to checkout
      return createUpgradeCheckout(
        db, customer, existingSub, newPlan, paystack, proratedAmount, options,
      );
    }

    // Charge succeeded — cancel old sub and create new one
    await cancelSubscription(db, existingSub, paystack);

    // Create new subscription via Paystack API if plan has a paystack plan code
    let paystackSubCode: string | undefined;
    if (newPlan.paystackPlanId && customer.paystackAuthorizationCode) {
      const subResult = await paystack.createSubscription({
        customer: customer.email,
        plan: newPlan.paystackPlanId,
        authorization: customer.paystackAuthorizationCode,
      });
      if (subResult.isOk()) {
        paystackSubCode = subResult.value.subscription_code;
      }
    }

    const periodEnd = existingSub.currentPeriodEnd; // Keep the same billing cycle
    const [sub] = await db
      .insert(schema.subscriptions)
      .values({
        id: crypto.randomUUID(),
        customerId: customer.id,
        planId: newPlan.id,
        paystackSubscriptionCode: paystackSubCode || null,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        metadata: {
          switched_from: existingSub.plan.id,
          switch_type: "upgrade",
          prorated_amount: proratedAmount,
          ...options.metadata,
        },
      })
      .returning();

    await provisionEntitlements(db, customer.id, newPlan.id, existingSub.plan.id);

    return {
      success: true,
      type: "upgrade",
      requiresCheckout: false,
      subscriptionId: sub.id,
      message: `Upgraded to ${newPlan.name}. Prorated charge: ${proratedAmount}`,
    };
  }

  // No saved card — return checkout URL
  return createUpgradeCheckout(
    db, customer, existingSub, newPlan, paystack, proratedAmount, options,
  );
}

async function createUpgradeCheckout(
  _db: DB,
  customer: any,
  existingSub: any,
  newPlan: any,
  paystack: PaystackClient | null,
  proratedAmount: number,
  options: { callbackUrl?: string; metadata?: Record<string, unknown> },
): Promise<SwitchResult> {
  if (!paystack) {
    return {
      success: false,
      type: "upgrade",
      requiresCheckout: true,
      message: "Paystack not configured — cannot process upgrade payment",
    };
  }

  // NOTE: Do NOT pass `plan` here. When both amount and plan are provided,
  // Paystack ignores the custom amount and charges the plan's full price.
  // We charge the prorated amount as a one-time payment; the webhook handler
  // creates the new subscription when the charge succeeds.
  const result = await paystack.initializeTransaction({
    email: customer.email,
    amount: String(Math.max(proratedAmount, 100)), // Minimum 100 (1 NGN/GHS)
    callback_url: options.callbackUrl,
    metadata: JSON.stringify({
      type: "plan_upgrade",
      old_plan_id: existingSub.plan.id,
      old_subscription_id: existingSub.id,
      new_plan_id: newPlan.id,
      customer_id: customer.id,
      prorated_amount: proratedAmount,
      ...options.metadata,
    }),
  });

  if (result.isErr()) {
    return {
      success: false,
      type: "upgrade",
      requiresCheckout: true,
      message: `Failed to create checkout: ${result.error.message}`,
    };
  }

  return {
    success: true,
    type: "upgrade",
    requiresCheckout: true,
    checkoutUrl: result.value.authorization_url,
    message: `Checkout created for upgrade to ${newPlan.name}`,
  };
}

async function handleDowngrade(
  db: DB,
  _customer: any,
  existingSub: any,
  newPlan: any,
  options: {
    scheduler?: DurableObjectStub<SubscriptionSchedulerDO>;
    organizationId?: string;
    environment?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<SwitchResult> {
  const now = Date.now();

  // Mark current sub with scheduled downgrade info
  await db
    .update(schema.subscriptions)
    .set({
      status: "active", // Keep active until period end
      cancelAt: existingSub.currentPeriodEnd,
      metadata: {
        ...(typeof existingSub.metadata === "object" ? existingSub.metadata : {}),
        scheduled_downgrade: {
          new_plan_id: newPlan.id,
          scheduled_at: now,
          effective_at: existingSub.currentPeriodEnd,
        },
      },
      updatedAt: now,
    })
    .where(eq(schema.subscriptions.id, existingSub.id));

  // Schedule a Durable Object alarm to execute the downgrade at period end
  if (options.scheduler && options.organizationId) {
    try {
      await options.scheduler.scheduleDowngrade(
        existingSub.id,
        existingSub.customerId,
        newPlan.id,
        options.organizationId,
        (options.environment || "test") as any,
        existingSub.currentPeriodEnd,
        {
          old_plan_id: existingSub.plan.id,
          paystack_subscription_code: existingSub.paystackSubscriptionCode,
          customer_email: _customer.email,
          customer_authorization_code: _customer.paystackAuthorizationCode,
          new_plan_paystack_id: newPlan.paystackPlanId,
        },
      );
    } catch (e) {
      console.error("Failed to schedule downgrade alarm:", e);
      // The metadata is still stored, so a manual process can pick it up
    }
  }

  return {
    success: true,
    type: "downgrade",
    requiresCheckout: false,
    subscriptionId: existingSub.id,
    scheduledAt: existingSub.currentPeriodEnd,
    message: `Downgrade to ${newPlan.name} scheduled for ${new Date(existingSub.currentPeriodEnd).toISOString()}`,
  };
}

async function handleLateralSwitch(
  db: DB,
  customer: any,
  existingSub: any,
  newPlan: any,
): Promise<SwitchResult> {
  const now = Date.now();

  // Update the subscription to point to the new plan (same price, different features)
  await db
    .update(schema.subscriptions)
    .set({
      planId: newPlan.id,
      metadata: {
        ...(typeof existingSub.metadata === "object" ? existingSub.metadata : {}),
        switched_from: existingSub.plan.id,
        switch_type: "lateral",
        switched_at: now,
      },
      updatedAt: now,
    })
    .where(eq(schema.subscriptions.id, existingSub.id));

  await provisionEntitlements(db, customer.id, newPlan.id, existingSub.plan.id);

  return {
    success: true,
    type: "lateral",
    requiresCheckout: false,
    subscriptionId: existingSub.id,
    message: `Switched to ${newPlan.name}. Features updated immediately.`,
  };
}

async function handleOneTimePurchase(
  db: DB,
  customer: any,
  plan: any,
  paystack: PaystackClient | null,
  options: { callbackUrl?: string; metadata?: Record<string, unknown> },
): Promise<SwitchResult> {
  const now = Date.now();

  // Free one-time → just create purchase record + entitlements
  if (plan.price === 0) {
    const [sub] = await db
      .insert(schema.subscriptions)
      .values({
        id: crypto.randomUUID(),
        customerId: customer.id,
        planId: plan.id,
        paystackSubscriptionCode: "one-time",
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: now, // No recurring period
        metadata: { ...options.metadata, billing_type: "one_time" },
      })
      .returning();

    await provisionEntitlements(db, customer.id, plan.id);

    return {
      success: true,
      type: "new",
      requiresCheckout: false,
      subscriptionId: sub.id,
      message: `${plan.name} activated (one-time)`,
    };
  }

  // Card on file → charge directly
  if (paystack && customer.paystackAuthorizationCode) {
    const chargeResult = await paystack.chargeAuthorization({
      authorization_code: customer.paystackAuthorizationCode,
      email: customer.email,
      amount: plan.price,
      currency: plan.currency,
      metadata: {
        type: "one_time_purchase",
        plan_id: plan.id,
        plan_slug: plan.slug,
        customer_id: customer.id,
        ...options.metadata,
      },
    });

    if (chargeResult.isOk()) {
      const [sub] = await db
        .insert(schema.subscriptions)
        .values({
          id: crypto.randomUUID(),
          customerId: customer.id,
          planId: plan.id,
          paystackSubscriptionCode: "one-time",
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: now, // No recurring period
          metadata: {
            ...options.metadata,
            billing_type: "one_time",
            paystack_reference: chargeResult.value.reference,
          },
        })
        .returning();

      await provisionEntitlements(db, customer.id, plan.id);

      return {
        success: true,
        type: "new",
        requiresCheckout: false,
        subscriptionId: sub.id,
        message: `${plan.name} purchased (one-time)`,
      };
    }
    // Fall through to checkout if charge failed
  }

  // No card or charge failed → checkout
  if (!paystack) {
    return {
      success: false,
      type: "new",
      requiresCheckout: true,
      message: "Paystack not configured",
    };
  }

  const result = await paystack.initializeTransaction({
    email: customer.email,
    amount: String(plan.price),
    // No plan parameter — one-time charge, not a Paystack subscription
    callback_url: options.callbackUrl,
    metadata: JSON.stringify({
      type: "one_time_purchase",
      plan_id: plan.id,
      plan_slug: plan.slug,
      customer_id: customer.id,
      ...options.metadata,
    }),
  });

  if (result.isErr()) {
    return {
      success: false,
      type: "new",
      requiresCheckout: true,
      message: `Failed to create checkout: ${result.error.message}`,
    };
  }

  return {
    success: true,
    type: "new",
    requiresCheckout: true,
    checkoutUrl: result.value.authorization_url,
    message: `Checkout created for ${plan.name} (one-time)`,
  };
}

async function handleNewSubscription(
  db: DB,
  customer: any,
  newPlan: any,
  paystack: PaystackClient | null,
  options: { callbackUrl?: string; metadata?: Record<string, unknown> },
): Promise<SwitchResult> {
  // If card on file and Paystack available, create subscription directly
  if (paystack && customer.paystackAuthorizationCode && newPlan.paystackPlanId) {
    const subResult = await paystack.createSubscription({
      customer: customer.email,
      plan: newPlan.paystackPlanId,
      authorization: customer.paystackAuthorizationCode,
    });

    if (subResult.isOk()) {
      const now = Date.now();
      const periodMs = intervalToMs(newPlan.interval);

      const [sub] = await db
        .insert(schema.subscriptions)
        .values({
          id: crypto.randomUUID(),
          customerId: customer.id,
          planId: newPlan.id,
          paystackSubscriptionCode: subResult.value.subscription_code,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: now + periodMs,
          metadata: options.metadata || {},
        })
        .returning();

      await provisionEntitlements(db, customer.id, newPlan.id);

      return {
        success: true,
        type: "new",
        requiresCheckout: false,
        subscriptionId: sub.id,
        message: `Subscribed to ${newPlan.name}`,
      };
    }
    // Fall through to checkout if direct sub creation failed
  }

  // No card or Paystack not available — need checkout
  if (!paystack) {
    return {
      success: false,
      type: "new",
      requiresCheckout: true,
      message: "Paystack not configured",
    };
  }

  const result = await paystack.initializeTransaction({
    email: customer.email,
    amount: String(newPlan.price),
    plan: newPlan.paystackPlanId || undefined,
    callback_url: options.callbackUrl,
    metadata: JSON.stringify({
      type: "new_subscription",
      plan_id: newPlan.id,
      plan_slug: newPlan.slug,
      customer_id: customer.id,
      ...options.metadata,
    }),
  });

  if (result.isErr()) {
    return {
      success: false,
      type: "new",
      requiresCheckout: true,
      message: `Failed to create checkout: ${result.error.message}`,
    };
  }

  return {
    success: true,
    type: "new",
    requiresCheckout: true,
    checkoutUrl: result.value.authorization_url,
    message: `Checkout created for ${newPlan.name}`,
  };
}

// =============================================================================
// Helpers
// =============================================================================

async function findSwitchableSubscription(
  db: DB,
  customerId: string,
  newPlan: { planGroup: string | null; isAddon: boolean | null },
) {
  // Add-ons stack — they don't replace existing subs
  if (newPlan.isAddon) return null;

  // Find active or trialing subscriptions for this customer
  const subs = await db.query.subscriptions.findMany({
    where: and(
      eq(schema.subscriptions.customerId, customerId),
      inArray(schema.subscriptions.status, ["active", "trialing"]),
    ),
    with: { plan: true },
  });

  if (subs.length === 0) return null;

  // If the new plan has a planGroup, find a sub in the same group
  if (newPlan.planGroup) {
    return subs.find((s: any) => s.plan.planGroup === newPlan.planGroup) || null;
  }

  // No planGroup — find any non-addon active sub (base plan replacement)
  return subs.find((s: any) => !s.plan.isAddon) || null;
}

async function cancelSubscription(
  db: DB,
  sub: any,
  paystack: PaystackClient | null,
) {
  const now = Date.now();

  // Cancel on Paystack if it's a native subscription
  if (
    paystack &&
    sub.paystackSubscriptionCode &&
    sub.paystackSubscriptionCode !== "one-time" &&
    !sub.paystackSubscriptionCode.startsWith("trial-")
  ) {
    // Fetch subscription to get the email_token needed for disable
    const fetchResult = await paystack.fetchSubscription(sub.paystackSubscriptionCode);
    if (fetchResult.isOk()) {
      await paystack.disableSubscription(
        sub.paystackSubscriptionCode,
        fetchResult.value.email_token,
      );
    }
  }

  await db
    .update(schema.subscriptions)
    .set({ status: "canceled", canceledAt: now, updatedAt: now })
    .where(eq(schema.subscriptions.id, sub.id));
}

async function provisionEntitlements(
  db: DB,
  customerId: string,
  planId: string,
  oldPlanId?: string,
) {
  // Fetch plan features for the new plan
  const planFeatures = await db.query.planFeatures.findMany({
    where: eq(schema.planFeatures.planId, planId),
    with: { feature: true },
  });

  // Remove entitlements from the OLD plan (if switching) to avoid orphans
  if (oldPlanId) {
    const oldPlanFeatures = await db.query.planFeatures.findMany({
      where: eq(schema.planFeatures.planId, oldPlanId),
    });
    for (const opf of oldPlanFeatures) {
      await db
        .delete(schema.entitlements)
        .where(
          and(
            eq(schema.entitlements.customerId, customerId),
            eq(schema.entitlements.featureId, opf.featureId),
          ),
        );
    }
  } else {
    // No old plan — just remove entitlements for features in the new plan (avoid duplicates)
    const featureIds = planFeatures.map((pf: any) => pf.featureId);
    for (const featureId of featureIds) {
      await db
        .delete(schema.entitlements)
        .where(
          and(
            eq(schema.entitlements.customerId, customerId),
            eq(schema.entitlements.featureId, featureId),
          ),
        );
    }
  }

  // Create new entitlements from plan features
  const now = Date.now();
  const entitlementValues = planFeatures.map((pf: any) => ({
    id: crypto.randomUUID(),
    customerId,
    featureId: pf.featureId,
    limitValue: pf.limitValue,
    resetInterval: pf.resetInterval,
    lastResetAt: pf.resetOnEnable ? now : null,
    createdAt: now,
    updatedAt: now,
  }));

  if (entitlementValues.length > 0) {
    await db.insert(schema.entitlements).values(entitlementValues);
  }
}

function intervalToMs(interval: string): number {
  switch (interval) {
    case "hourly":
      return 60 * 60 * 1000;
    case "daily":
      return 24 * 60 * 60 * 1000;
    case "weekly":
      return 7 * 24 * 60 * 60 * 1000;
    case "monthly":
      return 30 * 24 * 60 * 60 * 1000;
    case "quarterly":
      return 90 * 24 * 60 * 60 * 1000;
    case "biannually":
    case "semi_annual":
      return 180 * 24 * 60 * 60 * 1000;
    case "annually":
    case "yearly":
      return 365 * 24 * 60 * 60 * 1000;
    default:
      return 30 * 24 * 60 * 60 * 1000;
  }
}
