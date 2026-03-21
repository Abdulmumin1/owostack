import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { eq, and } from "drizzle-orm";
import { schema } from "@owostack/db";
import { verifyApiKey } from "../../lib/api-keys";
import type { Env, Variables } from "../../index";
import { sendCheckoutEmail } from "../../lib/email";
import { provisionEntitlements } from "../../lib/plan-switch";
import { createCheckoutSessionForSubscription } from "../../lib/checkout-session";
import {
  badRequestResponse,
  internalServerErrorResponse,
  jsonContent,
  notFoundResponse,
  unauthorizedResponse,
} from "../../openapi/common";

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

const subscriptionIdParamsSchema = z.object({
  id: z.string(),
});

const subscriptionCheckoutBodySchema = z.object({
  callbackUrl: z.string().url().optional(),
});

const subscriptionCheckoutResponseSchema = z
  .object({
    success: z.boolean(),
    checkoutUrl: z.string().url().optional(),
    reference: z.string().optional(),
    accessCode: z.string().optional(),
    activatedDirectly: z.boolean().optional(),
    message: z.string().optional(),
  })
  .passthrough();

const activatePendingSubscriptionRoute = createRoute({
  method: "get",
  path: "/{id}/activate",
  operationId: "activatePendingSubscription",
  tags: ["Subscriptions"],
  summary: "Redirect to a fresh checkout session",
  description:
    "Public activation URL for a pending subscription. Generates a fresh provider checkout session and redirects the customer to it.",
  security: [],
  request: {
    params: subscriptionIdParamsSchema,
    query: z.object({
      callbackUrl: z.string().url().optional(),
    }),
  },
  responses: {
    302: {
      description: "Redirects to provider checkout",
    },
    400: {
      description: "Failed to generate checkout link",
    },
  },
});

const generateSubscriptionCheckoutRoute = createRoute({
  method: "post",
  path: "/{id}/checkout",
  operationId: "generateSubscriptionCheckout",
  tags: ["Subscriptions"],
  summary: "Generate checkout for a pending subscription",
  description:
    "Generates a payment checkout URL for an existing pending subscription. Useful for collecting payment details before activating.",
  request: {
    params: subscriptionIdParamsSchema,
    body: {
      required: false,
      content: {
        "application/json": {
          schema: subscriptionCheckoutBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Checkout generated successfully",
      ...jsonContent(subscriptionCheckoutResponseSchema),
    },
    400: badRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    500: internalServerErrorResponse,
  },
});

// GET /v1/subscriptions/:id/activate
// Public route that redirects to a fresh provider checkout session.
app.openapi(activatePendingSubscriptionRoute, async (c) => {
  const { id } = c.req.param();
  const { callbackUrl } = c.req.query();

  try {
    const checkoutResult = await createCheckoutSessionForSubscription(c, id, {
      callbackUrl,
    });

    if (checkoutResult.isErr()) {
      return c.text(checkoutResult.error.message, 400);
    }

    return c.redirect(checkoutResult.value.url);
  } catch (e: any) {
    return c.text(e.message || "Failed to generate checkout link", 500);
  }
});

app.openapi(generateSubscriptionCheckoutRoute, async (c) => {
  const { id } = c.req.param();
  const db = c.get("db");
  const authDb = c.get("authDb");

  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing API Key" }, 401);
  }
  const apiKey = authHeader.split(" ")[1];

  const keyRecord = await verifyApiKey(authDb, apiKey);
  if (!keyRecord) return c.json({ error: "Unauthorized" }, 401);

  try {
    const subscription = await db.query.subscriptions.findFirst({
      where: and(
        eq(schema.subscriptions.id, id),
        eq(schema.subscriptions.status, "pending"),
      ),
      with: {
        plan: true,
        customer: {
          with: { organization: true },
        },
      },
    });

    if (!subscription) {
      return c.json({ error: "Pending subscription not found" }, 404);
    }

    const { plan, customer } = subscription;
    if (!plan || !customer) {
      return c.json({ error: "Invalid subscription data" }, 400);
    }

    // Direct activation for completely free plans (no card required, price 0)
    if (plan.price === 0) {
      const now = Date.now();
      const periodMs = 30 * 24 * 60 * 60 * 1000;
      await db
        .update(schema.subscriptions)
        .set({
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: now + periodMs,
          updatedAt: now,
        })
        .where(eq(schema.subscriptions.id, subscription.id));

      await provisionEntitlements(db, customer.id, plan.id);

      const payload: any = {
        success: true,
        activatedDirectly: true,
        message: "Free subscription activated instantly. No checkout required.",
      };
      return c.json(payload);
    }

    const body = await c.req.json().catch(() => ({}));
    const callbackUrl = body.callbackUrl || undefined;

    // Use URL from request to build the activation link
    const url = new URL(c.req.url);
    const activationUrl = `${url.origin}/v1/subscriptions/${subscription.id}/activate${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`;

    try {
      const organization = (customer as any).organization;
      await sendCheckoutEmail(c.env, {
        to: customer.email,
        customerName: customer.name || undefined,
        planName: plan.name,
        checkoutUrl: activationUrl,
        amount: plan.price,
        currency: plan.currency,
        organizationName: organization?.name || "The Merchant",
        organizationLogo: organization?.logo || undefined,
      });
    } catch (e) {
      console.warn("Failed to send checkout email:", e);
    }

    const payload: any = {
      success: true,
      checkoutUrl: activationUrl,
    };
    return c.json(payload);
  } catch (e: any) {
    return c.json({ error: e.message || "Network error" }, 500);
  }
});

export default app;
