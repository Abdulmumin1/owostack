import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApiCustomersRoute,
  type ApiCustomersDependencies,
} from "../src/routes/api/customers";
import { createRouteTestApp } from "./helpers/route-harness";

describe("POST /v1/customers", () => {
  const validApiKey = "owo_sk_1234567890abcdef";
  const verifyApiKeyMock = vi.fn();
  const customerFindFirstMock = vi.fn();
  const customerFindManyMock = vi.fn();
  const planFindManyMock = vi.fn();
  const insertValuesMock = vi.fn(async () => undefined);
  const updateWhereMock = vi.fn(async () => undefined);
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));

  const mockDb = {
    query: {
      customers: {
        findFirst: customerFindFirstMock,
        findMany: customerFindManyMock,
      },
      plans: {
        findMany: planFindManyMock,
      },
    },
    insert: vi.fn(() => ({ values: insertValuesMock })),
    update: vi.fn(() => ({ set: updateSetMock })),
  };

  const app = createRouteTestApp(
    createApiCustomersRoute({
      verifyApiKey:
        verifyApiKeyMock as unknown as ApiCustomersDependencies["verifyApiKey"],
    }),
    {
      db: mockDb,
      authDb: {},
    },
  );

  const env = {
    ENCRYPTION_KEY: "test_key",
    ENVIRONMENT: "test",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    verifyApiKeyMock.mockResolvedValue({
      id: "key_123",
      organizationId: "org_123",
    });
    customerFindFirstMock.mockResolvedValue(null);
    customerFindManyMock.mockResolvedValue([]);
    planFindManyMock.mockResolvedValue([
      { id: "plan_free", type: "free" },
      { id: "plan_paid", type: "paid" },
    ]);
  });

  it("auto-assigns auto-enabled plans when creating a customer", async () => {
    const uuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("cust_123")
      .mockReturnValueOnce("sub_free")
      .mockReturnValueOnce("sub_paid");

    const res = await app.request(
      "/customers",
      {
        method: "POST",
        body: JSON.stringify({
          email: "new@example.com",
          name: "New Customer",
        }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${validApiKey}`,
        },
      },
      env,
    );

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      id: string;
      email: string;
      name: string;
    };

    expect(body).toMatchObject({
      success: true,
      id: "cust_123",
      email: "new@example.com",
      name: "New Customer",
    });

    expect(insertValuesMock).toHaveBeenCalledTimes(2);
    expect(insertValuesMock.mock.calls[0]?.[0]).toMatchObject({
      id: "cust_123",
      organizationId: "org_123",
      externalId: null,
      email: "new@example.com",
      name: "New Customer",
      metadata: null,
      providerId: null,
    });
    expect(insertValuesMock.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({
        id: "sub_free",
        customerId: "cust_123",
        planId: "plan_free",
        status: "active",
      }),
      expect.objectContaining({
        id: "sub_paid",
        customerId: "cust_123",
        planId: "plan_paid",
        status: "pending",
      }),
    ]);

    uuidSpy.mockRestore();
  });
});
