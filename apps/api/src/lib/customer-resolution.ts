import { createDb, schema } from "@owostack/db";
import { and, eq, ne, or } from "drizzle-orm";
import { EntitlementCache } from "./cache";

type DB = ReturnType<typeof createDb>;
type Customer = typeof schema.customers.$inferSelect;

export type CustomerMatchField =
  | "id"
  | "externalId"
  | "email"
  | "providerCustomerId";

export interface ResolvedCustomer {
  customer: Customer;
  matchedBy: CustomerMatchField;
}

type CacheOptions = {
  cache?: EntitlementCache | null;
  waitUntil?: (promise: Promise<unknown>) => void;
};

type ResolveByIdentifierOptions = CacheOptions & {
  db: DB;
  organizationId: string;
  customerId: string;
};

type ResolveByEmailOptions = CacheOptions & {
  db: DB;
  organizationId: string;
  email: string;
};

type ResolveByProviderOptions = {
  db: DB;
  organizationId: string;
  providerCustomerId: string;
};

const CUSTOMER_FIELD_LABELS: Record<CustomerMatchField, string> = {
  id: "customer ID",
  externalId: "external ID",
  email: "email",
  providerCustomerId: "provider customer ID",
};

export class CustomerResolutionConflictError extends Error {
  readonly name = "CustomerResolutionConflictError";

  constructor(
    readonly organizationId: string,
    readonly identifier: string,
    readonly matchedBy: Exclude<CustomerMatchField, "id">,
  ) {
    super(
      `Multiple customers in organization '${organizationId}' match ${CUSTOMER_FIELD_LABELS[matchedBy]} '${identifier}'. Use the internal customer ID instead.`,
    );
  }
}

export function isCustomerResolutionConflictError(
  error: unknown,
): error is CustomerResolutionConflictError {
  return error instanceof CustomerResolutionConflictError;
}

function scheduleCacheWrite(
  waitUntil: CacheOptions["waitUntil"],
  promise: Promise<unknown>,
): Promise<void> {
  if (waitUntil) {
    waitUntil(promise);
    return Promise.resolve();
  }

  return promise.then(() => undefined);
}

async function cacheResolvedCustomer(
  organizationId: string,
  customer: Customer,
  opts: CacheOptions,
): Promise<void> {
  if (!opts.cache) return;

  await scheduleCacheWrite(
    opts.waitUntil,
    opts.cache.setCustomerAliases(
      organizationId,
      {
        id: customer.id,
        email: customer.email,
        externalId: customer.externalId,
      },
      customer,
    ),
  );
}

async function resolveUniqueCustomerMatch(opts: {
  db: DB;
  organizationId: string;
  identifier: string;
  matchedBy: Exclude<CustomerMatchField, "id">;
  where: unknown;
}): Promise<Customer | null> {
  const first = await opts.db.query.customers.findFirst({
    where: opts.where as never,
  });

  if (!first) {
    return null;
  }

  const second = await opts.db.query.customers.findFirst({
    where: and(
      opts.where as never,
      ne(schema.customers.id, first.id),
    ) as never,
  });

  if (second && second.id !== first.id) {
    throw new CustomerResolutionConflictError(
      opts.organizationId,
      opts.identifier,
      opts.matchedBy,
    );
  }

  return first;
}

async function getSafeCachedCustomer(
  organizationId: string,
  customerId: string,
  opts: CacheOptions,
): Promise<Customer | null> {
  if (!opts.cache) return null;

  const cacheKeys = customerId.includes("@")
    ? [...new Set([customerId, customerId.toLowerCase()])]
    : [customerId];

  for (const key of cacheKeys) {
    const cached =
      await opts.cache.getCustomer<typeof schema.customers.$inferSelect>(
        organizationId,
        key,
      );

    if (cached?.id === customerId) {
      return cached;
    }
  }

  return null;
}

export async function resolveCustomerById(
  opts: ResolveByIdentifierOptions,
): Promise<ResolvedCustomer | null> {
  const cached = await getSafeCachedCustomer(
    opts.organizationId,
    opts.customerId,
    opts,
  );
  if (cached) {
    return { customer: cached, matchedBy: "id" };
  }

  const customer = await opts.db.query.customers.findFirst({
    where: and(
      eq(schema.customers.organizationId, opts.organizationId),
      eq(schema.customers.id, opts.customerId),
    ),
  });

  if (!customer) {
    return null;
  }

  await cacheResolvedCustomer(opts.organizationId, customer, opts);
  return { customer, matchedBy: "id" };
}

export async function resolveCustomerByExternalId(
  opts: ResolveByIdentifierOptions,
): Promise<ResolvedCustomer | null> {
  const customer = await resolveUniqueCustomerMatch({
    db: opts.db,
    organizationId: opts.organizationId,
    identifier: opts.customerId,
    matchedBy: "externalId",
    where: and(
      eq(schema.customers.organizationId, opts.organizationId),
      eq(schema.customers.externalId, opts.customerId),
    ),
  });

  if (!customer) {
    return null;
  }

  await cacheResolvedCustomer(opts.organizationId, customer, opts);
  return { customer, matchedBy: "externalId" };
}

export async function resolveCustomerByEmail(
  opts: ResolveByEmailOptions,
): Promise<ResolvedCustomer | null> {
  const normalizedEmail = opts.email.toLowerCase();
  const customer = await resolveUniqueCustomerMatch({
    db: opts.db,
    organizationId: opts.organizationId,
    identifier: normalizedEmail,
    matchedBy: "email",
    where: and(
      eq(schema.customers.organizationId, opts.organizationId),
      eq(schema.customers.email, normalizedEmail),
    ),
  });

  if (!customer) {
    return null;
  }

  await cacheResolvedCustomer(opts.organizationId, customer, opts);
  return { customer, matchedBy: "email" };
}

export async function resolveCustomerByProviderReference(
  opts: ResolveByProviderOptions,
): Promise<ResolvedCustomer | null> {
  const customer = await resolveUniqueCustomerMatch({
    db: opts.db,
    organizationId: opts.organizationId,
    identifier: opts.providerCustomerId,
    matchedBy: "providerCustomerId",
    where: and(
      eq(schema.customers.organizationId, opts.organizationId),
      or(
        eq(schema.customers.providerCustomerId, opts.providerCustomerId),
        eq(schema.customers.paystackCustomerId, opts.providerCustomerId),
      ),
    ),
  });

  if (!customer) {
    return null;
  }

  return { customer, matchedBy: "providerCustomerId" };
}

export async function resolveCustomerByIdentifier(
  opts: ResolveByIdentifierOptions,
): Promise<ResolvedCustomer | null> {
  const byId = await resolveCustomerById(opts);
  if (byId) {
    return byId;
  }

  const byExternalId = await resolveCustomerByExternalId(opts);
  if (byExternalId) {
    return byExternalId;
  }

  if (!opts.customerId.includes("@")) {
    return null;
  }

  return resolveCustomerByEmail({
    ...opts,
    email: opts.customerId,
  });
}
