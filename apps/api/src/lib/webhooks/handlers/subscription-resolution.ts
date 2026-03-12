import { schema } from "@owostack/db";
import { and, eq, or } from "drizzle-orm";
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
