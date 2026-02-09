import { eq, and, inArray } from "drizzle-orm";
import { createDb, schema } from "@owostack/db";
import type { ProviderAdapter, ProviderAccount } from "@owostack/adapters";
// Workflow type (any since it's a Cloudflare Workflow binding)
type WorkflowBinding = { create: (opts: { params: Record<string, unknown> }) => Promise<unknown> };

type DB = ReturnType<typeof createDb>;

export interface ProviderContext {
  adapter: ProviderAdapter;
  account: ProviderAccount;
}

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

function resolveProviderId(
  provider: ProviderContext | null,
  metadata?: Record<string, unknown>,
): string | null {
  const providerId =
    typeof metadata?.provider_id === "string" ? metadata.provider_id : null;
  if (providerId) return providerId;
  return provider ? provider.adapter.id : null;
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
  provider: ProviderContext | null,
  options: {
    callbackUrl?: string;
    metadata?: Record<string, unknown>;
    downgradeWorkflow?: WorkflowBinding;
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
    return handleOneTimePurchase(db, customer, newPlan, provider, options);
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
    return handleFreePlanSwitch(db, customer, existingSub, newPlan, switchType, provider, options);
  }

  // =========================================================================
  // UPGRADE — immediate switch, prorated charge
  // =========================================================================
  if (switchType === "upgrade") {
    return handleUpgrade(db, customer, existingSub!, newPlan, provider, options);
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
  return handleNewSubscription(db, customer, newPlan, provider, options);
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
  provider: ProviderContext | null = null,
  options: { metadata?: Record<string, unknown> } = {},
): Promise<SwitchResult> {
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  // Cancel the old subscription (both in DB and on provider)
  if (existingSub) {
    await cancelSubscription(db, existingSub, provider);
  }

  // Create new free subscription
  const [sub] = await db
    .insert(schema.subscriptions)
    .values({
      id: crypto.randomUUID(),
      customerId: customer.id,
      planId: newPlan.id,
      providerId: resolveProviderId(provider, options.metadata),
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
  provider: ProviderContext | null,
  options: { callbackUrl?: string; metadata?: Record<string, unknown> },
): Promise<SwitchResult> {
  const now = Date.now();
  const proratedAmount = calculateProration(
    existingSub.plan,
    newPlan,
    existingSub.currentPeriodStart,
    existingSub.currentPeriodEnd,
  );

  const providerId = resolveProviderId(provider, options.metadata);
  const authCode = customer.providerAuthorizationCode || customer.paystackAuthorizationCode;
  const customerRef = customer.providerCustomerId || customer.paystackCustomerId || customer.email;
  const planRef = newPlan.providerPlanId || newPlan.paystackPlanId;

  // If prorated amount is 0 or negative (near end of period), just switch directly
  if (proratedAmount <= 0) {
    await cancelSubscription(db, existingSub, provider);

    let providerSubCode: string | undefined;
    if (provider && planRef && authCode) {
      const subResult = await provider.adapter.createSubscription({
        customer: { id: customerRef, email: customer.email },
        plan: { id: planRef },
        authorizationCode: authCode,
        environment: provider.account.environment,
        account: provider.account,
      });
      if (subResult.isOk()) {
        providerSubCode = subResult.value.id;
      }
    }

    const periodEnd = existingSub.currentPeriodEnd;
    const [sub] = await db
      .insert(schema.subscriptions)
      .values({
        id: crypto.randomUUID(),
        customerId: customer.id,
        planId: newPlan.id,
        paystackSubscriptionCode: providerId === "paystack" ? (providerSubCode || null) : null,
        providerId,
        providerSubscriptionId: providerSubCode || null,
        providerSubscriptionCode: providerSubCode || null,
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

  // If customer has a saved card and provider is configured, charge directly
  if (provider && authCode && proratedAmount > 0) {
    const chargeResult = await provider.adapter.chargeAuthorization({
      customer: { id: customerRef, email: customer.email },
      authorizationCode: authCode,
      amount: proratedAmount,
      currency: newPlan.currency || "USD",
      metadata: {
        type: "plan_upgrade_proration",
        old_plan_id: existingSub.plan.id,
        new_plan_id: newPlan.id,
        customer_id: customer.id,
        ...options.metadata,
      },
      environment: provider.account.environment,
      account: provider.account,
    });

    if (chargeResult.isErr()) {
      // Charge failed — fall through to checkout
      return createUpgradeCheckout(
        db, customer, existingSub, newPlan, provider, proratedAmount, options,
      );
    }

    // Charge succeeded — cancel old sub and create new one
    await cancelSubscription(db, existingSub, provider);

    // Create new subscription via provider API if plan has a provider plan code.
    // Use startDate = current period end so the provider doesn't charge immediately
    // (we already charged the prorated amount for the remaining current period).
    let providerSubCode: string | undefined;
    if (planRef && authCode) {
      const subResult = await provider.adapter.createSubscription({
        customer: { id: customerRef, email: customer.email },
        plan: { id: planRef },
        authorizationCode: authCode,
        startDate: new Date(existingSub.currentPeriodEnd).toISOString(),
        environment: provider.account.environment,
        account: provider.account,
      });
      if (subResult.isOk()) {
        providerSubCode = subResult.value.id;
      }
    }

    const periodEnd = existingSub.currentPeriodEnd; // Keep the same billing cycle
    const [sub] = await db
      .insert(schema.subscriptions)
      .values({
        id: crypto.randomUUID(),
        customerId: customer.id,
        planId: newPlan.id,
        paystackSubscriptionCode: providerId === "paystack" ? (providerSubCode || null) : null,
        providerId,
        providerSubscriptionId: providerSubCode || null,
        providerSubscriptionCode: providerSubCode || null,
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
    db, customer, existingSub, newPlan, provider, proratedAmount, options,
  );
}

async function createUpgradeCheckout(
  _db: DB,
  customer: any,
  existingSub: any,
  newPlan: any,
  provider: ProviderContext | null,
  proratedAmount: number,
  options: { callbackUrl?: string; metadata?: Record<string, unknown> },
): Promise<SwitchResult> {
  if (!provider) {
    return {
      success: false,
      type: "upgrade",
      requiresCheckout: true,
      message: "Payment provider not configured — cannot process upgrade payment",
    };
  }

  const customerRef = customer.providerCustomerId || customer.paystackCustomerId || customer.email;

  // NOTE: Do NOT pass `plan` here. We charge the prorated amount as a one-time
  // payment; the webhook handler creates the new subscription when the charge succeeds.
  const result = await provider.adapter.createCheckoutSession({
    customer: { id: customerRef, email: customer.email },
    plan: null,
    amount: Math.max(proratedAmount, 100),
    currency: newPlan.currency || "USD",
    callbackUrl: options.callbackUrl,
    metadata: {
      type: "plan_upgrade",
      old_plan_id: existingSub.plan.id,
      old_subscription_id: existingSub.id,
      new_plan_id: newPlan.id,
      customer_id: customer.id,
      prorated_amount: proratedAmount,
      ...options.metadata,
    },
    environment: provider.account.environment,
    account: provider.account,
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
    checkoutUrl: result.value.url,
    message: `Checkout created for upgrade to ${newPlan.name}`,
  };
}

async function handleDowngrade(
  db: DB,
  customer: any,
  existingSub: any,
  newPlan: any,
  options: {
    downgradeWorkflow?: WorkflowBinding;
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

  // Dispatch downgrade workflow (sleeps until period end, then executes)
  if (options.downgradeWorkflow && options.organizationId) {
    try {
      await options.downgradeWorkflow.create({
        params: {
          subscriptionId: existingSub.id,
          customerId: existingSub.customerId,
          newPlanId: newPlan.id,
          organizationId: options.organizationId,
          providerId: existingSub.providerId || "paystack",
          environment: options.environment || "test",
          executeAt: existingSub.currentPeriodEnd,
          oldPlanId: existingSub.plan?.id,
          providerSubscriptionCode: existingSub.providerSubscriptionCode || existingSub.paystackSubscriptionCode,
          customerEmail: customer.email,
          customerAuthorizationCode: customer.providerAuthorizationCode || customer.paystackAuthorizationCode,
          newPlanProviderCode: newPlan.providerPlanId || newPlan.paystackPlanId,
        },
      });
      console.log(`[plan-switch] Downgrade workflow dispatched: sub=${existingSub.id}, newPlan=${newPlan.id}`);
    } catch (e) {
      console.error("Failed to dispatch downgrade workflow:", e);
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
      providerId:
        existingSub.providerId ||
        (existingSub.paystackSubscriptionCode ? "paystack" : null),
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
  provider: ProviderContext | null,
  options: { callbackUrl?: string; metadata?: Record<string, unknown> },
): Promise<SwitchResult> {
  const now = Date.now();
  const providerId = resolveProviderId(provider, options.metadata);

  // Free one-time → just create purchase record + entitlements
  if (plan.price === 0) {
    const [sub] = await db
      .insert(schema.subscriptions)
      .values({
        id: crypto.randomUUID(),
        customerId: customer.id,
        planId: plan.id,
        paystackSubscriptionCode: providerId === "paystack" ? "one-time" : null,
        providerId,
        providerSubscriptionId: "one-time",
        providerSubscriptionCode: "one-time",
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: now,
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

  const authCode = customer.providerAuthorizationCode || customer.paystackAuthorizationCode;
  const customerRef = customer.providerCustomerId || customer.paystackCustomerId || customer.email;

  // Card on file → charge directly
  if (provider && authCode) {
    const chargeResult = await provider.adapter.chargeAuthorization({
      customer: { id: customerRef, email: customer.email },
      authorizationCode: authCode,
      amount: plan.price,
      currency: plan.currency || "USD",
      metadata: {
        type: "one_time_purchase",
        plan_id: plan.id,
        plan_slug: plan.slug,
        customer_id: customer.id,
        ...options.metadata,
      },
      environment: provider.account.environment,
      account: provider.account,
    });

    if (chargeResult.isOk()) {
      const [sub] = await db
        .insert(schema.subscriptions)
        .values({
          id: crypto.randomUUID(),
          customerId: customer.id,
          planId: plan.id,
          paystackSubscriptionCode: providerId === "paystack" ? "one-time" : null,
          providerId,
          providerSubscriptionId: "one-time",
          providerSubscriptionCode: "one-time",
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: now,
          metadata: {
            ...options.metadata,
            billing_type: "one_time",
            payment_reference: chargeResult.value.reference,
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
  if (!provider) {
    return {
      success: false,
      type: "new",
      requiresCheckout: true,
      message: "Payment provider not configured",
    };
  }

  const result = await provider.adapter.createCheckoutSession({
    customer: { id: customerRef, email: customer.email },
    plan: null,
    amount: plan.price,
    currency: plan.currency || "USD",
    callbackUrl: options.callbackUrl,
    metadata: {
      type: "one_time_purchase",
      plan_id: plan.id,
      plan_slug: plan.slug,
      customer_id: customer.id,
      ...options.metadata,
    },
    environment: provider.account.environment,
    account: provider.account,
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
    checkoutUrl: result.value.url,
    message: `Checkout created for ${plan.name} (one-time)`,
  };
}

async function handleNewSubscription(
  db: DB,
  customer: any,
  newPlan: any,
  provider: ProviderContext | null,
  options: { callbackUrl?: string; metadata?: Record<string, unknown> },
): Promise<SwitchResult> {
  const providerId = resolveProviderId(provider, options.metadata);
  const authCode = customer.providerAuthorizationCode || customer.paystackAuthorizationCode;
  const customerRef = customer.providerCustomerId || customer.paystackCustomerId || customer.email;
  const planRef = newPlan.providerPlanId || newPlan.paystackPlanId;

  // If card on file and provider available, create subscription directly
  if (provider && authCode && planRef) {
    const subResult = await provider.adapter.createSubscription({
      customer: { id: customerRef, email: customer.email },
      plan: { id: planRef },
      authorizationCode: authCode,
      environment: provider.account.environment,
      account: provider.account,
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
          paystackSubscriptionCode: providerId === "paystack" ? subResult.value.id : null,
          providerId,
          providerSubscriptionId: subResult.value.id,
          providerSubscriptionCode: subResult.value.id,
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

  // No card or provider not available — need checkout
  if (!provider) {
    return {
      success: false,
      type: "new",
      requiresCheckout: true,
      message: "Payment provider not configured",
    };
  }

  const result = await provider.adapter.createCheckoutSession({
    customer: { id: customerRef, email: customer.email },
    plan: planRef ? { id: planRef } : null,
    amount: newPlan.price,
    currency: newPlan.currency || "USD",
    callbackUrl: options.callbackUrl,
    metadata: {
      type: "new_subscription",
      plan_id: newPlan.id,
      plan_slug: newPlan.slug,
      customer_id: customer.id,
      ...options.metadata,
    },
    environment: provider.account.environment,
    account: provider.account,
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
    checkoutUrl: result.value.url,
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

  // Find active, trialing, or pending_cancel subscriptions for this customer.
  // pending_cancel included so re-subscribing triggers a proper switch instead of a duplicate.
  const subs = await db.query.subscriptions.findMany({
    where: and(
      eq(schema.subscriptions.customerId, customerId),
      inArray(schema.subscriptions.status, ["active", "trialing", "pending_cancel"]),
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
  provider: ProviderContext | null,
) {
  const now = Date.now();

  // Cancel on the provider if it's a native subscription
  const subCode = sub.providerSubscriptionCode || sub.paystackSubscriptionCode;
  if (
    provider &&
    subCode &&
    subCode !== "one-time" &&
    !subCode.startsWith("trial-")
  ) {
    try {
      const result = await provider.adapter.cancelSubscription({
        subscription: { id: subCode, status: sub.status || "active" },
        environment: provider.account.environment,
        account: provider.account,
      });
      if (result.isErr()) {
        console.warn(`Provider cancel failed for ${subCode}:`, result.error.message);
      }
    } catch (e) {
      console.warn(`Provider cancel threw for ${subCode}:`, e);
    }
  }

  await db
    .update(schema.subscriptions)
    .set({ status: "canceled", canceledAt: now, updatedAt: now })
    .where(eq(schema.subscriptions.id, sub.id));
}

export async function provisionEntitlements(
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
