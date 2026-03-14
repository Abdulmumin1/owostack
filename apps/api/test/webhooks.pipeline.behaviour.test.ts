import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { handleChargeSuccess } from "../src/lib/webhooks/handlers/charge-success";
import { createWebhookRoutes } from "../src/routes/webhooks";
import type { WebhookRouteDependencies } from "../src/routes/webhooks";
import { createRouteTestApp } from "./helpers/route-harness";
import { err, ok } from "./helpers/result";

interface BillingDb {
  query: {
    organizations: { findFirst: Mock };
    providerAccounts: { findMany: Mock };
    customers: { findFirst: Mock; findMany: Mock };
    creditPurchases: { findFirst: Mock };
  };
  insert: Mock;
  update: Mock;
  run: Mock;
  select: Mock;
}

interface AuthDb {
  query: {
    organizations: { findFirst: Mock };
  };
}

const handlerHandleMock = vi.fn();
const decryptMock = vi.fn();
const verifyWebhookMock = vi.fn();
const parseWebhookEventMock = vi.fn();
const registryGetMock = vi.fn();

const billingDb: BillingDb = {
  query: {
    organizations: { findFirst: vi.fn() },
    providerAccounts: { findMany: vi.fn() },
    customers: { findFirst: vi.fn(), findMany: vi.fn() },
    creditPurchases: { findFirst: vi.fn() },
  },
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(async () => null),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => []),
    })),
  })),
  run: vi.fn(async () => ({ meta: { changes: 1 } })),
  select: vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: async () => [],
      }),
    }),
  })),
};

const authDb: AuthDb = {
  query: {
    organizations: { findFirst: vi.fn() },
  },
};

const adapterMock = {
  signatureHeaderName: "x-paystack-signature",
  verifyWebhook: verifyWebhookMock,
  parseWebhookEvent: parseWebhookEventMock,
};

const env = {
  CACHE: undefined,
  TRIAL_END_WORKFLOW: { create: vi.fn(async () => null) },
  PLAN_UPGRADE_WORKFLOW: { create: vi.fn(async () => null) },
  ENCRYPTION_KEY: "test_key",
  ENVIRONMENT: "test",
  ANALYTICS: undefined,
};

const deps: WebhookRouteDependencies = {
  getProviderRegistry: (() => ({
    get: registryGetMock,
  })) as unknown as WebhookRouteDependencies["getProviderRegistry"],
  decrypt: decryptMock as unknown as WebhookRouteDependencies["decrypt"],
  createWebhookHandler: ((params) => ({
    handle: (event: unknown) => handlerHandleMock(event, params),
  })) as WebhookRouteDependencies["createWebhookHandler"],
};

describe("Webhook route pipeline behavior", () => {
  let app: ReturnType<
    typeof createRouteTestApp<{ db: BillingDb; authDb: AuthDb }>
  >;

  beforeEach(() => {
    vi.clearAllMocks();

    app = createRouteTestApp(createWebhookRoutes(deps), {
      db: billingDb,
      authDb,
    });

    const organization = {
      id: "org_1",
      slug: "org_1",
      webhookSecret: "project_wh_secret",
      testWebhookSecret: null,
      liveWebhookSecret: null,
      testSecretKey: null,
      liveSecretKey: null,
    };

    authDb.query.organizations.findFirst.mockResolvedValue(organization);
    billingDb.query.organizations.findFirst.mockResolvedValue({
      id: "org_1",
    });
    billingDb.query.providerAccounts.findMany.mockResolvedValue([]);

    decryptMock.mockImplementation(async (input: string) => `dec_${input}`);
    registryGetMock.mockImplementation((providerId: string) =>
      providerId === "paystack" ? adapterMock : undefined,
    );

    verifyWebhookMock.mockResolvedValue(ok(true));
    parseWebhookEventMock.mockReturnValue(
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
      }),
    );

    handlerHandleMock.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
    });
  });

  it("duplicate webhook delivery dispatches twice but charge.success credit purchase is idempotent (no double top-up)", async () => {
    const processedRefs = new Set<string>();

    billingDb.query.creditPurchases.findFirst.mockImplementation(
      async () => (processedRefs.has("ref_credit_1") ? { id: "cp_1" } : null),
    );
    billingDb.query.customers.findFirst.mockResolvedValue({
      id: "cus_1",
      organizationId: "org_1",
      email: "customer@example.com",
    });

    const insertValues = vi.fn(async (payload: { paymentReference?: string }) => {
      if (payload.paymentReference) {
        processedRefs.add(payload.paymentReference);
      }
      return null;
    });
    billingDb.insert.mockImplementation(() => ({
      values: insertValues,
    }));

    parseWebhookEventMock.mockReturnValue(
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

    handlerHandleMock.mockImplementation(async (event: any, params: any) => {
      await handleChargeSuccess({
        db: billingDb,
        organizationId: params.organizationId,
        event,
        adapter: params.adapter,
        providerAccount: params.account,
        workflows: {
          trialEnd: null,
          planUpgrade: null,
        },
        cache: null,
      } as any);
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
    expect(insertValues).toHaveBeenCalledTimes(1);
  });

  it("prefers decrypted provider account webhookSecret for signature verification", async () => {
    billingDb.query.providerAccounts.findMany.mockResolvedValue([
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
    const verifyArg = verifyWebhookMock.mock.calls[0]?.[0];
    expect(verifyArg.secret).toBe("dec_enc_provider_ws");
    expect(verifyArg.headers["x-extra-header"]).toBe("extra");
    expect(decryptMock).toHaveBeenCalledWith("enc_provider_ws", "test_key");
    expect(handlerHandleMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to raw provider webhookSecret when decrypt fails", async () => {
    billingDb.query.providerAccounts.findMany.mockResolvedValue([
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

    decryptMock.mockImplementation(async (input: string) => {
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
    const verifyArg = verifyWebhookMock.mock.calls[0]?.[0];
    expect(verifyArg.secret).toBe("whsec_plain_secret");
    expect(handlerHandleMock).toHaveBeenCalledTimes(1);
  });

  it("prefers provider account matching worker environment when multiple accounts exist", async () => {
    billingDb.query.providerAccounts.findMany.mockResolvedValue([
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
    const verifyArg = verifyWebhookMock.mock.calls[0]?.[0];
    expect(verifyArg.secret).toBe("dec_enc_test_ws");
    expect(decryptMock).toHaveBeenCalledWith("enc_test_ws", "test_key");
    expect(decryptMock).not.toHaveBeenCalledWith("enc_live_ws", "test_key");
  });

  it("falls back to decrypted environment secret key when no provider secrets are configured", async () => {
    billingDb.query.providerAccounts.findMany.mockResolvedValue([]);
    authDb.query.organizations.findFirst.mockResolvedValue({
      id: "org_1",
      slug: "org_1",
      webhookSecret: null,
      testWebhookSecret: null,
      liveWebhookSecret: null,
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
    const verifyArg = verifyWebhookMock.mock.calls[0]?.[0];
    expect(verifyArg.secret).toBe("dec_enc_test_secret");
    expect(decryptMock).toHaveBeenCalledWith("enc_test_secret", "test_key");
  });

  it("acknowledges unhandled events when adapter parse fails and skips dispatch", async () => {
    parseWebhookEventMock.mockReturnValue(err("unknown event type"));

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
