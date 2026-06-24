import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@owostack/db";
import { createWebhookRoutes } from "../../../src/routes/webhooks";
import type { WebhookRouteDependencies } from "../../../src/routes/webhooks";
import { createRouteTestApp } from "../../helpers/route-harness";
import { ok } from "../../helpers/result";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { RUNTIME_ROUTE_ENV } from "../helpers/catalog-runtime";
import { insertOrganization } from "../helpers/workflow-runtime";

describe("Webhook route runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let verifiedSecrets: string[];
  let app: ReturnType<
    typeof createRouteTestApp<{
      db: ReturnType<typeof createRuntimeBusinessDb>["db"];
      authDb: ReturnType<typeof createRuntimeBusinessDb>["db"];
    }>
  >;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    verifiedSecrets = [];

    await insertOrganization(businessDb.d1, {
      id: "org_webhooks",
      slug: "webhooks",
    });

    const adapter = {
      signatureHeaderName: "x-paystack-signature",
      verifyWebhook: async ({ secret }: { secret: string }) => {
        verifiedSecrets.push(secret);
        return ok(true);
      },
      parseWebhookEvent: ({ payload }: { payload: Record<string, unknown> }) =>
        ok({
          type: String(payload.event || "charge.success"),
          provider: "paystack",
          metadata: {},
          raw: payload,
        }),
    };

    const deps: WebhookRouteDependencies = {
      getProviderRegistry: (() => ({
        get: (providerId: string) =>
          providerId === "paystack" ? adapter : undefined,
      })) as WebhookRouteDependencies["getProviderRegistry"],
      decrypt: (async (value: string) => `dec_${value}`) as WebhookRouteDependencies["decrypt"],
      createWebhookHandler: (() => ({
        handle: async () => ok(true),
      })) as WebhookRouteDependencies["createWebhookHandler"],
    };

    app = createRouteTestApp(createWebhookRoutes(deps), {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  async function postWebhook() {
    return app.request(
      "/webhooks/webhooks",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": "sig",
        },
        body: JSON.stringify({ event: "charge.success", data: {} }),
      },
      {
        ...RUNTIME_ROUTE_ENV,
        ENCRYPTION_KEY: "test_key",
        ENVIRONMENT: "test",
      },
    );
  }

  it("falls back to the project webhook secret when provider accounts are absent", async () => {
    await businessDb.db.insert(schema.projects).values({
      id: "project_test_webhook",
      organizationId: "org_webhooks",
      name: "Test Project",
      slug: "test-project",
      testWebhookSecret: "project_wh_secret",
      activeEnvironment: "test",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const response = await postWebhook();

    expect(response.status).toBe(200);
    expect(verifiedSecrets).toEqual(["project_wh_secret"]);
  });

  it("falls back to the decrypted project secret key when no webhook secret is configured", async () => {
    await businessDb.db.insert(schema.projects).values({
      id: "project_test_key",
      organizationId: "org_webhooks",
      name: "Test Project",
      slug: "test-project",
      testSecretKey: "enc_project_test_key",
      activeEnvironment: "test",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const response = await postWebhook();

    expect(response.status).toBe(200);
    expect(verifiedSecrets).toEqual(["dec_enc_project_test_key"]);
  });
});
