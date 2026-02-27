import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { schema } from "@owostack/db";
import { verifyApiKey } from "../../lib/api-keys";
import type { Env, Variables } from "../../index";
import { sendCheckoutEmail } from "../../lib/email";
import { provisionEntitlements } from "../../lib/plan-switch";
import { createCheckoutSessionForSubscription } from "../../lib/checkout-session";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /v1/subscriptions/:id/activate
// Public route that redirects to a fresh provider checkout session.
app.get("/:id/activate", async (c) => {
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

app.post("/:id/checkout", async (c) => {
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
        customer: true,
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
      await sendCheckoutEmail({
        to: customer.email,
        customerName: customer.name || undefined,
        planName: plan.name,
        checkoutUrl: activationUrl,
        amount: plan.price,
        currency: plan.currency,
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
