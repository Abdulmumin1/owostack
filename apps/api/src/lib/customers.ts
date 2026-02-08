import { eq, and, or } from "drizzle-orm";
import { schema, createDb } from "@owostack/db";
import { EntitlementCache } from "./cache";

type DB = ReturnType<typeof createDb>;

export interface CustomerData {
  email: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface ResolveCustomerOptions {
  db: DB;
  organizationId: string;
  customerId: string;
  customerData?: CustomerData;
  providerId?: string;
  cache?: EntitlementCache | null;
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Resolve an existing customer or auto-create one.
 *
 * Lookup order: id → externalId → email (lowercased).
 * If no match and enough data to create (either customerData.email or customerId looks like an email),
 * a new record is inserted with consistent fields across all call sites.
 *
 * Returns the customer record or null if not found and cannot be created.
 */
export async function resolveOrCreateCustomer(
  opts: ResolveCustomerOptions,
): Promise<typeof schema.customers.$inferSelect | null> {
  const { db, organizationId, customerId, customerData, providerId, cache } = opts;
  const customerIdLower = customerId.toLowerCase();

  // 1. Check cache
  let customer = cache
    ? await cache.getCustomer<typeof schema.customers.$inferSelect>(organizationId, customerIdLower)
    : null;

  // 2. DB lookup by id, externalId, or email
  if (!customer) {
    customer = (await db.query.customers.findFirst({
      where: and(
        eq(schema.customers.organizationId, organizationId),
        or(
          eq(schema.customers.id, customerId),
          eq(schema.customers.externalId, customerId),
          eq(schema.customers.email, customerIdLower),
        ),
      ),
    })) ?? null;

    if (customer && cache) {
      cache.setCustomer(organizationId, customerIdLower, customer);
    }
  }

  if (customer) {
    // Backfill missing fields on existing customers (fire-and-forget)
    const patches: Record<string, unknown> = {};
    if (!customer.externalId && customerId !== customer.id) {
      patches.externalId = customerId;
    }
    if ((!customer.name || customer.name === "Anonymous") && customerData?.name) {
      patches.name = customerData.name;
    } else if ((!customer.name || customer.name === "Anonymous") && customer.email) {
      patches.name = customer.email.split("@")[0];
    }
    if (!customer.providerId && providerId) {
      patches.providerId = providerId;
    }

    if (Object.keys(patches).length > 0) {
      patches.updatedAt = Date.now();
      const updatePromise = db
        .update(schema.customers)
        .set(patches)
        .where(eq(schema.customers.id, customer.id))
        .then(() => {
          if (cache) cache.invalidateCustomer(organizationId, customerIdLower);
        })
        .catch((e: unknown) => console.warn("[customers] backfill failed:", e));

      if (opts.waitUntil) {
        opts.waitUntil(updatePromise);
      }
      // Optimistically patch the returned object so the caller sees updated values
      customer = { ...customer, ...patches } as typeof customer;
    }

    return customer;
  }

  // 3. Auto-create if we have enough info
  const email = customerData?.email?.toLowerCase() ?? (customerIdLower.includes("@") ? customerIdLower : null);
  if (!email) return null;

  const now = Date.now();
  const newCustomer = {
    id: crypto.randomUUID(),
    organizationId,
    providerId: providerId || null,
    externalId: customerId,
    email,
    name: customerData?.name || email.split("@")[0],
    metadata: customerData?.metadata || null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(schema.customers).values(newCustomer);
  customer = newCustomer as unknown as typeof schema.customers.$inferSelect;

  if (cache) {
    cache.setCustomer(organizationId, customerIdLower, customer);
  }

  return customer;
}
