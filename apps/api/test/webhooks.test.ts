import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { Result } from "better-result";
import { app } from "../src/index";

// =============================================================================
// Mocks
// =============================================================================

const mockVerify = vi.fn();
const mockHandle = vi.fn();

const mockOrg = {
  id: "org-123",
  name: "Test Org",
  slug: "test-org",
  webhookSecret: "wh_secret",
  testSecretKey: "encrypted_key",
  testWebhookSecret: "wh_secret",
};

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue([]),
  query: {
    organizations: { findFirst: vi.fn().mockResolvedValue(mockOrg) },
    providerAccounts: { findMany: vi.fn().mockResolvedValue([]) },
    customers: { findFirst: vi.fn() },
    plans: { findFirst: vi.fn() },
  },
};

vi.mock("@owostack/db", () => ({
  createDb: () => mockDb,
  schema: {
    events: {},
    organizations: { id: {}, organizationId: {} },
    providerAccounts: { organizationId: {}, providerId: {} },
    customers: {},
    plans: {},
    subscriptions: {},
  },
}));

vi.mock("../src/lib/paystack", () => ({
  PaystackClient: class {},
}));

vi.mock("../src/lib/entitlements", () => ({
  EntitlementService: class {},
}));

vi.mock("../src/lib/webhooks", () => ({
  WebhookHandler: class {
    verify = mockVerify;
    handle = mockHandle;
  },
}));

vi.mock("../src/lib/auth", () => ({
  auth: () => ({
    handler: () => new Response("Auth"),
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  }),
}));

// Mock KV
const mockKv = { get: vi.fn() };

// =============================================================================
// Tests
// =============================================================================

describe("Webhooks API", () => {
  const secret = "wh_secret";
  const orgId = "org-123";

  const mockEnv: {
    DB: Record<string, unknown>;
    API_KEYS: typeof mockKv;
    PAYSTACK_SECRET_KEY: string;
    PAYSTACK_WEBHOOK_SECRET: string;
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    ENCRYPTION_KEY: string;
    ENVIRONMENT: string;
  } = {
    DB: {},
    API_KEYS: mockKv,
    PAYSTACK_SECRET_KEY: "sk_test",
    PAYSTACK_WEBHOOK_SECRET: secret,
    BETTER_AUTH_SECRET: "secret",
    BETTER_AUTH_URL: "http://localhost",
    ENCRYPTION_KEY: "test_key",
    ENVIRONMENT: "test",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.query.organizations.findFirst.mockResolvedValue(mockOrg);
  });

  it("should reject requests without signature", async () => {
    const res = await app.request(
      `/webhooks/${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ event: "test" }),
        headers: { "Content-Type": "application/json" },
      },
      mockEnv,
    );

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("WebhookError");
  });

  it("should return 404 for unknown organization", async () => {
    mockDb.query.organizations.findFirst.mockResolvedValue(null);

    const res = await app.request(
      `/webhooks/unknown-org`,
      {
        method: "POST",
        body: JSON.stringify({ event: "test" }),
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": "some_signature",
        },
      },
      mockEnv,
    );

    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("not found");
  });

  it("should reject requests with invalid signature", async () => {
    mockVerify.mockResolvedValue(
      Result.err({
        _tag: "WebhookError",
        reason: "invalid_signature",
        message: "Invalid",
      }),
    );

    const res = await app.request(
      `/webhooks/${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ event: "test" }),
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": "invalid_signature",
        },
      },
      mockEnv,
    );

    expect(res.status).toBe(401);
  });

  it("should return 200 for valid signature", async () => {
    mockVerify.mockResolvedValue(Result.ok(true));
    mockHandle.mockResolvedValue(Result.ok(true));

    const payload = JSON.stringify({
      event: "charge.success",
      data: { id: 1 },
    });
    const signature = createHmac("sha512", secret)
      .update(payload)
      .digest("hex");

    const res = await app.request(
      `/webhooks/${orgId}`,
      {
        method: "POST",
        body: payload,
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": signature,
        },
      },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; received: boolean };
    expect(json.success).toBe(true);
    expect(json.received).toBe(true);
  });

  it("should use the organization-specific webhook secret", async () => {
    // Using a different secret for this org
    const orgSecret = "org_specific_secret";
    mockDb.query.organizations.findFirst.mockResolvedValue({
      ...mockOrg,
      testWebhookSecret: orgSecret,
    });

    mockVerify.mockResolvedValue(Result.ok(true));
    mockHandle.mockResolvedValue(Result.ok(true));

    const payload = JSON.stringify({ event: "test" });
    const signature = createHmac("sha512", orgSecret)
      .update(payload)
      .digest("hex");

    const res = await app.request(
      `/webhooks/${orgId}`,
      {
        method: "POST",
        body: payload,
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": signature,
        },
      },
      mockEnv,
    );

    expect(res.status).toBe(200);
  });
});
