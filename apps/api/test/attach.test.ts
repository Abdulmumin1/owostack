import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../src/index";
import { verifyApiKey } from "../src/lib/api-keys";
import { decrypt } from "../src/lib/encryption";

// =============================================================================
// Mocks
// =============================================================================

const mockDb = {
  query: {
    projects: { findFirst: vi.fn() },
    plans: { findFirst: vi.fn() },
  },
};

vi.mock("@owostack/db", () => ({
  createDb: () => mockDb,
  schema: {
    projects: { organizationId: "organizationId" },
    plans: {
      organizationId: "organizationId",
      slug: "slug",
    },
  },
}));

vi.mock("../src/lib/api-keys", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/api-keys")>(
    "../src/lib/api-keys",
  );
  return {
    ...actual,
    verifyApiKey: vi.fn(),
  };
});

vi.mock("../src/lib/encryption", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/encryption")>(
    "../src/lib/encryption",
  );
  return {
    ...actual,
    decrypt: vi.fn(),
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

vi.mock("../src/lib/entitlements", () => ({
  EntitlementService: class {},
}));

vi.mock("../src/lib/webhooks", () => ({
  WebhookHandler: class {},
}));

// Type definitions
type ErrorResponse = {
  success: boolean;
  error: string | { code: string };
};

type HealthResponse = {
  status: string;
};

const mockEnv: {
  DB: Record<string, unknown>;
  PAYSTACK_SECRET_KEY: string;
  PAYSTACK_WEBHOOK_SECRET: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  ENCRYPTION_KEY: string;
} = {
  DB: {},
  PAYSTACK_SECRET_KEY: "sk_test",
  PAYSTACK_WEBHOOK_SECRET: "wh_secret",
  BETTER_AUTH_SECRET: "secret",
  BETTER_AUTH_URL: "http://localhost",
  ENCRYPTION_KEY: "test_key",
};

// =============================================================================
// Tests
// =============================================================================

describe("POST /v1/attach", () => {
  const validApiKey = "owo_sk_1234567890abcdef";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyApiKey).mockResolvedValue({
      id: "key_123",
      organizationId: "org_123",
    });
    mockDb.query.projects.findFirst.mockResolvedValue({
      id: "proj_123",
      organizationId: "org_123",
      activeEnvironment: "test",
      liveSecretKey: null,
      testSecretKey: "encrypted_test_key",
      webhookSecret: "wh_secret",
    });
    mockDb.query.plans.findFirst.mockResolvedValue(null);
    vi.mocked(decrypt).mockResolvedValue("sk_decrypted");

    vi.stubGlobal("fetch", vi.fn());
  });

  it("should reject requests without API key", async () => {
    const res = await app.request(
      "/v1/attach",
      {
        method: "POST",
        body: JSON.stringify({ email: "test@example.com", amount: 5000 }),
        headers: { "Content-Type": "application/json" },
      },
      mockEnv,
    );

    expect(res.status).toBe(401);
    const json = (await res.json()) as ErrorResponse;
    expect(json.success).toBe(false);
    expect(json.error).toBe("Missing API Key");
  });

  it("should reject invalid API key", async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce(null);

    const res = await app.request(
      "/v1/attach",
      {
        method: "POST",
        body: JSON.stringify({ customer: "test@example.com", product: "pro" }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${validApiKey}`,
        },
      },
      mockEnv,
    );

    expect(res.status).toBe(401);
    const json = (await res.json()) as ErrorResponse;
    expect(json.success).toBe(false);
    expect(json.error).toBe("Invalid API Key");
  });

  it("should validate input with Zod", async () => {
    const res = await app.request(
      "/v1/attach",
      {
        method: "POST",
        body: JSON.stringify({ customer: "test@example.com" }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${validApiKey}`,
        },
      },
      mockEnv,
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
      "/v1/attach",
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
      mockEnv,
    );

    expect(res.status).toBe(404);
    const json = (await res.json()) as ErrorResponse;
    expect(json.success).toBe(false);
    expect(json.error).toContain("Plan 'pro' not found");
  });
});

describe("Health Check", () => {
  it("should return healthy status", async () => {
    const res = await app.request(
      "/",
      {
        method: "GET",
      },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as HealthResponse;
    expect(json.status).toBe("healthy");
  });
});
