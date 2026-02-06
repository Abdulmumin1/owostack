import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { schema } from "@owostack/db";
import { decrypt } from "../../lib/encryption";
import { verifyApiKey } from "../../lib/api-keys";
import { getPaystackEnvironment, selectPaystackKey } from "../../lib/environment";
import { PaystackClient } from "../../lib/paystack";
import { executeSwitch } from "../../lib/plan-switch";
import type { Env, Variables } from "../../index";
import { errorToResponse, ValidationError } from "../../lib/errors";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const attachSchema = z.object({
  // Customer identification (one required)
  customer: z.string(), // Email or customer ID
  // Product identification
  product: z.string(), // Plan slug or ID
  // Optional overrides
  currency: z.string().min(3).optional(),
  channels: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  callbackUrl: z.string().url().optional(),
});

function zodErrorToResponse(zodError: {
  flatten: () => {
    formErrors: string[];
    fieldErrors: Record<string, string[] | undefined>;
  };
}) {
  const flattened = zodError.flatten();
  const fieldErrors = Object.entries(flattened.fieldErrors);

  if (fieldErrors.length > 0) {
    const [field, messages] = fieldErrors[0];
    return errorToResponse(
      new ValidationError({ field, details: messages?.[0] || "Invalid value" }),
    );
  }

  const formError = flattened.formErrors[0];
  return errorToResponse(
    new ValidationError({
      field: "input",
      details: formError || "Invalid request body",
    }),
  );
}

// Attach (Initialize Transaction)
app.post("/attach", async (c) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "Missing API Key" }, 401);
  }

  const apiKey = authHeader.split(" ")[1];
  const db = c.get("db");

  // Verify API Key
  const keyRecord = await verifyApiKey(db, apiKey);
  if (!keyRecord) {
    return c.json({ success: false, error: "Invalid API Key" }, 401);
  }

  // Get project config from shared auth DB
  const authDb = c.get("authDb");
  const project = await authDb.query.projects.findFirst({
    where: eq(schema.projects.organizationId, keyRecord.organizationId),
  });

  if (!project) {
    return c.json(
      { success: false, error: "Project configuration not found" },
      500,
    );
  }

  // Determine environment from worker's ENVIRONMENT var or project config
  const activeEnv = getPaystackEnvironment(
    c.env.ENVIRONMENT,
    project.activeEnvironment
  );
  
  const encryptedKey = selectPaystackKey(
    activeEnv,
    project.testSecretKey,
    project.liveSecretKey
  );
  if (!encryptedKey) {
    return c.json(
      {
        success: false,
        error: `Paystack ${activeEnv} mode not configured`,
      },
      400,
    );
  }

  // Decrypt the Paystack Secret Key
  let paystackSecretKey: string;
  try {
    paystackSecretKey = await decrypt(encryptedKey, c.env.ENCRYPTION_KEY);
  } catch (e) {
    return c.json(
      { success: false, error: "Failed to decrypt Paystack key" },
      500,
    );
  }

  // Parse Body
  const body = await c.req.json();
  const parsed = attachSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { customer, product, currency, channels, metadata, callbackUrl } =
    parsed.data;

  // 1. Resolve Plan (Price)
  const plan = await db.query.plans.findFirst({
    where: and(
      eq(schema.plans.organizationId, keyRecord.organizationId),
      eq(schema.plans.slug, product),
    ),
  });

  if (!plan) {
    return c.json(
      { success: false, error: `Plan '${product}' not found` },
      404,
    );
  }

  // 2. Resolve Customer - customer param is always treated as email (normalized to lowercase)
  const email = customer.toLowerCase();

  // 3. Find or create customer record
  let customerRecord = await db.query.customers.findFirst({
    where: and(
      eq(schema.customers.organizationId, keyRecord.organizationId),
      eq(schema.customers.email, email),
    ),
  });

  if (!customerRecord) {
    // Create customer record
    const [newCustomer] = await db
      .insert(schema.customers)
      .values({
        id: crypto.randomUUID(),
        organizationId: keyRecord.organizationId,
        email,
        name: email.split("@")[0], // Default name from email
        metadata: metadata || {},
      })
      .returning();
    customerRecord = newCustomer;
  }

  // 4. Handle TRIAL plans (trialDays > 0, no card required) — separate path
  const trialDays = plan.trialDays || 0;
  const trialCardRequired = plan.trialCardRequired || false;

  if (trialDays > 0 && !trialCardRequired) {
    try {
      const now = Date.now();
      const trialEndMs = now + trialDays * 24 * 60 * 60 * 1000;

      const [subscription] = await db
        .insert(schema.subscriptions)
        .values({
          id: crypto.randomUUID(),
          customerId: customerRecord.id,
          planId: plan.id,
          status: "trialing",
          currentPeriodStart: now,
          currentPeriodEnd: trialEndMs,
          metadata: { ...metadata, trial: true, trial_ends_at: trialEndMs },
        })
        .returning();

      return c.json({
        success: true,
        trial: true,
        message: `${trialDays}-day trial activated`,
        subscription_id: subscription.id,
        customer_id: customerRecord.id,
        trial_ends_at: new Date(trialEndMs).toISOString(),
      });
    } catch (e: any) {
      return c.json(
        { success: false, error: e.message || "Failed to create trial subscription" },
        500,
      );
    }
  }

  // 5. Handle trial with card required — Paystack checkout for card capture
  if (trialDays > 0 && trialCardRequired) {
    const paystackMetadata = {
      ...metadata,
      organization_id: keyRecord.organizationId,
      project_id: project.id,
      plan_id: plan.id,
      plan_slug: plan.slug,
      customer_id: customerRecord.id,
      environment: activeEnv,
      trial_days: trialDays,
      is_trial: true,
    };

    try {
      const paystack = new PaystackClient({ secretKey: paystackSecretKey });
      const result = await paystack.initializeTransaction({
        email,
        amount: "10000", // 100 NGN minimum for card verification
        currency: currency || plan.currency,
        channels,
        callback_url: callbackUrl,
        metadata: JSON.stringify(paystackMetadata),
      });

      if (result.isErr()) {
        return c.json(
          { success: false, error: result.error.message },
          400,
        );
      }

      return c.json({
        success: true,
        trial: true,
        trial_days: trialDays,
        ...result.value,
      });
    } catch (e: any) {
      return c.json({ success: false, error: e.message || "Network error" }, 500);
    }
  }

  // 6. Plan switching (handles free, upgrade, downgrade, lateral, new)
  //    Uses the unified executeSwitch logic which:
  //    - Detects if customer has an active sub in the same planGroup
  //    - Upgrades: prorates and charges immediately (or returns checkout URL)
  //    - Downgrades: schedules for end of billing period
  //    - Lateral: switches features immediately, no charge
  //    - New: creates subscription (direct if card on file, checkout if not)
  try {
    const paystack = new PaystackClient({ secretKey: paystackSecretKey });

    // Get scheduler DO stub for downgrade alarms
    const schedulerId = c.env.SUBSCRIPTION_SCHEDULER.idFromName(keyRecord.organizationId);
    const scheduler = c.env.SUBSCRIPTION_SCHEDULER.get(schedulerId);

    const result = await executeSwitch(db, customerRecord.id, plan.id, paystack, {
      callbackUrl,
      metadata: {
        ...metadata,
        organization_id: keyRecord.organizationId,
        project_id: project.id,
        environment: activeEnv,
      },
      scheduler,
      organizationId: keyRecord.organizationId,
      environment: activeEnv,
    });

    if (!result.success) {
      return c.json({ success: false, error: result.message }, 400);
    }

    return c.json({
      ...result,
      customer_id: customerRecord.id,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || "Switch failed" }, 500);
  }
});

export default app;
