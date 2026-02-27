import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { decrypt } from "../src/lib/encryption";

function ok<T>(value: T) {
  return {
    isOk: () => true,
    isErr: () => false,
    value,
  };
}

function err(message: string) {
  return {
    isOk: () => false,
    isErr: () => true,
    error: { message },
  };
}

const handlerHandleMock = vi.fn();

const adapterMock = {
  signatureHeaderName: "x-paystack-signature",
  verifyWebhook: vi.fn(),
  parseWebhookEvent: vi.fn(),
};

const mockDb: any = {
  query: {
    organizations: { findFirst: vi.fn() },
    providerAccounts: { findMany: vi.fn() },
    projects: { findFirst: vi.fn() },
  },
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(async () => null),
    })),
  })),
};

vi.mock("@owostack/db", () => ({
  createDb: () => mockDb,
  schema: {
    organizations: { id: "id" },
    projects: { organizationId: "organizationId" },
    providerAccounts: { organizationId: "organizationId", providerId: "providerId" },
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

vi.mock("../src/lib/providers", () => ({
  getProviderRegistry: vi.fn(() => ({
    get: vi.fn((providerId: string) =>
      providerId === "paystack" ? (adapterMock as any) : undefined,
    ),
  })),
  buildProviderContext: vi.fn((params: any) => params),
  deriveProviderEnvironment: vi.fn(() => "test"),
  loadProviderAccounts: vi.fn(async () => []),
  loadProviderRules: vi.fn(async () => []),
}));

vi.mock("../src/lib/encryption", () => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(),
  maskSecretKey: vi.fn(),
  generateEncryptionKey: vi.fn(),
}));

vi.mock("../src/lib/webhooks", () => ({
  WebhookHandler: class {
    handle = handlerHandleMock;
  },
}));

describe("Webhook route pipeline behavior", () => {
  const env = {
    DB: {},
    DB_AUTH: {},
    CACHE: undefined,
    TRIAL_END_WORKFLOW: { create: vi.fn(async () => null) },
    PLAN_UPGRADE_WORKFLOW: { create: vi.fn(async () => null) },
    ENCRYPTION_KEY: "test_key",
    ENVIRONMENT: "test",
    BETTER_AUTH_SECRET: "secret",
    BETTER_AUTH_URL: "http://localhost",
    PAYSTACK_SECRET_KEY: "sk_test",
    PAYSTACK_WEBHOOK_SECRET: "wh_test",
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb.query.organizations.findFirst.mockResolvedValue({ id: "org_1" });
    mockDb.query.providerAccounts.findMany.mockResolvedValue([]);
    mockDb.query.projects.findFirst.mockResolvedValue({
      id: "proj_1",
      organizationId: "org_1",
      webhookSecret: "project_wh_secret",
      testSecretKey: null,
      liveSecretKey: null,
    });

    vi.mocked(decrypt).mockImplementation(async (input: string) => `dec_${input}`);

    adapterMock.verifyWebhook.mockResolvedValue(ok(true));
    adapterMock.parseWebhookEvent.mockReturnValue(
      ok({
        type: "charge.success",
        provider: "paystack",
        customer: {
          email: "customer@example.com",
          providerCustomerId: "cus_provider_1",
        },
        payment: {
          amount: 5000,
          currency: "NGN",
          reference: "ref_123",
        },
        metadata: {},
        raw: { event: "charge.success" },
      } as any),
    );

    handlerHandleMock.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
    });
  });

  it("prefers decrypted provider account webhookSecret for signature verification", async () => {
    mockDb.query.providerAccounts.findMany.mockResolvedValue([
      {
        id: "acct_1",
        organizationId: "org_1",
        providerId: "paystack",
        credentials: { webhookSecret: "enc_provider_ws", secretKey: "enc_provider_sk" },
        environment: "test",
      },
    ]);

    const res = await app.request(
      "/webhooks/org_1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": "sig",
          "x-extra-header": "extra",
        },
        body: JSON.stringify({ event: "charge.success", data: {} }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const verifyArg = adapterMock.verifyWebhook.mock.calls[0]?.[0];
    expect(verifyArg.secret).toBe("dec_enc_provider_ws");
    expect(verifyArg.headers["x-extra-header"]).toBe("extra");

    expect(vi.mocked(decrypt)).toHaveBeenCalledWith("enc_provider_ws", "test_key");
    expect(handlerHandleMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to project webhookSecret when provider account webhookSecret is absent", async () => {
    mockDb.query.providerAccounts.findMany.mockResolvedValue([
      {
        id: "acct_1",
        organizationId: "org_1",
        providerId: "paystack",
        credentials: { secretKey: "enc_provider_sk_only" },
        environment: "test",
      },
    ]);

    mockDb.query.projects.findFirst.mockResolvedValue({
      id: "proj_1",
      organizationId: "org_1",
      webhookSecret: "project_secret_plain",
      testSecretKey: "enc_test_key",
      liveSecretKey: null,
    });

    const res = await app.request(
      "/webhooks/org_1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": "sig",
        },
        body: JSON.stringify({ event: "charge.success", data: {} }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const verifyArg = adapterMock.verifyWebhook.mock.calls[0]?.[0];
    expect(verifyArg.secret).toBe("project_secret_plain");
  });

  it("falls back to decrypted environment secret key when no webhook secrets are configured", async () => {
    mockDb.query.providerAccounts.findMany.mockResolvedValue([]);
    mockDb.query.projects.findFirst.mockResolvedValue({
      id: "proj_1",
      organizationId: "org_1",
      webhookSecret: null,
      testSecretKey: "enc_test_secret",
      liveSecretKey: null,
    });

    const res = await app.request(
      "/webhooks/org_1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": "sig",
        },
        body: JSON.stringify({ event: "charge.success", data: {} }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const verifyArg = adapterMock.verifyWebhook.mock.calls[0]?.[0];
    expect(verifyArg.secret).toBe("dec_enc_test_secret");
    expect(vi.mocked(decrypt)).toHaveBeenCalledWith("enc_test_secret", "test_key");
  });

  it("acknowledges unhandled events when adapter parse fails and skips dispatch", async () => {
    adapterMock.parseWebhookEvent.mockReturnValue(err("unknown event type"));

    const res = await app.request(
      "/webhooks/org_1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": "sig",
        },
        body: JSON.stringify({ event: "mystery.event", data: {} }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.skipped).toBe(true);
    expect(handlerHandleMock).not.toHaveBeenCalled();
  });
});
