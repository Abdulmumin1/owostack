import { beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import { schema } from "@owostack/db";

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

type BillingRunRecord = {
  id: string;
  organizationId: string;
  customerId: string;
  trigger: string;
  status: string;
  idempotencyKey: string;
  activeLockKey: string | null;
  thresholdAmount: number | null;
  usageWindowStart: number | null;
  usageWindowEnd: number;
  invoiceId: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
};

type OverageBlockRecord = {
  id: string;
  customerId: string;
  organizationId: string;
  billingRunId: string | null;
  invoiceId: string | null;
  reason: string;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
};

type SqlInvoiceRecord = {
  id: string;
  number: string;
  total: number;
  currency: string;
  status: string;
  amountPaid: number;
  amountDue: number;
};

type SqlDbOptions = {
  overageSettings?: {
    billing_interval: string;
    threshold_amount: number | null;
    auto_collect: number;
    grace_period_hours: number;
  } | null;
  paymentMethodForMinimumCheck?: { provider_id: string } | null;
  defaultPaymentMethod?: { token: string; provider_id: string } | null;
  customerEmail?: string | null;
  customerProviderCustomerId?: string | null;
  customerPaystackCustomerId?: string | null;
  existingInvoice?: SqlInvoiceRecord | null;
  existingSuccessfulPaymentAttempt?: {
    provider_reference: string | null;
  } | null;
  duePaidSubscriptions?: Array<{
    id: string;
    customer_id: string;
    provider_id: string | null;
    provider_subscription_code: string | null;
    paystack_subscription_code: string | null;
    current_period_end: number;
  }>;
};

function createBillingRun(
  overrides?: Partial<BillingRunRecord>,
): BillingRunRecord {
  return {
    id: "run_1",
    organizationId: "org_1",
    customerId: "cust_1",
    trigger: "threshold",
    status: "pending",
    idempotencyKey: "threshold:org_1:cust_1:2500",
    activeLockKey: "threshold:cust_1",
    thresholdAmount: 20000,
    usageWindowStart: null,
    usageWindowEnd: 2500,
    invoiceId: null,
    failureReason: null,
    metadata: { effectiveThreshold: 20000 },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function createSqlDbMock(options: SqlDbOptions = {}) {
  const state = {
    invoices: options.existingInvoice ? [{ ...options.existingInvoice }] : [],
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
    subscriptionUpdates: [] as Array<{
      id: string;
      status: string;
      currentPeriodStart: number | null;
      currentPeriodEnd: number | null;
    }>,
  };

  const findInvoice = (invoiceId: string) =>
    state.invoices.find((invoice) => invoice.id === invoiceId) || null;

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
                  sql.includes(
                    "SELECT token, provider_id FROM payment_methods WHERE customer_id",
                  )
                ) {
                  return options.defaultPaymentMethod ?? null;
                }

                if (
                  sql.includes(
                    "SELECT email, provider_customer_id, paystack_customer_id FROM customers WHERE id = ?",
                  )
                ) {
                  return {
                    email: options.customerEmail ?? null,
                    provider_customer_id:
                      options.customerProviderCustomerId ?? null,
                    paystack_customer_id:
                      options.customerPaystackCustomerId ?? null,
                  };
                }

                if (sql.includes("SELECT status FROM invoices WHERE id = ?")) {
                  const invoice = findInvoice(params[0]);
                  return invoice ? { status: invoice.status } : null;
                }

                if (
                  sql.includes("FROM payment_attempts") &&
                  sql.includes("status = 'succeeded'")
                ) {
                  const succeededAttempt =
                    [...state.paymentAttempts]
                      .reverse()
                      .find((attempt) => attempt.status === "succeeded") || null;

                  return (
                    succeededAttempt
                      ? {
                          provider_reference: succeededAttempt.providerReference,
                        }
                      : options.existingSuccessfulPaymentAttempt
                  );
                }

                return null;
              },
              async all() {
                if (
                  sql.includes("FROM subscriptions s") &&
                  sql.includes("p.type != 'free'")
                ) {
                  return {
                    results: options.duePaidSubscriptions || [],
                  };
                }

                if (
                  sql.includes("FROM subscriptions s") &&
                  sql.includes("p.type = 'free'")
                ) {
                  return { results: [] };
                }

                return { results: [] };
              },
              async run() {
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
                  const invoice = findInvoice(invoiceId);
                  if (invoice) {
                    invoice.status = "paid";
                    invoice.amountPaid = params[0];
                    invoice.amountDue = 0;
                  }
                }

                if (
                  sql.includes("SET status = 'paid'") &&
                  sql.includes("paid_at = COALESCE")
                ) {
                  const invoiceId = params[3];
                  const invoice = findInvoice(invoiceId);
                  if (invoice) {
                    invoice.status = "paid";
                    invoice.amountPaid = params[0];
                    invoice.amountDue = 0;
                  }
                }

                if (
                  sql.includes("UPDATE subscriptions") &&
                  sql.includes("current_period_start = ?") &&
                  sql.includes("current_period_end = ?")
                ) {
                  state.subscriptionUpdates.push({
                    id: params[3],
                    status: "active",
                    currentPeriodStart: params[0],
                    currentPeriodEnd: params[1],
                  });
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

function createDrizzleDbMock(options?: {
  billingRun?: BillingRunRecord | null;
  overageBlock?: OverageBlockRecord | null;
}) {
  const state = {
    billingRun: options?.billingRun ? { ...options.billingRun } : null,
    overageBlock: options?.overageBlock ? { ...options.overageBlock } : null,
  };

  const db = {
    state,
    query: {
      billingRuns: {
        findFirst: vi.fn(async () => state.billingRun),
      },
      customerOverageBlocks: {
        findFirst: vi.fn(async () => state.overageBlock),
      },
    },
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (_where: unknown) => {
          if (table === schema.billingRuns && state.billingRun) {
            state.billingRun = {
              ...state.billingRun,
              ...values,
            } as BillingRunRecord;
          }

          return [];
        },
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === schema.customerOverageBlocks) {
          return {
            onConflictDoUpdate: async ({
              set,
            }: {
              set: Record<string, unknown>;
            }) => {
              state.overageBlock = {
                ...(state.overageBlock || values),
                ...(set || {}),
              } as OverageBlockRecord;
              return [];
            },
            returning: async () => [values],
          };
        }

        return {
          onConflictDoUpdate: async () => [],
          returning: async () => [],
        };
      },
    })),
    delete: vi.fn((table: unknown) => ({
      where: async (_where: unknown) => {
        if (table === schema.customerOverageBlocks) {
          state.overageBlock = null;
        }
        return [];
      },
    })),
  };

  return {
    state,
    db,
  };
}

function createUnbilledUsage(totalEstimated = 25000, usageWindowEnd = 2500) {
  return {
    customerId: "cust_1",
    usageWindowEnd,
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
            flatFee: totalEstimated,
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
  const createInvoiceFromUsageMock = vi.fn();
  const chargeAuthorizationMock = vi.fn();
  const fetchSubscriptionMock = vi.fn();
  const resolveProviderAccountMock = vi.fn();
  const invalidateSubscriptionCacheMock = vi.fn(async () => undefined);
  const createDbMockFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSubscriptionMock.mockResolvedValue(
      Result.ok({
        id: "sub_remote_1",
        status: "active",
        nextPaymentDate: "2026-04-01T00:00:00.000Z",
        startDate: "2026-03-01T00:00:00.000Z",
      }),
    );
    resolveProviderAccountMock.mockResolvedValue({
      id: "acct_1",
      organizationId: "org_1",
      providerId: "paystack",
      environment: "test",
      credentials: { secretKey: "sk_test" },
      createdAt: 0,
      updatedAt: 0,
    });
    getUnbilledUsageMock.mockResolvedValue(Result.ok(createUnbilledUsage()));
    chargeAuthorizationMock.mockResolvedValue(Result.ok({ reference: "ch_123" }));
  });

  function createDeps(sqlState: {
    invoices: SqlInvoiceRecord[];
    paymentAttempts: Array<{
      invoiceId: string;
      amount: number;
      currency: string;
      status: string;
      provider: string;
      providerReference: string | null;
      attemptNumber: number;
      lastError: string | null;
    }>;
  }) {
    return {
      getAdapter: vi.fn(() => ({
        chargeAuthorization: chargeAuthorizationMock,
        fetchSubscription: fetchSubscriptionMock,
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
        createInvoiceFromUsage: createInvoiceFromUsageMock.mockImplementation(
          async (_customerId, _organizationId, unbilled, options) => {
            const existingInvoice =
              sqlState.invoices.find(
                (invoice) => invoice.id === "inv_1",
              ) || null;

            if (!existingInvoice) {
              sqlState.invoices.push({
                id: "inv_1",
                number: "INV-00001-TEST",
                total: unbilled.totalEstimated,
                currency: unbilled.currency,
                status: "open",
                amountPaid: 0,
                amountDue: unbilled.totalEstimated,
              });
            }

            const invoice =
              sqlState.invoices.find((entry) => entry.id === "inv_1") ||
              sqlState.invoices[0];
            const periodStart = Math.min(
              ...unbilled.features.map((feature) => feature.periodStart),
            );
            const periodEnd = Math.max(
              ...unbilled.features.map((feature) => feature.periodEnd),
            );

            expect(options.idempotencyKey).toBeDefined();

            return {
              invoiceId: invoice.id,
              number: invoice.number,
              status: invoice.status,
              currency: invoice.currency,
              subtotal: invoice.total,
              total: invoice.total,
              items: [],
              periodStart,
              periodEnd,
              usageWindowEnd: unbilled.usageWindowEnd,
            };
          },
        ),
      })) as OverageBillingWorkflowDependencies["createBillingService"],
    } satisfies OverageBillingWorkflowDependencies;
  }

  it("uses the billing run cutoff, creates an idempotent threshold invoice, and completes on successful charge", async () => {
    const sql = createSqlDbMock({
      paymentMethodForMinimumCheck: { provider_id: "paystack" },
      defaultPaymentMethod: { token: "AUTH_123", provider_id: "paystack" },
      customerEmail: "customer@example.com",
    });
    const drizzle = createDrizzleDbMock({
      billingRun: createBillingRun(),
    });
    const deps = createDeps(sql.state);
    createDbMockFn.mockImplementation(() => drizzle.db);
    OverageBillingWorkflow.dependencies = deps;

    await OverageBillingWorkflow.prototype.run.call(
      createWorkflowInstance(OverageBillingWorkflow, {
        DB: sql.DB,
        ENCRYPTION_KEY: "key",
      }),
      {
        payload: {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
          billingRunId: "run_1",
        },
      },
      createWorkflowStepMock(),
    );

    expect(createDbMockFn).toHaveBeenCalledWith(sql.DB);
    expect(getUnbilledUsageMock).toHaveBeenCalledWith("cust_1", "org_1", {
      usageCutoffAt: 2500,
    });
    expect(createInvoiceFromUsageMock).toHaveBeenCalledWith(
      "cust_1",
      "org_1",
      expect.objectContaining({
        usageWindowEnd: 2500,
      }),
      expect.objectContaining({
        idempotencyKey: "threshold:org_1:cust_1:2500",
        sourceTrigger: "threshold",
      }),
    );
    expect(chargeAuthorizationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: expect.objectContaining({
          id: "cust_1",
          email: "customer@example.com",
        }),
        authorizationCode: "AUTH_123",
        amount: 25000,
        reference: "inv_1",
        metadata: expect.objectContaining({
          type: "overage_billing",
          billing_run_id: "run_1",
        }),
      }),
    );
    expect(sql.state.invoices).toEqual([
      expect.objectContaining({
        id: "inv_1",
        status: "paid",
        amountPaid: 25000,
        amountDue: 0,
      }),
    ]);
    expect(sql.state.paymentAttempts).toEqual([
      expect.objectContaining({
        status: "succeeded",
        provider: "paystack",
        providerReference: "ch_123",
      }),
    ]);
    expect(drizzle.state.billingRun).toEqual(
      expect.objectContaining({
        status: "completed",
        invoiceId: "inv_1",
        activeLockKey: null,
        failureReason: null,
      }),
    );
    expect(drizzle.state.overageBlock).toBeNull();
  });

  it("uses the provider customer id for Stripe threshold auto-collection", async () => {
    resolveProviderAccountMock.mockResolvedValueOnce({
      id: "acct_stripe_1",
      organizationId: "org_1",
      providerId: "stripe",
      environment: "test",
      credentials: { secretKey: "sk_test_stripe" },
      createdAt: 0,
      updatedAt: 0,
    });

    const sql = createSqlDbMock({
      paymentMethodForMinimumCheck: { provider_id: "stripe" },
      defaultPaymentMethod: { token: "pm_123", provider_id: "stripe" },
      customerEmail: "customer@example.com",
      customerProviderCustomerId: "cus_stripe_123",
    });
    const drizzle = createDrizzleDbMock({
      billingRun: createBillingRun(),
    });
    const deps = createDeps(sql.state);
    createDbMockFn.mockImplementation(() => drizzle.db);
    OverageBillingWorkflow.dependencies = deps;

    await OverageBillingWorkflow.prototype.run.call(
      createWorkflowInstance(OverageBillingWorkflow, {
        DB: sql.DB,
        ENCRYPTION_KEY: "key",
      }),
      {
        payload: {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
          billingRunId: "run_1",
        },
      },
      createWorkflowStepMock(),
    );

    expect(chargeAuthorizationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: expect.objectContaining({
          id: "cus_stripe_123",
          email: "customer@example.com",
        }),
        authorizationCode: "pm_123",
      }),
    );
  });

  it("blocks the customer and marks the billing run blocked when threshold auto-collection cannot start", async () => {
    const sql = createSqlDbMock({
      paymentMethodForMinimumCheck: null,
      defaultPaymentMethod: null,
      customerEmail: "customer@example.com",
    });
    const drizzle = createDrizzleDbMock({
      billingRun: createBillingRun(),
    });
    const deps = createDeps(sql.state);
    createDbMockFn.mockImplementation(() => drizzle.db);
    OverageBillingWorkflow.dependencies = deps;

    await OverageBillingWorkflow.prototype.run.call(
      createWorkflowInstance(OverageBillingWorkflow, {
        DB: sql.DB,
        ENCRYPTION_KEY: "key",
      }),
      {
        payload: {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
          billingRunId: "run_1",
        },
      },
      createWorkflowStepMock(),
    );

    expect(chargeAuthorizationMock).not.toHaveBeenCalled();
    expect(sql.state.invoices).toEqual([
      expect.objectContaining({
        id: "inv_1",
        status: "open",
        amountPaid: 0,
        amountDue: 25000,
      }),
    ]);
    expect(sql.state.paymentAttempts).toEqual([
      expect.objectContaining({
        status: "failed",
        provider: "unknown",
        attemptNumber: 1,
        lastError: "No payment method on file",
      }),
    ]);
    expect(drizzle.state.overageBlock).toEqual(
      expect.objectContaining({
        customerId: "cust_1",
        organizationId: "org_1",
        billingRunId: "run_1",
        invoiceId: "inv_1",
        reason: "no_payment_method_on_file",
      }),
    );
    expect(drizzle.state.billingRun).toEqual(
      expect.objectContaining({
        status: "blocked",
        invoiceId: "inv_1",
        activeLockKey: null,
        failureReason: "no_payment_method_on_file",
      }),
    );
  });

  it("reconciles a previously successful threshold payment attempt without charging again", async () => {
    const sql = createSqlDbMock({
      paymentMethodForMinimumCheck: { provider_id: "paystack" },
      defaultPaymentMethod: { token: "AUTH_123", provider_id: "paystack" },
      customerEmail: "customer@example.com",
      existingSuccessfulPaymentAttempt: { provider_reference: "ch_123" },
    });
    const drizzle = createDrizzleDbMock({
      billingRun: createBillingRun({
        status: "processing",
      }),
    });
    const deps = createDeps(sql.state);
    createDbMockFn.mockImplementation(() => drizzle.db);
    OverageBillingWorkflow.dependencies = deps;

    await OverageBillingWorkflow.prototype.run.call(
      createWorkflowInstance(OverageBillingWorkflow, {
        DB: sql.DB,
        ENCRYPTION_KEY: "key",
      }),
      {
        payload: {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
          billingRunId: "run_1",
        },
      },
      createWorkflowStepMock(),
    );

    expect(chargeAuthorizationMock).not.toHaveBeenCalled();
    expect(sql.state.invoices).toEqual([
      expect.objectContaining({
        id: "inv_1",
        status: "paid",
        amountPaid: 25000,
        amountDue: 0,
      }),
    ]);
    expect(drizzle.state.billingRun).toEqual(
      expect.objectContaining({
        status: "completed",
        invoiceId: "inv_1",
        activeLockKey: null,
      }),
    );
    expect(drizzle.state.overageBlock).toBeNull();
  });

  it("does not retry permanent provider invalid_request failures", async () => {
    chargeAuthorizationMock.mockResolvedValueOnce(
      Result.err({
        code: "invalid_request",
        message: "Stripe chargeAuthorization requires a Stripe customer ID",
        providerId: "stripe",
      }),
    );
    resolveProviderAccountMock.mockResolvedValueOnce({
      id: "acct_stripe_1",
      organizationId: "org_1",
      providerId: "stripe",
      environment: "test",
      credentials: { secretKey: "sk_test_stripe" },
      createdAt: 0,
      updatedAt: 0,
    });

    const sql = createSqlDbMock({
      paymentMethodForMinimumCheck: { provider_id: "stripe" },
      defaultPaymentMethod: { token: "pm_123", provider_id: "stripe" },
      customerEmail: "customer@example.com",
    });
    const drizzle = createDrizzleDbMock({
      billingRun: createBillingRun(),
    });
    const deps = createDeps(sql.state);
    createDbMockFn.mockImplementation(() => drizzle.db);
    OverageBillingWorkflow.dependencies = deps;
    const step = createWorkflowStepMock();

    await OverageBillingWorkflow.prototype.run.call(
      createWorkflowInstance(OverageBillingWorkflow, {
        DB: sql.DB,
        ENCRYPTION_KEY: "key",
      }),
      {
        payload: {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
          billingRunId: "run_1",
        },
      },
      step,
    );

    expect(chargeAuthorizationMock).toHaveBeenCalledTimes(1);
    expect(step.sleep).not.toHaveBeenCalledWith(
      expect.stringMatching(/^charge-retry-wait-/),
      expect.any(Number),
    );
    expect(sql.state.paymentAttempts).toEqual([
      expect.objectContaining({
        status: "failed",
        provider: "stripe",
        attemptNumber: 1,
        lastError: "Stripe chargeAuthorization requires a Stripe customer ID",
      }),
    ]);
    expect(drizzle.state.billingRun).toEqual(
      expect.objectContaining({
        status: "blocked",
        failureReason: "threshold_charge_failed",
      }),
    );
  });

  it("defers a threshold run when the fixed usage slice is still below the provider minimum", async () => {
    getUnbilledUsageMock.mockResolvedValueOnce(Result.ok(createUnbilledUsage(10, 2500)));

    const sql = createSqlDbMock({
      paymentMethodForMinimumCheck: { provider_id: "paystack" },
      defaultPaymentMethod: { token: "AUTH_123", provider_id: "paystack" },
      customerEmail: "customer@example.com",
    });
    const drizzle = createDrizzleDbMock({
      billingRun: createBillingRun(),
    });
    const deps = createDeps(sql.state);
    createDbMockFn.mockImplementation(() => drizzle.db);
    OverageBillingWorkflow.dependencies = deps;

    await OverageBillingWorkflow.prototype.run.call(
      createWorkflowInstance(OverageBillingWorkflow, {
        DB: sql.DB,
        ENCRYPTION_KEY: "key",
      }),
      {
        payload: {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
          billingRunId: "run_1",
        },
      },
      createWorkflowStepMock(),
    );

    expect(createInvoiceFromUsageMock).not.toHaveBeenCalled();
    expect(chargeAuthorizationMock).not.toHaveBeenCalled();
    expect(sql.state.invoices).toHaveLength(0);
    expect(drizzle.state.billingRun).toEqual(
      expect.objectContaining({
        status: "deferred",
        invoiceId: null,
        activeLockKey: null,
        failureReason: "below_provider_minimum",
      }),
    );
    expect(drizzle.state.overageBlock).toBeNull();
  });

  it("still advances paid subscription periods when period-end usage is below the provider minimum", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T00:00:00.000Z"));

    try {
      getUnbilledUsageMock.mockResolvedValueOnce(
        Result.ok(createUnbilledUsage(10, 2500)),
      );

      const currentPeriodEnd = new Date("2026-03-01T00:00:00.000Z").getTime();
      const nextPaymentDate = "2026-04-01T00:00:00.000Z";
      const sql = createSqlDbMock({
        paymentMethodForMinimumCheck: { provider_id: "paystack" },
        duePaidSubscriptions: [
          {
            id: "sub_1",
            customer_id: "cust_1",
            provider_id: "paystack",
            provider_subscription_code: "sub_code_1",
            paystack_subscription_code: null,
            current_period_end: currentPeriodEnd,
          },
        ],
      });
      const drizzle = createDrizzleDbMock();
      const deps = createDeps(sql.state);
      createDbMockFn.mockImplementation(() => drizzle.db);
      OverageBillingWorkflow.dependencies = deps;

      await OverageBillingWorkflow.prototype.run.call(
        createWorkflowInstance(OverageBillingWorkflow, {
          DB: sql.DB,
          ENCRYPTION_KEY: "key",
        }),
        {
          payload: {
            organizationId: "org_1",
            customerId: "cust_1",
            trigger: "period_end",
          },
        },
        createWorkflowStepMock(),
      );

      expect(createInvoiceFromUsageMock).not.toHaveBeenCalled();
      expect(sql.state.subscriptionUpdates).toEqual([
        {
          id: "sub_1",
          status: "active",
          currentPeriodStart: currentPeriodEnd,
          currentPeriodEnd: new Date(nextPaymentDate).getTime(),
        },
      ]);
      expect(invalidateSubscriptionCacheMock).toHaveBeenCalledWith(
        expect.anything(),
        "org_1",
        "cust_1",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
