import { schema } from "@owostack/db";
import { eq, and, sql } from "drizzle-orm";

/**
 * Upsert a payment method into the payment_methods table.
 *
 * For Paystack: called on charge.success with reusable auth code + card details.
 * For Dodo: called on subscription.active with subscription_id as token.
 * For Stripe: called on checkout.session.completed with pm_xxx.
 *
 * Uses INSERT ... ON CONFLICT to be idempotent on (customer_id, provider_id, token).
 * When a new default is inserted, all other methods for the same customer are demoted.
 */
export async function upsertPaymentMethod(
  db: any,
  params: {
    customerId: string;
    organizationId: string;
    providerId: string;
    token: string;
    type: "card" | "provider_managed";
    cardLast4?: string | null;
    cardBrand?: string | null;
    cardExpMonth?: string | null;
    cardExpYear?: string | null;
    isDefault?: boolean;
  },
): Promise<void> {
  const now = Date.now();
  const isDefault = params.isDefault !== false; // default true

  // Demote existing defaults for this customer (only if we're setting a new default)
  if (isDefault) {
    await db
      .update(schema.paymentMethods)
      .set({ isDefault: false, updatedAt: now })
      .where(
        and(
          eq(schema.paymentMethods.customerId, params.customerId),
          eq(schema.paymentMethods.organizationId, params.organizationId),
          eq(schema.paymentMethods.isDefault, true),
        ),
      );
  }

  // Upsert the payment method
  await db.run(
    sql`INSERT INTO payment_methods (id, customer_id, organization_id, provider_id, token, type, card_last4, card_brand, card_exp_month, card_exp_year, is_default, is_valid, verified_at, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${params.customerId}, ${params.organizationId}, ${params.providerId}, ${params.token}, ${params.type}, ${params.cardLast4 || null}, ${params.cardBrand || null}, ${params.cardExpMonth || null}, ${params.cardExpYear || null}, ${isDefault ? 1 : 0}, 1, ${now}, ${now}, ${now})
        ON CONFLICT (customer_id, provider_id, token) DO UPDATE SET
          is_valid = 1,
          is_default = ${isDefault ? 1 : 0},
          type = CASE
            WHEN excluded.type = 'provider_managed' AND type = 'card' THEN type
            ELSE excluded.type
          END,
          card_last4 = COALESCE(${params.cardLast4 || null}, card_last4),
          card_brand = COALESCE(${params.cardBrand || null}, card_brand),
          card_exp_month = COALESCE(${params.cardExpMonth || null}, card_exp_month),
          card_exp_year = COALESCE(${params.cardExpYear || null}, card_exp_year),
          verified_at = ${now},
          updated_at = ${now}`,
  );
}

/**
 * Invalidate a payment method after a permanent charge failure.
 * Called from trial-end and overage-billing workflows when the auth code is rejected.
 */
export async function invalidatePaymentMethod(
  db: any,
  customerId: string,
  token: string,
): Promise<void> {
  const now = Date.now();
  await db
    .update(schema.paymentMethods)
    .set({ isValid: false, invalidatedAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.paymentMethods.customerId, customerId),
        eq(schema.paymentMethods.token, token),
      ),
    );
}

/**
 * Get the default valid payment method for a customer.
 * Used by overage guard and workflows to find a chargeable token.
 */
export async function getDefaultPaymentMethod(
  db: any,
  customerId: string,
): Promise<{ token: string; providerId: string; type: string } | null> {
  const result = await db.run(
    sql`SELECT token, provider_id, type FROM payment_methods
        WHERE customer_id = ${customerId} AND is_valid = 1 AND is_default = 1
        LIMIT 1`,
  );
  const row = result?.results?.[0];
  if (!row) return null;
  return {
    token: row.token as string,
    providerId: row.provider_id as string,
    type: row.type as string,
  };
}
