import { describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import { createDb, schema } from "@owostack/db";
import { eq } from "drizzle-orm";
import { OverageBillingWorkflow } from "../../../src/lib/workflows/overage-billing";
import { getAdapter } from "../../../src/lib/workflows/utils";
import { createSqliteD1Database } from "../helpers/sqlite-d1";
import {
  insertBillingRun,
  insertInvoice,
  insertOverageSettings,
  insertPaymentAttempt,
  seedOverageWorkflowBase,
  SimulatedUsageLedgerNamespace,
} from "../helpers/overage-runtime";
import {
  buildWorkflowEnv,
  runWorkflow,
  SimulatedProviderAdapter,
} from "../helpers/workflow-runtime";

async function appendMeteredUsage(
  usageLedger: SimulatedUsageLedgerNamespace,
  record: {
    organizationId?: string;
    customerId?: string;
    featureId?: string;
    featureSlug?: string;
    featureName?: string;
    subscriptionId?: string;
    planId?: string;
    amount?: number;
    periodStart?: number;
    periodEnd?: number;
    createdAt?: number;
  } = {},
) {
  const stub = usageLedger.get(
    usageLedger.idFromName(`org:${record.organizationId || "org_1"}`),
  ) as any;

  await stub.appendUsage({
    customerId: record.customerId || "cust_1",
    featureId: record.featureId || "feature_1",
    featureSlug: record.featureSlug || "agent-runs",
    featureName: record.featureName || "Agent Runs",
    subscriptionId: record.subscriptionId || "sub_1",
    planId: record.planId || "plan_1",
    amount: record.amount ?? 1500,
    periodStart: record.periodStart ?? 1000,
    periodEnd: record.periodEnd ?? 2000,
    createdAt: record.createdAt ?? 2500,
  });
}

describe("OverageBillingWorkflow runtime integration", () => {
  it("uses the billing run cutoff, creates a threshold invoice, and completes on successful charge", async () => {
    const db = createSqliteD1Database();
    const appDb = createDb(db);
    const usageLedger = new SimulatedUsageLedgerNamespace();
    const adapter = new SimulatedProviderAdapter({
      expectedEnvironment: "live",
    });
    const previousDependencies = OverageBillingWorkflow.dependencies;

    OverageBillingWorkflow.dependencies = {
      ...previousDependencies,
      getAdapter: (providerId) =>
        providerId === "paystack" ? adapter : getAdapter(providerId),
    };

    try {
      await seedOverageWorkflowBase(db, {
        customer: {
          id: "cust_1",
          email: "customer@example.com",
        },
        providerAccount: {
          providerId: "paystack",
          environment: "test",
        },
        plan: {
          id: "plan_1",
          currency: "USD",
        },
        paymentMethod: {
          id: "pm_1",
          providerId: "paystack",
          token: "AUTH_123",
          isDefault: 1,
        },
        subscription: {
          id: "sub_1",
          providerId: "paystack",
          providerSubscriptionCode: "sub_code_1",
        },
      });
      await insertOverageSettings(db, {
        organizationId: "org_1",
        autoCollect: 1,
      });
      await insertBillingRun(db, {
        id: "run_1",
        organizationId: "org_1",
        customerId: "cust_1",
        usageWindowEnd: 2500,
      });
      await appendMeteredUsage(usageLedger);

      await runWorkflow(
        OverageBillingWorkflow,
        buildWorkflowEnv(db, {
          ENVIRONMENT: "production",
          USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
        }),
        {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
          billingRunId: "run_1",
        },
      );

      const invoice = await appDb.query.invoices.findFirst({
        where: eq(schema.invoices.customerId, "cust_1"),
        with: {
          items: true,
        },
      });
      const paymentAttempts = await appDb.query.paymentAttempts.findMany({
        where: eq(schema.paymentAttempts.invoiceId, invoice?.id || ""),
      });
      const billingRun = await appDb.query.billingRuns.findFirst({
        where: eq(schema.billingRuns.id, "run_1"),
      });
      const overageBlock = await appDb.query.customerOverageBlocks.findFirst({
        where: eq(schema.customerOverageBlocks.customerId, "cust_1"),
      });
      const usageRecords = usageLedger.listRecords("org_1");

      expect(invoice).toMatchObject({
        status: "paid",
        currency: "USD",
        subtotal: 25000,
        total: 25000,
        amountPaid: 25000,
        amountDue: 0,
        idempotencyKey: "threshold:org_1:cust_1:2500",
        usageWindowEnd: 2500,
      });
      expect(invoice?.items).toHaveLength(1);
      expect(paymentAttempts).toEqual([
        expect.objectContaining({
          status: "succeeded",
          provider: "paystack",
          providerReference: invoice?.id,
          attemptNumber: 1,
        }),
      ]);
      expect(billingRun).toMatchObject({
        status: "completed",
        invoiceId: invoice?.id,
        activeLockKey: null,
        failureReason: null,
      });
      expect(overageBlock ?? null).toBeNull();
      expect(usageRecords).toEqual([
        expect.objectContaining({
          invoiceId: invoice?.id,
          createdAt: 2500,
        }),
      ]);
      expect(adapter.operations).toEqual([
        {
          kind: "chargeAuthorization",
          environment: "live",
          customerId: "cus_remote_1",
          email: "customer@example.com",
          authorizationCode: "AUTH_123",
          amount: 25000,
          currency: "USD",
          reference: invoice?.id,
        },
      ]);
    } finally {
      OverageBillingWorkflow.dependencies = previousDependencies;
      db.close();
    }
  });

  it("uses the provider customer id for Stripe threshold auto-collection", async () => {
    const db = createSqliteD1Database();
    const usageLedger = new SimulatedUsageLedgerNamespace();
    const adapter = new SimulatedProviderAdapter({
      id: "stripe",
      displayName: "Simulated Stripe",
      expectedEnvironment: "live",
    });
    const previousDependencies = OverageBillingWorkflow.dependencies;

    OverageBillingWorkflow.dependencies = {
      ...previousDependencies,
      getAdapter: (providerId) =>
        providerId === "stripe" ? adapter : getAdapter(providerId),
    };

    try {
      await seedOverageWorkflowBase(db, {
        customer: {
          id: "cust_1",
          email: "customer@example.com",
          providerCustomerId: "cus_stripe_123",
        },
        providerAccount: {
          providerId: "stripe",
          environment: "test",
        },
        paymentMethod: {
          id: "pm_stripe_1",
          providerId: "stripe",
          token: "pm_123",
          isDefault: 1,
        },
        subscription: {
          id: "sub_1",
          providerId: "stripe",
          providerSubscriptionCode: "sub_code_1",
        },
      });
      await insertOverageSettings(db, {
        organizationId: "org_1",
        autoCollect: 1,
      });
      await insertBillingRun(db, {
        id: "run_1",
        organizationId: "org_1",
        customerId: "cust_1",
        usageWindowEnd: 2500,
      });
      await appendMeteredUsage(usageLedger);

      await runWorkflow(
        OverageBillingWorkflow,
        buildWorkflowEnv(db, {
          ENVIRONMENT: "production",
          USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
        }),
        {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
          billingRunId: "run_1",
        },
      );

      expect(adapter.operations).toEqual([
        {
          kind: "chargeAuthorization",
          environment: "live",
          customerId: "cus_stripe_123",
          email: "customer@example.com",
          authorizationCode: "pm_123",
          amount: 25000,
          currency: "USD",
          reference: expect.any(String),
        },
      ]);
    } finally {
      OverageBillingWorkflow.dependencies = previousDependencies;
      db.close();
    }
  });

  it("blocks the customer and marks the billing run blocked when threshold auto-collection cannot start", async () => {
    const db = createSqliteD1Database();
    const appDb = createDb(db);
    const usageLedger = new SimulatedUsageLedgerNamespace();

    try {
      await seedOverageWorkflowBase(db, {
        customer: {
          id: "cust_1",
          email: "customer@example.com",
        },
        paymentMethod: null,
      });
      await insertOverageSettings(db, {
        organizationId: "org_1",
        autoCollect: 1,
      });
      await insertBillingRun(db, {
        id: "run_1",
        organizationId: "org_1",
        customerId: "cust_1",
        usageWindowEnd: 2500,
      });
      await appendMeteredUsage(usageLedger);

      await runWorkflow(
        OverageBillingWorkflow,
        buildWorkflowEnv(db, {
          ENVIRONMENT: "production",
          USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
        }),
        {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
          billingRunId: "run_1",
        },
      );

      const invoice = await appDb.query.invoices.findFirst({
        where: eq(schema.invoices.customerId, "cust_1"),
      });
      const paymentAttempts = await appDb.query.paymentAttempts.findMany({
        where: eq(schema.paymentAttempts.invoiceId, invoice?.id || ""),
      });
      const billingRun = await appDb.query.billingRuns.findFirst({
        where: eq(schema.billingRuns.id, "run_1"),
      });
      const overageBlock = await appDb.query.customerOverageBlocks.findFirst({
        where: eq(schema.customerOverageBlocks.customerId, "cust_1"),
      });

      expect(invoice).toMatchObject({
        status: "open",
        amountPaid: 0,
        amountDue: 25000,
      });
      expect(paymentAttempts).toEqual([
        expect.objectContaining({
          status: "failed",
          provider: "unknown",
          attemptNumber: 1,
          lastError: "No payment method on file",
        }),
      ]);
      expect(overageBlock).toMatchObject({
        customerId: "cust_1",
        organizationId: "org_1",
        billingRunId: "run_1",
        invoiceId: invoice?.id,
        reason: "no_payment_method_on_file",
      });
      expect(billingRun).toMatchObject({
        status: "blocked",
        invoiceId: invoice?.id,
        activeLockKey: null,
        failureReason: "no_payment_method_on_file",
      });
    } finally {
      db.close();
    }
  });

  it("reconciles a previously successful threshold payment attempt without charging again", async () => {
    const db = createSqliteD1Database();
    const appDb = createDb(db);
    const usageLedger = new SimulatedUsageLedgerNamespace();
    const adapter = new SimulatedProviderAdapter({
      expectedEnvironment: "live",
    });
    const previousDependencies = OverageBillingWorkflow.dependencies;

    OverageBillingWorkflow.dependencies = {
      ...previousDependencies,
      getAdapter: (providerId) =>
        providerId === "paystack" ? adapter : getAdapter(providerId),
    };

    try {
      await seedOverageWorkflowBase(db, {
        customer: {
          id: "cust_1",
          email: "customer@example.com",
        },
        providerAccount: {
          providerId: "paystack",
          environment: "test",
        },
        paymentMethod: {
          id: "pm_1",
          providerId: "paystack",
          token: "AUTH_123",
          isDefault: 1,
        },
      });
      await insertOverageSettings(db, {
        organizationId: "org_1",
        autoCollect: 1,
      });
      await insertBillingRun(db, {
        id: "run_1",
        organizationId: "org_1",
        customerId: "cust_1",
        status: "processing",
        usageWindowEnd: 2500,
      });
      await insertInvoice(db, {
        id: "inv_1",
        organizationId: "org_1",
        customerId: "cust_1",
        idempotencyKey: "threshold:org_1:cust_1:2500",
        status: "open",
        usageWindowEnd: 2500,
      });
      await insertPaymentAttempt(db, {
        invoiceId: "inv_1",
        status: "succeeded",
        providerReference: "ch_123",
      });
      await appendMeteredUsage(usageLedger);

      await runWorkflow(
        OverageBillingWorkflow,
        buildWorkflowEnv(db, {
          ENVIRONMENT: "production",
          USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
        }),
        {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
          billingRunId: "run_1",
        },
      );

      const invoice = await appDb.query.invoices.findFirst({
        where: eq(schema.invoices.id, "inv_1"),
      });
      const billingRun = await appDb.query.billingRuns.findFirst({
        where: eq(schema.billingRuns.id, "run_1"),
      });
      const overageBlock = await appDb.query.customerOverageBlocks.findFirst({
        where: eq(schema.customerOverageBlocks.customerId, "cust_1"),
      });

      expect(adapter.operations).toEqual([]);
      expect(invoice).toMatchObject({
        id: "inv_1",
        status: "paid",
        amountPaid: 25000,
        amountDue: 0,
      });
      expect(billingRun).toMatchObject({
        status: "completed",
        invoiceId: "inv_1",
        activeLockKey: null,
      });
      expect(overageBlock ?? null).toBeNull();
    } finally {
      OverageBillingWorkflow.dependencies = previousDependencies;
      db.close();
    }
  });

  it("does not retry permanent provider invalid_request failures", async () => {
    const db = createSqliteD1Database();
    const appDb = createDb(db);
    const usageLedger = new SimulatedUsageLedgerNamespace();
    const adapter = new SimulatedProviderAdapter({
      id: "stripe",
      displayName: "Simulated Stripe",
      expectedEnvironment: "live",
      onChargeAuthorization: async () =>
        Result.err({
          code: "invalid_request",
          message: "Stripe chargeAuthorization requires a Stripe customer ID",
          providerId: "stripe",
        }),
    });
    const previousDependencies = OverageBillingWorkflow.dependencies;

    OverageBillingWorkflow.dependencies = {
      ...previousDependencies,
      getAdapter: (providerId) =>
        providerId === "stripe" ? adapter : getAdapter(providerId),
    };

    try {
      await seedOverageWorkflowBase(db, {
        customer: {
          id: "cust_1",
          email: "customer@example.com",
        },
        providerAccount: {
          providerId: "stripe",
          environment: "test",
        },
        paymentMethod: {
          id: "pm_stripe_1",
          providerId: "stripe",
          token: "pm_123",
          isDefault: 1,
        },
        subscription: {
          id: "sub_1",
          providerId: "stripe",
          providerSubscriptionCode: "sub_code_1",
        },
      });
      await insertOverageSettings(db, {
        organizationId: "org_1",
        autoCollect: 1,
      });
      await insertBillingRun(db, {
        id: "run_1",
        organizationId: "org_1",
        customerId: "cust_1",
        usageWindowEnd: 2500,
      });
      await appendMeteredUsage(usageLedger);

      const step = await runWorkflow(
        OverageBillingWorkflow,
        buildWorkflowEnv(db, {
          ENVIRONMENT: "production",
          USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
        }),
        {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
          billingRunId: "run_1",
        },
      );

      const paymentAttempts = await appDb.query.paymentAttempts.findMany();
      const billingRun = await appDb.query.billingRuns.findFirst({
        where: eq(schema.billingRuns.id, "run_1"),
      });

      expect(adapter.operations).toEqual([
        {
          kind: "chargeAuthorization",
          environment: "live",
          customerId: "cus_remote_1",
          email: "customer@example.com",
          authorizationCode: "pm_123",
          amount: 25000,
          currency: "USD",
          reference: expect.any(String),
        },
      ]);
      expect(step.sleeps).toEqual([]);
      expect(paymentAttempts).toEqual([
        expect.objectContaining({
          status: "failed",
          provider: "stripe",
          attemptNumber: 1,
          lastError: "Stripe chargeAuthorization requires a Stripe customer ID",
        }),
      ]);
      expect(billingRun).toMatchObject({
        status: "blocked",
        failureReason: "threshold_charge_failed",
      });
    } finally {
      OverageBillingWorkflow.dependencies = previousDependencies;
      db.close();
    }
  });

  it("defers a threshold run when the fixed usage slice is still below the provider minimum", async () => {
    const db = createSqliteD1Database();
    const appDb = createDb(db);
    const usageLedger = new SimulatedUsageLedgerNamespace();

    try {
      await seedOverageWorkflowBase(db, {
        customer: {
          id: "cust_1",
          email: "customer@example.com",
        },
        paymentMethod: {
          id: "pm_1",
          providerId: "paystack",
          token: "AUTH_123",
          isDefault: 1,
        },
        planFeature: {
          billingUnits: 1,
          overagePrice: 10,
        },
      });
      await insertOverageSettings(db, {
        organizationId: "org_1",
        autoCollect: 1,
      });
      await insertBillingRun(db, {
        id: "run_1",
        organizationId: "org_1",
        customerId: "cust_1",
        usageWindowEnd: 2500,
      });
      await appendMeteredUsage(usageLedger, {
        amount: 1001,
      });

      await runWorkflow(
        OverageBillingWorkflow,
        buildWorkflowEnv(db, {
          ENVIRONMENT: "production",
          USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
        }),
        {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "threshold",
          billingRunId: "run_1",
        },
      );

      const invoices = await appDb.query.invoices.findMany();
      const billingRun = await appDb.query.billingRuns.findFirst({
        where: eq(schema.billingRuns.id, "run_1"),
      });
      const overageBlock = await appDb.query.customerOverageBlocks.findFirst({
        where: eq(schema.customerOverageBlocks.customerId, "cust_1"),
      });

      expect(invoices).toHaveLength(0);
      expect(billingRun).toMatchObject({
        status: "deferred",
        invoiceId: null,
        activeLockKey: null,
        failureReason: "below_provider_minimum",
      });
      expect(overageBlock ?? null).toBeNull();
    } finally {
      db.close();
    }
  });

  it("still advances paid subscription periods when period-end usage is below the provider minimum", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T00:00:00.000Z"));

    const db = createSqliteD1Database();
    const appDb = createDb(db);
    const usageLedger = new SimulatedUsageLedgerNamespace();
    const adapter = new SimulatedProviderAdapter({
      expectedEnvironment: "live",
      onFetchSubscription: async () =>
        Result.ok({
          id: "sub_code_1",
          status: "active",
          nextPaymentDate: "2026-04-01T00:00:00.000Z",
          startDate: "2026-03-01T00:00:00.000Z",
          metadata: {},
        }),
    });
    const previousDependencies = OverageBillingWorkflow.dependencies;

    OverageBillingWorkflow.dependencies = {
      ...previousDependencies,
      getAdapter: (providerId) =>
        providerId === "paystack" ? adapter : getAdapter(providerId),
    };

    try {
      await seedOverageWorkflowBase(db, {
        customer: {
          id: "cust_1",
          email: "customer@example.com",
        },
        providerAccount: {
          providerId: "paystack",
          environment: "test",
        },
        paymentMethod: {
          id: "pm_1",
          providerId: "paystack",
          token: "AUTH_123",
          isDefault: 1,
        },
        subscription: {
          id: "sub_1",
          providerId: "paystack",
          providerSubscriptionCode: "sub_code_1",
          currentPeriodStart: new Date("2026-02-01T00:00:00.000Z").getTime(),
          currentPeriodEnd: new Date("2026-03-01T00:00:00.000Z").getTime(),
        },
        planFeature: {
          billingUnits: 1,
          overagePrice: 10,
        },
      });
      await insertOverageSettings(db, {
        organizationId: "org_1",
        autoCollect: 1,
      });
      await appendMeteredUsage(usageLedger, {
        amount: 1001,
      });

      await runWorkflow(
        OverageBillingWorkflow,
        buildWorkflowEnv(db, {
          ENVIRONMENT: "production",
          USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
        }),
        {
          organizationId: "org_1",
          customerId: "cust_1",
          trigger: "period_end",
        },
      );

      const subscription = await appDb.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.id, "sub_1"),
      });
      const invoices = await appDb.query.invoices.findMany();

      expect(invoices).toHaveLength(0);
      expect(subscription).toMatchObject({
        currentPeriodStart: new Date("2026-03-01T00:00:00.000Z").getTime(),
        currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z").getTime(),
      });
      expect(adapter.operations).toEqual([
        {
          kind: "fetchSubscription",
          environment: "live",
          subscriptionId: "sub_code_1",
        },
      ]);
    } finally {
      OverageBillingWorkflow.dependencies = previousDependencies;
      db.close();
      vi.useRealTimers();
    }
  });
});
