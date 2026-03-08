import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApiPlansRoute,
  type ApiPlansDependencies,
} from "../src/routes/api/plans";
import { createRouteTestApp } from "./helpers/route-harness";

describe("GET /api/v1/plans", () => {
  const mockDb = {
    query: {
      plans: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    },
  };
  const verifyApiKeyMock = vi.fn();
  const deps: ApiPlansDependencies = {
    verifyApiKey:
      verifyApiKeyMock as unknown as ApiPlansDependencies["verifyApiKey"],
  };
  const app = createRouteTestApp(createApiPlansRoute(deps), {
    db: mockDb,
    authDb: {},
  });

  beforeEach(() => {
    vi.clearAllMocks();
    verifyApiKeyMock.mockResolvedValue({
      id: "key_123",
      organizationId: "org_123",
    });
  });

  it("treats unlimited metered features as enabled", async () => {
    mockDb.query.plans.findMany.mockResolvedValue([
      {
        id: "plan_123",
        slug: "free",
        name: "free",
        description: null,
        price: 0,
        currency: "USD",
        interval: "monthly",
        type: "free",
        billingType: "recurring",
        isAddon: false,
        planGroup: null,
        trialDays: 0,
        providerId: "dodopayments",
        autoEnable: true,
        planFeatures: [
          {
            featureId: "feature_123",
            limitValue: null,
            resetInterval: "monthly",
            overage: "block",
            overagePrice: null,
            feature: {
              slug: "send-email",
              name: "send email",
              type: "metered",
              meterType: "consumable",
              unit: null,
            },
          },
        ],
      },
    ]);

    const res = await app.request("/", {
      method: "GET",
      headers: {
        Authorization: "Bearer owo_sk_test",
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.plans[0].features).toEqual([
      expect.objectContaining({
        slug: "send-email",
        enabled: true,
        limit: null,
        resetInterval: "monthly",
      }),
    ]);
  });

  it("canonicalizes reset intervals and exports usage-based features as chargeable", async () => {
    mockDb.query.plans.findMany.mockResolvedValue([
      {
        id: "plan_456",
        slug: "pro",
        name: "pro",
        description: null,
        price: 1000,
        currency: "USD",
        interval: "monthly",
        type: "paid",
        billingType: "recurring",
        isAddon: false,
        planGroup: null,
        trialDays: 0,
        providerId: null,
        autoEnable: false,
        planFeatures: [
          {
            featureId: "feature_metered",
            limitValue: 5000,
            resetInterval: "quarter",
            usageModel: "usage_based",
            overage: "block",
            ratingModel: "volume",
            tiers: [{ upTo: null, flatFee: 5000 }],
            overagePrice: null,
            feature: {
              slug: "agent-runs",
              name: "Agent Runs",
              type: "metered",
              meterType: "consumable",
              unit: "runs",
            },
          },
        ],
      },
    ]);

    const res = await app.request("/", {
      method: "GET",
      headers: {
        Authorization: "Bearer owo_sk_test",
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.plans[0].features).toEqual([
      expect.objectContaining({
        slug: "agent-runs",
        usageModel: "usage_based",
        limit: null,
        resetInterval: "quarterly",
        overage: "charge",
        ratingModel: "volume",
        tiers: [{ upTo: null, flatFee: 5000 }],
      }),
    ]);
  });
});
