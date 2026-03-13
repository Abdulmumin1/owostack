import { describe, expect, it, vi } from "vitest";
import { BillingService } from "./billing";

describe("BillingService recovery", () => {
  it("rejects Stripe USD invoices below the provider minimum", async () => {
    const service = new BillingService(
      {
        query: {
          paymentMethods: {
            findFirst: vi.fn().mockResolvedValue({
              providerId: "stripe",
            }),
          },
        },
      } as any,
      {
        deps: {
          markUsageInvoiced: vi.fn(),
          releaseUsageInvoice: vi.fn(),
          releaseCustomerOverageBlockForInvoice: vi.fn(),
          sumUnbilledByFeaturePeriod: vi.fn(),
        },
      },
    );

    await expect(
      service.createInvoiceFromUsage(
        "cust_1",
        "org_1",
        {
          customerId: "cust_1",
          usageWindowEnd: 123,
          currency: "USD",
          totalEstimated: 30,
          features: [
            {
              featureId: "feature_1",
              featureSlug: "api-calls",
              featureName: "API Calls",
              usageModel: "usage_based",
              usage: 1,
              included: 0,
              billableQuantity: 1,
              pricePerUnit: 30,
              billingUnits: 1,
              estimatedAmount: 30,
              periodStart: 1,
              periodEnd: 2,
            },
          ],
        },
        {
          idempotencyKey: "manual:org_1:cust_1:123",
          sourceTrigger: "manual",
        },
      ),
    ).rejects.toMatchObject({
      _tag: "ValidationError",
      field: "invoice_amount",
    });
  });

  it("voids an open invoice and releases its usage back to the unbilled pool", async () => {
    const updateWhereMock = vi.fn(async () => []);
    const updateSetMock = vi.fn(() => ({
      where: updateWhereMock,
    }));
    const releaseUsageInvoiceMock = vi.fn().mockResolvedValue(3);
    const releaseCustomerOverageBlockForInvoiceMock = vi
      .fn()
      .mockResolvedValue(undefined);

    const service = new BillingService(
      {
        query: {
          invoices: {
            findFirst: vi.fn().mockResolvedValue({
              id: "inv_1",
              organizationId: "org_1",
              customerId: "cust_1",
              status: "open",
              amountDue: 30,
              total: 30,
              currency: "USD",
              metadata: { sourceTrigger: "threshold" },
            }),
          },
          paymentAttempts: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
        update: vi.fn(() => ({
          set: updateSetMock,
        })),
      } as any,
      {
        usageLedger: {} as any,
        deps: {
          markUsageInvoiced: vi.fn(),
          releaseUsageInvoice: releaseUsageInvoiceMock,
          releaseCustomerOverageBlockForInvoice:
            releaseCustomerOverageBlockForInvoiceMock,
          sumUnbilledByFeaturePeriod: vi.fn(),
        },
      },
    );

    const result = await service.releaseInvoiceToUnbilledUsage(
      "inv_1",
      "org_1",
      {
        reason: "below_provider_minimum",
        metadata: {
          providerId: "stripe",
          minimumAmount: 50,
          amountDue: 30,
          currency: "USD",
        },
      },
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value).toEqual({
      invoiceId: "inv_1",
      status: "void",
      releasedUsageRecords: 3,
    });
    expect(releaseUsageInvoiceMock).toHaveBeenCalledWith(
      expect.anything(),
      "inv_1",
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "void",
        amountDue: 0,
        metadata: expect.objectContaining({
          sourceTrigger: "threshold",
          release: expect.objectContaining({
            reason: "below_provider_minimum",
            releasedUsageRecords: 3,
            providerId: "stripe",
            minimumAmount: 50,
            amountDue: 30,
            currency: "USD",
          }),
        }),
      }),
    );
    expect(updateWhereMock).toHaveBeenCalledTimes(1);
    expect(releaseCustomerOverageBlockForInvoiceMock).toHaveBeenCalledWith(
      expect.anything(),
      "inv_1",
      {
        failureReason: "below_provider_minimum",
        metadata: {
          providerId: "stripe",
          minimumAmount: 50,
          amountDue: 30,
          currency: "USD",
        },
      },
    );
  });
});
