import { beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {},
}));

import {
  OverageBillingWorkflow,
  type OverageBillingWorkflowDependencies,
} from "./overage-billing";
import {
  createWorkflowInstance,
  createWorkflowStepMock,
} from "./test-helpers";

type DbOptions = {
  overageSettings?: {
    billing_interval: string;
    threshold_amount: number | null;
    auto_collect: number;
    grace_period_hours: number;
  } | null;
  paymentMethodForMinimumCheck?: { provider_id: string } | null;
  defaultPaymentMethod?: { token: string; provider_id: string } | null;
  customerEmail?: string | null;
  existingInvoice?: {
    id: string;
    number: string;
    total: number;
    currency: string;
    status: string;
  } | null;
  invoiceCount?: number;
};

function createDbMock(options: DbOptions = {}) {
  const state = {
    invoices: [] as Array<{
      id: string;
      number: string;
      total: number;
      currency: string;
      status: string;
      amountPaid: number;
      amountDue: number;
    }>,
    invoiceItems: [] as Array<{
      invoiceId: string;
      featureId: string;
      amount: number;
      unitPrice: number;
      metadata: Record<string, unknown> | null;
    }>,
    paymentAttempts: [] as Array<{
      invoiceId: string;
      amount: number;
      currency: string;
      status: string;
      provider: string;
      providerReference: string | null;
      attemptNumber: number;
      lastError: string | null;
    }>,
  };

  const invoiceStatusById = new Map<string, string>();
  if (options.existingInvoice) {
    invoiceStatusById.set(
      options.existingInvoice.id,
      options.existingInvoice.status,
    );
  }

  return {
    state,
    DB: {
      prepare(sql: string) {
        return {
          bind(...params: any[]) {
            return {
              async first() {
                if (
                  sql.includes(
                    "SELECT * FROM overage_settings WHERE organization_id",
                  )
                ) {
                  return (
                    options.overageSettings || {
                      billing_interval: "end_of_period",
                      threshold_amount: null,
                      auto_collect: 1,
                      grace_period_hours: 0,
                    }
                  );
                }

                if (
                  sql.includes(
                    "SELECT provider_id FROM payment_methods WHERE customer_id",
                  )
                ) {
                  return options.paymentMethodForMinimumCheck ?? null;
                }

                if (
                  sql.includes("SELECT id, number, total, currency FROM invoices")
                ) {
                  return options.existingInvoice ?? null;
                }

                if (sql.includes("SELECT COUNT(*) as count FROM invoices")) {
                  return { count: options.invoiceCount ?? 0 };
                }

                if (
                  sql.includes(
                    "SELECT id FROM invoice_items WHERE invoice_id = ? AND feature_id = ?",
                  )
                ) {
                  return null;
                }

                if (
                  sql.includes(
                    "SELECT token, provider_id FROM payment_methods WHERE customer_id",
                  )
                ) {
                  return options.defaultPaymentMethod ?? null;
                }

                if (sql.includes("SELECT email FROM customers WHERE id = ?")) {
                  return { email: options.customerEmail ?? null };
                }

                if (sql.includes("SELECT status FROM invoices WHERE id = ?")) {
                  const invoiceId = params[0];
                  const status = invoiceStatusById.get(invoiceId);
                  return status ? { status } : null;
                }

                return null;
              },
              async run() {
                if (sql.includes("INSERT INTO invoices")) {
                  const invoice = {
                    id: params[0],
                    number: params[3],
                    currency: params[4],
                    total: params[6],
                    status: "open",
                    amountPaid: 0,
                    amountDue: params[7],
                  };
                  state.invoices.push(invoice);
                  invoiceStatusById.set(invoice.id, "open");
                }

                if (sql.includes("INSERT INTO invoice_items")) {
                  state.invoiceItems.push({
                    invoiceId: params[1],
                    featureId: params[2],
                    amount: params[6],
                    unitPrice: params[5],
                    metadata: params[9] ? JSON.parse(params[9]) : null,
                  });
                }

                if (sql.includes("INSERT INTO payment_attempts")) {
                  if (params.length === 6) {
                    state.paymentAttempts.push({
                      invoiceId: params[1],
                      amount: params[2],
                      currency: params[3],
                      status: "failed",
                      provider: params[4],
                      providerReference: null,
                      attemptNumber: 1,
                      lastError: sql.includes("No provider account configured")
                        ? "No provider account configured"
                        : "No payment method on file",
                    });
                  } else {
                    state.paymentAttempts.push({
                      invoiceId: params[1],
                      amount: params[2],
                      currency: params[3],
                      status: params[4],
                      provider: params[5],
                      providerReference: params[6] ?? null,
                      attemptNumber: params[7],
                      lastError: params[8] ?? null,
                    });
                  }
                }

                if (sql.includes("UPDATE invoices SET status = 'paid'")) {
                  const invoiceId = params[2];
                  const invoice = state.invoices.find(
                    (item) => item.id === invoiceId,
                  );
                  if (invoice) {
                    invoice.status = "paid";
                    invoice.amountPaid = params[0];
                    invoice.amountDue = 0;
                  }
                  invoiceStatusById.set(invoiceId, "paid");
                }

                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };
}

function createUnbilledUsage(totalEstimated = 25000) {
  return {
    customerId: "cust_1",
    totalEstimated,
    currency: "USD",
    features: [
      {
        featureId: "feature_1",
        featureSlug: "agent-runs",
        featureName: "Agent Runs",
        usageModel: "usage_based",
        usage: 1200,
        included: null,
        billableQuantity: 1200,
        pricePerUnit: 0,
        billingUnits: 1,
        ratingModel: "volume" as const,
        tierBreakdown: [
          {
            tier: 1,
            units: 1200,
            unitPrice: 0,
            flatFee: 25000,
            amount: totalEstimated,
          },
        ],
        estimatedAmount: totalEstimated,
        periodStart: 1_000,
        periodEnd: 2_000,
      },
    ],
  };
}

describe("OverageBillingWorkflow", () => {
  const getUnbilledUsageMock = vi.fn();
  const chargeAuthorizationMock = vi.fn();
  const resolveProviderAccountMock = vi.fn();
  const markUsageInvoicedMock = vi.fn();
  const invalidateSubscriptionCacheMock = vi.fn(async () => undefined);
  const createDbMockFn = vi.fn((db) => db);
  const deps: OverageBillingWorkflowDependencies = {
    getAdapter: vi.fn(() => ({
      chargeAuthorization: chargeAuthorizationMock,
    })) as unknown as OverageBillingWorkflowDependencies["getAdapter"],
    intervalToMs: vi.fn((interval: string) => {
      switch (interval) {
        case "monthly":
          return 30 * 24 * 60 * 60 * 1000;
        default:
          return 30 * 24 * 60 * 60 * 1000;
      }
    }) as unknown as OverageBillingWorkflowDependencies["intervalToMs"],
    invalidateSubscriptionCache:
      invalidateSubscriptionCacheMock as unknown as OverageBillingWorkflowDependencies["invalidateSubscriptionCache"],
    resolveProviderAccount:
      resolveProviderAccountMock as unknown as OverageBillingWorkflowDependencies["resolveProviderAccount"],
    createDb:
      createDbMockFn as unknown as OverageBillingWorkflowDependencies["createDb"],
    createBillingService: (() => ({
      getUnbilledUsage: getUnbilledUsageMock,
    })) as OverageBillingWorkflowDependencies["createBillingService"],
    markUsageInvoiced:
      markUsageInvoicedMock as unknown as OverageBillingWorkflowDependencies["markUsageInvoiced"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    OverageBillingWorkflow.dependencies = deps;
    getUnbilledUsageMock.mockResolvedValue(Result.ok(createUnbilledUsage()));
    chargeAuthorizationMock.mockResolvedValue(Result.ok({ reference: "ch_123" }));
    resolveProviderAccountMock.mockResolvedValue({
      id: "acct_1",
      organizationId: "org_1",
      providerId: "paystack",
      environment: "test",
      credentials: { secretKey: "sk_test" },
      createdAt: 0,
      updatedAt: 0,
    });
    markUsageInvoicedMock.mockResolvedValue(true);
  });

  it("creates an invoice, preserves flat-fee tier metadata, and auto-collects successfully", async () => {
    const db = createDbMock({
      paymentMethodForMinimumCheck: { provider_id: "paystack" },
      defaultPaymentMethod: { token: "AUTH_123", provider_id: "paystack" },
      customerEmail: "customer@example.com",
    });

    await OverageBillingWorkflow.prototype.run.call(
      createWorkflowInstance(OverageBillingWorkflow, {
        DB: db.DB,
        ENCRYPTION_KEY: "key",
      }),
      {
        payload: {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
        },
      },
      createWorkflowStepMock(),
    );

    expect(createDbMockFn).toHaveBeenCalledWith(db.DB);
    expect(getUnbilledUsageMock).toHaveBeenCalledWith("cust_1", "org_1");
    expect(chargeAuthorizationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationCode: "AUTH_123",
        amount: 25000,
        metadata: expect.objectContaining({
          type: "overage_billing",
          organization_id: "org_1",
          customer_id: "cust_1",
        }),
      }),
    );
    expect(db.state.invoices).toHaveLength(1);
    expect(db.state.invoices[0]).toEqual(
      expect.objectContaining({
        status: "paid",
        amountPaid: 25000,
        amountDue: 0,
      }),
    );
    expect(db.state.invoiceItems).toEqual([
      expect.objectContaining({
        amount: 25000,
        unitPrice: 0,
        metadata: {
          ratingModel: "volume",
          tierBreakdown: [
            {
              tier: 1,
              units: 1200,
              unitPrice: 0,
              flatFee: 25000,
              amount: 25000,
            },
          ],
        },
      }),
    ]);
    expect(db.state.paymentAttempts).toEqual([
      expect.objectContaining({
        status: "succeeded",
        provider: "paystack",
        providerReference: "ch_123",
        lastError: null,
      }),
    ]);
  });

  it("records a failed attempt when no payment method is on file", async () => {
    const db = createDbMock({
      paymentMethodForMinimumCheck: null,
      defaultPaymentMethod: null,
      customerEmail: "customer@example.com",
    });

    await OverageBillingWorkflow.prototype.run.call(
      createWorkflowInstance(OverageBillingWorkflow, {
        DB: db.DB,
        ENCRYPTION_KEY: "key",
      }),
      {
        payload: {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
        },
      },
      createWorkflowStepMock(),
    );

    expect(chargeAuthorizationMock).not.toHaveBeenCalled();
    expect(db.state.invoices[0]).toEqual(
      expect.objectContaining({
        status: "open",
        amountPaid: 0,
        amountDue: 25000,
      }),
    );
    expect(db.state.paymentAttempts).toEqual([
      expect.objectContaining({
        status: "failed",
        provider: "unknown",
        attemptNumber: 1,
        lastError: "No payment method on file",
      }),
    ]);
  });

  it("records a failed attempt when the provider account is missing", async () => {
    resolveProviderAccountMock.mockResolvedValueOnce(null);
    const db = createDbMock({
      paymentMethodForMinimumCheck: { provider_id: "paystack" },
      defaultPaymentMethod: { token: "AUTH_123", provider_id: "paystack" },
      customerEmail: "customer@example.com",
    });

    await OverageBillingWorkflow.prototype.run.call(
      createWorkflowInstance(OverageBillingWorkflow, {
        DB: db.DB,
        ENCRYPTION_KEY: "key",
      }),
      {
        payload: {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
        },
      },
      createWorkflowStepMock(),
    );

    expect(chargeAuthorizationMock).not.toHaveBeenCalled();
    expect(db.state.invoices[0]).toEqual(
      expect.objectContaining({
        status: "open",
      }),
    );
    expect(db.state.paymentAttempts).toEqual([
      expect.objectContaining({
        status: "failed",
        provider: "paystack",
        attemptNumber: 1,
        lastError: "No provider account configured",
      }),
    ]);
  });

  it("keeps the provider error on failed charge attempts", async () => {
    chargeAuthorizationMock.mockResolvedValueOnce(
      Result.err({
        code: "invalid_request",
        message: "authorization expired",
        providerId: "paystack",
      }),
    );
    const step = createWorkflowStepMock();
    const db = createDbMock({
      paymentMethodForMinimumCheck: { provider_id: "paystack" },
      defaultPaymentMethod: { token: "AUTH_123", provider_id: "paystack" },
      customerEmail: "customer@example.com",
    });

    await OverageBillingWorkflow.prototype.run.call(
      createWorkflowInstance(OverageBillingWorkflow, {
        DB: db.DB,
        ENCRYPTION_KEY: "key",
      }),
      {
        payload: {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
        },
      },
      step,
    );

    expect(step.sleep).not.toHaveBeenCalled();
    expect(db.state.invoices[0]).toEqual(
      expect.objectContaining({
        status: "open",
        amountPaid: 0,
        amountDue: 25000,
      }),
    );
    expect(db.state.paymentAttempts).toEqual([
      expect.objectContaining({
        status: "failed",
        provider: "paystack",
        attemptNumber: 1,
        lastError: "authorization expired",
      }),
    ]);
  });
});
