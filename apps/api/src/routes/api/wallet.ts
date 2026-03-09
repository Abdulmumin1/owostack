import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { schema } from "@owostack/db";
import { verifyApiKey } from "../../lib/api-keys";
import {
  getProviderRegistry,
  loadProviderAccounts,
  deriveProviderEnvironment,
} from "../../lib/providers";
import type { ProviderAccount } from "@owostack/adapters";
import {
  isCustomerResolutionConflictError,
  resolveCustomerByIdentifier,
} from "../../lib/customer-resolution";
import type { Env, Variables } from "../../index";

export type WalletDependencies = {
  verifyApiKey: typeof verifyApiKey;
  getProviderRegistry: typeof getProviderRegistry;
  loadProviderAccounts: typeof loadProviderAccounts;
  deriveProviderEnvironment: typeof deriveProviderEnvironment;
};

const defaultDependencies: WalletDependencies = {
  verifyApiKey,
  getProviderRegistry,
  loadProviderAccounts,
  deriveProviderEnvironment,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toCardInfo(row: any) {
  if (row.type !== "card" || !row.cardLast4) return null;
  return {
    id: row.id,
    last4: row.cardLast4,
    brand: row.cardBrand || "unknown",
    exp:
      row.cardExpMonth && row.cardExpYear
        ? `${row.cardExpMonth}/${row.cardExpYear}`
        : "",
    provider: row.providerId,
  };
}

function toPaymentMethod(row: any) {
  return {
    id: row.id,
    type: row.type as "card" | "provider_managed",
    provider: row.providerId,
    isDefault: !!row.isDefault,
    isValid: !!row.isValid,
    card: toCardInfo(row),
  };
}

async function resolveCustomer(
  db: any,
  organizationId: string,
  customer: string,
) {
  const resolved = await resolveCustomerByIdentifier({
    db,
    organizationId,
    customerId: customer,
  });
  return resolved?.customer ?? null;
}

export function createWalletRoute(overrides: Partial<WalletDependencies> = {}) {
  const deps = { ...defaultDependencies, ...overrides };
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  async function resolveAuth(c: any) {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return {
        error: c.json({ success: false, error: "Missing API Key" }, 401),
      };
    }
    const apiKey = authHeader.split(" ")[1];
    const authDb = c.get("authDb");
    const keyRecord = await deps.verifyApiKey(authDb, apiKey);
    if (!keyRecord) {
      return {
        error: c.json({ success: false, error: "Invalid API Key" }, 401),
      };
    }
    return { keyRecord, authDb };
  }

  // ---------------------------------------------------------------------------
  // GET /wallet?customer=...
  // ---------------------------------------------------------------------------

  app.get("/wallet", async (c) => {
    const auth = await resolveAuth(c);
    if ("error" in auth) return auth.error;
    const { keyRecord } = auth;

    const customer = c.req.query("customer");
    if (!customer) {
      return c.json(
        { success: false, error: "customer query param required" },
        400,
      );
    }

    const db = c.get("db");
    const organizationId = keyRecord.organizationId;

    let dbCustomer;
    try {
      dbCustomer = await resolveCustomer(db, organizationId, customer);
    } catch (error) {
      if (isCustomerResolutionConflictError(error)) {
        return c.json({ success: false, error: error.message }, 409);
      }
      throw error;
    }
    if (!dbCustomer) {
      return c.json({ hasCard: false, card: null, methods: [] });
    }

    const methods = await db.query.paymentMethods.findMany({
      where: and(
        eq(schema.paymentMethods.customerId, dbCustomer.id),
        eq(schema.paymentMethods.organizationId, organizationId),
      ),
    });

    const mapped = methods.map(toPaymentMethod);
    const defaultMethod = mapped.find((m: any) => m.isDefault && m.isValid);

    return c.json({
      hasCard: !!defaultMethod,
      card: defaultMethod?.card || null,
      methods: mapped,
    });
  });

  // ---------------------------------------------------------------------------
  // POST /wallet/setup — generate a card capture checkout URL
  // ---------------------------------------------------------------------------

  const setupSchema = z.object({
    customer: z.string(),
    callbackUrl: z.string().url().optional(),
    provider: z.string().optional(),
  });

  function getCardSetupAmount(providerId: string, currency: string): number {
    // Stripe's API amounts are always in minor units and non-zero charges must meet
    // the settlement minimum. For USD, 100 = $1.00; 10000 would be $100.00.
    if (providerId === "stripe") {
      switch (currency.toUpperCase()) {
        case "JPY":
          return 100;
        case "GBP":
          return 100;
        case "EUR":
          return 100;
        case "USD":
        default:
          return 100;
      }
    }

    // Paystack's card-verification flow uses small local-currency authorizations.
    return 10000;
  }

  app.post("/wallet/setup", async (c) => {
    const auth = await resolveAuth(c);
    if ("error" in auth) return auth.error;
    const { keyRecord } = auth;

    const body = await c.req.json();
    const parsed = setupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { success: false, error: parsed.error.flatten().fieldErrors },
        400,
      );
    }

    const { customer, callbackUrl, provider } = parsed.data;
    const db = c.get("db");
    const organizationId = keyRecord.organizationId;

    let dbCustomer;
    try {
      dbCustomer = await resolveCustomer(db, organizationId, customer);
    } catch (error) {
      if (isCustomerResolutionConflictError(error)) {
        return c.json({ success: false, error: error.message }, 409);
      }
      throw error;
    }
    if (!dbCustomer) {
      return c.json({ success: false, error: "Customer not found" }, 404);
    }

    // Resolve org default currency — will be overridden by provider default if set
    const authDb = c.get("authDb");
    const org = await authDb.query.organizations.findFirst({
      where: eq(schema.organizations.id, organizationId),
    });
    const orgDefaultCurrency = (org?.metadata as any)?.defaultCurrency || null;

    // Resolve provider account from provider_accounts table
    const providerEnv = deps.deriveProviderEnvironment(c.env.ENVIRONMENT, null);
    const registry = deps.getProviderRegistry();
    const providerAccounts = await deps.loadProviderAccounts(
      db,
      organizationId,
      c.env.ENCRYPTION_KEY,
    );

    let selectedProviderId = provider || dbCustomer.providerId || null;
    let selectedAccount: ProviderAccount | undefined;

    if (selectedProviderId) {
      selectedAccount = providerAccounts.find(
        (a) =>
          a.providerId === selectedProviderId && a.environment === providerEnv,
      );
    }

    if (!selectedAccount) {
      const fallback = providerAccounts.find(
        (a) => a.environment === providerEnv,
      );
      if (fallback) {
        selectedProviderId = fallback.providerId;
        selectedAccount = fallback;
      }
    }

    if (!selectedAccount || !selectedProviderId) {
      return c.json(
        { success: false, error: "No payment provider configured" },
        400,
      );
    }

    const adapter = registry.get(selectedProviderId);
    if (!adapter) {
      return c.json(
        {
          success: false,
          error: `Provider '${selectedProviderId}' not registered`,
        },
        400,
      );
    }

    // Use the adapter's default currency for card setup (e.g. NGN for Paystack, USD for Dodo)
    // to avoid "unsupported_currency" errors when the org default doesn't match the provider.
    const setupCurrency =
      adapter.defaultCurrency || orgDefaultCurrency || "USD";

    const setupMetadata = {
      type: "card_setup",
      organization_id: organizationId,
      customer_id: dbCustomer.id,
      provider_id: selectedProviderId,
    };

    // Polar setup flow:
    // - Ensure a provider customer exists
    // - Create a customer session and return the hosted customer portal URL
    if (selectedProviderId === "polar" && adapter.createCustomerSession) {
      let providerCustomerId =
        dbCustomer.providerId === selectedProviderId
          ? dbCustomer.providerCustomerId
          : null;

      if (!providerCustomerId) {
        const createCustomerResult = await adapter.createCustomer({
          email: dbCustomer.email,
          name: dbCustomer.name || undefined,
          metadata: setupMetadata,
          environment: selectedAccount.environment as "test" | "live",
          account: selectedAccount,
        });

        if (createCustomerResult.isErr()) {
          return c.json(
            { success: false, error: createCustomerResult.error.message },
            400,
          );
        }

        providerCustomerId = createCustomerResult.value.id;

        // Persist the provider customer reference for future off-session charging.
        try {
          await db
            .update(schema.customers)
            .set({
              providerId: selectedProviderId,
              providerCustomerId,
              updatedAt: Date.now(),
            })
            .where(eq(schema.customers.id, dbCustomer.id));
        } catch (error) {
          console.error(
            "[wallet] Failed to persist Polar customer reference:",
            error,
          );
          return c.json(
            {
              success: false,
              error: "Failed to save customer payment profile",
            },
            500,
          );
        }
      }

      const sessionResult = await adapter.createCustomerSession({
        customer: {
          id: providerCustomerId,
          email: dbCustomer.email,
        },
        metadata: setupMetadata,
        environment: selectedAccount.environment as "test" | "live",
        account: selectedAccount,
      });

      if (sessionResult.isErr()) {
        return c.json(
          { success: false, error: sessionResult.error.message },
          400,
        );
      }

      c.header("Cache-Control", "no-store");
      return c.json({
        url: sessionResult.value.url,
        reference: sessionResult.value.token || providerCustomerId,
      });
    }

    // For product-centric providers (e.g. Dodo) that don't support raw-amount
    // checkout, we use an on-demand subscription with mandate_only=true.
    // This authorizes the customer's card without charging them, and gives us
    // a subscription ID we can charge later (for overages, etc.).
    let lineItems: any[] | undefined;
    let onDemand: { mandateOnly: boolean } | undefined;

    if (selectedProviderId === "dodopayments" && adapter.createPlan) {
      // Dodo on-demand mandate requires a *subscription* product (recurring_price),
      // not a one-time product. Use createPlan to create a recurring product.
      const metaKey = `cardSetupSubProduct_v1_${selectedProviderId}`;
      const cachedProductId = (org?.metadata as any)?.[metaKey];

      let productId = cachedProductId;
      if (!productId) {
        const planResult = await adapter.createPlan({
          name: "Payment Method Authorization",
          description: "Authorize payment method for future charges",
          amount: 100, // Dodo uses major units — $1.00 (not actually charged with mandate_only)
          currency: setupCurrency,
          interval: "monthly",
          environment: selectedAccount.environment as "test" | "live",
          account: selectedAccount,
        });

        if (planResult.isErr()) {
          return c.json(
            {
              success: false,
              error: `Failed to create card-setup product: ${planResult.error.message}`,
            },
            400,
          );
        }

        productId = planResult.value.id;

        // Cache in org metadata for reuse
        try {
          const existingMeta = (org?.metadata as any) || {};
          await authDb
            .update(schema.organizations)
            .set({ metadata: { ...existingMeta, [metaKey]: productId } })
            .where(eq(schema.organizations.id, organizationId));
        } catch {
          // Non-critical — will just recreate next time
        }
      }

      lineItems = [{ priceId: productId, quantity: 1 }];
      onDemand = { mandateOnly: true };
    }

    const result = await adapter.createCheckoutSession({
      customer: {
        id:
          dbCustomer.providerCustomerId ||
          dbCustomer.paystackCustomerId ||
          dbCustomer.email,
        email: dbCustomer.email,
      },
      plan: null,
      amount: getCardSetupAmount(selectedProviderId, setupCurrency),
      currency: setupCurrency,
      channels: ["card"],
      callbackUrl,
      metadata: setupMetadata,
      ...(lineItems ? { lineItems } : {}),
      ...(onDemand ? { onDemand } : {}),
      environment: selectedAccount.environment as "test" | "live",
      account: selectedAccount,
    });

    if (result.isErr()) {
      return c.json({ success: false, error: result.error.message }, 400);
    }

    c.header("Cache-Control", "no-store");
    return c.json({
      url: result.value.url,
      reference: result.value.reference,
    });
  });

  // ---------------------------------------------------------------------------
  // POST /wallet/remove — remove a payment method
  // ---------------------------------------------------------------------------

  const removeSchema = z.object({
    customer: z.string(),
    id: z.string(),
  });

  app.post("/wallet/remove", async (c) => {
    const auth = await resolveAuth(c);
    if ("error" in auth) return auth.error;
    const { keyRecord } = auth;

    const body = await c.req.json();
    const parsed = removeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { success: false, error: parsed.error.flatten().fieldErrors },
        400,
      );
    }

    const { customer, id } = parsed.data;
    const db = c.get("db");
    const organizationId = keyRecord.organizationId;

    let dbCustomer;
    try {
      dbCustomer = await resolveCustomer(db, organizationId, customer);
    } catch (error) {
      if (isCustomerResolutionConflictError(error)) {
        return c.json({ success: false, error: error.message }, 409);
      }
      throw error;
    }
    if (!dbCustomer) {
      return c.json({ success: false, error: "Customer not found" }, 404);
    }

    const deleted = await db
      .delete(schema.paymentMethods)
      .where(
        and(
          eq(schema.paymentMethods.id, id),
          eq(schema.paymentMethods.customerId, dbCustomer.id),
          eq(schema.paymentMethods.organizationId, organizationId),
        ),
      )
      .returning();

    if (deleted.length === 0) {
      return c.json({ success: false, error: "Payment method not found" }, 404);
    }

    return c.json({ success: true });
  });

  return app;
}

export default createWalletRoute();
