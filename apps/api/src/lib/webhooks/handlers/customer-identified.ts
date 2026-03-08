import { schema } from "@owostack/db";
import { eq, and, or } from "drizzle-orm";
import type { WebhookContext } from "../types";
import { upsertPaymentMethod } from "../../payment-methods";

export type CustomerIdentifiedDependencies = {
  upsertPaymentMethod: typeof upsertPaymentMethod;
};

export const customerIdentifiedDependencies: CustomerIdentifiedDependencies = {
  upsertPaymentMethod,
};

async function resolveCustomer(ctx: WebhookContext): Promise<any | null> {
  const { db, organizationId, event } = ctx;
  const metadataCustomerId =
    typeof event.metadata.customer_id === "string"
      ? event.metadata.customer_id
      : null;
  const email = event.customer.email?.toLowerCase() || null;
  const providerCustomerId = event.customer.providerCustomerId || null;

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
    const customerByProvider = await db.query.customers.findFirst({
      where: and(
        eq(schema.customers.organizationId, organizationId),
        or(
          eq(schema.customers.providerCustomerId, providerCustomerId),
          eq(schema.customers.paystackCustomerId, providerCustomerId),
        ),
      ),
    });
    if (customerByProvider) return customerByProvider;
  }

  if (!email) return null;

  return (
    (await db.query.customers.findFirst({
      where: and(
        eq(schema.customers.email, email),
        eq(schema.customers.organizationId, organizationId),
      ),
    })) ?? null
  );
}

export async function handleCustomerIdentified(
  ctx: WebhookContext,
): Promise<void> {
  const { db, organizationId, event } = ctx;
  const existing = await resolveCustomer(ctx);
  if (!existing) return;

  const email = existing.email?.toLowerCase();

  const existingMeta =
    typeof existing.metadata === "object" && existing.metadata
      ? (existing.metadata as Record<string, unknown>)
      : {};

  const hasReusableAuth =
    event.authorization?.reusable && !!event.authorization.code;

  await db
    .update(schema.customers)
    .set({
      providerId: event.provider,
      providerCustomerId:
        event.customer.providerCustomerId || existing.providerCustomerId,
      providerAuthorizationCode: hasReusableAuth
        ? event.authorization.code
        : existing.providerAuthorizationCode,
      paystackCustomerId:
        event.provider === "paystack"
          ? event.customer.providerCustomerId || existing.paystackCustomerId
          : existing.paystackCustomerId,
      paystackAuthorizationCode:
        event.provider === "paystack" && hasReusableAuth
          ? event.authorization.code
          : existing.paystackAuthorizationCode,
      metadata: {
        ...existingMeta,
        verified: true,
        verifiedAt: new Date().toISOString(),
      },
      updatedAt: Date.now(),
    })
    .where(eq(schema.customers.id, existing.id));

  if (hasReusableAuth) {
    try {
      await customerIdentifiedDependencies.upsertPaymentMethod(db, {
        customerId: existing.id,
        organizationId,
        providerId: event.provider,
        token: event.authorization.code,
        type: event.authorization.last4 ? "card" : "provider_managed",
        cardLast4: event.authorization.last4,
        cardBrand: event.authorization.cardType,
        cardExpMonth: event.authorization.expMonth,
        cardExpYear: event.authorization.expYear,
      });
    } catch (pmErr) {
      console.warn(
        `[WEBHOOK] customer.identified payment method upsert failed: ${pmErr}`,
      );
    }
  }

  if (ctx.cache) {
    try {
      const cacheAny = ctx.cache as any;
      const dashboardInvalidate =
        typeof cacheAny.invalidateDashboardCustomer === "function"
          ? cacheAny.invalidateDashboardCustomer(existing.id)
          : Promise.resolve();
      if (typeof cacheAny.invalidateCustomerAliases === "function") {
        await Promise.all([
          cacheAny.invalidateCustomerAliases(organizationId, {
            id: existing.id,
            email: existing.email,
            externalId: existing.externalId,
          }),
          dashboardInvalidate,
        ]);
      } else {
        await Promise.all([
          ctx.cache.invalidateCustomer(organizationId, existing.id),
          email
            ? ctx.cache.invalidateCustomer(organizationId, email)
            : Promise.resolve(),
          dashboardInvalidate,
        ]);
      }
    } catch (e) {
      console.warn(
        `[WEBHOOK] customer.identified cache invalidation failed:`,
        e,
      );
    }
  }
}
