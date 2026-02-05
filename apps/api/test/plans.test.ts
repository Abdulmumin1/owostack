import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../src/index";

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

let mockReturningPlan: any;

const mockDb = {
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(async () => [mockReturningPlan]),
    })),
  })),
  query: {
    plans: {
      findMany: vi.fn(async () => []),
    },
  },
};

vi.mock("@owostack/db", () => ({
  createDb: () => mockDb,
  schema: {
    plans: {},
  },
}));

const env = {
  DB: {},
  BETTER_AUTH_SECRET: "secret",
  BETTER_AUTH_URL: "http://localhost",
  ENCRYPTION_KEY: "test_key",
  PAYSTACK_SECRET_KEY: "sk_test",
  PAYSTACK_WEBHOOK_SECRET: "wh_secret",
} as any;

describe("Plans API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReturningPlan = undefined;
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
