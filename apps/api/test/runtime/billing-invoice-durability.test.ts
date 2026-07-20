import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@owostack/db";
import { BillingService } from "../../src/lib/billing";
import { createRuntimeBusinessDb } from "./helpers/business-db";
import { insertFeature } from "./helpers/overage-runtime";
import { insertCustomer, insertOrganization } from "./helpers/workflow-runtime";

describe("BillingService invoice usage durability", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_invoice_durability" });
    await insertCustomer(businessDb.d1, {
      id: "cust_invoice_durability",
      organizationId: "org_invoice_durability",
      email: "invoice-durability@example.com",
    });
    await insertFeature(businessDb.d1, {
      id: "feature_invoice_durability",
      organizationId: "org_invoice_durability",
      slug: "api-calls",
      name: "API Calls",
      type: "metered",
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  function createUnbilledUsage() {
    return {
      customerId: "cust_invoice_durability",
      usageWindowEnd: 2_000,
      currency: "USD",
      totalEstimated: 500,
      features: [
        {
          featureId: "feature_invoice_durability",
          featureSlug: "api-calls",
          featureName: "API Calls",
          usageModel: "usage_based",
          usage: 5,
          included: 0,
          billableQuantity: 5,
          pricePerUnit: 100,
          billingUnits: 1,
          estimatedAmount: 500,
          periodStart: 1_000,
          periodEnd: 2_000,
          billingGroupKey: "feature_invoice_durability:1000:2000",
        },
      ],
    };
  }

  it("marks usage only after the invoice row is durably readable", async () => {
    const observedInvoiceIds: string[] = [];
    const service = new BillingService(businessDb.db, {
      deps: {
        markUsageInvoiced: async (_ctx, params) => {
          const invoice = await businessDb.db.query.invoices.findFirst({
            where: eq(schema.invoices.id, params.invoiceId),
          });
          if (!invoice) return null;
          observedInvoiceIds.push(invoice.id);
          return 1;
        },
        releaseUsageInvoice: async () => 0,
        releaseCustomerOverageBlockForInvoice: async () => undefined,
        sumUsageAmount: async () => 0,
        sumUnbilledByFeaturePeriod: async () => [],
      },
    });

    const result = await service.createInvoiceFromUsage(
      "cust_invoice_durability",
      "org_invoice_durability",
      createUnbilledUsage(),
      {
        idempotencyKey: "manual:org_invoice_durability:cust_invoice_durability:2000",
        sourceTrigger: "manual",
      },
    );

    expect(result.invoiceId).toBeTruthy();
    expect(observedInvoiceIds).toEqual([result.invoiceId]);
  });

  it("voids a durable invoice and releases partial ledger marks if a later mark fails", async () => {
    await insertFeature(businessDb.d1, {
      id: "feature_invoice_durability_2",
      organizationId: "org_invoice_durability",
      slug: "storage",
      name: "Storage",
      type: "metered",
    });

    const releasedInvoiceIds: string[] = [];
    const service = new BillingService(businessDb.db, {
      deps: {
        markUsageInvoiced: async (_ctx, params) => {
          if (params.featureId === "feature_invoice_durability_2") {
            return null;
          }
          return 1;
        },
        releaseUsageInvoice: async (_ctx, invoiceId) => {
          releasedInvoiceIds.push(invoiceId);
          return 1;
        },
        releaseCustomerOverageBlockForInvoice: async () => undefined,
        sumUsageAmount: async () => 0,
        sumUnbilledByFeaturePeriod: async () => [],
      },
    });

    const unbilled = createUnbilledUsage();
    unbilled.features.push({
      featureId: "feature_invoice_durability_2",
      featureSlug: "storage",
      featureName: "Storage",
      usageModel: "usage_based",
      usage: 2,
      included: 0,
      billableQuantity: 2,
      pricePerUnit: 50,
      billingUnits: 1,
      estimatedAmount: 100,
      periodStart: 1_000,
      periodEnd: 2_000,
      billingGroupKey: "feature_invoice_durability_2:1000:2000",
    });
    unbilled.totalEstimated = 600;

    await expect(
      service.createInvoiceFromUsage(
        "cust_invoice_durability",
        "org_invoice_durability",
        unbilled,
        {
          idempotencyKey: "manual:org_invoice_durability:cust_invoice_durability:2000",
          sourceTrigger: "manual",
        },
      ),
    ).rejects.toThrow("Failed to mark usage as invoiced");

    expect(releasedInvoiceIds).toHaveLength(1);
    const invoice = await businessDb.db.query.invoices.findFirst({
      where: eq(schema.invoices.id, releasedInvoiceIds[0]!),
    });

    expect(invoice).toMatchObject({
      status: "void",
      amountDue: 0,
    });
    expect(invoice?.metadata).toMatchObject({
      sourceTrigger: "manual",
      voidedReason: "usage_ledger_mark_failed",
      releasedUsageRecords: 1,
    });
  });
});
