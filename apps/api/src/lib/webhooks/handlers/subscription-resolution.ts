import { schema } from "@owostack/db";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  isCustomerResolutionConflictError,
  resolveCustomerByEmail,
  resolveCustomerByProviderReference,
} from "../../customer-resolution";
import type { WebhookContext } from "../types";

type ResolveSubscriptionCustomerOptions = {
  allowCreate?: boolean;
  logContext: string;
};

type RecoverableSubscriptionStatus =
  | "active"
  | "trialing"
  | "pending"
  | "pending_cancel"
  | "past_due";

type SubscriptionRecoveryStrategy =
  | "status_event"
  | "subscription_created"
  | "customer_link";

type RecoverableSubscription = {
  id: string;
  customerId: string;
  planId: string;
  status?: string | null;
  currentPeriodStart?: number | null;
  currentPeriodEnd?: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
};

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getRecoveryBucket(
  subscription: RecoverableSubscription,
  strategy: SubscriptionRecoveryStrategy,
  now: number,
): number {
  const status = (subscription.status || "").trim().toLowerCase();
  const hasActiveTrial =
    status === "trialing" && numberOrZero(subscription.currentPeriodEnd) > now;

  switch (strategy) {
    case "subscription_created":
      if (status === "pending") return 60;
      if (hasActiveTrial) return 50;
      if (status === "active") return 40;
      if (status === "pending_cancel") return 30;
      if (status === "past_due") return 20;
      if (status === "trialing") return 10;
      return 0;
    case "customer_link":
      if (status === "active") return 60;
      if (status === "pending_cancel") return 50;
      if (status === "past_due") return 40;
      if (hasActiveTrial) return 30;
      if (status === "trialing") return 10;
      return 0;
    case "status_event":
    default:
      if (hasActiveTrial) return 60;
      if (status === "active") return 50;
      if (status === "pending_cancel") return 40;
      if (status === "past_due") return 30;
      if (status === "pending") return 20;
      if (status === "trialing") return 10;
      return 0;
  }
}

function pickBestSubscriptionRecoveryCandidate(
  candidates: RecoverableSubscription[],
  strategy: SubscriptionRecoveryStrategy,
): RecoverableSubscription | null {
  if (candidates.length === 0) return null;

  const now = Date.now();
  return [...candidates].sort((left, right) => {
    const bucketDiff =
      getRecoveryBucket(right, strategy, now) -
      getRecoveryBucket(left, strategy, now);
    if (bucketDiff !== 0) return bucketDiff;

    const endDiff =
      numberOrZero(right.currentPeriodEnd) -
      numberOrZero(left.currentPeriodEnd);
    if (endDiff !== 0) return endDiff;

    const startDiff =
      numberOrZero(right.currentPeriodStart) -
      numberOrZero(left.currentPeriodStart);
    if (startDiff !== 0) return startDiff;

    const updatedDiff =
      numberOrZero(right.updatedAt) - numberOrZero(left.updatedAt);
    if (updatedDiff !== 0) return updatedDiff;

    const createdDiff =
      numberOrZero(right.createdAt) - numberOrZero(left.createdAt);
    if (createdDiff !== 0) return createdDiff;

    return left.id.localeCompare(right.id);
  })[0];
}

async function findBestRecoverableSubscription(
  ctx: WebhookContext,
  where: unknown,
  strategy: SubscriptionRecoveryStrategy,
): Promise<any | null> {
  const subscriptionQuery = ctx.db.query.subscriptions as {
    findMany?: (args: { where: never }) => Promise<RecoverableSubscription[]>;
    findFirst: (args: {
      where: never;
    }) => Promise<RecoverableSubscription | null>;
  };

  if (typeof subscriptionQuery.findMany === "function") {
    const candidates = await subscriptionQuery.findMany({
      where: where as never,
    });
    return pickBestSubscriptionRecoveryCandidate(candidates, strategy);
  }

  return subscriptionQuery.findFirst({
    where: where as never,
  });
}

export function getSubscriptionEventEmail(ctx: WebhookContext): string | null {
  const rawEmail =
    ctx.event.customer.email ||
    (typeof ctx.event.metadata.customer_email === "string"
      ? ctx.event.metadata.customer_email
      : "");
  const normalizedEmail = rawEmail.trim().toLowerCase();
  return normalizedEmail || null;
}

export function getSubscriptionEventPlanCode(
  ctx: WebhookContext,
): string | null {
  return (
    ctx.event.plan?.providerPlanCode ||
    ctx.event.subscription?.planCode ||
    (typeof ctx.event.metadata.provider_plan_id === "string"
      ? ctx.event.metadata.provider_plan_id
      : null)
  );
}

export async function resolveSubscriptionEventCustomer(
  ctx: WebhookContext,
  options: ResolveSubscriptionCustomerOptions,
): Promise<any | null> {
  const { db, organizationId, event } = ctx;
  const providerCustomerId = event.customer.providerCustomerId || null;
  const email = getSubscriptionEventEmail(ctx);
  const metadataCustomerId =
    typeof event.metadata.customer_id === "string"
      ? event.metadata.customer_id
      : null;

  if (metadataCustomerId) {
    const customerById = await db.query.customers.findFirst({
      where: and(
        eq(schema.customers.id, metadataCustomerId),
        eq(schema.customers.organizationId, organizationId),
      ),
    });
    if (customerById) return customerById;
  }

  if (providerCustomerId) {
    try {
      const customerByProvider = await resolveCustomerByProviderReference({
        db,
        organizationId,
        providerCustomerId,
      });
      if (customerByProvider) return customerByProvider.customer;
    } catch (error) {
      if (isCustomerResolutionConflictError(error)) {
        console.warn(
          `[WEBHOOK] ${options.logContext} resolution conflict: ${error.message}`,
        );
        return null;
      }
      throw error;
    }
  }

  if (email) {
    try {
      const customerByEmail = await resolveCustomerByEmail({
        db,
        organizationId,
        email,
      });
      if (customerByEmail) return customerByEmail.customer;
    } catch (error) {
      if (isCustomerResolutionConflictError(error)) {
        console.warn(
          `[WEBHOOK] ${options.logContext} resolution conflict: ${error.message}`,
        );
        return null;
      }
      throw error;
    }
  }

  if (!options.allowCreate || !email) {
    return null;
  }

  const [newCustomer] = await db
    .insert(schema.customers)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      email,
      providerId: event.provider,
      providerCustomerId,
      paystackCustomerId:
        event.provider === "paystack" ? providerCustomerId : null,
    })
    .returning();

  return newCustomer;
}

export async function resolveSubscriptionEventPlan(
  ctx: WebhookContext,
): Promise<any | null> {
  const { db, organizationId, event } = ctx;
  const metadataPlanId =
    typeof event.metadata.plan_id === "string" ? event.metadata.plan_id : null;

  if (metadataPlanId) {
    const planById = await db.query.plans.findFirst({
      where: and(
        eq(schema.plans.id, metadataPlanId),
        eq(schema.plans.organizationId, organizationId),
      ),
    });
    if (planById) return planById;
  }

  const planCode = getSubscriptionEventPlanCode(ctx);
  if (!planCode) return null;

  return db.query.plans.findFirst({
    where: and(
      or(
        eq(schema.plans.paystackPlanId, planCode),
        eq(schema.plans.providerPlanId, planCode),
      ),
      eq(schema.plans.organizationId, organizationId),
    ),
  });
}

export async function findBestSubscriptionForCustomerPlan(
  ctx: WebhookContext,
  params: {
    customerId: string;
    planId: string;
    statuses: RecoverableSubscriptionStatus[];
    strategy: SubscriptionRecoveryStrategy;
  },
): Promise<any | null> {
  return findBestRecoverableSubscription(
    ctx,
    and(
      eq(schema.subscriptions.customerId, params.customerId),
      eq(schema.subscriptions.planId, params.planId),
      inArray(schema.subscriptions.status, params.statuses),
    ),
    params.strategy,
  );
}

export async function findBestSubscriptionForCustomer(
  ctx: WebhookContext,
  params: {
    customerId: string;
    statuses: RecoverableSubscriptionStatus[];
    strategy: SubscriptionRecoveryStrategy;
  },
): Promise<any | null> {
  return findBestRecoverableSubscription(
    ctx,
    and(
      eq(schema.subscriptions.customerId, params.customerId),
      inArray(schema.subscriptions.status, params.statuses),
    ),
    params.strategy,
  );
}
