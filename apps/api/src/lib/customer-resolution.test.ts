import { describe, expect, it, vi } from "vitest";
import {
  resolveCustomerByEmail,
  resolveCustomerByIdentifier,
} from "./customer-resolution";

function createCustomer(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "cust_1",
    organizationId: "org_1",
    email: "user@example.com",
    externalId: "user_123",
    providerCustomerId: null,
    paystackCustomerId: null,
    name: "User",
    metadata: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createMocks(options?: {
  cachedByKey?: Record<string, any>;
  findFirstResult?: any;
  findManyResult?: any[];
}) {
  const getCustomer = vi.fn(async (_orgId: string, key: string) => {
    return options?.cachedByKey?.[key] ?? null;
  });
  const setCustomerAliases = vi.fn(async () => undefined);
  const findFirst = vi.fn(async () => options?.findFirstResult ?? null);
  const findMany = vi.fn(async () => options?.findManyResult ?? []);

  return {
    cache: {
      getCustomer,
      setCustomerAliases,
    },
    db: {
      query: {
        customers: {
          findFirst,
          findMany,
        },
      },
    },
    getCustomer,
    setCustomerAliases,
    findFirst,
    findMany,
  };
}

describe("customer-resolution", () => {
  it("resolves a cached external-id alias without hitting the database", async () => {
    const customer = createCustomer();
    const { cache, findFirst, findMany } = createMocks({
      cachedByKey: {
        user_123: customer,
      },
    });

    const resolved = await resolveCustomerByIdentifier({
      db: {} as any,
      organizationId: "org_1",
      customerId: "user_123",
      cache: cache as any,
    });

    expect(resolved).toEqual({
      customer,
      matchedBy: "externalId",
    });
    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("resolves cached email aliases case-insensitively", async () => {
    const customer = createCustomer();
    const { cache, findFirst, findMany } = createMocks({
      cachedByKey: {
        "user@example.com": customer,
      },
    });

    const resolved = await resolveCustomerByIdentifier({
      db: {} as any,
      organizationId: "org_1",
      customerId: "USER@EXAMPLE.COM",
      cache: cache as any,
    });

    expect(resolved).toEqual({
      customer,
      matchedBy: "email",
    });
    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("uses a single uniqueness query for external-id lookups after a cache miss", async () => {
    const customer = createCustomer();
    const { cache, findFirst, findMany, setCustomerAliases, db } = createMocks({
      findFirstResult: null,
      findManyResult: [customer],
    });

    const resolved = await resolveCustomerByIdentifier({
      db: db as any,
      organizationId: "org_1",
      customerId: "user_123",
      cache: cache as any,
    });

    expect(resolved).toEqual({
      customer,
      matchedBy: "externalId",
    });
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(setCustomerAliases).toHaveBeenCalledTimes(1);
  });

  it("reuses the cache in direct email lookups", async () => {
    const customer = createCustomer();
    const { cache, findMany } = createMocks({
      cachedByKey: {
        "user@example.com": customer,
      },
    });

    const resolved = await resolveCustomerByEmail({
      db: {} as any,
      organizationId: "org_1",
      email: "User@Example.com",
      cache: cache as any,
    });

    expect(resolved).toEqual({
      customer,
      matchedBy: "email",
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});
