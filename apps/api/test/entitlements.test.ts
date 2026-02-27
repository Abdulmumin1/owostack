import { describe, expect, it, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { Mock } from "vitest";
import entitlements from "../src/routes/api/entitlements";
import {
  deductScopedBalance,
  getScopedBalance,
} from "../src/lib/addon-credits";

vi.mock("../src/lib/api-keys", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/api-keys")>(
    "../src/lib/api-keys",
  );
  return {
    ...actual,
    verifyApiKey: vi.fn().mockResolvedValue({
      id: "key_test",
      organizationId: "org_test",
    }),
  };
});

vi.mock("../src/lib/addon-credits", () => ({
  getScopedBalance: vi.fn(async () => 0),
  deductScopedBalance: vi.fn(async () => false),
  topUpScopedBalance: vi.fn(async () => 0),
}));

// Type for response body
type TrackResponse = {
  success: boolean;
  allowed: boolean;
  code: string;
  addonCredits?: number;
};

// Mock DB type with vitest mocks
type MockDb = {
  query: {
    customers: { findFirst: Mock };
    features: { findFirst: Mock; findMany: Mock };
    subscriptions: { findFirst: Mock; findMany: Mock };
    planFeatures: { findFirst: Mock; findMany: Mock };
    credits: { findFirst: Mock };
    entities: { findFirst: Mock };
  };
  insert: Mock;
  values: Mock;
  update: Mock;
  set: Mock;
  where: Mock;
  select: Mock;
};

describe("Entitlements Engine (Check & Track)", () => {
  const apiKey = "owo_sk_test";
  const customerId = "cus_test";
  const featureIdMetered = "feat_metered";
  const featureIdBoolean = "feat_boolean";
  const mockEnv: {
    CACHE: unknown;
    USAGE_METER: unknown;
  } = {
    CACHE: undefined,
    USAGE_METER: undefined,
  };
  const mockExecutionCtx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  };

  let usageTotal = 0;
  let mockDb: MockDb;
  let app: Hono<{ Variables: { db: MockDb; organizationId?: string } }>;

  beforeEach(() => {
    usageTotal = 0;

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
          findFirst: vi
            .fn()
            .mockImplementation(
              async ({
                where,
              }: {
                where?: { organizationId?: string; slug?: string; id?: string };
              }) => {
                void where;
                return null;
              },
            ),
        },
        subscriptions: {
          findFirst: vi.fn().mockResolvedValue(subscription),
          findMany: vi.fn().mockResolvedValue([subscription]),
        },
        planFeatures: {
          findFirst: vi
            .fn()
            .mockImplementation(
              async ({
                where,
              }: {
                where?: { planId?: string; featureId?: string };
              }) => {
                void where;
                return null;
              },
            ),
          findMany: vi
            .fn()
            .mockImplementation(
              async ({ where }: { where?: { planId?: string } }) => {
                void where;
                return [];
              },
            ),
        },
        credits: {
          findFirst: vi.fn().mockResolvedValue({ balance: 0 }),
        },
        entities: {
          findFirst: vi.fn().mockResolvedValue({
            id: "entity_test",
            entityId: "workspace_1",
            status: "active",
          }),
        },
      },
      insert: vi.fn().mockReturnThis(),
      values: vi
        .fn()
        .mockImplementation((record: { amount?: number | string }) => {
          usageTotal += Number(record.amount || 0);
          return {
            onConflictDoUpdate: vi.fn().mockResolvedValue([]),
            returning: vi.fn().mockResolvedValue([]),
          };
        }),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
      select: vi.fn().mockImplementation((_shape: unknown) => {
        return {
          from: (_table: unknown) => {
            return {
              where: async (_where: unknown) => {
                void _where;
                return [{ total: usageTotal }];
              },
            };
          },
        };
      }),
    };

    app = new Hono<{ Variables: { db: MockDb; organizationId?: string } }>();
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
    const trackBody = (await res.json()) as TrackResponse;
    expect(trackBody.success).toBe(true);
    expect(trackBody.allowed).toBe(true);
    expect(trackBody.code).toBe("tracked");

    // Without a DO or ledger binding, check sees usage as 0 (usage
    // is persisted asynchronously via waitUntil). Verify the check
    // still succeeds — the balance reflects the ledger state.
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
    // Without DO/ledger, balance = limitValue (usage not yet visible)
    expect(body.balance).toBe(100);
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
    const body = (await res.json()) as TrackResponse;
    expect(body.success).toBe(true);
    expect(body.allowed).toBe(true);
    expect(body.code).toBe("tracked");

    expect(mockExecutionCtx.waitUntil).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId,
        featureId: featureIdMetered,
        amount: 50,
        organizationId: "org_test",
      }),
    );
  });

  it("track filters expired trialing subscriptions, schedules cleanup, and invalidates subscription cache", async () => {
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => null),
      delete: vi.fn(async () => null),
    };
    const envWithCache = {
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
      envWithCache,
      mockExecutionCtx,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as TrackResponse;
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

  it("check uses DO and falls back to addon credits for credit system features when limit is exceeded (sendEvent=true)", async () => {
    const usageMeter = {
      check: vi.fn(async () => ({
        allowed: false,
        code: "limit_exceeded",
        usage: 100,
        limit: 100,
      })),
      configureFeature: vi.fn(async () => null),
      track: vi.fn(async () => ({
        allowed: true,
        code: "tracked",
        balance: 0,
      })),
    };

    const envWithMeter = {
      ...mockEnv,
      USAGE_METER: {
        idFromName: vi.fn(() => "do_1"),
        get: vi.fn(() => usageMeter),
      },
    };

    vi.mocked(getScopedBalance).mockResolvedValue(100);
    vi.mocked(deductScopedBalance).mockResolvedValue(true);

    mockDb.query.features.findFirst.mockResolvedValueOnce({
      id: "feat_child",
      organizationId: "org_test",
      slug: "dfs",
      type: "metered",
    });

    mockDb.query.planFeatures.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          planId: "plan_test",
          featureId: "cs_feature_1",
          limitValue: 100,
          resetInterval: "monthly",
          resetOnEnable: false,
          rolloverEnabled: false,
          rolloverMaxBalance: null,
          usageModel: "included",
          creditCost: 0,
        },
      ]);

    mockDb.select.mockImplementation(
      (
        shape: { creditSystemId?: string; creditSystemSlug?: string } | unknown,
      ) => {
        if (
          shape &&
          typeof shape === "object" &&
          "creditSystemId" in (shape as Record<string, unknown>)
        ) {
          return {
            from: (_table: unknown) => ({
              innerJoin: (_join: unknown, _on: unknown) => ({
                where: async (_where: unknown) => {
                  void _where;
                  return [
                    {
                      creditSystemId: "cs_feature_1",
                      cost: 20,
                      creditSystemSlug: "support-credits",
                    },
                  ];
                },
              }),
            }),
          };
        }

        return {
          from: (_table: unknown) => {
            return {
              where: async (_where: unknown) => {
                void _where;
                return [{ total: usageTotal }];
              },
            };
          },
        };
      },
    );

    const res = await app.request(
      "/check",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          customer: customerId,
          feature: "feat_child",
          value: 3,
          sendEvent: true,
        }),
      },
      envWithMeter,
      mockExecutionCtx,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TrackResponse;
    expect(body.allowed).toBe(true);
    expect(body.code).toBe("addon_credits_used");
    expect(body.addonCredits).toBe(40);

    expect(usageMeter.check).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deductScopedBalance)).toHaveBeenCalledWith(
      mockDb,
      customerId,
      "cs_feature_1",
      60,
    );
    expect(mockExecutionCtx.waitUntil).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        featureId: "cs_feature_1",
        amount: 60,
      }),
    );
  });

  it("track resolves credit system mapping and persists usage against the credit system feature id with multiplied effectiveValue", async () => {
    mockDb.query.features.findFirst.mockResolvedValueOnce({
      id: "feat_child",
      organizationId: "org_test",
      slug: "dfs",
      type: "boolean",
    });

    mockDb.query.planFeatures.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          planId: "plan_test",
          featureId: "cs_feature_1",
          limitValue: 100,
          resetInterval: "monthly",
          resetOnEnable: false,
          rolloverEnabled: false,
          rolloverMaxBalance: null,
          usageModel: "included",
          creditCost: 0,
        },
      ]);

    mockDb.select.mockImplementation(
      (
        shape: { creditSystemId?: string; creditSystemSlug?: string } | unknown,
      ) => {
        if (
          shape &&
          typeof shape === "object" &&
          "creditSystemId" in (shape as Record<string, unknown>)
        ) {
          return {
            from: (_table: unknown) => ({
              innerJoin: (_join: unknown, _on: unknown) => ({
                where: async (_where: unknown) => {
                  void _where;
                  return [
                    {
                      creditSystemId: "cs_feature_1",
                      cost: 20,
                      creditSystemSlug: "support-credits",
                    },
                  ];
                },
              }),
            }),
          };
        }

        return {
          from: (_table: unknown) => {
            return {
              where: async (_where: unknown) => {
                void _where;
                return [{ total: usageTotal }];
              },
            };
          },
        };
      },
    );

    const res = await app.request(
      "/track",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          customer: customerId,
          feature: "feat_child",
          value: 3,
        }),
      },
      mockEnv,
      mockExecutionCtx,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TrackResponse;
    expect(body.success).toBe(true);
    expect(body.allowed).toBe(true);
    expect(body.code).toBe("tracked");

    expect(mockExecutionCtx.waitUntil).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        featureId: "cs_feature_1",
        amount: 60,
      }),
    );
  });
});
