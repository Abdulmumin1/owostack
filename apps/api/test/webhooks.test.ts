import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWebhookRoutes } from "../src/routes/webhooks";
import type { WebhookRouteDependencies } from "../src/routes/webhooks";
import { createRouteTestApp } from "./helpers/route-harness";
import { err, ok } from "./helpers/result";

describe("Webhooks API", () => {
  const handlerHandleMock = vi.fn();
  const decryptMock = vi.fn(async (value: string) => value);
  const registryGetMock = vi.fn();

  const billingDb = {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(async () => null),
      })),
    })),
    query: {
      organizations: { findFirst: vi.fn() },
      providerAccounts: { findMany: vi.fn() },
    },
  };

  const authDb = {
    query: {
      organizations: { findFirst: vi.fn() },
    },
  };

  const secret = "wh_secret";
  const orgId = "org-123";
  const mockOrg = {
    id: orgId,
    name: "Test Org",
    slug: "test-org",
    webhookSecret: secret,
    testSecretKey: "encrypted_key",
    testWebhookSecret: secret,
    liveWebhookSecret: null,
    liveSecretKey: null,
  };

  const adapter = {
    signatureHeaderName: "x-paystack-signature",
    verifyWebhook: vi.fn(
      async ({
        signature,
        payload,
        secret,
      }: {
        signature: string;
        payload: string;
        secret: string;
      }) => {
        const expected = createHmac("sha512", secret).update(payload).digest("hex");
        return expected === signature ? ok(true) : err("invalid_signature");
      },
    ),
    parseWebhookEvent: vi.fn(
      ({ payload }: { payload: Record<string, unknown> }) =>
        ok({
          type: String(payload.event || "unknown"),
          provider: "paystack",
          metadata: {},
          raw: payload,
          payment: undefined,
        }),
    ),
  };

  const deps: WebhookRouteDependencies = {
    getProviderRegistry: (() => ({
      get: registryGetMock,
    })) as unknown as WebhookRouteDependencies["getProviderRegistry"],
    decrypt: decryptMock as unknown as WebhookRouteDependencies["decrypt"],
    createWebhookHandler: (() => ({
      handle: handlerHandleMock,
    })) as WebhookRouteDependencies["createWebhookHandler"],
  };

  const mockEnv = {
    ENCRYPTION_KEY: "test_key",
    ENVIRONMENT: "test",
    CACHE: undefined,
    TRIAL_END_WORKFLOW: { create: vi.fn(async () => null) },
    PLAN_UPGRADE_WORKFLOW: { create: vi.fn(async () => null) },
    ANALYTICS: undefined,
  };

  let app: ReturnType<
    typeof createRouteTestApp<{ db: typeof billingDb; authDb: typeof authDb }>
  >;

  beforeEach(() => {
    vi.clearAllMocks();

    app = createRouteTestApp(createWebhookRoutes(deps), {
      db: billingDb,
      authDb,
    });

    authDb.query.organizations.findFirst.mockResolvedValue(mockOrg);
    billingDb.query.organizations.findFirst.mockResolvedValue({ id: orgId });
    billingDb.query.providerAccounts.findMany.mockResolvedValue([]);
    registryGetMock.mockImplementation((providerId: string) =>
      providerId === "paystack" ? adapter : undefined,
    );
    handlerHandleMock.mockResolvedValue(ok(true));
  });

  it("rejects requests without signature", async () => {
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

  it("returns 404 for unknown organization", async () => {
    authDb.query.organizations.findFirst.mockResolvedValue(null);

    const res = await app.request(
      "/webhooks/unknown-org",
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

  it("rejects requests with invalid signature", async () => {
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
    expect(handlerHandleMock).not.toHaveBeenCalled();
  });

  it("returns 200 for a valid signature", async () => {
    const payload = JSON.stringify({
      event: "charge.success",
      data: { id: 1 },
    });
    const signature = createHmac("sha512", secret).update(payload).digest("hex");

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
    expect(handlerHandleMock).toHaveBeenCalledTimes(1);
  });

  it("uses the organization-specific webhook secret", async () => {
    const orgSecret = "org_specific_secret";
    authDb.query.organizations.findFirst.mockResolvedValue({
      ...mockOrg,
      testWebhookSecret: orgSecret,
    });

    const payload = JSON.stringify({ event: "test" });
    const signature = createHmac("sha512", orgSecret).update(payload).digest("hex");

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
    expect(handlerHandleMock).toHaveBeenCalledTimes(1);
  });
});
