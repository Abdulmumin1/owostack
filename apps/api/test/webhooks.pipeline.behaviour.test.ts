import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { app } from "../src/index";
import { decrypt } from "../src/lib/encryption";
import { handleChargeSuccess } from "../src/lib/webhooks/handlers/charge-success";
import { topUpScopedBalance } from "../src/lib/addon-credits";

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

interface MockDb {
  query: {
    organizations: { findFirst: Mock };
    providerAccounts: { findMany: Mock };
    customers: { findFirst: Mock };
    creditPurchases: { findFirst: Mock };
  };
  insert: Mock;
}

const adapterMock = {
  signatureHeaderName: "x-paystack-signature",
  verifyWebhook: vi.fn(),
  parseWebhookEvent: vi.fn(),
};

const mockDb: MockDb = {
  query: {
    organizations: { findFirst: vi.fn() },
    providerAccounts: { findMany: vi.fn() },
    customers: { findFirst: vi.fn() },
    creditPurchases: { findFirst: vi.fn() },
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
    providerAccounts: {
      organizationId: "organizationId",
      providerId: "providerId",
    },
    customers: { id: "id", organizationId: "organizationId", email: "email" },
    creditPurchases: { paymentReference: "paymentReference" },
    events: { id: "id" },
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
      providerId === "paystack" ? adapterMock : undefined,
    ),
  })),
  buildProviderContext: vi.fn((params: unknown) => params),
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

vi.mock("../src/lib/addon-credits", () => ({
  topUpScopedBalance: vi.fn(async () => null),
  getScopedBalance: vi.fn(async () => 0),
  deductScopedBalance: vi.fn(async () => false),
}));

vi.mock("../src/lib/webhooks", () => ({
  WebhookHandler: class {
    handle = handlerHandleMock;
  },
}));

interface Env {
  DB: unknown;
  DB_AUTH: unknown;
  CACHE: undefined;
  TRIAL_END_WORKFLOW: { create: Mock };
  PLAN_UPGRADE_WORKFLOW: { create: Mock };
  ENCRYPTION_KEY: string;
  ENVIRONMENT: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  PAYSTACK_SECRET_KEY: string;
  PAYSTACK_WEBHOOK_SECRET: string;
}

describe("Webhook route pipeline behavior", () => {
  const env: Env = {
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
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb.query.organizations.findFirst.mockResolvedValue({
      id: "org_1",
      webhookSecret: "project_wh_secret",
      testSecretKey: null,
      liveSecretKey: null,
    });
    mockDb.query.providerAccounts.findMany.mockResolvedValue([]);

    vi.mocked(decrypt).mockImplementation(
      async (input: string) => `dec_${input}`,
    );

    adapterMock.verifyWebhook.mockResolvedValue(ok(true));
    interface WebhookEvent {
      type: string;
      provider: string;
      customer: {
        email: string;
        providerCustomerId: string;
      };
      payment: {
        amount: number;
        currency: string;
        reference: string;
      };
      metadata: Record<string, unknown>;
      raw: { event: string };
    }
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
      } as WebhookEvent),
    );

    handlerHandleMock.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
    });
  });

  it("duplicate webhook delivery dispatches twice but charge.success credit purchase is idempotent (no double top-up)", async () => {
    const processedRefs = new Set<string>();

    mockDb.query.creditPurchases.findFirst.mockImplementation(
      async ({ where }: { where?: unknown }) => {
        void where;
        return processedRefs.has("ref_credit_1") ? { id: "cp_1" } : null;
      },
    );
    mockDb.query.customers.findFirst.mockResolvedValue({
      id: "cus_1",
      organizationId: "org_1",
      email: "customer@example.com",
    });

    // Capture credit purchase ledger writes
    interface CreditPurchasePayload {
      paymentReference?: string;
    }
    const insertValues = vi.fn(async (payload: CreditPurchasePayload) => {
      if (payload?.paymentReference)
        processedRefs.add(payload.paymentReference);
      return null;
    });
    mockDb.insert.mockImplementation(() => ({
      values: insertValues,
    }));

    adapterMock.parseWebhookEvent.mockReturnValue(
      ok({
        type: "charge.success",
        provider: "paystack",
        customer: {
          email: "customer@example.com",
          providerCustomerId: "cus_provider_1",
        },
        payment: {
          amount: 7500,
          currency: "USD",
          reference: "ref_credit_1",
        },
        checkout: {
          lineItems: [{ quantity: 2 }],
        },
        metadata: {
          type: "credit_purchase",
          credit_pack_id: "pack_1",
          credit_system_id: "cs_1",
          credits: "20",
          credits_per_pack: "20",
          quantity: "1",
        },
        raw: { event: "charge.success" },
      }),
    );

    interface WebhookEventData {
      type: string;
      provider: string;
      customer: { email: string; providerCustomerId: string };
      payment: { amount: number; currency: string; reference: string };
      checkout?: { lineItems: { quantity: number }[] };
      metadata: Record<string, unknown>;
      raw: { event: string };
    }

    interface HandlerContext {
      db: MockDb;
      organizationId: string;
      event: WebhookEventData;
      adapter: null;
      providerAccount: null;
      workflows: { trialEnd: null; planUpgrade: null };
      cache: null;
    }

    handlerHandleMock.mockImplementation(async (event: WebhookEventData) => {
      await handleChargeSuccess({
        db: mockDb,
        organizationId: "org_1",
        event,
        adapter: null,
        providerAccount: null,
        workflows: { trialEnd: null, planUpgrade: null },
        cache: null,
      } as unknown as HandlerContext);
      return { isErr: () => false, isOk: () => true };
    });

    const req = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": "sig",
      },
      body: JSON.stringify({ event: "charge.success", data: {} }),
    };

    const res1 = await app.request("/webhooks/org_1", req, env);
    const res2 = await app.request("/webhooks/org_1", req, env);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    expect(handlerHandleMock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(topUpScopedBalance)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(topUpScopedBalance)).toHaveBeenCalledWith(
      mockDb,
      "cus_1",
      "cs_1",
      40,
    );
    expect(insertValues).toHaveBeenCalledTimes(1);
  });

  it("prefers decrypted provider account webhookSecret for signature verification", async () => {
    mockDb.query.providerAccounts.findMany.mockResolvedValue([
      {
        id: "acct_1",
        organizationId: "org_1",
        providerId: "paystack",
        credentials: {
          webhookSecret: "enc_provider_ws",
          secretKey: "enc_provider_sk",
        },
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

    expect(vi.mocked(decrypt)).toHaveBeenCalledWith(
      "enc_provider_ws",
      "test_key",
    );
    expect(handlerHandleMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to raw provider webhookSecret when decrypt fails", async () => {
    mockDb.query.providerAccounts.findMany.mockResolvedValue([
      {
        id: "acct_1",
        organizationId: "org_1",
        providerId: "paystack",
        credentials: {
          webhookSecret: "whsec_plain_secret",
          secretKey: "enc_provider_sk",
        },
        environment: "test",
      },
    ]);

    vi.mocked(decrypt).mockImplementation(async (input: string) => {
      if (input === "whsec_plain_secret") {
        throw new Error("decrypt failed");
      }
      return `dec_${input}`;
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
    expect(verifyArg.secret).toBe("whsec_plain_secret");
    expect(handlerHandleMock).toHaveBeenCalledTimes(1);
  });

  it("prefers provider account matching worker environment when multiple accounts exist", async () => {
    mockDb.query.providerAccounts.findMany.mockResolvedValue([
      {
        id: "acct_live",
        organizationId: "org_1",
        providerId: "paystack",
        credentials: {
          webhookSecret: "enc_live_ws",
          secretKey: "enc_live_sk",
        },
        environment: "live",
      },
      {
        id: "acct_test",
        organizationId: "org_1",
        providerId: "paystack",
        credentials: {
          webhookSecret: "enc_test_ws",
          secretKey: "enc_test_sk",
        },
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
        },
        body: JSON.stringify({ event: "charge.success", data: {} }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const verifyArg = adapterMock.verifyWebhook.mock.calls[0]?.[0];
    expect(verifyArg.secret).toBe("dec_enc_test_ws");
    expect(vi.mocked(decrypt)).toHaveBeenCalledWith("enc_test_ws", "test_key");
    expect(vi.mocked(decrypt)).not.toHaveBeenCalledWith(
      "enc_live_ws",
      "test_key",
    );
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

    mockDb.query.organizations.findFirst.mockResolvedValue({
      id: "org_1",
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
    mockDb.query.organizations.findFirst.mockResolvedValue({
      id: "org_1",
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
    expect(vi.mocked(decrypt)).toHaveBeenCalledWith(
      "enc_test_secret",
      "test_key",
    );
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
    const body = (await res.json()) as { success: boolean; skipped: boolean };
    expect(body.success).toBe(true);
    expect(body.skipped).toBe(true);
    expect(handlerHandleMock).not.toHaveBeenCalled();
  });
});
