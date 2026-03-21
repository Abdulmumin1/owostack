import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, eq, or } from "drizzle-orm";
import { schema } from "@owostack/db";
import type { ProviderAccount, ProviderAdapter } from "@owostack/adapters";
import type { Env, Variables } from "../index";
import type { AnalyticsEnv } from "../lib/analytics-engine";
import { WebhookHandler } from "../lib/webhooks";
import { decrypt } from "../lib/encryption";
import { WebhookError, errorToResponse } from "../lib/errors";
import { getProviderRegistry } from "../lib/providers";
import {
  badRequestResponse,
  internalServerErrorResponse,
  jsonContent,
  notFoundResponse,
  unauthorizedResponse,
} from "../openapi/common";

export type WebhookRouteDependencies = {
  getProviderRegistry: typeof getProviderRegistry;
  decrypt: typeof decrypt;
  createWebhookHandler: (params: {
    db: Variables["db"];
    organizationId: string;
    adapter: ProviderAdapter;
    account: ProviderAccount | undefined;
    trialEndWorkflow: Env["TRIAL_END_WORKFLOW"];
    planUpgradeWorkflow: Env["PLAN_UPGRADE_WORKFLOW"];
    cache: Env["CACHE"];
    analyticsEnv: AnalyticsEnv;
  }) => {
    handle(event: unknown): Promise<{
      isErr(): boolean;
      isOk(): boolean;
      error?: unknown;
    }>;
  };
};

const defaultDependencies: WebhookRouteDependencies = {
  getProviderRegistry,
  decrypt,
  createWebhookHandler: ({
    db,
    organizationId,
    adapter,
    account,
    trialEndWorkflow,
    planUpgradeWorkflow,
    cache,
    analyticsEnv,
  }) =>
    new WebhookHandler(db, organizationId, {
      adapter,
      account,
      trialEndWorkflow,
      planUpgradeWorkflow,
      cache,
      analyticsEnv,
    }),
};

export function createWebhookRoutes(
  overrides: Partial<WebhookRouteDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...overrides };
  const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

  const webhookResponseSchema = z
    .object({
      success: z.boolean().optional(),
      received: z.boolean().optional(),
      skipped: z.boolean().optional(),
      error: z.string().optional(),
    })
    .passthrough();

  const paystackWebhookRoute = createRoute({
    method: "post",
    path: "/webhooks/{organizationId}",
    operationId: "webhookPaystack",
    tags: ["Webhooks"],
    summary: "Receive a Paystack webhook",
    description:
      "Provider webhook endpoint for Paystack. The organization can be addressed by ID or slug.",
    security: [],
    request: {
      params: z.object({
        organizationId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Webhook processed or acknowledged successfully",
        ...jsonContent(webhookResponseSchema),
      },
      400: badRequestResponse,
      401: unauthorizedResponse,
      404: notFoundResponse,
      500: internalServerErrorResponse,
    },
  });

  const providerWebhookRoute = createRoute({
    method: "post",
    path: "/webhooks/{organizationId}/{provider}",
    operationId: "webhook",
    tags: ["Webhooks"],
    summary: "Receive a provider webhook",
    description:
      "Provider webhook endpoint for any supported payment adapter. The organization can be addressed by ID or slug.",
    security: [],
    request: {
      params: z.object({
        organizationId: z.string(),
        provider: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Webhook processed or acknowledged successfully",
        ...jsonContent(webhookResponseSchema),
      },
      400: badRequestResponse,
      401: unauthorizedResponse,
      404: notFoundResponse,
      500: internalServerErrorResponse,
    },
  });

  async function handleWebhookRequest(
    c: any,
    organizationId: string,
    providerId: string,
  ) {
    const maskSecretForLog = (value: string | null | undefined) => {
      if (!value) return "<empty>";
      if (value.length <= 10) return `${value.slice(0, 2)}***`;
      return `${value.slice(0, 6)}...${value.slice(-4)} (len=${value.length})`;
    };

    console.log(
      `[WEBHOOK-ROUTE] Received webhook for org=${organizationId}, provider=${providerId}`,
    );

    const registry = deps.getProviderRegistry();
    const adapter = registry.get(providerId);
    if (!adapter) {
      console.error(`[WEBHOOK-ROUTE] Unknown provider: ${providerId}`);
      return c.json({ error: `Unsupported provider: ${providerId}` }, 400);
    }

    const sigHeader =
      adapter.signatureHeaderName || `x-${providerId}-signature`;
    const signature = c.req.header(sigHeader);
    console.log(
      `[WEBHOOK-ROUTE] Signature header=${sigHeader}, hasSignature=${!!signature}`,
    );

    if (!signature) {
      return c.json(
        errorToResponse(new WebhookError({ reason: "missing_signature" })),
        401,
      );
    }

    const rawBody = await c.req.text();
    const db = c.get("db");
    const authDb = c.get("authDb");

    const org = await authDb.query.organizations.findFirst({
      where: or(
        eq(schema.organizations.id, organizationId),
        eq(schema.organizations.slug, organizationId),
      ),
    });

    if (!org) {
      return c.json({ error: "Organization not found" }, 404);
    }

    const existingOrgInBilling = await db.query.organizations.findFirst({
      where: or(
        eq(schema.organizations.id, organizationId),
        eq(schema.organizations.slug, organizationId),
      ),
      columns: { id: true },
    });

    if (!existingOrgInBilling) {
      await db.insert(schema.organizations).values(org).onConflictDoNothing();
    }

    const workerEnv = c.env.ENVIRONMENT === "live" ? "live" : "test";
    let secret: string | null = null;
    let secretSource: string | null = null;

    const allProviderAccounts = await db.query.providerAccounts.findMany({
      where: and(
        eq(schema.providerAccounts.organizationId, org.id),
        eq(schema.providerAccounts.providerId, providerId),
      ),
    });
    const providerAccounts = allProviderAccounts.filter((pa: any) => {
      const env = pa?.environment;
      return !env || env === workerEnv;
    });

    const scopedProviderAccounts =
      providerAccounts.length > 0 ? providerAccounts : allProviderAccounts;
    let secretAccountId: string | null = null;
    for (const pa of scopedProviderAccounts) {
      const creds = (pa as any).credentials || {};
      const potentialSecret =
        creds.webhookSecret ||
        (providerId === "paystack" ? creds.secretKey : null);

      if (typeof potentialSecret === "string" && potentialSecret.length > 0) {
        try {
          secret = (
            await deps.decrypt(potentialSecret, c.env.ENCRYPTION_KEY)
          ).trim();
          secretSource = creds.webhookSecret
            ? "provider_account_webhook_secret_encrypted"
            : "provider_account_api_key_encrypted";
          secretAccountId = pa.id;
          console.log(
            `[WEBHOOK-ROUTE] Using provider account secret (${secretSource}) for org=${organizationId}, provider=${providerId}`,
          );
        } catch (e) {
          console.warn(`[WEBHOOK-ROUTE] Failed to decrypt provider secret:`, e);
          secret = potentialSecret.trim();
          secretSource = creds.webhookSecret
            ? "provider_account_webhook_secret_plaintext"
            : "provider_account_api_key_plaintext";
          secretAccountId = pa.id;
          console.warn(
            `[WEBHOOK-ROUTE] Falling back to raw provider secret for org=${organizationId}, provider=${providerId}`,
          );
        }
        break;
      }
    }

    if (!secret) {
      const orgWebhookSecret =
        workerEnv === "live" ? org.liveWebhookSecret : org.testWebhookSecret;
      secret = orgWebhookSecret || org.webhookSecret;
      if (secret) {
        secretSource = "organization_webhook_secret";
      }
    }

    if (!secret) {
      const encryptedKey =
        workerEnv === "live" ? org.liveSecretKey : org.testSecretKey;
      if (encryptedKey) {
        try {
          secret = (
            await deps.decrypt(encryptedKey, c.env.ENCRYPTION_KEY)
          ).trim();
          secretSource = `organization_${workerEnv}_secret_key_encrypted`;
          console.log(
            `[WEBHOOK-ROUTE] No webhookSecret, falling back to ${workerEnv} secret key for org=${organizationId}`,
          );
        } catch (e) {
          console.error(
            `[WEBHOOK-ROUTE] Failed to decrypt key for verification:`,
            e,
          );
          secret = encryptedKey.trim();
          secretSource = `organization_${workerEnv}_secret_key_plaintext`;
        }
      }
    }

    if (!secret) {
      console.error(
        `[WEBHOOK-ROUTE] No secret available for org=${organizationId}, provider=${providerId}`,
      );
      return c.json({ error: "Webhook secret not configured" }, 500);
    }

    const reqHeaders: Record<string, string> = {};
    c.req.raw.headers.forEach((value: string, key: string) => {
      reqHeaders[key.toLowerCase()] = value;
    });

    const verifyResult = await adapter.verifyWebhook({
      signature,
      payload: rawBody,
      secret,
      headers: reqHeaders,
    });

    if (verifyResult.isErr() || !verifyResult.value) {
      console.error(
        `[WEBHOOK-ROUTE] Signature verification FAILED for org=${organizationId}, provider=${providerId}`,
      );
      if (providerId === "polar") {
        console.error("[WEBHOOK-ROUTE] Polar verification context", {
          org: organizationId,
          provider: providerId,
          workerEnv,
          secretSource,
          secretAccountId,
          providerAccountsTotal: allProviderAccounts.length,
          providerAccountsScoped: scopedProviderAccounts.length,
          secretPreview: maskSecretForLog(secret),
          signatureHeaderPresent: !!signature,
          signatureHeaderPreview: maskSecretForLog(signature),
          webhookId: reqHeaders["webhook-id"] || null,
          webhookTimestamp: reqHeaders["webhook-timestamp"] || null,
          availableHeaders: Object.keys(reqHeaders),
        });
      }
      return c.json(
        errorToResponse(new WebhookError({ reason: "invalid_signature" })),
        401,
      );
    }
    console.log(`[WEBHOOK-ROUTE] Signature verified for org=${organizationId}`);

    let rawPayload: Record<string, unknown>;
    try {
      rawPayload = JSON.parse(rawBody);
    } catch {
      return c.json(
        errorToResponse(new WebhookError({ reason: "parse_failed" })),
        400,
      );
    }

    const parseResult = adapter.parseWebhookEvent({ payload: rawPayload });
    if (parseResult.isErr()) {
      console.log(
        `[WEBHOOK-ROUTE] Unhandled event from ${providerId}: ${parseResult.error.message}`,
      );
      return c.json({ success: true, received: true, skipped: true });
    }

    const normalizedEvent = parseResult.value;
    console.log(
      `[WEBHOOK-ROUTE] Event: ${normalizedEvent.type}, provider=${normalizedEvent.provider}, ref=${normalizedEvent.payment?.reference || "n/a"}`,
    );

    let selectedAccount: any | undefined;
    const accountToUse = secretAccountId
      ? scopedProviderAccounts.find((a: any) => a.id === secretAccountId)
      : scopedProviderAccounts.length > 0
        ? scopedProviderAccounts[0]
        : undefined;

    if (accountToUse) {
      const pa = accountToUse as any;
      const creds = { ...(pa.credentials || {}) };
      if (typeof creds.secretKey === "string" && creds.secretKey.length > 0) {
        try {
          creds.secretKey = (
            await deps.decrypt(creds.secretKey, c.env.ENCRYPTION_KEY)
          ).trim();
        } catch (e) {
          console.warn(
            `[WEBHOOK-ROUTE] Failed to decrypt provider secretKey for org=${organizationId}:`,
            e,
          );
          creds.secretKey = creds.secretKey.trim();
        }
      }
      selectedAccount = {
        ...pa,
        credentials: creds,
      };
    }

    const handler = deps.createWebhookHandler({
      db,
      organizationId: org.id,
      adapter,
      account: selectedAccount,
      trialEndWorkflow: c.env.TRIAL_END_WORKFLOW,
      planUpgradeWorkflow: c.env.PLAN_UPGRADE_WORKFLOW,
      cache: c.env.CACHE,
      analyticsEnv: {
        ANALYTICS: c.env.ANALYTICS,
        ENVIRONMENT: c.env.ENVIRONMENT,
        CF_ACCOUNT_ID: c.env.CF_ACCOUNT_ID,
        CF_ANALYTICS_READ_TOKEN: c.env.CF_ANALYTICS_READ_TOKEN,
        ANALYTICS_DATASET: c.env.ANALYTICS_DATASET,
        EVENTS_PIPELINE: c.env.EVENTS_PIPELINE,
        R2_SQL_TOKEN: c.env.R2_SQL_TOKEN,
        R2_WAREHOUSE: c.env.R2_WAREHOUSE,
      },
    });

    const handleResult = await handler.handle(normalizedEvent);
    if (handleResult.isErr()) {
      console.error("Webhook handling error:", handleResult.error);
    }

    return c.json({ success: true, received: true });
  }

  app.openapi(paystackWebhookRoute, async (c) => {
    return handleWebhookRequest(c, c.req.param("organizationId"), "paystack");
  });

  app.openapi(providerWebhookRoute, async (c) => {
    return handleWebhookRequest(
      c,
      c.req.param("organizationId"),
      c.req.param("provider"),
    );
  });

  return app;
}

export default createWebhookRoutes();
