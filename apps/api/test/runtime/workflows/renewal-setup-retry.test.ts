import { describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import { RenewalSetupRetryWorkflow } from "../../../src/lib/workflows/renewal-setup-retry";
import {
  getAdapter,
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

describe("RenewalSetupRetryWorkflow runtime integration", () => {
  it("creates the missing provider subscription and clears cancel_at using the runtime environment", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T17:00:15.000Z"));

    const db = createSqliteD1Database();
    const adapter = new SimulatedProviderAdapter({
      expectedEnvironment: "live",
    });
    const previousDependencies = RenewalSetupRetryWorkflow.dependencies;

    RenewalSetupRetryWorkflow.dependencies = {
      getAdapter: (providerId) =>
        providerId === "paystack" ? adapter : getAdapter(providerId),
      resolveProviderAccount,
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
            token: "AUTH_123",
            isDefault: 1,
          },
        ],
      });
      await insertSubscription(db, {
        id: "sub_retry_1",
        status: "active",
        providerSubscriptionCode: "trial-placeholder",
        paystackSubscriptionCode: "trial-placeholder",
        cancelAt: new Date("2026-04-05T17:00:15.000Z").getTime(),
        currentPeriodEnd: new Date("2026-04-05T17:00:15.000Z").getTime(),
        metadata: {
          renewal_setup_status: "scheduled",
          renewal_setup_retry_count: 0,
        },
      });

      await runWorkflow(
        RenewalSetupRetryWorkflow,
        buildWorkflowEnv(db, { ENVIRONMENT: "production" }),
        {
          subscriptionId: "sub_retry_1",
          customerId: "cust_1",
          organizationId: "org_1",
          providerId: "paystack",
          source: "dashboard_manual",
          immediate: true,
        },
      );

      const subscription = await db
        .prepare(
          `SELECT provider_subscription_code, paystack_subscription_code, cancel_at, metadata
           FROM subscriptions
           WHERE id = ?
           LIMIT 1`,
        )
        .bind("sub_retry_1")
        .first<{
          provider_subscription_code: string | null;
          paystack_subscription_code: string | null;
          cancel_at: number | null;
          metadata: string | null;
        }>();

      const metadata = JSON.parse(subscription?.metadata || "{}");

      expect(subscription?.provider_subscription_code).toBe("sub_remote_1");
      expect(subscription?.paystack_subscription_code).toBe("sub_remote_1");
      expect(subscription?.cancel_at).toBeNull();
      expect(metadata.renewal_setup_status).toBe("complete");
      expect(metadata.renewal_setup_last_source).toBe("dashboard_manual");
      expect(adapter.operations).toEqual([
        {
          kind: "createSubscription",
          environment: "live",
          customerId: "cus_remote_1",
          email: "customer@example.com",
          authorizationCode: "AUTH_123",
          planId: "plan_remote_1",
          startDate: "2026-04-05T17:00:15.000Z",
        },
      ]);
    } finally {
      RenewalSetupRetryWorkflow.dependencies = previousDependencies;
      db.close();
      vi.useRealTimers();
    }
  });

  it("marks renewal setup failed after exhausting retryable provider errors", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T17:00:15.000Z"));

    const db = createSqliteD1Database();
    const adapter = new SimulatedProviderAdapter({
      expectedEnvironment: "live",
      onCreateSubscription: async () =>
        Result.err({
          code: "request_failed",
          message: "provider temporarily unavailable",
          providerId: "paystack",
        }),
    });
    const previousDependencies = RenewalSetupRetryWorkflow.dependencies;

    RenewalSetupRetryWorkflow.dependencies = {
      getAdapter: (providerId) =>
        providerId === "paystack" ? adapter : getAdapter(providerId),
      resolveProviderAccount,
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
            token: "AUTH_123",
            isDefault: 1,
          },
        ],
      });
      await insertSubscription(db, {
        id: "sub_retry_2",
        status: "active",
        providerSubscriptionCode: "trial-placeholder",
        paystackSubscriptionCode: "trial-placeholder",
        cancelAt: new Date("2026-04-05T17:00:15.000Z").getTime(),
        currentPeriodEnd: new Date("2026-04-05T17:00:15.000Z").getTime(),
        metadata: {
          renewal_setup_status: "scheduled",
          renewal_setup_retry_count: 0,
        },
      });

      const step = await runWorkflow(
        RenewalSetupRetryWorkflow,
        buildWorkflowEnv(db, { ENVIRONMENT: "production" }),
        {
          subscriptionId: "sub_retry_2",
          customerId: "cust_1",
          organizationId: "org_1",
          providerId: "paystack",
          source: "trial_end",
          immediate: false,
        },
      );

      const subscription = await db
        .prepare(
          `SELECT provider_subscription_code, paystack_subscription_code, cancel_at, metadata
           FROM subscriptions
           WHERE id = ?
           LIMIT 1`,
        )
        .bind("sub_retry_2")
        .first<{
          provider_subscription_code: string | null;
          paystack_subscription_code: string | null;
          cancel_at: number | null;
          metadata: string | null;
        }>();

      const metadata = JSON.parse(subscription?.metadata || "{}");

      expect(subscription?.provider_subscription_code).toBe(
        "trial-placeholder",
      );
      expect(subscription?.paystack_subscription_code).toBe(
        "trial-placeholder",
      );
      expect(subscription?.cancel_at).toBe(
        new Date("2026-04-05T17:00:15.000Z").getTime(),
      );
      expect(metadata.renewal_setup_status).toBe("failed");
      expect(metadata.renewal_setup_retry_count).toBe(3);
      expect(metadata.renewal_setup_last_error).toBe(
        "provider temporarily unavailable",
      );
      expect(metadata.renewal_setup_last_source).toBe("trial_end");
      expect(adapter.operations).toHaveLength(3);
      expect(step.sleeps).toEqual([
        {
          name: "renewal-setup-wait-0",
          ms: 15 * 60 * 1000,
        },
        {
          name: "renewal-setup-wait-1",
          ms: 6 * 60 * 60 * 1000,
        },
        {
          name: "renewal-setup-wait-2",
          ms: 24 * 60 * 60 * 1000,
        },
      ]);
    } finally {
      RenewalSetupRetryWorkflow.dependencies = previousDependencies;
      db.close();
      vi.useRealTimers();
    }
  });
});
