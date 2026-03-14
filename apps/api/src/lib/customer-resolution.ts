import { createDb, schema } from "@owostack/db";
import { and, eq, or } from "drizzle-orm";
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

function getCustomerCacheKeys(customerId: string): string[] {
  return customerId.includes("@")
    ? [...new Set([customerId, customerId.toLowerCase()])]
    : [customerId];
}

function inferCustomerMatchField(
  customer: Customer,
  customerId: string,
): CustomerMatchField | null {
  if (customer.id === customerId) {
    return "id";
  }

  if (customer.externalId === customerId) {
    return "externalId";
  }

  if (
    customerId.includes("@") &&
    customer.email?.toLowerCase() === customerId.toLowerCase()
  ) {
    return "email";
  }

  return null;
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

async function getCachedResolvedCustomer(
  opts: ResolveByIdentifierOptions,
  matchField?: CustomerMatchField,
): Promise<ResolvedCustomer | null> {
  if (!opts.cache) return null;

  for (const key of getCustomerCacheKeys(opts.customerId)) {
    const cached =
      await opts.cache.getCustomer<typeof schema.customers.$inferSelect>(
        opts.organizationId,
        key,
      );

    if (!cached) {
      continue;
    }

    const matchedBy = inferCustomerMatchField(cached, opts.customerId);
    if (!matchedBy) {
      continue;
    }

    if (matchField && matchedBy !== matchField) {
      continue;
    }

    return { customer: cached, matchedBy };
  }

  return null;
}

async function resolveUniqueCustomerMatch(opts: {
  db: DB;
  organizationId: string;
  identifier: string;
  matchedBy: Exclude<CustomerMatchField, "id">;
  where: unknown;
}): Promise<Customer | null> {
  const customerQuery = opts.db.query.customers as {
    findMany?: (args: { where: never; limit: number }) => Promise<Customer[]>;
    findFirst: (args: { where: never }) => Promise<Customer | null>;
  };

  let matches: Customer[] | undefined;
  if (typeof customerQuery.findMany === "function") {
    const result = await customerQuery.findMany({
      where: opts.where as never,
      limit: 2,
    });
    if (Array.isArray(result)) {
      matches = result;
    }
  }

  if (!matches) {
    const customer = await customerQuery.findFirst({
      where: opts.where as never,
    });
    matches = customer ? [customer] : [];
  }

  const [first, second] = matches;
  if (!first) {
    return null;
  }

  if (second && second.id !== first.id) {
    throw new CustomerResolutionConflictError(
      opts.organizationId,
      opts.identifier,
      opts.matchedBy,
    );
  }

  return first;
}

export async function resolveCustomerById(
  opts: ResolveByIdentifierOptions,
): Promise<ResolvedCustomer | null> {
  const cached = await getCachedResolvedCustomer(opts, "id");
  if (cached) {
    return cached;
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
  const cached = await getCachedResolvedCustomer(opts, "externalId");
  if (cached) {
    return cached;
  }

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
  const cached = await getCachedResolvedCustomer(
    {
      db: opts.db,
      organizationId: opts.organizationId,
      customerId: opts.email,
      cache: opts.cache,
      waitUntil: opts.waitUntil,
    },
    "email",
  );
  if (cached) {
    return cached;
  }

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
  const cached = await getCachedResolvedCustomer(opts);
  if (cached) {
    return cached;
  }

  const dbLookupOpts = {
    ...opts,
    cache: null,
  };

  const byId = await resolveCustomerById(dbLookupOpts);
  if (byId) {
    await cacheResolvedCustomer(opts.organizationId, byId.customer, opts);
    return byId;
  }

  const byExternalId = await resolveCustomerByExternalId(dbLookupOpts);
  if (byExternalId) {
    await cacheResolvedCustomer(
      opts.organizationId,
      byExternalId.customer,
      opts,
    );
    return byExternalId;
  }

  if (!opts.customerId.includes("@")) {
    return null;
  }

  const byEmail = await resolveCustomerByEmail({
    ...dbLookupOpts,
    email: opts.customerId,
  });
  if (byEmail) {
    await cacheResolvedCustomer(opts.organizationId, byEmail.customer, opts);
  }

  return byEmail;
}
