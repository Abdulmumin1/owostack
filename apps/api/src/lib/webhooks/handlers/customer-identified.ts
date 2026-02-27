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
}
