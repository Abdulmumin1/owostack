import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createRouteTestApp } from "./helpers/route-harness";
import { err, ok } from "./helpers/result";

let app: ReturnType<typeof createRouteTestApp<{ db: MockDb }>>;

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

const env = {
  ENCRYPTION_KEY: "test_key",
  ENVIRONMENT: "test",
};

describe("Plans API", () => {
  const paystackAdapter = {
    id: "paystack",
    createPlan: vi.fn(async () => ok({ id: "prov_plan_paystack_1" })),
    updatePlan: vi.fn(async () => ok({ updated: true })),
  };
  const stripeAdapter = {
    id: "stripe",
    createPlan: vi.fn(async () => ok({ id: "price_stripe_1" })),
    updatePlan: vi.fn(async () => ok({ updated: true })),
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
        ["stripe", stripeAdapter],
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
        id: "acct_stripe",
        providerId: "stripe",
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

    const { default: plansRoute } =
      await import("../src/routes/dashboard/plans");
    app = createRouteTestApp(plansRoute, {
      db: mockDb,
      organizationId: "org_123",
    });
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
      "/",
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
      "/",
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
      "/",
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
      "/",
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
      "/",
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
      "/plan_patch_1",
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
    mockDb.query.plans.findFirst.mockResolvedValueOnce({
      id: "plan_patch_2",
      billingType: "recurring",
      metadata: {},
    });

    const res = await app.request(
      "/plan_patch_2",
      {
        method: "PATCH",
        body: JSON.stringify({ isActive: true }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(paystackAdapter.updatePlan).not.toHaveBeenCalled();
  });

  it("GET normalizes one-time plans to hide trial and auto-enable flags", async () => {
    mockDb.query.plans.findMany.mockResolvedValueOnce([
      {
        id: "plan_one_time_dashboard_1",
        organizationId: "org_123",
        name: "Credit Pack",
        price: 5000,
        interval: "monthly",
        currency: "USD",
        type: "paid",
        billingModel: "base",
        billingType: "one_time",
        slug: "credit-pack",
        trialDays: 14,
        trialCardRequired: true,
        autoEnable: true,
        subscriptions: [],
        planFeatures: [],
      },
    ]);

    const res = await app.request("/", { method: "GET" }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data[0].billingType).toBe("one_time");
    expect(body.data[0].trialDays).toBe(0);
    expect(body.data[0].trialCardRequired).toBe(false);
    expect(body.data[0].autoEnable).toBe(false);
  });

  it("GET /:id normalizes one-time plan flags", async () => {
    mockDb.query.plans.findFirst.mockResolvedValueOnce({
      id: "plan_one_time_dashboard_2",
      organizationId: "org_123",
      name: "Credit Pack",
      price: 5000,
      interval: "monthly",
      currency: "USD",
      type: "paid",
      billingModel: "base",
      billingType: "one_time",
      slug: "credit-pack",
      trialDays: 7,
      trialCardRequired: true,
      autoEnable: true,
      planFeatures: [],
    });

    const res = await app.request("/plan_one_time_dashboard_2", {
      method: "GET",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.billingType).toBe("one_time");
    expect(body.data.trialDays).toBe(0);
    expect(body.data.trialCardRequired).toBe(false);
    expect(body.data.autoEnable).toBe(false);
  });

  it("PATCH persists a rotated provider plan id when adapter.updatePlan returns nextPlanId", async () => {
    const localUpdateReturningMock = vi.fn(async () => [
      {
        id: "plan_patch_stripe_1",
        organizationId: "org_123",
        name: "Pro",
        price: 5000,
        interval: "monthly",
        currency: "USD",
        description: "Updated plan",
        providerId: "stripe",
        providerPlanId: "price_old_1",
        paystackPlanId: null,
      },
    ]);
    const providerIdUpdateReturningMock = vi.fn(async () => [
      {
        id: "plan_patch_stripe_1",
        organizationId: "org_123",
        name: "Pro",
        price: 5000,
        interval: "monthly",
        currency: "USD",
        description: "Updated plan",
        providerId: "stripe",
        providerPlanId: "price_new_1",
        paystackPlanId: null,
      },
    ]);

    const firstSetMock = vi.fn(() => ({
      where: vi.fn(() => ({
        returning: localUpdateReturningMock,
      })),
    }));
    const secondSetMock = vi.fn(() => ({
      where: vi.fn(() => ({
        returning: providerIdUpdateReturningMock,
      })),
    }));

    mockDb.update = vi
      .fn()
      .mockImplementationOnce(() => ({
        set: firstSetMock,
      }))
      .mockImplementationOnce(() => ({
        set: secondSetMock,
      }));

    stripeAdapter.updatePlan.mockResolvedValueOnce(
      ok({ updated: true, nextPlanId: "price_new_1" }),
    );

    mockDb.query.plans.findFirst.mockResolvedValueOnce({
      id: "plan_patch_stripe_1",
      metadata: {},
    });

    const res = await app.request(
      "/plan_patch_stripe_1",
      {
        method: "PATCH",
        body: JSON.stringify({ description: "Updated plan" }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(stripeAdapter.updatePlan).toHaveBeenCalledTimes(1);
    expect(mockDb.update).toHaveBeenCalledTimes(2);

    const providerIdUpdatePayload = secondSetMock.mock.calls[0]?.[0] as {
      providerPlanId: string;
      updatedAt: number;
    };
    expect(providerIdUpdatePayload.providerPlanId).toBe("price_new_1");

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.providerPlanId).toBe("price_new_1");
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
      "/",
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

  it("should clear trial and auto-enable flags for one-time plans on create", async () => {
    mockReturningPlan = {
      id: "plan_one_time_1",
      organizationId: "org_123",
      name: "One-off Plan",
      price: 2500,
      interval: "monthly",
      currency: "USD",
      type: "paid",
      billingModel: "base",
      billingType: "one_time",
      slug: "one-off-plan",
      trialDays: 0,
      trialCardRequired: false,
      autoEnable: false,
    };

    const res = await app.request(
      "/",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          name: "One-off Plan",
          price: 2500,
          currency: "USD",
          type: "paid",
          billingModel: "base",
          billingType: "one_time",
          trialDays: 14,
          trialCardRequired: true,
          autoEnable: true,
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const inserted = insertValuesMock.mock.calls[0]?.[0] as {
      trialDays: number;
      trialCardRequired: boolean;
      autoEnable: boolean;
    };
    expect(inserted.trialDays).toBe(0);
    expect(inserted.trialCardRequired).toBe(false);
    expect(inserted.autoEnable).toBe(false);

    const body = await res.json();
    expect(body.data.trialDays).toBe(0);
    expect(body.data.trialCardRequired).toBe(false);
    expect(body.data.autoEnable).toBe(false);
  });

  it("PATCH clears trial metadata and auto-enable when a plan becomes one-time", async () => {
    const updateReturningMock = vi.fn(async () => [
      {
        id: "plan_patch_one_time_1",
        organizationId: "org_123",
        name: "One-off Plan",
        price: 2500,
        interval: "monthly",
        currency: "USD",
        description: null,
        billingType: "one_time",
        trialDays: 0,
        trialCardRequired: false,
        autoEnable: false,
        providerId: null,
        providerPlanId: null,
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
      id: "plan_patch_one_time_1",
      billingType: "recurring",
      metadata: { trialUnit: "minutes" },
    });

    const res = await app.request(
      "/plan_patch_one_time_1",
      {
        method: "PATCH",
        body: JSON.stringify({
          billingType: "one_time",
          trialDays: 10,
          trialCardRequired: true,
          autoEnable: true,
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const updatePayload = updateSetMock.mock.calls[0]?.[0] as {
      billingType: string;
      trialDays: number;
      trialCardRequired: boolean;
      autoEnable: boolean;
      metadata: Record<string, unknown>;
    };
    expect(updatePayload.billingType).toBe("one_time");
    expect(updatePayload.trialDays).toBe(0);
    expect(updatePayload.trialCardRequired).toBe(false);
    expect(updatePayload.autoEnable).toBe(false);
    expect(updatePayload.metadata.trialUnit).toBeUndefined();
  });

  it("should fail with invalid data", async () => {
    const res = await app.request(
      "/",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
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
