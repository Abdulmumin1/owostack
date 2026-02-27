import { describe, expect, it, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import entitlements from "../src/routes/api/entitlements";

vi.mock("../src/lib/api-keys", async () => {
  const actual = await vi.importActual<any>("../src/lib/api-keys");
  return {
    ...actual,
    verifyApiKey: vi.fn().mockResolvedValue({
      id: "key_test",
      organizationId: "org_test",
    }),
  };
});

describe("Entitlements Engine (Check & Track)", () => {
  const apiKey = "owo_sk_test";
  const customerId = "cus_test";
  const featureIdMetered = "feat_metered";
  const featureIdBoolean = "feat_boolean";
  let mockEnv = {
    CACHE: undefined,
    USAGE_METER: undefined,
  } as any;
  const mockExecutionCtx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as any;

  let usageTotal = 0;
  let mockDb: any;
  let app: Hono<{ Variables: { db: any; organizationId?: string } }>;

  beforeEach(() => {
    usageTotal = 0;
    mockEnv = {
      CACHE: undefined,
      USAGE_METER: undefined,
    } as any;

    const subscription = {
      id: "sub_test",
      customerId,
      planId: "plan_test",
      status: "active",
      currentPeriodStart: new Date("2025-01-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2025-02-01T00:00:00.000Z"),
    };

    mockDb = {
      query: {
        customers: {
          findFirst: vi.fn().mockResolvedValue({
            id: customerId,
            externalId: null,
            organizationId: "org_test",
          }),
        },
        features: {
          findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
            void where;
            return null;
          }),
        },
        subscriptions: {
          findFirst: vi.fn().mockResolvedValue(subscription),
          findMany: vi.fn().mockResolvedValue([subscription]),
        },
        planFeatures: {
          findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
            void where;
            return null;
          }),
          findMany: vi.fn().mockImplementation(async ({ where }: any) => {
            void where;
            return [];
          }),
        },
        credits: {
          findFirst: vi.fn().mockResolvedValue({ balance: 0 }),
        },
      },
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockImplementation(async (record: any) => {
        usageTotal += Number(record.amount || 0);
        return [];
      }),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
      select: vi.fn().mockImplementation((_shape: any) => {
        return {
          from: (_table: any) => {
            return {
              where: async (_where: any) => {
                void _where;
                return [{ total: usageTotal }];
              },
            };
          },
        };
      }),
    };

    app = new Hono<{ Variables: { db: any; organizationId?: string } }>();
    app.use("*", async (c, next) => {
      c.set("db", mockDb);
      await next();
    });
    app.route("/", entitlements);
  });

  it("should allow access to valid boolean feature", async () => {
    mockDb.query.features.findFirst.mockResolvedValueOnce({
      id: featureIdBoolean,
      organizationId: "org_test",
      slug: "sso",
      type: "boolean",
    });
    mockDb.query.planFeatures.findMany.mockResolvedValueOnce([
      {
        planId: "plan_test",
        featureId: featureIdBoolean,
        limitValue: null,
        creditCost: null,
      },
    ]);

    const res = await app.request(
      "/check",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          customer: customerId,
          feature: featureIdBoolean,
        }),
      },
      mockEnv,
      mockExecutionCtx,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);
  });

  it("should allow metered access within limit", async () => {
    mockDb.query.features.findFirst.mockResolvedValueOnce({
      id: featureIdMetered,
      organizationId: "org_test",
      slug: "api-calls",
      type: "metered",
    });
    mockDb.query.planFeatures.findMany.mockResolvedValueOnce([
      {
        planId: "plan_test",
        featureId: featureIdMetered,
        limitValue: 100,
        creditCost: null,
        resetInterval: "monthly",
      },
    ]);

    const res = await app.request(
      "/check",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          customer: customerId,
          feature: featureIdMetered,
        }),
      },
      mockEnv,
      mockExecutionCtx,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);
    expect(body.balance).toBe(100);
  });

  it("should track usage", async () => {
    mockDb.query.features.findFirst
      .mockResolvedValueOnce({
        id: featureIdMetered,
        organizationId: "org_test",
        slug: "api-calls",
        type: "metered",
      })
      .mockResolvedValueOnce({
        id: featureIdMetered,
        organizationId: "org_test",
        slug: "api-calls",
        type: "metered",
      });

    mockDb.query.planFeatures.findMany
      .mockResolvedValueOnce([
        {
          planId: "plan_test",
          featureId: featureIdMetered,
          limitValue: 100,
          creditCost: null,
          resetInterval: "monthly",
        },
      ])
      .mockResolvedValueOnce([
        {
          planId: "plan_test",
          featureId: featureIdMetered,
          limitValue: 100,
          creditCost: null,
          resetInterval: "monthly",
        },
      ]);

    const res = await app.request(
      "/track",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          customer: customerId,
          feature: featureIdMetered,
          value: 50,
        }),
      },
      mockEnv,
      mockExecutionCtx,
    );
    expect(res.status).toBe(200);

    // Check remaining
    const check = await app.request(
      "/check",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          customer: customerId,
          feature: featureIdMetered,
        }),
      },
      mockEnv,
      mockExecutionCtx,
    );
    const body = await check.json();
    expect(body.allowed).toBe(true);
    expect(body.balance).toBe(50);
  });

  it("track persists usage record via waitUntil and scopes by entity when provided", async () => {
    mockDb.query.features.findFirst.mockResolvedValueOnce({
      id: featureIdMetered,
      organizationId: "org_test",
      slug: "api-calls",
      type: "metered",
    });
    mockDb.query.planFeatures.findMany.mockResolvedValueOnce([
      {
        planId: "plan_test",
        featureId: featureIdMetered,
        limitValue: 100,
        creditCost: null,
        resetInterval: "monthly",
      },
    ]);

    const res = await app.request(
      "/track",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          customer: customerId,
          feature: featureIdMetered,
          value: 50,
          entity: "workspace_1",
        }),
      },
      mockEnv,
      mockExecutionCtx,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.allowed).toBe(true);
    expect(body.code).toBe("tracked");

    expect(mockExecutionCtx.waitUntil).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId,
        featureId: featureIdMetered,
        entityId: "workspace_1",
        amount: 50,
        periodStart: expect.any(Number),
        periodEnd: expect.any(Number),
      }),
    );
  });

  it("track filters expired trialing subscriptions, schedules cleanup, and invalidates subscription cache", async () => {
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => null),
      delete: vi.fn(async () => null),
    } as any;
    mockEnv = {
      ...mockEnv,
      CACHE: kv,
    };

    mockDb.query.subscriptions.findMany.mockResolvedValueOnce([
      {
        id: "sub_trial_expired",
        customerId,
        planId: "plan_test",
        status: "trialing",
        currentPeriodStart: Date.now() - 10 * 24 * 60 * 60 * 1000,
        currentPeriodEnd: Date.now() - 60 * 1000,
        plan: { name: "Trial" },
      },
    ]);

    mockDb.query.features.findFirst.mockResolvedValueOnce({
      id: featureIdMetered,
      organizationId: "org_test",
      slug: "api-calls",
      type: "metered",
    });

    const res = await app.request(
      "/track",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          customer: customerId,
          feature: featureIdMetered,
          value: 1,
        }),
      },
      mockEnv,
      mockExecutionCtx,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.code).toBe("no_active_subscription");

    expect(mockExecutionCtx.waitUntil).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "expired" }),
    );
    expect(kv.delete).toHaveBeenCalledWith(
      expect.stringContaining(`org:org_test:subscriptions:${customerId}`),
    );
  });
});
