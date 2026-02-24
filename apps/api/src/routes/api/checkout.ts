import { Hono } from "hono";
import { z } from "zod";
import { eq, and, or } from "drizzle-orm";
import { schema } from "@owostack/db";
import { resolveOrCreateCustomer } from "../../lib/customers";
import { verifyApiKey } from "../../lib/api-keys";
import { executeSwitch, provisionEntitlements } from "../../lib/plan-switch";
import { hasPaymentMethod } from "../../lib/overage-guards";
import type { ProviderContext } from "../../lib/plan-switch";
import { ensurePlanSynced } from "../../lib/plan-sync";
import { resolveProvider } from "@owostack/adapters";
import type { ProviderAccount } from "@owostack/adapters";
import {
  getProviderRegistry,
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

  const registry = getProviderRegistry();

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

  // ---------- Provider Resolution ----------
  // Free plans don't need a provider — executeSwitch handles them entirely in the DB.
  // For paid plans we must resolve a provider account.
  const isFree = plan.type === "free" || plan.price === 0;

  const explicitProvider = provider || null;
  let selectedProviderId: string | null = explicitProvider;
  let selectedAccount: ProviderAccount | undefined;

  if (!isFree) {
    // 1. Explicit provider requested
    if (selectedProviderId) {
      selectedAccount = providerAccounts.find(
        (a) =>
          a.providerId === selectedProviderId && a.environment === providerEnv,
      );
      if (!selectedAccount) {
        return c.json(
          {
            success: false,
            error: `Provider '${selectedProviderId}' not configured`,
          },
          400,
        );
      }
    }

    // 2. Plan's own provider — use the provider the plan was created on
    if (!selectedAccount && plan.providerId) {
      selectedAccount = providerAccounts.find(
        (a) =>
          a.providerId === plan.providerId && a.environment === providerEnv,
      );
      if (selectedAccount) {
        selectedProviderId = plan.providerId;
      }
    }

    // 3. Try rules-based resolution
    if (!selectedAccount && providerRules.length > 0) {
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
      }
    }

    // 3. Default fallback: first account matching the current environment
    if (!selectedAccount && providerAccounts.length > 0) {
      const defaultAccount = providerAccounts.find(
        (a) => a.environment === providerEnv,
      );
      if (defaultAccount) {
        selectedProviderId = defaultAccount.providerId;
        selectedAccount = defaultAccount;
      }
    }

    if (!selectedAccount || !selectedProviderId) {
      return c.json(
        { success: false, error: "No payment provider configured" },
        400,
      );
    }
  }

  // Build ProviderContext (null for free plans — no provider API calls needed)
  let providerCtx: ProviderContext | null = null;
  if (selectedAccount && selectedProviderId) {
    const resolvedAdapter = registry.get(selectedProviderId);
    if (!resolvedAdapter) {
      return c.json(
        {
          success: false,
          error: `Provider '${selectedProviderId}' not registered`,
        },
        400,
      );
    }
    providerCtx = {
      adapter: resolvedAdapter,
      account: selectedAccount as ProviderAccount,
    };
  }

  // 2. Resolve or create customer
  const email = customer.toLowerCase();
  let customerRecord = await resolveOrCreateCustomer({
    db,
    organizationId: keyRecord.organizationId,
    customerId: customer,
    customerData: { email, metadata },
    providerId: selectedProviderId || undefined,
    waitUntil: (p) => c.executionCtx.waitUntil(p),
  });

  if (!customerRecord) {
    return c.json(
      { success: false, error: "Could not resolve or create customer" },
      400,
    );
  }

  // 4. Handle TRIAL plans (trialDays > 0, no card required) — separate path
  const trialDays = plan.trialDays || 0;
  const trialCardRequired = plan.trialCardRequired || false;
  const trialUnit =
    (plan.metadata as Record<string, unknown>)?.trialUnit === "minutes"
      ? "minutes"
      : "days";

  if (trialDays > 0 && !trialCardRequired) {
    try {
      // Check for existing active/trialing subscription to prevent duplicates
      const existingSub = await db.query.subscriptions.findFirst({
        where: and(
          eq(schema.subscriptions.customerId, customerRecord.id),
          eq(schema.subscriptions.planId, plan.id),
          or(
            eq(schema.subscriptions.status, "active"),
            eq(schema.subscriptions.status, "trialing"),
          ),
        ),
      });

      if (existingSub) {
        console.log(
          `[TRIAL] Existing subscription found: ${existingSub.id}, skipping trial creation`,
        );
        return c.json({
          success: true,
          trial: true,
          message: "Trial already active",
          subscription_id: existingSub.id,
          customer_id: customerRecord.id,
          trial_ends_at: existingSub.currentPeriodEnd
            ? new Date(existingSub.currentPeriodEnd).toISOString()
            : null,
        });
      }

      const now = Date.now();
      const trialEndMs =
        trialUnit === "minutes"
          ? now + trialDays * 60 * 1000
          : now + trialDays * 24 * 60 * 60 * 1000;
      console.log(
        `[TRIAL] Creating no-card trial: plan=${plan.id}, customer=${customerRecord.id}, duration=${trialDays} ${trialUnit}, endsAt=${new Date(trialEndMs).toISOString()}`,
      );

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
          paystackSubscriptionCode:
            selectedProviderId === "paystack" ? trialCode : null,
          status: "trialing",
          currentPeriodStart: now,
          currentPeriodEnd: trialEndMs,
          metadata: { ...metadata, trial: true, trial_ends_at: trialEndMs },
        })
        .returning();

      // Dispatch trial-end workflow (sleeps until trial ends, then expires)
      try {
        await c.env.TRIAL_END_WORKFLOW.create({
          params: {
            subscriptionId: subscription.id,
            customerId: customerRecord.id,
            planId: plan.id,
            organizationId: keyRecord.organizationId,
            providerId: selectedProviderId,
            environment: providerEnv,
            trialEndMs,
            email,
            amount: plan.price,
            currency: plan.currency,
            planSlug: plan.slug,
          },
        });
        console.log(
          `[TRIAL] Trial end workflow dispatched: subscription=${subscription.id}, trialEnds=${new Date(trialEndMs).toISOString()}`,
        );
      } catch (wfErr) {
        console.error(
          `[TRIAL] Failed to dispatch trial end workflow for subscription=${subscription.id}:`,
          wfErr,
        );
      }

      // Provision entitlements so trial users can access features
      await provisionEntitlements(db, customerRecord.id, plan.id);

      console.log(
        `[TRIAL] No-card trial activated: subscription=${subscription.id}, trialEnds=${new Date(trialEndMs).toISOString()}`,
      );
      return c.json({
        success: true,
        trial: true,
        message:
          trialUnit === "minutes"
            ? `${trialDays}-minute trial activated`
            : `${trialDays}-day trial activated`,
        subscription_id: subscription.id,
        customer_id: customerRecord.id,
        trial_ends_at: new Date(trialEndMs).toISOString(),
      });
    } catch (e: any) {
      return c.json(
        {
          success: false,
          error: e.message || "Failed to create trial subscription",
        },
        500,
      );
    }
  }

  // 5a. Lazy plan sync — ensure the plan exists on the provider before any checkout
  if (
    providerCtx &&
    !plan.providerPlanId &&
    plan.type === "paid" &&
    plan.billingType === "recurring"
  ) {
    try {
      const syncedId = await ensurePlanSynced(
        db,
        plan,
        providerCtx.adapter,
        providerCtx.account,
      );
      if (syncedId) {
        (plan as any).providerPlanId = syncedId;
        if (providerCtx.adapter.id === "paystack")
          (plan as any).paystackPlanId = syncedId;
      }
    } catch (e) {
      console.warn(`[checkout] Lazy plan sync failed for ${plan.id}:`, e);
    }
  }

  // 5b. Handle trial with card required — checkout for card capture
  if (trialDays > 0 && trialCardRequired) {
    if (!providerCtx) {
      return c.json(
        {
          success: false,
          error:
            "Trial with card requires a payment provider. Please connect a provider first.",
        },
        400,
      );
    }

    // If the customer already has a valid payment method (e.g. from wallet.setup()
    // or a previous purchase), skip the card capture checkout entirely — just create
    // the trialing subscription directly. This is the elegant composition:
    // wallet.setup() + attach() work together without redundant charges.
    const alreadyHasCard = await hasPaymentMethod(db, customerRecord.id);
    if (alreadyHasCard) {
      console.log(
        `[TRIAL] Customer ${customerRecord.id} already has card — skipping auth capture, creating trial directly`,
      );
      try {
        const now = Date.now();
        const trialEndMs =
          trialUnit === "minutes"
            ? now + trialDays * 60 * 1000
            : now + trialDays * 24 * 60 * 60 * 1000;

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
            paystackSubscriptionCode:
              selectedProviderId === "paystack" ? trialCode : null,
            status: "trialing",
            currentPeriodStart: now,
            currentPeriodEnd: trialEndMs,
            metadata: { ...metadata, trial: true, trial_ends_at: trialEndMs },
          })
          .returning();

        try {
          await c.env.TRIAL_END_WORKFLOW.create({
            params: {
              subscriptionId: subscription.id,
              customerId: customerRecord.id,
              planId: plan.id,
              organizationId: keyRecord.organizationId,
              providerId: selectedProviderId,
              environment: providerEnv,
              trialEndMs,
              email,
              amount: plan.price,
              currency: plan.currency,
              planSlug: plan.slug,
            },
          });
        } catch (wfErr) {
          console.error(
            `[TRIAL] Failed to dispatch trial end workflow:`,
            wfErr,
          );
        }

        await provisionEntitlements(db, customerRecord.id, plan.id);

        return c.json({
          success: true,
          trial: true,
          trial_days: trialDays,
          message:
            trialUnit === "minutes"
              ? `${trialDays}-minute trial activated`
              : `${trialDays}-day trial activated`,
          subscription_id: subscription.id,
          customer_id: customerRecord.id,
          trial_ends_at: new Date(trialEndMs).toISOString(),
        });
      } catch (e: any) {
        return c.json(
          {
            success: false,
            error: e.message || "Failed to create trial subscription",
          },
          500,
        );
      }
    }

    console.log(
      `[TRIAL] Initiating card-required trial checkout: plan=${plan.id}, customer=${customerRecord.id}, duration=${trialDays} ${trialUnit}`,
    );
    // Providers like Dodo handle trials natively via subscription_data.trial_period_days.
    // Mark these so the trial-end workflow skips the charge (provider handles billing).
    const isNativeTrial = providerCtx.adapter.supportsNativeTrials === true;

    // Pre-calculate trial end date for reliable downstream processing
    const trialDurationMs =
      trialUnit === "minutes"
        ? trialDays * 60 * 1000
        : trialDays * 24 * 60 * 60 * 1000;
    const trialEndsAt = new Date(Date.now() + trialDurationMs).toISOString();

    const trialMetadata = {
      ...metadata,
      organization_id: keyRecord.organizationId,
      project_id: project.id,
      plan_id: plan.id,
      plan_slug: plan.slug,
      customer_id: customerRecord.id,
      environment: providerEnv,
      provider_id: selectedProviderId,
      trial_days: trialDays,
      trial_unit: trialUnit,
      trial_ends_at: trialEndsAt,
      is_trial: true,
      native_trial: isNativeTrial,
      amount: plan.price,
      currency: plan.currency,
    };

    try {
      const customerRef =
        customerRecord.providerCustomerId ||
        customerRecord.paystackCustomerId ||
        email;
      // Only pass the plan for providers with native trial support.
      // For auth-capture providers (Paystack), plan: null ensures the checkout
      // charges the small auth amount instead of the full subscription price.
      const trialPlanRef = isNativeTrial
        ? plan.providerPlanId || plan.paystackPlanId
        : null;

      // Convert trial duration to days for providers that support native trials (Dodo).
      // Minute-based trials (used for testing) round up to at least 1 day.
      const trialDaysForProvider =
        trialUnit === "minutes"
          ? Math.max(1, Math.ceil(trialDays / 1440))
          : trialDays;

      const result = await providerCtx.adapter.createCheckoutSession({
        customer: { id: customerRef, email },
        plan: trialPlanRef ? { id: trialPlanRef } : null,
        amount: 10000, // 100 NGN/GHS minimum for card verification (Paystack)
        currency: currency || plan.currency,
        channels,
        callbackUrl,
        metadata: trialMetadata,
        trialDays: trialDaysForProvider,
        environment: providerCtx.account.environment,
        account: providerCtx.account,
      });

      if (result.isErr()) {
        return c.json({ success: false, error: result.error.message }, 400);
      }

      return c.json({
        success: true,
        trial: true,
        trial_days: trialDays,
        checkoutUrl: result.value.url,
        reference: result.value.reference,
        accessCode: result.value.accessCode,
      });
    } catch (e: any) {
      return c.json(
        { success: false, error: e.message || "Network error" },
        500,
      );
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
    const result = await executeSwitch(
      db,
      customerRecord.id,
      plan.id,
      providerCtx,
      {
        callbackUrl,
        metadata: {
          ...metadata,
          organization_id: keyRecord.organizationId,
          project_id: project.id,
          environment: providerEnv,
          provider_id: selectedProviderId,
        },
        downgradeWorkflow: c.env.DOWNGRADE_WORKFLOW,
        organizationId: keyRecord.organizationId,
        environment: providerEnv,
      },
    );

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
