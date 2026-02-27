import { schema } from "@owostack/db";
import { eq, and } from "drizzle-orm";
import type { WebhookContext } from "../types";

export async function handleCustomerIdentified(ctx: WebhookContext): Promise<void> {
  const { db, organizationId, event } = ctx;
  const email = event.customer.email?.toLowerCase();
  if (!email) return;

  // Fetch existing customer to merge metadata instead of overwriting
  const existing = await db.query.customers.findFirst({
    where: and(
      eq(schema.customers.email, email),
      eq(schema.customers.organizationId, organizationId),
    ),
  });
  if (!existing) return;

  const existingMeta = typeof existing.metadata === "object" && existing.metadata
    ? existing.metadata as Record<string, unknown>
    : {};

  await db
    .update(schema.customers)
    .set({
      metadata: { ...existingMeta, verified: true, verifiedAt: new Date().toISOString() },
      updatedAt: Date.now(),
    })
    .where(eq(schema.customers.id, existing.id));

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
          ctx.cache.invalidateCustomer(organizationId, email),
          dashboardInvalidate,
        ]);
      }
    } catch (e) {
      console.warn(`[WEBHOOK] customer.identified cache invalidation failed:`, e);
    }
  }
}
