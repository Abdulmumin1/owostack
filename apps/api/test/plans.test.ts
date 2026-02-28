import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
let app: typeof import("../src/index").app;

interface ProviderContext {
  currency?: string;
}

const hoisted = vi.hoisted(() => {
  return {
    resolveProviderMock: vi.fn(),
    getProviderRegistryMock: vi.fn(),
    deriveProviderEnvironmentMock: vi.fn(() => "test"),
    loadProviderAccountsMock: vi.fn(),
    loadProviderRulesMock: vi.fn(),
    buildProviderContextMock: vi.fn((ctx: ProviderContext) => ctx),
  };
});

const resolveProviderMock = hoisted.resolveProviderMock;
vi.mock("@owostack/adapters", async () => {
  const actual =
    await vi.importActual<typeof import("@owostack/adapters")>(
      "@owostack/adapters",
    );
  return {
    ...actual,
    resolveProvider: (...args: unknown[]) => resolveProviderMock(...args),
  };
});

const getProviderRegistryMock = hoisted.getProviderRegistryMock;
const deriveProviderEnvironmentMock = hoisted.deriveProviderEnvironmentMock;
const loadProviderAccountsMock = hoisted.loadProviderAccountsMock;
const loadProviderRulesMock = hoisted.loadProviderRulesMock;
const buildProviderContextMock = hoisted.buildProviderContextMock;

vi.mock("../src/lib/providers", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/providers")>(
    "../src/lib/providers",
  );
  return {
    ...actual,
    getProviderRegistry: () => getProviderRegistryMock(),
    deriveProviderEnvironment: (...args: unknown[]) =>
      deriveProviderEnvironmentMock(...args),
    loadProviderAccounts: (...args: unknown[]) =>
      loadProviderAccountsMock(...args),
    loadProviderRules: (...args: unknown[]) => loadProviderRulesMock(...args),
    buildProviderContext: (...args: unknown[]) =>
      buildProviderContextMock(...args),
  };
});

vi.mock("../src/lib/auth", () => ({
  auth: () => ({
    handler: () => new Response("Auth"),
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: { id: "test-user" },
        session: { id: "test-session" },
      }),
    },
  }),
}));

interface Plan {
  id: string;
  organizationId: string;
  name: string;
  price: number;
  interval: string;
  currency: string;
  type: string;
  billingModel: string;
  billingType: string;
  slug: string;
  trialDays?: number;
  trialCardRequired?: boolean;
  description?: string | null;
  providerId?: string | null;
  providerPlanId?: string | null;
  paystackPlanId?: string | null;
  metadata?: Record<string, unknown>;
}

let mockReturningPlan: Plan | undefined;

const insertReturningMock = vi.fn(async () => [mockReturningPlan]);
const insertValuesMock = vi.fn(() => ({
  returning: insertReturningMock,
}));
const insertMock = vi.fn(() => ({
  values: insertValuesMock,
}));

interface MockDb {
  insert: Mock;
  query: {
    organizations: { findFirst: Mock };
    providerAccounts: { findMany: Mock };
    providerRules: { findMany: Mock };
    plans: { findFirst: Mock; findMany: Mock };
  };
  update?: Mock;
}

const mockDb: MockDb = {
  insert: insertMock,
  query: {
    organizations: {
      findFirst: vi.fn(async () => ({ id: "org_123" })),
    },
    providerAccounts: {
      findMany: vi.fn(async () => []),
    },
    providerRules: {
      findMany: vi.fn(async () => []),
    },
    plans: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
  },
};

vi.mock("@owostack/db", async () => {
  const actual =
    await vi.importActual<typeof import("@owostack/db")>("@owostack/db");
  return {
    ...actual,
    createDb: () => mockDb,
  };
});

interface Env {
  DB: unknown;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  ENCRYPTION_KEY: string;
  PAYSTACK_SECRET_KEY: string;
  PAYSTACK_WEBHOOK_SECRET: string;
}

const env: Env = {
  DB: {},
  BETTER_AUTH_SECRET: "secret",
  BETTER_AUTH_URL: "http://localhost",
  ENCRYPTION_KEY: "test_key",
  PAYSTACK_SECRET_KEY: "sk_test",
  PAYSTACK_WEBHOOK_SECRET: "wh_secret",
};

describe("Plans API", () => {
  const ok = <T>(value: T) => ({
    isOk: () => true,
    isErr: () => false,
    value,
  });

  const err = <E>(error: E) => ({
    isOk: () => false,
    isErr: () => true,
    error,
  });

  const paystackAdapter = {
    id: "paystack",
    createPlan: vi.fn(async () => ok({ id: "prov_plan_paystack_1" })),
    updatePlan: vi.fn(async () => ok({ id: "prov_plan_paystack_1" })),
  };
  const dodoAdapter = {
    id: "dodopayments",
    createPlan: vi.fn(async () => ok({ id: "prov_plan_dodo_1" })),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockReturningPlan = undefined;

    await vi.resetModules();

    getProviderRegistryMock.mockReturnValue(
      new Map([
        ["paystack", paystackAdapter],
        ["dodopayments", dodoAdapter],
      ]),
    );
    loadProviderAccountsMock.mockResolvedValue([
      {
        id: "acct_paystack",
        providerId: "paystack",
        environment: "test",
      },
      {
        id: "acct_dodo",
        providerId: "dodopayments",
        environment: "test",
      },
    ]);
    loadProviderRulesMock.mockResolvedValue([]);
    resolveProviderMock.mockReset();
    resolveProviderMock.mockReturnValue(err(new Error("no_match")));

    insertMock.mockClear();
    insertValuesMock.mockClear();
    insertReturningMock.mockClear();

    ({ app } = await import("../src/index"));
  });

  it("should create a basic paid plan", async () => {
    mockReturningPlan = {
      id: "plan_123",
      organizationId: "org_123",
      name: "Pro Plan",
      price: 500000,
      interval: "monthly",
      currency: "NGN",
      type: "paid",
      billingModel: "base",
      billingType: "recurring",
      slug: "pro-plan",
      trialDays: 0,
      trialCardRequired: false,
      description: "A pro plan",
    };

    const res = await app.request(
      "/api/dashboard/plans",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          name: "Pro Plan",
          price: 500000,
          interval: "monthly",
          currency: "NGN",
          type: "paid",
          billingModel: "base",
          billingType: "recurring",
          description: "A pro plan",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe("Pro Plan");
    expect(body.data.price).toBe(500000);
    expect(body.data.type).toBe("paid");
    expect(body.data.billingModel).toBe("base");
    expect(body.data.slug).toBe("pro-plan");
  });

  it("should create a free plan", async () => {
    mockReturningPlan = {
      id: "plan_456",
      organizationId: "org_123",
      name: "Free Plan",
      price: 0,
      interval: "monthly",
      currency: "NGN",
      type: "free",
      billingModel: "base",
      billingType: "recurring",
      slug: "free-plan",
      trialDays: 0,
      trialCardRequired: false,
    };

    const res = await app.request(
      "/api/dashboard/plans",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          name: "Free Plan",
          price: 0,
          type: "free",
          billingModel: "base",
          billingType: "recurring",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.type).toBe("free");
    expect(body.data.price).toBe(0);

    expect(paystackAdapter.createPlan).not.toHaveBeenCalled();
    expect(dodoAdapter.createPlan).not.toHaveBeenCalled();
    expect(resolveProviderMock).not.toHaveBeenCalled();
  });

  it("syncs paid recurring plan to explicitly requested provider and stores provider plan ids", async () => {
    mockReturningPlan = {
      id: "plan_999",
      organizationId: "org_123",
      name: "Pro Plus",
      price: 8000,
      interval: "monthly",
      currency: "USD",
      type: "paid",
      billingModel: "base",
      billingType: "recurring",
      slug: "pro-plus",
      providerId: "paystack",
      providerPlanId: "prov_plan_paystack_1",
      paystackPlanId: "prov_plan_paystack_1",
    };

    const res = await app.request(
      "/api/dashboard/plans",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          name: "Pro Plus",
          price: 8000,
          interval: "monthly",
          currency: "USD",
          type: "paid",
          billingModel: "base",
          billingType: "recurring",
          providerId: "paystack",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);

    expect(resolveProviderMock).not.toHaveBeenCalled();
    expect(paystackAdapter.createPlan).toHaveBeenCalledTimes(1);

    const createArg = paystackAdapter.createPlan.mock.calls[0]?.[0] as {
      amount: number;
      currency: string;
      environment: string;
      account: { id: string };
    };
    expect(createArg.amount).toBe(8000);
    expect(createArg.currency).toBe("USD");
    expect(createArg.environment).toBe("test");
    expect(createArg.account.id).toBe("acct_paystack");

    const inserted = insertValuesMock.mock.calls[0]?.[0] as {
      providerId: string;
      providerPlanId: string;
      paystackPlanId: string | null;
    };
    expect(inserted.providerId).toBe("paystack");
    expect(inserted.providerPlanId).toBe("prov_plan_paystack_1");
    expect(inserted.paystackPlanId).toBe("prov_plan_paystack_1");
  });

  it("syncs paid recurring plan via provider rules when provider is not explicitly requested", async () => {
    resolveProviderMock.mockReturnValue(
      ok({
        adapter: dodoAdapter,
        account: { id: "acct_dodo", providerId: "dodopayments" },
      }),
    );

    mockReturningPlan = {
      id: "plan_1000",
      organizationId: "org_123",
      name: "Global Pro",
      price: 12000,
      interval: "monthly",
      currency: "USD",
      type: "paid",
      billingModel: "base",
      billingType: "recurring",
      slug: "global-pro",
      providerId: "dodopayments",
      providerPlanId: "prov_plan_dodo_1",
    };

    const res = await app.request(
      "/api/dashboard/plans",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          name: "Global Pro",
          price: 12000,
          interval: "monthly",
          currency: "USD",
          type: "paid",
          billingModel: "base",
          billingType: "recurring",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);

    expect(buildProviderContextMock).toHaveBeenCalledWith({ currency: "USD" });
    expect(resolveProviderMock).toHaveBeenCalledTimes(1);
    expect(dodoAdapter.createPlan).toHaveBeenCalledTimes(1);
    expect(paystackAdapter.createPlan).not.toHaveBeenCalled();

    const inserted = insertValuesMock.mock.calls[0]?.[0] as {
      providerId: string;
      providerPlanId: string;
      paystackPlanId: string | null;
    };
    expect(inserted.providerId).toBe("dodopayments");
    expect(inserted.providerPlanId).toBe("prov_plan_dodo_1");
    expect(inserted.paystackPlanId).toBe(null);
  });

  it("creates unique slugs by suffixing when a plan with the same slug already exists", async () => {
    mockDb.query.plans.findFirst
      .mockResolvedValueOnce({ id: "existing" })
      .mockResolvedValueOnce(null);

    mockReturningPlan = {
      id: "plan_slug_2",
      organizationId: "org_123",
      name: "Pro Plan",
      price: 1000,
      interval: "monthly",
      currency: "USD",
      type: "free",
      billingModel: "base",
      billingType: "recurring",
      slug: "pro-plan-1",
    };

    const res = await app.request(
      "/api/dashboard/plans",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          name: "Pro Plan",
          price: 1000,
          type: "free",
          billingModel: "base",
          billingType: "recurring",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(mockDb.query.plans.findFirst).toHaveBeenCalledTimes(2);
    const inserted = insertValuesMock.mock.calls[0]?.[0] as { slug: string };
    expect(inserted.slug).toBe("pro-plan-1");
  });

  it("PATCH triggers provider sync via adapter.updatePlan when provider fields change", async () => {
    const updateReturningMock = vi.fn(async () => [
      {
        id: "plan_patch_1",
        organizationId: "org_123",
        name: "Pro",
        price: 5000,
        interval: "monthly",
        currency: "USD",
        description: null,
        providerId: "paystack",
        providerPlanId: "prov_plan_paystack_1",
      },
    ]);
    const updateSetMock = vi.fn(() => ({
      where: vi.fn(() => ({
        returning: updateReturningMock,
      })),
    }));
    mockDb.update = vi.fn(() => ({
      set: updateSetMock,
    }));

    mockDb.query.plans.findFirst.mockResolvedValueOnce({
      id: "plan_patch_1",
      metadata: {},
    });

    const res = await app.request(
      "/api/dashboard/plans/plan_patch_1",
      {
        method: "PATCH",
        body: JSON.stringify({ price: 6000 }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(paystackAdapter.updatePlan).toHaveBeenCalledTimes(1);
    const arg = paystackAdapter.updatePlan.mock.calls[0]?.[0] as {
      planId: string;
      amount: number;
      environment: string;
      account: { id: string };
    };
    expect(arg.planId).toBe("prov_plan_paystack_1");
    expect(arg.amount).toBe(5000);
    expect(arg.environment).toBe("test");
    expect(arg.account.id).toBe("acct_paystack");
  });

  it("PATCH does not call provider when provider fields are unchanged", async () => {
    const updateReturningMock = vi.fn(async () => [
      {
        id: "plan_patch_2",
        organizationId: "org_123",
        name: "Pro",
        price: 5000,
        interval: "monthly",
        currency: "USD",
        description: null,
        providerId: "paystack",
        providerPlanId: "prov_plan_paystack_1",
      },
    ]);
    const updateSetMock = vi.fn(() => ({
      where: vi.fn(() => ({
        returning: updateReturningMock,
      })),
    }));
    mockDb.update = vi.fn(() => ({
      set: updateSetMock,
    }));

    const res = await app.request(
      "/api/dashboard/plans/plan_patch_2",
      {
        method: "PATCH",
        body: JSON.stringify({ isActive: true }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(paystackAdapter.updatePlan).not.toHaveBeenCalled();
  });

  it("should create a plan with trial", async () => {
    mockReturningPlan = {
      id: "plan_789",
      organizationId: "org_123",
      name: "Trial Plan",
      price: 10000,
      interval: "monthly",
      currency: "NGN",
      type: "paid",
      billingModel: "base",
      billingType: "recurring",
      slug: "trial-plan",
      trialDays: 14,
      trialCardRequired: true,
    };

    const res = await app.request(
      "/api/dashboard/plans",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          name: "Trial Plan",
          price: 10000,
          interval: "monthly",
          type: "paid",
          trialDays: 14,
          trialCardRequired: true,
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.trialDays).toBe(14);
    expect(body.data.trialCardRequired).toBe(true);
  });

  it("should fail with invalid data", async () => {
    const res = await app.request(
      "/api/dashboard/plans",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          // name missing
          price: 5000,
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
