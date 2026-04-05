import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Mock } from "vitest";
import entitlements, {
  type EntitlementsDependencies,
} from "../src/routes/api/entitlements";
import { createRouteTestApp } from "./helpers/route-harness";

// Type for response body
type TrackResponse = {
  success: boolean;
  allowed: boolean;
  code: string;
  usage?: number | null;
  balance?: number | null;
  credits?: {
    source: "credit_system" | "prepaid";
    systemSlug?: string;
    costPerUnit?: number;
    addonBalance: number | null;
    plan: {
      used: number;
      limit: number | null;
      balance: number | null;
      resetsAt: string;
    };
  } | null;
};

// Mock DB type with vitest mocks
type MockDb = {
  query: {
    customers: { findFirst: Mock };
    features: { findFirst: Mock; findMany: Mock };
    subscriptions: { findFirst: Mock; findMany: Mock };
    planFeatures: { findFirst: Mock; findMany: Mock };
    creditSystems: { findFirst: Mock };
    credits: { findFirst: Mock };
    entities: { findFirst: Mock };
    entitlements: { findFirst: Mock; findMany: Mock };
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
    USAGE_LEDGER?: unknown;
  } = {
    CACHE: undefined,
    USAGE_METER: undefined,
  };
  const mockExecutionCtx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  };
  const verifyApiKeyMock = vi.fn();
  const resolveOrCreateCustomerMock = vi.fn();
  const getScopedBalanceMock = vi.fn(async () => 0);
  const deductScopedBalanceMock = vi.fn(async () => false);
  const checkOverageAllowedMock = vi.fn(async () => ({ allowed: true }));
  const getOrgOverageSettingsMock = vi.fn(async () => null);
  const getUnbilledOverageAmountMock = vi.fn(async () => 0);
  const deps: EntitlementsDependencies = {
    verifyApiKey:
      verifyApiKeyMock as unknown as EntitlementsDependencies["verifyApiKey"],
    resolveOrCreateCustomer:
      resolveOrCreateCustomerMock as unknown as EntitlementsDependencies["resolveOrCreateCustomer"],
    getScopedBalance:
      getScopedBalanceMock as unknown as EntitlementsDependencies["getScopedBalance"],
    deductScopedBalance:
      deductScopedBalanceMock as unknown as EntitlementsDependencies["deductScopedBalance"],
    checkOverageAllowed:
      checkOverageAllowedMock as unknown as EntitlementsDependencies["checkOverageAllowed"],
    getOrgOverageSettings:
      getOrgOverageSettingsMock as unknown as EntitlementsDependencies["getOrgOverageSettings"],
    getUnbilledOverageAmount:
      getUnbilledOverageAmountMock as unknown as EntitlementsDependencies["getUnbilledOverageAmount"],
  };

  let usageTotal = 0;
  let mockDb: MockDb;
  let app: ReturnType<
    typeof createRouteTestApp<{
      db: MockDb;
      authDb: unknown;
      entitlementsDeps: EntitlementsDependencies;
    }>
  >;

  beforeEach(() => {
    usageTotal = 0;
    verifyApiKeyMock.mockReset();
    resolveOrCreateCustomerMock.mockReset();
    getScopedBalanceMock.mockReset();
    deductScopedBalanceMock.mockReset();
    checkOverageAllowedMock.mockReset();
    getOrgOverageSettingsMock.mockReset();
    getUnbilledOverageAmountMock.mockReset();

    verifyApiKeyMock.mockResolvedValue({
      id: "key_test",
      organizationId: "org_test",
    });
    checkOverageAllowedMock.mockResolvedValue({ allowed: true });
    getScopedBalanceMock.mockResolvedValue(0);
    deductScopedBalanceMock.mockResolvedValue(false);
    getOrgOverageSettingsMock.mockResolvedValue(null);
    getUnbilledOverageAmountMock.mockResolvedValue(0);

    const now = Date.now();
    const subscription = {
      id: "sub_test",
      customerId,
      planId: "plan_test",
      status: "active",
      currentPeriodStart: now - 5 * 24 * 60 * 60 * 1000,
      currentPeriodEnd: now + 25 * 24 * 60 * 60 * 1000,
      plan: { type: "paid", name: "Pro" },
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
        creditSystems: {
          findFirst: vi.fn().mockResolvedValue(null),
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
        entitlements: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([]),
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

    app = createRouteTestApp(entitlements, {
      db: mockDb,
      authDb: {},
      entitlementsDeps: deps,
    });

    resolveOrCreateCustomerMock.mockImplementation(
      async ({ customerId: requestedCustomerId }: { customerId: string }) => ({
        id: requestedCustomerId,
        externalId: null,
        organizationId: "org_test",
      }),
    );
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

  it("fails closed when the authoritative billing ledger is configured but unavailable", async () => {
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

    const envWithFailingLedger = {
      ...mockEnv,
      USAGE_LEDGER: {
        idFromName: vi.fn(() => "ledger_1"),
        get: vi.fn(() => ({
          sumUsage: vi.fn(async () => {
            throw new Error("ledger down");
          }),
        })),
      },
    };

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
      envWithFailingLedger,
      mockExecutionCtx,
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.allowed).toBe(false);
    expect(body.code).toBe("billing_unavailable");
  });

  it("checks usage-based pricing through billing guardrails", async () => {
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
        limitValue: null,
        usageModel: "usage_based",
        ratingModel: "package",
        pricePerUnit: 25,
        billingUnits: 1,
        overage: "charge",
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
          value: 3,
        }),
      },
      mockEnv,
      mockExecutionCtx,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);
    expect(body.limit).toBeNull();
    expect(body.details.pricing).toEqual(
      expect.objectContaining({
        usageModel: "usage_based",
        ratingModel: "package",
        pricePerUnit: 25,
        billingUnits: 1,
      }),
    );
    expect(checkOverageAllowedMock).toHaveBeenCalledWith(
      mockDb,
      customerId,
      featureIdMetered,
      expect.any(Number),
      expect.any(Number),
      0,
      undefined,
      3,
      expect.any(Object),
    );
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

  it("blocks usage-based tracking when billing guardrails fail", async () => {
    checkOverageAllowedMock.mockResolvedValueOnce({
      allowed: false,
      reason: "No payment method on file.",
    });

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
        limitValue: null,
        usageModel: "usage_based",
        ratingModel: "package",
        pricePerUnit: 25,
        billingUnits: 1,
        overage: "charge",
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
          value: 2,
        }),
      },
      mockEnv,
      mockExecutionCtx,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TrackResponse & {
      details: { pricing?: { usageModel?: string } };
    };
    expect(body.success).toBe(false);
    expect(body.allowed).toBe(false);
    expect(body.code).toBe("limit_exceeded");
    expect(body.details.pricing?.usageModel).toBe("usage_based");
    expect(mockDb.values).not.toHaveBeenCalled();
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

  it("check filters stale paid subscriptions past grace and marks them past_due", async () => {
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => null),
      delete: vi.fn(async () => null),
    };
    const envWithCache = {
      ...mockEnv,
      CACHE: kv,
    };

    const now = Date.now();
    mockDb.query.subscriptions.findMany.mockResolvedValueOnce([
      {
        id: "sub_paid_stale",
        customerId,
        planId: "plan_test",
        status: "active",
        currentPeriodStart: now - 40 * 24 * 60 * 60 * 1000,
        currentPeriodEnd: now - 5 * 24 * 60 * 60 * 1000,
        plan: { type: "paid", name: "Pro" },
      },
    ]);

    mockDb.query.features.findFirst.mockResolvedValueOnce({
      id: featureIdMetered,
      organizationId: "org_test",
      slug: "api-calls",
      type: "metered",
    });

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
      envWithCache,
      mockExecutionCtx,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(false);
    expect(body.code).toBe("no_active_subscription");

    expect(mockExecutionCtx.waitUntil).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "past_due" }),
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

    getScopedBalanceMock.mockResolvedValue(100);
    deductScopedBalanceMock.mockResolvedValue(true);

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
    expect(body.credits).toMatchObject({
      source: "credit_system",
      systemSlug: "support-credits",
      costPerUnit: 20,
      addonBalance: 40,
      plan: {
        used: 100,
        limit: 100,
        balance: 0,
      },
    });

    expect(usageMeter.check).toHaveBeenCalledTimes(1);
    expect(deductScopedBalanceMock).toHaveBeenCalledWith(
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

  it("check returns nested credits for direct credit system features", async () => {
    const usageMeter = {
      check: vi.fn(async () => ({
        allowed: true,
        code: "access_granted",
        usage: 0,
        limit: 300,
        balance: 300,
        rolloverBalance: 0,
      })),
      configureFeature: vi.fn(async () => null),
      track: vi.fn(async () => ({
        allowed: true,
        code: "tracked",
        balance: 299,
      })),
    };

    const envWithMeter = {
      ...mockEnv,
      USAGE_METER: {
        idFromName: vi.fn(() => "do_1"),
        get: vi.fn(() => usageMeter),
      },
    };

    getScopedBalanceMock.mockResolvedValue(120);

    mockDb.query.features.findFirst.mockResolvedValueOnce({
      id: "feat_ai_credits",
      organizationId: "org_test",
      slug: "ai-credits",
      type: "metered",
    });

    mockDb.query.planFeatures.findMany.mockResolvedValueOnce([
      {
        planId: "plan_test",
        featureId: "feat_ai_credits",
        limitValue: 300,
        trialLimitValue: 300,
        resetInterval: "5min",
        resetOnEnable: false,
        rolloverEnabled: false,
        rolloverMaxBalance: null,
        usageModel: "included",
        creditCost: 0,
      },
    ]);

    mockDb.query.creditSystems.findFirst.mockResolvedValueOnce({
      id: "cs_ai_credits",
      slug: "ai-credits",
    });

    const res = await app.request(
      "/check",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          customer: customerId,
          feature: "feat_ai_credits",
          value: 1,
          sendEvent: false,
        }),
      },
      envWithMeter,
      mockExecutionCtx,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TrackResponse;
    expect(body.allowed).toBe(true);
    expect(body.code).toBe("access_granted");
    expect(body.credits).toMatchObject({
      source: "credit_system",
      systemSlug: "ai-credits",
      costPerUnit: 1,
      addonBalance: 120,
      plan: {
        used: 0,
        limit: 300,
        balance: 300,
      },
    });
  });

  it("track returns nested credits for direct credit system features with the current addon balance", async () => {
    const usageMeter = {
      track: vi.fn(async () => ({
        allowed: true,
        code: "tracked",
        usage: 5,
        limit: 300,
        balance: 295,
        rolloverBalance: 0,
      })),
      configureFeature: vi.fn(async () => null),
    };

    const envWithMeter = {
      ...mockEnv,
      USAGE_METER: {
        idFromName: vi.fn(() => "do_1"),
        get: vi.fn(() => usageMeter),
      },
    };

    getScopedBalanceMock.mockResolvedValue(120);

    mockDb.query.features.findFirst.mockResolvedValueOnce({
      id: "feat_ai_credits",
      organizationId: "org_test",
      slug: "ai-credits",
      type: "metered",
    });

    mockDb.query.planFeatures.findMany.mockResolvedValueOnce([
      {
        planId: "plan_test",
        featureId: "feat_ai_credits",
        limitValue: 300,
        trialLimitValue: 300,
        resetInterval: "5min",
        resetOnEnable: false,
        rolloverEnabled: false,
        rolloverMaxBalance: null,
        usageModel: "included",
        creditCost: 0,
      },
    ]);

    mockDb.query.creditSystems.findFirst.mockResolvedValueOnce({
      id: "cs_ai_credits",
      slug: "ai-credits",
    });

    const res = await app.request(
      "/track",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          customer: customerId,
          feature: "feat_ai_credits",
          value: 5,
        }),
      },
      envWithMeter,
      mockExecutionCtx,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TrackResponse;
    expect(body.success).toBe(true);
    expect(body.allowed).toBe(true);
    expect(body.code).toBe("tracked");
    expect(body.credits).toMatchObject({
      source: "credit_system",
      systemSlug: "ai-credits",
      costPerUnit: 1,
      addonBalance: 120,
      plan: {
        used: 5,
        limit: 300,
        balance: 295,
      },
    });
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

  it("track consumes remaining included balance before overage when overage is enabled", async () => {
    const usageMeter = {
      track: vi
        .fn()
        .mockResolvedValueOnce({
          allowed: false,
          code: "insufficient_balance",
          balance: 10,
          usage: 90,
          limit: 100,
          rolloverBalance: 0,
        })
        .mockResolvedValueOnce({
          allowed: true,
          code: "tracked",
          balance: 0,
          usage: 100,
          limit: 100,
          rolloverBalance: 0,
        }),
      configureFeature: vi.fn(async () => ({ success: true })),
    };

    const envWithMeter = {
      ...mockEnv,
      USAGE_METER: {
        idFromName: vi.fn(() => "do_1"),
        get: vi.fn(() => usageMeter),
      },
    };

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
        resetInterval: "monthly",
        resetOnEnable: false,
        rolloverEnabled: false,
        rolloverMaxBalance: null,
        usageModel: "included",
        creditCost: 0,
        overage: "charge",
        maxOverageUnits: 200,
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
          value: 20,
        }),
      },
      envWithMeter,
      mockExecutionCtx,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TrackResponse;
    expect(body.success).toBe(true);
    expect(body.allowed).toBe(true);
    expect(body.code).toBe("tracked_overage");
    expect(body.usage).toBe(100);
    expect(body.balance).toBe(0);

    expect(checkOverageAllowedMock).toHaveBeenCalledTimes(1);
    expect(checkOverageAllowedMock).toHaveBeenCalledWith(
      mockDb,
      customerId,
      featureIdMetered,
      expect.anything(),
      expect.anything(),
      100,
      200,
      10,
      expect.any(Object),
    );

    expect(usageMeter.track).toHaveBeenNthCalledWith(
      1,
      "api-calls",
      20,
      expect.objectContaining({
        limit: 100,
        resetInterval: "monthly",
      }),
    );
    expect(usageMeter.track).toHaveBeenNthCalledWith(
      2,
      "api-calls",
      10,
      expect.objectContaining({
        limit: 100,
        resetInterval: "monthly",
      }),
    );

    expect(mockExecutionCtx.waitUntil).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        featureId: featureIdMetered,
        amount: 20,
      }),
    );
  });
});
