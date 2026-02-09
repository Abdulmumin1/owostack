import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { schema } from "@owostack/db";
import { resolveOrCreateCustomer } from "../../lib/customers";
import { decrypt } from "../../lib/encryption";
import { verifyApiKey } from "../../lib/api-keys";
import { getPaystackEnvironment, selectPaystackKey, type PaystackEnvironment } from "../../lib/environment";
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
import { ensureCreditPackSynced } from "../../lib/credit-pack-sync";
import { topUpScopedBalance } from "../../lib/addon-credits";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const addonSchema = z.object({
  customer: z.string(), // Email or customer ID
  pack: z.string(), // Credit pack slug or ID
  quantity: z.number().int().min(1).default(1),
  provider: z.string().optional(),
  region: z.string().optional(),
  currency: z.string().min(3).optional(),
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

// POST /addon — Purchase a credit pack
app.post("/addon", async (c) => {
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

  // Get project config
  const project = await authDb.query.projects.findFirst({
    where: eq(schema.projects.organizationId, keyRecord.organizationId),
  });

  if (!project) {
    return c.json(
      { success: false, error: "Project configuration not found" },
      500,
    );
  }

  const activeEnv = getPaystackEnvironment(
    c.env.ENVIRONMENT,
    project.activeEnvironment,
  );

  // Parse Body
  const body = await c.req.json();
  const parsed = addonSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const {
    customer,
    pack,
    quantity,
    currency,
    metadata,
    callbackUrl,
    provider,
    region,
  } = parsed.data;

  // 1. Resolve Credit Pack (by slug, then by ID)
  let creditPack: any = null;
  try {
    if ((db.query as any).creditPacks) {
      creditPack = await (db.query as any).creditPacks.findFirst({
        where: and(
          eq((schema as any).creditPacks.organizationId, keyRecord.organizationId),
          eq((schema as any).creditPacks.slug, pack),
          eq((schema as any).creditPacks.isActive, true),
        ),
      });

      if (!creditPack) {
        creditPack = await (db.query as any).creditPacks.findFirst({
          where: and(
            eq((schema as any).creditPacks.id, pack),
            eq((schema as any).creditPacks.organizationId, keyRecord.organizationId),
            eq((schema as any).creditPacks.isActive, true),
          ),
        });
      }
    } else {
      // Fallback: direct select
      const rows = await (db as any)
        .select()
        .from((schema as any).creditPacks)
        .where(and(
          eq((schema as any).creditPacks.organizationId, keyRecord.organizationId),
          eq((schema as any).creditPacks.slug, pack),
          eq((schema as any).creditPacks.isActive, true),
        ))
        .limit(1);
      creditPack = rows[0] || null;

      if (!creditPack) {
        const byIdRows = await (db as any)
          .select()
          .from((schema as any).creditPacks)
          .where(and(
            eq((schema as any).creditPacks.id, pack),
            eq((schema as any).creditPacks.organizationId, keyRecord.organizationId),
            eq((schema as any).creditPacks.isActive, true),
          ))
          .limit(1);
        creditPack = byIdRows[0] || null;
      }
    }
  } catch (e: any) {
    if (e?.message?.includes("no such table")) {
      return c.json({ success: false, error: "Credit packs not yet configured. Run migration 0004." }, 500);
    }
    throw e;
  }

  if (!creditPack) {
    return c.json(
      { success: false, error: `Credit pack '${pack}' not found` },
      404,
    );
  }

  if (!creditPack.creditSystemId) {
    return c.json(
      { success: false, error: `Credit pack '${pack}' is not attached to a credit system. Every add-on pack must have a creditSystemId.` },
      400,
    );
  }

  return handleAddonPurchase(c, db, keyRecord, project, activeEnv, creditPack, {
    customer, quantity, currency, metadata, callbackUrl, provider, region,
  });
});

async function handleAddonPurchase(
  c: any,
  db: any,
  keyRecord: any,
  project: any,
  activeEnv: PaystackEnvironment,
  creditPack: any,
  opts: {
    customer: string;
    quantity: number;
    currency?: string;
    metadata?: Record<string, unknown>;
    callbackUrl?: string;
    provider?: string;
    region?: string;
  },
) {
  const { customer, quantity, currency, metadata, callbackUrl, provider, region } = opts;
  const totalCredits = creditPack.credits * quantity;
  const totalPrice = creditPack.price * quantity;
  const registry = getProviderRegistry();

  const providerContext = buildProviderContext({
    region,
    currency: currency || creditPack.currency,
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
  const explicitProvider = provider || null;
  let selectedProviderId: string | null = explicitProvider;
  let selectedAccount: ProviderAccount | undefined;

  // 1. Explicit provider
  if (selectedProviderId) {
    selectedAccount = providerAccounts.find(
      (a) => a.providerId === selectedProviderId && a.environment === providerEnv,
    );
    if (!selectedAccount) {
      return c.json(
        { success: false, error: `Provider '${selectedProviderId}' not configured` },
        400,
      );
    }
  }

  // 2. Rules-based
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

  // 3. Default fallback
  if (!selectedAccount && providerAccounts.length > 0) {
    const defaultAccount = providerAccounts.find(
      (a) => a.environment === providerEnv,
    );
    if (defaultAccount) {
      selectedProviderId = defaultAccount.providerId;
      selectedAccount = defaultAccount;
    }
  }

  // 4. Legacy fallback: synthetic Paystack account
  if (!selectedAccount) {
    selectedProviderId = selectedProviderId || "paystack";

    if (selectedProviderId === "paystack") {
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
            { success: false, error: "Failed to decrypt provider key" },
            500,
          );
        }
      }

      if (!secretKey) {
        return c.json(
          { success: false, error: `Payment provider ${activeEnv} mode not configured` },
          400,
        );
      }

      selectedAccount = {
        id: `legacy-${project.id}`,
        organizationId: keyRecord.organizationId,
        providerId: "paystack",
        environment: providerEnv,
        credentials: { secretKey },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as ProviderAccount;
    }
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

  // Resolve or create customer
  const email = customer.toLowerCase();
  const customerRecord = await resolveOrCreateCustomer({
    db,
    organizationId: keyRecord.organizationId,
    customerId: customer,
    customerData: { email, metadata },
    providerId: selectedProviderId,
    waitUntil: (p: Promise<any>) => c.executionCtx.waitUntil(p),
  });

  if (!customerRecord) {
    return c.json(
      { success: false, error: "Could not resolve or create customer" },
      400,
    );
  }

  const purchaseMetadata = {
    ...metadata,
    // These MUST come after spread to prevent user metadata from overwriting critical keys
    type: "credit_purchase",
    credit_pack_id: creditPack.id,
    credit_pack_slug: creditPack.slug,
    credits: String(totalCredits),
    credits_per_pack: String(creditPack.credits),
    quantity: String(quantity),
    credit_system_id: creditPack.creditSystemId,
    customer_id: customerRecord.id,
    organization_id: keyRecord.organizationId,
    provider_id: selectedProviderId,
  };

  // Try to charge saved card directly
  const authCode =
    customerRecord.providerAuthorizationCode ||
    customerRecord.paystackAuthorizationCode;
  const customerRef =
    customerRecord.providerCustomerId ||
    customerRecord.paystackCustomerId ||
    customerRecord.email;

  if (authCode) {
    const chargeResult = await resolvedAdapter.chargeAuthorization({
      customer: { id: customerRef, email: customerRecord.email },
      authorizationCode: authCode,
      amount: totalPrice,
      currency: currency || creditPack.currency || "USD",
      metadata: purchaseMetadata,
      environment: selectedAccount.environment,
      account: selectedAccount,
    });

    if (chargeResult.isOk()) {
      // Charge succeeded — credit immediately via atomic upsert
      const updatedBalance = await topUpScopedBalance(
        db,
        customerRecord.id,
        creditPack.creditSystemId,
        totalCredits,
      );

      // Record the purchase in ledger
      await (db as any).insert((schema as any).creditPurchases).values({
        id: crypto.randomUUID(),
        customerId: customerRecord.id,
        creditPackId: creditPack.id,
        creditSystemId: creditPack.creditSystemId,
        credits: totalCredits,
        quantity,
        price: totalPrice,
        currency: currency || creditPack.currency || "USD",
        paymentReference: chargeResult.value.reference || null,
        providerId: selectedProviderId,
        metadata: purchaseMetadata,
      });

      return c.json({
        success: true,
        requiresCheckout: false,
        quantity,
        credits: totalCredits,
        balance: updatedBalance,
        creditSystemId: creditPack.creditSystemId,
        message: `${totalCredits} credits added (${quantity}x ${creditPack.name})`,
      });
    }

    // Charge failed — fall through to checkout
    console.warn(
      `[ADDON] Direct charge failed for customer=${customerRecord.id}, pack=${creditPack.slug}: ${chargeResult.error.message}`,
    );
  }

  // No saved card or charge failed — create checkout session
  // Try to sync credit pack to provider for native line-item checkout
  const syncResult = await ensureCreditPackSynced(db, creditPack, resolvedAdapter, selectedAccount);

  const checkoutResult = await resolvedAdapter.createCheckoutSession({
    customer: { id: customerRef, email: customerRecord.email },
    plan: null,
    amount: totalPrice,
    currency: currency || creditPack.currency || "USD",
    callbackUrl: callbackUrl,
    metadata: purchaseMetadata,
    // If provider supports native products, use lineItems for adjustable quantity
    ...(syncResult ? {
      lineItems: [{
        priceId: syncResult.priceId,
        quantity,
        adjustableQuantity: { enabled: true, minimum: 1, maximum: 100 },
      }],
    } : {}),
    environment: selectedAccount.environment,
    account: selectedAccount,
  });

  if (checkoutResult.isErr()) {
    return c.json(
      {
        success: false,
        error: `Failed to create checkout: ${checkoutResult.error.message}`,
      },
      500,
    );
  }

  return c.json({
    success: true,
    requiresCheckout: true,
    checkoutUrl: checkoutResult.value.url,
    quantity,
    credits: totalCredits,
    message: `Checkout created for ${quantity}x ${creditPack.name} (${totalCredits} credits)`,
  });
}

export default app;
