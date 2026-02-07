import { Hono } from "hono";
import { z } from "zod";
import { eq, and, or } from "drizzle-orm";
import { schema } from "@owostack/db";
import { verifyApiKey } from "../../lib/api-keys";
import { BillingService } from "../../lib/billing";
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

  const billingService = new BillingService(db);
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

  const billingService = new BillingService(db);
  const result = await billingService.generateInvoice(customer.id, organizationId);

  if (result.isErr()) {
    if (result.error.message.includes("Unbilled usage")) {
      return c.json({ success: false, error: "No unbilled usage to invoice" }, 400);
    }
    return c.json({ success: false, error: result.error.message }, 500);
  }

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

  const billingService = new BillingService(db);
  const result = await billingService.getInvoices(customer.id, organizationId);

  if (result.isErr()) {
    return c.json({ success: false, error: result.error.message }, 500);
  }

  return c.json({
    success: true,
    invoices: result.value,
  });
});

export default app;
