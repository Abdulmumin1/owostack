import { describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import { TrialEndWorkflow } from "../../../src/lib/workflows/trial-end";
import {
  getAdapter,
  intervalToMs,
  invalidateSubscriptionCache,
  resolveProviderAccount,
} from "../../../src/lib/workflows/utils";
import { createSqliteD1Database } from "../helpers/sqlite-d1";
import {
  buildWorkflowEnv,
  insertSubscription,
  runWorkflow,
  seedWorkflowBase,
  SimulatedProviderAdapter,
} from "../helpers/workflow-runtime";

describe("TrialEndWorkflow runtime integration", () => {
  it("uses the same-provider saved card even when another provider owns the global default method", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T17:00:15.000Z"));

    const db = createSqliteD1Database();
    const adapter = new SimulatedProviderAdapter({
      expectedEnvironment: "live",
    });
    const previousDependencies = TrialEndWorkflow.dependencies;

    TrialEndWorkflow.dependencies = {
      getAdapter: (providerId) =>
        providerId === "paystack" ? adapter : getAdapter(providerId),
      resolveProviderAccount,
      intervalToMs,
      provisionEntitlements: async () => undefined,
      invalidateSubscriptionCache,
    };

    try {
      await seedWorkflowBase(db, {
        providerAccount: {
          environment: "test",
        },
        paymentMethods: [
          {
            id: "pm_stripe_default",
            providerId: "stripe",
            token: "pm_stripe_default",
            isDefault: 1,
          },
          {
            id: "pm_paystack_backup",
            providerId: "paystack",
            token: "AUTH_paystack",
            isDefault: 0,
          },
        ],
      });
      await insertSubscription(db, {
        id: "sub_trial_1",
        status: "trialing",
      });

      await runWorkflow(
        TrialEndWorkflow,
        buildWorkflowEnv(db, { ENVIRONMENT: "production" }),
        {
          subscriptionId: "sub_trial_1",
          customerId: "cust_1",
          planId: "plan_1",
          organizationId: "org_1",
          providerId: "paystack",
          environment: "test",
          trialEndMs: Date.now(),
          amount: 3000,
          currency: "NGN",
          email: "customer@example.com",
        },
      );

      const subscription = await db
        .prepare(
          `SELECT status, provider_subscription_code, paystack_subscription_code
           FROM subscriptions
           WHERE id = ?
           LIMIT 1`,
        )
        .bind("sub_trial_1")
        .first<{
          status: string;
          provider_subscription_code: string | null;
          paystack_subscription_code: string | null;
        }>();

      expect(subscription?.status).toBe("active");
      expect(subscription?.provider_subscription_code).toBe("sub_remote_2");
      expect(subscription?.paystack_subscription_code).toBe("sub_remote_2");
      expect(adapter.operations).toEqual([
        {
          kind: "chargeAuthorization",
          environment: "live",
          customerId: "cus_remote_1",
          email: "customer@example.com",
          authorizationCode: "AUTH_paystack",
          amount: 3000,
          currency: "NGN",
          reference: undefined,
        },
        {
          kind: "createSubscription",
          environment: "live",
          customerId: "cus_remote_1",
          email: "customer@example.com",
          authorizationCode: "AUTH_paystack",
          planId: "plan_remote_1",
          startDate: "2026-04-05T17:00:15.000Z",
        },
      ]);
    } finally {
      TrialEndWorkflow.dependencies = previousDependencies;
      db.close();
      vi.useRealTimers();
    }
  });

  it("cuts off at period end and records renewal setup failure when provider subscription creation fails after the conversion charge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T17:00:15.000Z"));

    const db = createSqliteD1Database();
    const adapter = new SimulatedProviderAdapter({
      expectedEnvironment: "live",
      onCreateSubscription: async () =>
        Result.err({
          code: "request_failed",
          message: "provider create subscription failed",
          providerId: "paystack",
        }),
    });
    const previousDependencies = TrialEndWorkflow.dependencies;

    TrialEndWorkflow.dependencies = {
      getAdapter: (providerId) =>
        providerId === "paystack" ? adapter : getAdapter(providerId),
      resolveProviderAccount,
      intervalToMs,
      provisionEntitlements: async () => undefined,
      invalidateSubscriptionCache,
    };

    try {
      await seedWorkflowBase(db, {
        providerAccount: {
          environment: "test",
        },
        paymentMethods: [
          {
            id: "pm_paystack_default",
            providerId: "paystack",
            token: "AUTH_paystack",
            isDefault: 1,
          },
        ],
      });
      await insertSubscription(db, {
        id: "sub_trial_2",
        status: "trialing",
      });

      await runWorkflow(
        TrialEndWorkflow,
        buildWorkflowEnv(db, { ENVIRONMENT: "production" }),
        {
          subscriptionId: "sub_trial_2",
          customerId: "cust_1",
          planId: "plan_1",
          organizationId: "org_1",
          providerId: "paystack",
          environment: "test",
          trialEndMs: Date.now(),
          amount: 3000,
          currency: "NGN",
          email: "customer@example.com",
        },
      );

      const subscription = await db
        .prepare(
          `SELECT status, provider_subscription_code, paystack_subscription_code, cancel_at, metadata
           FROM subscriptions
           WHERE id = ?
           LIMIT 1`,
        )
        .bind("sub_trial_2")
        .first<{
          status: string;
          provider_subscription_code: string | null;
          paystack_subscription_code: string | null;
          cancel_at: number | null;
          metadata: string | null;
        }>();

      const metadata = JSON.parse(subscription?.metadata || "{}");

      expect(subscription?.status).toBe("active");
      expect(subscription?.provider_subscription_code).toBeNull();
      expect(subscription?.paystack_subscription_code).toBeNull();
      expect(subscription?.cancel_at).toBe(
        new Date("2026-04-05T17:00:15.000Z").getTime(),
      );
      expect(metadata.renewal_setup_status).toBe("failed");
      expect(metadata.renewal_setup_last_source).toBe("trial_end");
      expect(String(metadata.renewal_setup_last_error)).toContain(
        "provider create subscription failed",
      );
      expect(adapter.operations.map((operation) => operation.kind)).toEqual([
        "chargeAuthorization",
        "createSubscription",
      ]);
    } finally {
      TrialEndWorkflow.dependencies = previousDependencies;
      db.close();
      vi.useRealTimers();
    }
  });

  it("defers to a scheduled downgrade instead of charging an already-canceled trial", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T12:00:00.000Z"));

    const db = createSqliteD1Database();
    const adapter = new SimulatedProviderAdapter({
      expectedEnvironment: "live",
    });
    const previousDependencies = TrialEndWorkflow.dependencies;

    TrialEndWorkflow.dependencies = {
      getAdapter: (providerId) =>
        providerId === "paystack" ? adapter : getAdapter(providerId),
      resolveProviderAccount,
      intervalToMs,
      provisionEntitlements: async () => undefined,
      invalidateSubscriptionCache,
    };

    try {
      await seedWorkflowBase(db, {
        providerAccount: {
          environment: "test",
        },
        paymentMethods: [
          {
            id: "pm_paystack_default",
            providerId: "paystack",
            token: "AUTH_paystack",
            isDefault: 1,
          },
        ],
      });
      await insertSubscription(db, {
        id: "sub_trial_3",
        status: "trialing",
        cancelAt: Date.now(),
        metadata: {
          scheduled_downgrade: {
            new_plan_id: "plan_free",
            effective_at: Date.now(),
          },
        },
      });

      await runWorkflow(
        TrialEndWorkflow,
        buildWorkflowEnv(db, { ENVIRONMENT: "production" }),
        {
          subscriptionId: "sub_trial_3",
          customerId: "cust_1",
          planId: "plan_1",
          organizationId: "org_1",
          providerId: "paystack",
          environment: "test",
          trialEndMs: Date.now(),
          amount: 3000,
          currency: "NGN",
          email: "customer@example.com",
        },
      );

      const subscription = await db
        .prepare(
          "SELECT status, cancel_at FROM subscriptions WHERE id = ? LIMIT 1",
        )
        .bind("sub_trial_3")
        .first<{
          status: string;
          cancel_at: number | null;
        }>();

      expect(subscription?.status).toBe("trialing");
      expect(subscription?.cancel_at).toBe(
        new Date("2026-03-13T12:00:00.000Z").getTime(),
      );
      expect(adapter.operations).toEqual([]);
    } finally {
      TrialEndWorkflow.dependencies = previousDependencies;
      db.close();
      vi.useRealTimers();
    }
  });
});
