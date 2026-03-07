import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { verifyApiKey } from "../src/lib/api-keys";

const mockDb = {
  query: {
    plans: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
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

vi.mock("../src/lib/api-keys", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/api-keys")>(
    "../src/lib/api-keys",
  );
  return {
    ...actual,
    verifyApiKey: vi.fn(),
  };
});

vi.mock("../src/lib/auth", () => ({
  auth: () => ({
    handler: () => new Response("Auth"),
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  }),
}));

vi.mock("../src/lib/webhooks", () => ({
  WebhookHandler: class {},
}));

const env = {
  DB: {},
  DB_AUTH: {},
  BETTER_AUTH_SECRET: "secret",
  BETTER_AUTH_URL: "http://localhost",
  ENCRYPTION_KEY: "test_key",
  PAYSTACK_SECRET_KEY: "sk_test",
  PAYSTACK_WEBHOOK_SECRET: "wh_secret",
};

describe("GET /api/v1/plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyApiKey).mockResolvedValue({
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

    const res = await app.request(
      "/api/v1/plans",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer owo_sk_test",
        },
      },
      env,
    );

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
});
