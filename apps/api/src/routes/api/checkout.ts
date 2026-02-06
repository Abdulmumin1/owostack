import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { schema } from "@owostack/db";
import { decrypt } from "../../lib/encryption";
import { verifyApiKey } from "../../lib/api-keys";
import { getPaystackEnvironment, selectPaystackKey } from "../../lib/environment";
import { executeSwitch } from "../../lib/plan-switch";
import type { ProviderContext } from "../../lib/plan-switch";
import {
  createProviderRegistry,
  paystackAdapter,
  resolveProvider,
} from "@owostack/adapters";
import type { ProviderAccount } from "@owostack/adapters";
import {
  buildProviderContext,
  deriveProviderEnvironment,
  loadProviderAccounts,
  loadProviderRules,
} from "../../lib/providers";
import type { Env, Variables } from "../../index";
import { errorToResponse, ValidationError } from "../../lib/errors";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const attachSchema = z.object({
  // Customer identification (one required)
  customer: z.string(), // Email or customer ID
  // Product identification
  product: z.string(), // Plan slug or ID
  // Optional provider selection
  provider: z.string().optional(),
  region: z.string().optional(),
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
  const authDb = c.get("authDb");


  // Verify API Key
  const keyRecord = await verifyApiKey(authDb, apiKey);
  if (!keyRecord) {
    return c.json({ success: false, error: "Invalid API Key" }, 401);
  }

  // Get project config from shared auth DB
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
    project.activeEnvironment,
  );

  // Parse Body
  const body = await c.req.json();
  const parsed = attachSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const {
    customer,
    product,
    currency,
    channels,
    metadata,
    callbackUrl,
    provider,
    region,
  } = parsed.data;

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

  const registry = createProviderRegistry();
  registry.register(paystackAdapter);

  const providerContext = buildProviderContext({
    region,
    currency: currency || plan.currency,
    metadata,
  });

  const providerRules = await loadProviderRules(db, keyRecord.organizationId);
  const providerAccounts = await loadProviderAccounts(
    db,
    keyRecord.organizationId,
    c.env.ENCRYPTION_KEY,
  );

  const providerEnv = deriveProviderEnvironment(
    c.env.ENVIRONMENT,
    project.activeEnvironment,
  );

  const explicitProvider = provider || null;
  let selectedProviderId = explicitProvider;

  if (!selectedProviderId && providerRules.length === 0 && providerAccounts.length === 0) {
    selectedProviderId = "paystack";
  }

  let selectedAccount = providerAccounts.find(
    (account) =>
      account.providerId === selectedProviderId &&
      account.environment === providerEnv,
  );

  if (explicitProvider && !selectedAccount) {
    return c.json(
      { success: false, error: `Provider '${explicitProvider}' not configured` },
      400,
    );
  }

  if (!selectedAccount) {
    const selectionResult = resolveProvider(registry, {
      organizationId: keyRecord.organizationId,
      environment: providerEnv,
      context: providerContext,
      rules: providerRules,
      accounts: providerAccounts,
    });

    if (selectionResult.isOk()) {
      selectedProviderId = selectionResult.value.adapter.id;
      selectedAccount = selectionResult.value.account;
    } else if (!selectedProviderId) {
      return c.json(
        { success: false, error: selectionResult.error.message },
        400,
      );
    }
  }

  // Build the provider account — either from providerAccounts table or legacy project keys
  if (!selectedAccount && selectedProviderId === "paystack") {
    let secretKey: string | null = null;

    const encryptedKey = selectPaystackKey(
      activeEnv,
      project.testSecretKey,
      project.liveSecretKey,
    );

    if (encryptedKey) {
      try {
        secretKey = await decrypt(encryptedKey, c.env.ENCRYPTION_KEY);
      } catch (e) {
        return c.json(
          { success: false, error: "Failed to decrypt Paystack key" },
          500,
        );
      }
    }

    if (!secretKey) {
      return c.json(
        { success: false, error: `Paystack ${activeEnv} mode not configured` },
        400,
      );
    }

    // Build a synthetic ProviderAccount from legacy project keys
    selectedAccount = {
      id: `legacy-${project.id}`,
      organizationId: keyRecord.organizationId,
      providerId: "paystack",
      environment: providerEnv,
      credentials: { secretKey },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  if (!selectedAccount || !selectedProviderId) {
    return c.json(
      { success: false, error: "No payment provider configured" },
      400,
    );
  }

  const resolvedAdapter = registry.get(selectedProviderId);
  if (!resolvedAdapter) {
    return c.json(
      { success: false, error: `Provider '${selectedProviderId}' not registered` },
      400,
    );
  }

  const providerCtx: ProviderContext = {
    adapter: resolvedAdapter,
    account: selectedAccount as ProviderAccount,
  };

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
        providerId: selectedProviderId,
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

      const trialCode = `trial-${crypto.randomUUID().slice(0, 8)}`;
      const [subscription] = await db
        .insert(schema.subscriptions)
        .values({
          id: crypto.randomUUID(),
          customerId: customerRecord.id,
          planId: plan.id,
          providerId: selectedProviderId,
          providerSubscriptionId: trialCode,
          providerSubscriptionCode: trialCode,
          paystackSubscriptionCode: selectedProviderId === "paystack" ? trialCode : null,
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

  // 5. Handle trial with card required — checkout for card capture
  if (trialDays > 0 && trialCardRequired) {
    const trialMetadata = {
      ...metadata,
      organization_id: keyRecord.organizationId,
      project_id: project.id,
      plan_id: plan.id,
      plan_slug: plan.slug,
      customer_id: customerRecord.id,
      environment: activeEnv,
      provider_id: selectedProviderId,
      trial_days: trialDays,
      is_trial: true,
    };

    try {
      const customerRef = customerRecord.providerCustomerId || customerRecord.paystackCustomerId || email;
      const result = await providerCtx.adapter.createCheckoutSession({
        customer: { id: customerRef, email },
        plan: null,
        amount: 10000, // 100 NGN/GHS minimum for card verification
        currency: currency || plan.currency,
        channels,
        callbackUrl,
        metadata: trialMetadata,
        environment: providerCtx.account.environment,
        account: providerCtx.account,
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
        url: result.value.url,
        reference: result.value.reference,
        accessCode: result.value.accessCode,
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
    // Get scheduler DO stub for downgrade alarms
    const schedulerId = c.env.SUBSCRIPTION_SCHEDULER.idFromName(keyRecord.organizationId);
    const scheduler = c.env.SUBSCRIPTION_SCHEDULER.get(schedulerId);

    const result = await executeSwitch(db, customerRecord.id, plan.id, providerCtx, {
      callbackUrl,
      metadata: {
        ...metadata,
        organization_id: keyRecord.organizationId,
        project_id: project.id,
        environment: activeEnv,
        provider_id: selectedProviderId,
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
