import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCheckoutRoute,
  type CheckoutDependencies,
} from "../src/routes/api/checkout";
import { createHealthRoute } from "../src/routes/health";
import { createRouteTestApp } from "./helpers/route-harness";
import { err } from "./helpers/result";

type ErrorResponse = {
  success: boolean;
  error: string | { code: string };
};

type HealthResponse = {
  status: string;
};

describe("POST /v1/attach", () => {
  const validApiKey = "owo_sk_1234567890abcdef";
  const mockDb = {
    query: {
      plans: { findFirst: vi.fn() },
    },
  };
  const verifyApiKeyMock = vi.fn();
  const deps: CheckoutDependencies = {
    verifyApiKey:
      verifyApiKeyMock as unknown as CheckoutDependencies["verifyApiKey"],
    resolveOrCreateCustomer:
      vi.fn() as unknown as CheckoutDependencies["resolveOrCreateCustomer"],
    executeSwitch: vi.fn() as unknown as CheckoutDependencies["executeSwitch"],
    provisionEntitlements:
      vi.fn() as unknown as CheckoutDependencies["provisionEntitlements"],
    hasPaymentMethod:
      vi.fn() as unknown as CheckoutDependencies["hasPaymentMethod"],
    ensurePlanSynced:
      vi.fn() as unknown as CheckoutDependencies["ensurePlanSynced"],
    resolveProvider: vi.fn(() =>
      err("no provider"),
    ) as unknown as CheckoutDependencies["resolveProvider"],
    getProviderRegistry: vi.fn(
      () => new Map(),
    ) as unknown as CheckoutDependencies["getProviderRegistry"],
    buildProviderContext: vi.fn(
      (context) => context,
    ) as unknown as CheckoutDependencies["buildProviderContext"],
    deriveProviderEnvironment: vi.fn(
      () => "test",
    ) as unknown as CheckoutDependencies["deriveProviderEnvironment"],
    loadProviderAccounts: vi.fn(
      async () => [],
    ) as unknown as CheckoutDependencies["loadProviderAccounts"],
    loadProviderRules: vi.fn(
      async () => [],
    ) as unknown as CheckoutDependencies["loadProviderRules"],
  };

  const app = createRouteTestApp(createCheckoutRoute(deps), {
    db: mockDb,
    authDb: {},
  });

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
    mockDb.query.plans.findFirst.mockResolvedValue(null);
  });

  it("should reject requests without API key", async () => {
    const res = await app.request(
      "/attach",
      {
        method: "POST",
        body: JSON.stringify({ email: "test@example.com", amount: 5000 }),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );

    expect(res.status).toBe(401);
    const json = (await res.json()) as ErrorResponse;
    expect(json.success).toBe(false);
    expect(json.error).toBe("Missing API Key");
  });

  it("should reject invalid API key", async () => {
    verifyApiKeyMock.mockResolvedValueOnce(null);

    const res = await app.request(
      "/attach",
      {
        method: "POST",
        body: JSON.stringify({ customer: "test@example.com", product: "pro" }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${validApiKey}`,
        },
      },
      env,
    );

    expect(res.status).toBe(401);
    const json = (await res.json()) as ErrorResponse;
    expect(json.success).toBe(false);
    expect(json.error).toBe("Invalid API Key");
  });

  it("should validate input with Zod", async () => {
    const res = await app.request(
      "/attach",
      {
        method: "POST",
        body: JSON.stringify({ customer: "test@example.com" }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${validApiKey}`,
        },
      },
      env,
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as ErrorResponse;
    expect(json.success).toBe(false);
    expect(json.error).toEqual(
      expect.objectContaining({ code: "ValidationError" }),
    );
  });

  it("should return 404 when requested plan is missing", async () => {
    const res = await app.request(
      "/attach",
      {
        method: "POST",
        body: JSON.stringify({
          customer: "test@example.com",
          product: "pro",
        }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${validApiKey}`,
        },
      },
      env,
    );

    expect(res.status).toBe(404);
    const json = (await res.json()) as ErrorResponse;
    expect(json.success).toBe(false);
    expect(json.error).toContain("Plan 'pro' not found");
  });
});

describe("Health Check", () => {
  const app = createRouteTestApp(createHealthRoute(), {});

  it("should return healthy status", async () => {
    const res = await app.request("/", { method: "GET" });

    expect(res.status).toBe(200);
    const json = (await res.json()) as HealthResponse;
    expect(json.status).toBe("healthy");
  });
});
