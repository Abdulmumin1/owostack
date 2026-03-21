import { OpenAPIHono } from "@hono/zod-openapi";
import type { Env, Variables } from "../index";
import apiAddon from "../routes/api/addon";
import apiBilling from "../routes/api/billing";
import apiCheckout from "../routes/api/checkout";
import apiCreditPacks from "../routes/api/credit-packs";
import apiCreditSystems from "../routes/api/credit-systems";
import apiCustomers from "../routes/api/customers";
import apiEntitlements from "../routes/api/entitlements";
import apiPlans from "../routes/api/plans";
import apiSubscriptions from "../routes/api/subscriptions";
import apiSync from "../routes/api/sync";
import apiWallet from "../routes/api/wallet";
import webhooksRoute from "../routes/webhooks";

function createOpenApiApp() {
  const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();
  const v1Routes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

  v1Routes.route("/subscriptions", apiSubscriptions);
  v1Routes.route("/", apiCheckout);
  v1Routes.route("/", apiEntitlements);
  v1Routes.route("/", apiAddon);
  v1Routes.route("/billing", apiBilling);
  v1Routes.route("/sync", apiSync);
  v1Routes.route("/", apiWallet);
  v1Routes.route("/plans", apiPlans);
  v1Routes.route("/", apiCustomers);
  v1Routes.route("/credit-systems", apiCreditSystems);
  v1Routes.route("/credit-packs", apiCreditPacks);

  app.route("/v1", v1Routes);
  app.route("/", webhooksRoute);

  return app;
}

export function getOpenApiDocument() {
  const app = createOpenApiApp();

  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Owostack API",
      version: "1.0.0",
      description:
        "Unified billing, entitlements, and usage metering API. Owostack sits between your app and payment providers (Paystack, Stripe, Dodo, Polar) to handle subscriptions, feature gating, metered usage, credit systems, and invoicing.",
      contact: {
        name: "Owostack",
        url: "https://owostack.com",
      },
    },
    servers: [
      {
        url: "https://api.owostack.com",
        description: "Production (live)",
      },
      {
        url: "https://sandbox.owostack.com",
        description: "Sandbox (test)",
      },
    ],
    security: [{ bearerAuth: [] }],
    tags: [
      {
        name: "Subscriptions",
        description: "Subscribe customers to plans",
      },
      {
        name: "Entitlements",
        description: "Check and track feature entitlements",
      },
      {
        name: "Add-ons",
        description: "Purchase credit pack add-ons",
      },
      {
        name: "Wallet",
        description: "Manage saved payment methods",
      },
      {
        name: "Billing",
        description: "Overage billing and invoicing",
      },
      {
        name: "Catalog",
        description: "Sync features and plans from code",
      },
      {
        name: "Plans",
        description: "List and retrieve plans",
      },
      {
        name: "Customers",
        description: "Create and manage customers",
      },
      {
        name: "Entities",
        description: "Manage per-seat and per-entity usage",
      },
      {
        name: "Credit Systems",
        description: "List credit systems and credit packs",
      },
      {
        name: "Webhooks",
        description: "Receive provider webhooks",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API Key",
          description:
            "Provide your Owostack secret API key as a Bearer token.",
        },
      },
    },
  } as any);
}

export const openApiDocument = getOpenApiDocument();
