import { Hono } from "hono";
import { z } from "zod";
import { eq, and, or, inArray } from "drizzle-orm";
import { schema } from "@owostack/db";
import { verifyApiKey } from "../../lib/api-keys";
import { BillingService } from "../../lib/billing";
import {
  getProviderRegistry,
  deriveProviderEnvironment,
  loadProviderAccounts,
} from "../../lib/providers";
import { trackBusinessEvent } from "../../lib/analytics-engine";
import type { Env, Variables } from "../../index";
import { zodErrorToResponse } from "../../lib/validation";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Middleware for API Key Auth
app.use("*", async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "Missing API Key" }, 401);
  }

  const apiKey = authHeader.split(" ")[1];
  const authDb = c.get("authDb");

  const keyRecord = await verifyApiKey(authDb, apiKey);
  if (!keyRecord) {
    return c.json({ success: false, error: "Invalid API Key" }, 401);
  }

  c.set("organizationId", keyRecord.organizationId);
  return await next();
});

const customerSchema = z.object({
  customer: z.string(),
});

/**
 * Resolve customer by ID, externalId, or email
 */
async function resolveCustomer(db: any, organizationId: string, customerId: string) {
  const customerIdLower = customerId.toLowerCase();
  return await db.query.customers.findFirst({
    where: and(
      eq(schema.customers.organizationId, organizationId),
      or(
        eq(schema.customers.id, customerId),
        eq(schema.customers.externalId, customerId),
        eq(schema.customers.email, customerIdLower),
      ),
    ),
  });
}

/**
 * GET /billing/usage - Get unbilled usage for a customer
 */
app.get("/usage", async (c) => {
  const customerId = c.req.query("customer");
  
  if (!customerId) {
    return c.json({ success: false, error: "customer query param required" }, 400);
  }

  const db = c.get("db");
  const organizationId = c.get("organizationId");

  if (!organizationId) {
    return c.json({ success: false, error: "Organization Context Missing" }, 500);
  }

  const customer = await resolveCustomer(db, organizationId, customerId);
  if (!customer) {
    return c.json({ success: false, error: "Customer not found" }, 404);
  }

  const billingService = new BillingService(db, {
    usageLedger: c.env.USAGE_LEDGER,
  });
  const result = await billingService.getUnbilledUsage(customer.id, organizationId);

  if (result.isErr()) {
    return c.json({ success: false, error: result.error.message }, 500);
  }

  return c.json({
    success: true,
    ...result.value,
  });
});

/**
 * POST /billing/invoice - Generate an invoice for a customer
 */
app.post("/invoice", async (c) => {
  const body = await c.req.json();
  const parsed = customerSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const db = c.get("db");
  const organizationId = c.get("organizationId");

  if (!organizationId) {
    return c.json({ success: false, error: "Organization Context Missing" }, 500);
  }

  const customer = await resolveCustomer(db, organizationId, parsed.data.customer);
  if (!customer) {
    return c.json({ success: false, error: "Customer not found" }, 404);
  }

  const billingService = new BillingService(db, {
    usageLedger: c.env.USAGE_LEDGER,
  });
  const result = await billingService.generateInvoice(customer.id, organizationId);

  if (result.isErr()) {
    const noUsage = result.error.message.includes("Unbilled usage");
    trackBusinessEvent(c.env, {
      event: "billing.invoice.generate",
      outcome: noUsage ? "empty" : "error",
      organizationId,
      customerId: customer.id,
    });

    if (result.error.message.includes("Unbilled usage")) {
      return c.json({ success: false, error: "No unbilled usage to invoice" }, 400);
    }
    return c.json({ success: false, error: result.error.message }, 500);
  }

  trackBusinessEvent(c.env, {
    event: "billing.invoice.generate",
    outcome: "success",
    organizationId,
    customerId: customer.id,
    value: Number(result.value.total || 0),
    currency: result.value.currency || null,
  });

  return c.json({
    success: true,
    invoice: result.value,
  });
});

/**
 * GET /billing/invoices - List invoices for a customer
 */
app.get("/invoices", async (c) => {
  const customerId = c.req.query("customer");
  
  if (!customerId) {
    return c.json({ success: false, error: "customer query param required" }, 400);
  }

  const db = c.get("db");
  const organizationId = c.get("organizationId");

  if (!organizationId) {
    return c.json({ success: false, error: "Organization Context Missing" }, 500);
  }

  const customer = await resolveCustomer(db, organizationId, customerId);
  if (!customer) {
    return c.json({ success: false, error: "Customer not found" }, 404);
  }

  const billingService = new BillingService(db, {
    usageLedger: c.env.USAGE_LEDGER,
  });
  const result = await billingService.getInvoices(customer.id, organizationId);

  if (result.isErr()) {
    return c.json({ success: false, error: result.error.message }, 500);
  }

  return c.json({
    success: true,
    invoices: result.value,
  });
});

/**
 * POST /billing/invoice/:id/pay - Pay an invoice (auto-charge or checkout fallback)
 */
const payInvoiceSchema = z.object({
  callbackUrl: z.string().url().optional(),
});

app.post("/invoice/:id/pay", async (c) => {
  const invoiceId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = payInvoiceSchema.safeParse(body);

  const db = c.get("db");
  const authDb = c.get("authDb");
  const organizationId = c.get("organizationId");

  if (!organizationId) {
    return c.json({ success: false, error: "Organization Context Missing" }, 500);
  }

  // 1. Load the invoice
  const invoice = await db.query.invoices.findFirst({
    where: and(
      eq(schema.invoices.id, invoiceId),
      eq(schema.invoices.organizationId, organizationId),
    ),
  });

  if (!invoice) {
    trackBusinessEvent(c.env, {
      event: "billing.invoice.pay",
      outcome: "invoice_not_found",
      organizationId,
    });
    return c.json({ success: false, error: "Invoice not found" }, 404);
  }

  if (invoice.status === "paid") {
    trackBusinessEvent(c.env, {
      event: "billing.invoice.pay",
      outcome: "already_paid",
      organizationId,
      customerId: invoice.customerId,
      value: Number(invoice.total || 0),
      currency: invoice.currency || null,
    });
    return c.json({
      success: true,
      paid: true,
      invoice: {
        id: invoice.id,
        number: invoice.number,
        total: invoice.total,
        currency: invoice.currency,
        status: invoice.status,
      },
    });
  }

  if (invoice.status !== "open") {
    trackBusinessEvent(c.env, {
      event: "billing.invoice.pay",
      outcome: "invalid_status",
      organizationId,
      customerId: invoice.customerId,
    });
    return c.json({ success: false, error: `Invoice is ${invoice.status} — only open invoices can be paid` }, 400);
  }

  if (!invoice.amountDue || invoice.amountDue <= 0) {
    trackBusinessEvent(c.env, {
      event: "billing.invoice.pay",
      outcome: "no_outstanding_balance",
      organizationId,
      customerId: invoice.customerId,
    });
    return c.json({ success: false, error: "Invoice has no outstanding balance" }, 400);
  }

  // 2. Load customer
  const customer = await db.query.customers.findFirst({
    where: eq(schema.customers.id, invoice.customerId),
  });

  if (!customer) {
    return c.json({ success: false, error: "Customer not found" }, 404);
  }

  // 3. Resolve provider from the customer's subscription
  const subscription = await db.query.subscriptions.findFirst({
    where: and(
      eq(schema.subscriptions.customerId, customer.id),
      inArray(schema.subscriptions.status, ["active", "canceled", "pending_cancel"]),
    ),
  });

  if (!subscription?.providerId) {
    trackBusinessEvent(c.env, {
      event: "billing.invoice.pay",
      outcome: "provider_missing",
      organizationId,
      customerId: customer.id,
    });
    return c.json({ success: false, error: "No provider configured for this customer" }, 400);
  }

  const project = await authDb.query.projects.findFirst({
    where: eq(schema.projects.organizationId, organizationId),
  });

  const providerEnv = deriveProviderEnvironment(
    c.env.ENVIRONMENT,
    project?.activeEnvironment,
  );

  const registry = getProviderRegistry();
  const adapter = registry.get(subscription.providerId);
  const accounts = await loadProviderAccounts(db, organizationId, c.env.ENCRYPTION_KEY);
  const account = accounts.find(
    (a) => a.providerId === subscription.providerId && a.environment === providerEnv,
  );

  if (!adapter || !account) {
    trackBusinessEvent(c.env, {
      event: "billing.invoice.pay",
      outcome: "provider_not_configured",
      organizationId,
      customerId: customer.id,
      providerId: subscription.providerId,
    });
    return c.json({ success: false, error: "Payment provider not configured" }, 400);
  }

  // 4. Try auto-charge if customer has a saved payment method
  const authCode = customer.providerAuthorizationCode;
  if (authCode && adapter.chargeAuthorization) {
    try {
      // Re-check invoice status to guard against concurrent pay requests
      const freshInvoice = await db.query.invoices.findFirst({
        where: and(
          eq(schema.invoices.id, invoice.id),
          eq(schema.invoices.status, "open"),
        ),
      });
      if (!freshInvoice) {
        return c.json({ success: true, paid: true, invoice: {
          id: invoice.id, number: invoice.number, total: invoice.total,
          currency: invoice.currency, status: "paid",
        }});
      }

      const chargeRef = `inv-${invoice.id.slice(0, 8)}-${Date.now()}`;
      const chargeResult = await adapter.chargeAuthorization({
        customer: {
          id: customer.providerCustomerId || customer.id,
          email: customer.email,
        },
        authorizationCode: authCode,
        amount: invoice.amountDue,
        currency: invoice.currency,
        reference: chargeRef,
        metadata: {
          type: "invoice_payment",
          invoice_id: invoice.id,
          invoice_number: invoice.number,
        },
        environment: providerEnv,
        account,
      });

      if (chargeResult.isOk()) {
        // Mark invoice as paid
        const now = Date.now();
        await db
          .update(schema.invoices)
          .set({
            status: "paid",
            amountPaid: invoice.amountDue,
            amountDue: 0,
            paidAt: now,
            updatedAt: now,
          })
          .where(eq(schema.invoices.id, invoice.id));

        trackBusinessEvent(c.env, {
          event: "billing.invoice.pay",
          outcome: "auto_charge_paid",
          organizationId,
          customerId: customer.id,
          providerId: subscription.providerId,
          value: Number(invoice.amountDue || 0),
          currency: invoice.currency || null,
        });

        return c.json({
          success: true,
          paid: true,
          invoice: {
            id: invoice.id,
            number: invoice.number,
            total: invoice.total,
            currency: invoice.currency,
            status: "paid",
          },
        });
      }

      // Charge failed — fall through to checkout
      console.warn(`[billing] Auto-charge failed for invoice ${invoice.id}:`, chargeResult.error.message);
      trackBusinessEvent(c.env, {
        event: "billing.invoice.pay",
        outcome: "auto_charge_failed",
        organizationId,
        customerId: customer.id,
        providerId: subscription.providerId,
        value: Number(invoice.amountDue || 0),
        currency: invoice.currency || null,
      });
    } catch (e) {
      console.warn(`[billing] Auto-charge error for invoice ${invoice.id}:`, e);
      trackBusinessEvent(c.env, {
        event: "billing.invoice.pay",
        outcome: "auto_charge_error",
        organizationId,
        customerId: customer.id,
        providerId: subscription.providerId,
        value: Number(invoice.amountDue || 0),
        currency: invoice.currency || null,
      });
    }
  }

  // 5. Fallback: create checkout session
  const callbackUrl = parsed.success ? parsed.data.callbackUrl : undefined;
  const checkoutResult = await adapter.createCheckoutSession({
    customer: {
      id: customer.providerCustomerId || customer.id,
      email: customer.email,
    },
    plan: null,
    amount: invoice.amountDue,
    currency: invoice.currency,
    callbackUrl,
    metadata: {
      type: "invoice_payment",
      invoice_id: invoice.id,
      invoice_number: invoice.number,
    },
    environment: providerEnv,
    account,
  });

  if (checkoutResult.isErr()) {
    // Some providers (e.g. Dodo) can't create raw-amount checkouts without a product.
    // If auto-charge was attempted but failed, communicate that clearly.
    const hasAuthCode = !!customer.providerAuthorizationCode;
    trackBusinessEvent(c.env, {
      event: "billing.invoice.pay",
      outcome: "checkout_error",
      organizationId,
      customerId: customer.id,
      providerId: subscription.providerId,
      value: Number(invoice.amountDue || 0),
      currency: invoice.currency || null,
    });
    return c.json({
      success: false,
      error: hasAuthCode
        ? `Auto-charge failed and checkout unavailable for this provider: ${checkoutResult.error.message}`
        : `No payment method on file and checkout creation failed: ${checkoutResult.error.message}`,
    }, 500);
  }

  trackBusinessEvent(c.env, {
    event: "billing.invoice.pay",
    outcome: "checkout_required",
    organizationId,
    customerId: customer.id,
    providerId: subscription.providerId,
    value: Number(invoice.amountDue || 0),
    currency: invoice.currency || null,
  });

  return c.json({
    success: true,
    paid: false,
    checkoutUrl: checkoutResult.value.url,
    invoice: {
      id: invoice.id,
      number: invoice.number,
      total: invoice.total,
      currency: invoice.currency,
      status: invoice.status,
    },
  });
});

export default app;
