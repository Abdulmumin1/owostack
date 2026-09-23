import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderAccount } from "@owostack/adapters";
import { paystackAdapter } from "@owostack/adapters";
import {
  createWebhookRoutes,
  type WebhookRouteDependencies,
} from "../../../src/routes/webhooks";
import { getProviderRegistry } from "../../../src/lib/providers";
import { createRouteTestApp } from "../../helpers/route-harness";
import { ok } from "../../helpers/result";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { RUNTIME_ROUTE_ENV } from "../helpers/catalog-runtime";
import {
  insertOrganization,
  insertProviderAccount,
} from "../helpers/workflow-runtime";

/**
 * Real webhook routes, real Paystack adapter (HMAC-SHA512 verification), real
 * D1. Only the downstream WebhookHandler is replaced with a recorder so we can
 * assert which organization and account an event was dispatched to.
 */

const MANAGED_PAYSTACK_KEY = "sk_test_owostack_managed_paystack";
const MANAGED_SECRET = JSON.stringify({
  paystack: { secretKey: MANAGED_PAYSTACK_KEY },
});

async function paystackSignature(secret: string, body: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function chargeSuccess(metadata: Record<string, unknown> | null) {
  return JSON.stringify({
    event: "charge.success",
    data: {
      reference: "ref_sandbox_1",
      amount: 500000,
      currency: "NGN",
      customer: { email: "buyer@example.com", customer_code: "CUS_1" },
      metadata,
    },
  });
}

describe("Managed sandbox webhooks", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let dispatched: Array<{
    organizationId: string;
    accountId: string | null;
    secretKey: unknown;
    eventType: string;
  }>;
  let app: ReturnType<typeof createRouteTestApp<{ db: any; authDb: any }>>;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    dispatched = [];

    await insertOrganization(businessDb.d1, {
      id: "org_alpha",
      slug: "alpha",
    });
    await insertOrganization(businessDb.d1, { id: "org_beta", slug: "beta" });

    const deps: Partial<WebhookRouteDependencies> = {
      getProviderRegistry,
      createWebhookHandler: (({
        organizationId,
        account,
      }: {
        organizationId: string;
        account: ProviderAccount | undefined;
      }) => ({
        handle: async (event: any) => {
          dispatched.push({
            organizationId,
            accountId: account?.id ?? null,
            secretKey: account?.credentials.secretKey,
            eventType: event.type,
          });
          return ok(true);
        },
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

  async function post(
    path: string,
    body: string,
    signature: string,
    env: Record<string, unknown> = {
      ...RUNTIME_ROUTE_ENV,
      ENVIRONMENT: "test",
      MANAGED_SANDBOX_PROVIDERS: MANAGED_SECRET,
    },
  ) {
    return app.request(
      path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": signature,
        },
        body,
      },
      env,
    );
  }

  describe("POST /webhooks/sandbox/{provider}", () => {
    it("verifies with the managed secret and routes to the organization named in metadata", async () => {
      const body = chargeSuccess({ organization_id: "org_alpha" });
      const response = await post(
        "/webhooks/sandbox/paystack",
        body,
        await paystackSignature(MANAGED_PAYSTACK_KEY, body),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, received: true });
      expect(dispatched).toEqual([
        {
          organizationId: "org_alpha",
          accountId: "managed_sandbox_paystack",
          secretKey: MANAGED_PAYSTACK_KEY,
          eventType: "charge.success",
        },
      ]);
    });

    it("accepts an organization slug in metadata and mirrors the org into the billing DB", async () => {
      const body = chargeSuccess({ organization_id: "beta" });
      const response = await post(
        "/webhooks/sandbox/paystack",
        body,
        await paystackSignature(MANAGED_PAYSTACK_KEY, body),
      );

      expect(response.status).toBe(200);
      expect(dispatched.map((d) => d.organizationId)).toEqual(["org_beta"]);
    });

    it("rejects payloads not signed by the managed secret before reading any org data", async () => {
      const body = chargeSuccess({ organization_id: "org_alpha" });
      const response = await post(
        "/webhooks/sandbox/paystack",
        body,
        await paystackSignature("sk_test_somebody_elses_key", body),
      );

      expect(response.status).toBe(401);
      expect(dispatched).toEqual([]);
    });

    it("acknowledges and drops events that carry no organization metadata", async () => {
      const body = chargeSuccess(null);
      const response = await post(
        "/webhooks/sandbox/paystack",
        body,
        await paystackSignature(MANAGED_PAYSTACK_KEY, body),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        skipped: true,
        reason: "unrouted",
      });
      expect(dispatched).toEqual([]);
    });

    it("acknowledges and drops events for organizations that no longer exist", async () => {
      const body = chargeSuccess({ organization_id: "org_deleted" });
      const response = await post(
        "/webhooks/sandbox/paystack",
        body,
        await paystackSignature(MANAGED_PAYSTACK_KEY, body),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        skipped: true,
        reason: "organization_not_found",
      });
      expect(dispatched).toEqual([]);
    });

    it("is not exposed on the live worker", async () => {
      const body = chargeSuccess({ organization_id: "org_alpha" });
      const response = await post(
        "/webhooks/sandbox/paystack",
        body,
        await paystackSignature(MANAGED_PAYSTACK_KEY, body),
        {
          ...RUNTIME_ROUTE_ENV,
          ENVIRONMENT: "live",
          MANAGED_SANDBOX_PROVIDERS: MANAGED_SECRET,
        },
      );

      expect(response.status).toBe(404);
      expect(dispatched).toEqual([]);
    });

    it("returns 404 for providers Owostack does not manage in sandbox", async () => {
      const body = chargeSuccess({ organization_id: "org_alpha" });
      const response = await post(
        "/webhooks/sandbox/stripe",
        body,
        "sig",
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /webhooks/{organizationId}/{provider} on the sandbox worker", () => {
    it("falls back to the managed secret when the organization has no credentials of its own", async () => {
      const body = chargeSuccess({ organization_id: "org_alpha" });
      const response = await post(
        "/webhooks/alpha/paystack",
        body,
        await paystackSignature(MANAGED_PAYSTACK_KEY, body),
      );

      expect(response.status).toBe(200);
      expect(dispatched).toEqual([
        {
          organizationId: "org_alpha",
          accountId: "managed_sandbox_paystack",
          secretKey: MANAGED_PAYSTACK_KEY,
          eventType: "charge.success",
        },
      ]);
    });

    it("keeps using the organization's own test credentials when present", async () => {
      await insertProviderAccount({
        db: businessDb.d1,
        id: "acct_alpha_paystack_test",
        organizationId: "org_alpha",
        providerId: "paystack",
        environment: "test",
        secretKey: "sk_test_alpha_own",
      });

      const body = chargeSuccess({ organization_id: "org_alpha" });

      const managedSigned = await post(
        "/webhooks/alpha/paystack",
        body,
        await paystackSignature(MANAGED_PAYSTACK_KEY, body),
      );
      expect(managedSigned.status).toBe(401);

      const ownSigned = await post(
        "/webhooks/alpha/paystack",
        body,
        await paystackSignature("sk_test_alpha_own", body),
      );
      expect(ownSigned.status).toBe(200);
      expect(dispatched.map((d) => d.accountId)).toEqual([
        "acct_alpha_paystack_test",
      ]);
    });

    it("still reports a missing secret when nothing is managed and nothing is configured", async () => {
      const body = chargeSuccess({ organization_id: "org_alpha" });
      const response = await post(
        "/webhooks/alpha/paystack",
        body,
        await paystackSignature(MANAGED_PAYSTACK_KEY, body),
        { ...RUNTIME_ROUTE_ENV, ENVIRONMENT: "test" },
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Webhook secret not configured",
      });
    });
  });

  it("uses the real Paystack adapter registered in the provider registry", () => {
    expect(getProviderRegistry().get("paystack")).toBe(paystackAdapter);
  });
});
