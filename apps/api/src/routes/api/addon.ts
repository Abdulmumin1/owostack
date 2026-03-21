import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { eq, and } from "drizzle-orm";
import { schema } from "@owostack/db";
import { resolveOrCreateCustomer } from "../../lib/customers";
import { verifyApiKey } from "../../lib/api-keys";
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
import { isCustomerResolutionConflictError } from "../../lib/customer-resolution";
import {
  apiKeySecurity,
  badRequestResponse,
  conflictResponse,
  internalServerErrorResponse,
  jsonContent,
  metadataSchema,
  notFoundResponse,
  unauthorizedResponse,
} from "../../openapi/common";

export type AddonDependencies = {
  resolveOrCreateCustomer: typeof resolveOrCreateCustomer;
  verifyApiKey: typeof verifyApiKey;
  resolveProvider: typeof resolveProvider;
  getProviderRegistry: typeof getProviderRegistry;
  buildProviderContext: typeof buildProviderContext;
  deriveProviderEnvironment: typeof deriveProviderEnvironment;
  loadProviderAccounts: typeof loadProviderAccounts;
  loadProviderRules: typeof loadProviderRules;
  ensureCreditPackSynced: typeof ensureCreditPackSynced;
};

const defaultDependencies: AddonDependencies = {
  resolveOrCreateCustomer,
  verifyApiKey,
  resolveProvider,
  getProviderRegistry,
  buildProviderContext,
  deriveProviderEnvironment,
  loadProviderAccounts,
  loadProviderRules,
  ensureCreditPackSynced,
};

const addonSchema = z.object({
  customer: z.string(), // Email or customer ID
  pack: z.string(), // Credit pack slug or ID
  quantity: z.number().int().min(1).default(1),
  currency: z.string().min(3).optional(),
  metadata: metadataSchema.optional(),
  callbackUrl: z.string().url().optional(),
});

const addonResponseSchema = z
  .object({
    success: z.literal(true),
    requiresCheckout: z.boolean(),
    checkoutUrl: z.string().url(),
    quantity: z.number(),
    credits: z.number(),
    message: z.string(),
  })
  .passthrough();

const purchaseAddonRoute = createRoute({
  method: "post",
  path: "/addon",
  operationId: "addon",
  tags: ["Add-ons"],
  summary: "Purchase a credit pack",
  description:
    "Creates a checkout session to purchase a credit pack add-on for a customer.",
  security: apiKeySecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: addonSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Checkout created successfully",
      ...jsonContent(addonResponseSchema),
    },
    400: badRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalServerErrorResponse,
  },
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

export function createAddonRoute(overrides: Partial<AddonDependencies> = {}) {
  const deps = { ...defaultDependencies, ...overrides };
  const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

  // POST /addon — Purchase a credit pack
  app.openapi(purchaseAddonRoute, async (c) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ success: false, error: "Missing API Key" }, 401);
    }

    const apiKey = authHeader.split(" ")[1];
    const db = c.get("db");
    const authDb = c.get("authDb");

    // Verify API Key
    const keyRecord = await deps.verifyApiKey(authDb, apiKey);
    if (!keyRecord) {
      return c.json({ success: false, error: "Invalid API Key" }, 401);
    }

    // Parse Body
    const body = await c.req.json();
    const parsed = addonSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(zodErrorToResponse(parsed.error), 400);
    }

    const { customer, pack, quantity, currency, metadata, callbackUrl } =
      parsed.data;

    // 1. Resolve Credit Pack (by slug, then by ID)
    let creditPack: any = null;
    try {
      if ((db.query as any).creditPacks) {
        creditPack = await (db.query as any).creditPacks.findFirst({
          where: and(
            eq(
              (schema as any).creditPacks.organizationId,
              keyRecord.organizationId,
            ),
            eq((schema as any).creditPacks.slug, pack),
            eq((schema as any).creditPacks.isActive, true),
          ),
        });

        if (!creditPack) {
          creditPack = await (db.query as any).creditPacks.findFirst({
            where: and(
              eq((schema as any).creditPacks.id, pack),
              eq(
                (schema as any).creditPacks.organizationId,
                keyRecord.organizationId,
              ),
              eq((schema as any).creditPacks.isActive, true),
            ),
          });
        }
      } else {
        // Fallback: direct select
        const rows = await (db as any)
          .select()
          .from((schema as any).creditPacks)
          .where(
            and(
              eq(
                (schema as any).creditPacks.organizationId,
                keyRecord.organizationId,
              ),
              eq((schema as any).creditPacks.slug, pack),
              eq((schema as any).creditPacks.isActive, true),
            ),
          )
          .limit(1);
        creditPack = rows[0] || null;

        if (!creditPack) {
          const byIdRows = await (db as any)
            .select()
            .from((schema as any).creditPacks)
            .where(
              and(
                eq((schema as any).creditPacks.id, pack),
                eq(
                  (schema as any).creditPacks.organizationId,
                  keyRecord.organizationId,
                ),
                eq((schema as any).creditPacks.isActive, true),
              ),
            )
            .limit(1);
          creditPack = byIdRows[0] || null;
        }
      }
    } catch (e: any) {
      if (e?.message?.includes("no such table")) {
        return c.json(
          {
            success: false,
            error: "Credit packs not yet configured. Run migration 0004.",
          },
          500,
        );
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
        {
          success: false,
          error: `Credit pack '${pack}' is not attached to a credit system. Every add-on pack must have a creditSystemId.`,
        },
        400,
      );
    }

    return handleAddonPurchase(
      c,
      db,
      keyRecord,
      creditPack,
      {
        customer,
        quantity,
        currency,
        metadata,
        callbackUrl,
      },
      deps,
    );
  });

  return app;
}

async function handleAddonPurchase(
  c: any,
  db: any,
  keyRecord: any,
  creditPack: any,
  opts: {
    customer: string;
    quantity: number;
    currency?: string;
    metadata?: Record<string, unknown>;
    callbackUrl?: string;
  },
  deps: AddonDependencies = defaultDependencies,
) {
  const { customer, quantity, currency, metadata, callbackUrl } = opts;
  const totalCredits = creditPack.credits * quantity;
  const totalPrice = creditPack.price * quantity;
  const registry = deps.getProviderRegistry();

  const providerContext = deps.buildProviderContext({
    currency: currency || creditPack.currency,
    metadata,
  });

  const providerRules = await deps.loadProviderRules(
    db,
    keyRecord.organizationId,
  );
  const providerAccounts = await deps.loadProviderAccounts(
    db,
    keyRecord.organizationId,
    c.env.ENCRYPTION_KEY,
  );

  // Environment comes directly from ENVIRONMENT variable
  const providerEnv = deps.deriveProviderEnvironment(c.env.ENVIRONMENT, null);

  // ---------- Provider Resolution ----------
  // Prefer: explicit request param > pack's stored provider > rules/fallback
  let selectedProviderId: string | null = creditPack.providerId || null;
  let selectedAccount: ProviderAccount | undefined;

  // 1. Pack's own provider
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

  // 2. Rules-based
  if (!selectedAccount && providerRules.length > 0) {
    const selectionResult = deps.resolveProvider(registry, {
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

  if (!selectedAccount || !selectedProviderId) {
    return c.json(
      { success: false, error: "No payment provider configured" },
      400,
    );
  }

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

  // Resolve or create customer
  const normalizedCustomer = customer.trim();
  const customerLooksLikeEmail = normalizedCustomer.includes("@");
  const customerData = customerLooksLikeEmail
    ? { email: normalizedCustomer.toLowerCase(), metadata }
    : undefined;

  let customerRecord;
  try {
    customerRecord = await deps.resolveOrCreateCustomer({
      db,
      organizationId: keyRecord.organizationId,
      customerId: normalizedCustomer,
      customerData,
      providerId: selectedProviderId,
      waitUntil: (p: Promise<any>) => c.executionCtx.waitUntil(p),
    });
  } catch (error) {
    if (isCustomerResolutionConflictError(error)) {
      return c.json({ success: false, error: error.message }, 409);
    }
    throw error;
  }

  if (!customerRecord) {
    return c.json(
      {
        success: false,
        error:
          "Could not resolve customer. Use an existing customer ID/external ID or pass a customer email to auto-create.",
      },
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

  const customerRef =
    customerRecord.providerCustomerId ||
    customerRecord.paystackCustomerId ||
    customerRecord.email;

  // Always use checkout for credit pack purchases (auto-charge reserved for overages only)
  // Try to sync credit pack to provider for native line-item checkout
  const syncResult = await deps.ensureCreditPackSynced(
    db,
    creditPack,
    resolvedAdapter,
    selectedAccount,
  );

  const checkoutResult = await resolvedAdapter.createCheckoutSession({
    customer: { id: customerRef, email: customerRecord.email },
    plan: null,
    amount: totalPrice,
    currency: currency || creditPack.currency || "USD",
    callbackUrl: callbackUrl,
    metadata: purchaseMetadata,
    // If provider supports native products, use lineItems for adjustable quantity
    ...(syncResult
      ? {
          lineItems: [
            {
              priceId: syncResult.priceId,
              quantity,
              adjustableQuantity: { enabled: true, minimum: 1, maximum: 100 },
            },
          ],
        }
      : {}),
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

export default createAddonRoute();
