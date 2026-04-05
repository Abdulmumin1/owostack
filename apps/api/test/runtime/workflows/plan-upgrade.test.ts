import { describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import { PlanUpgradeWorkflow } from "../../../src/lib/workflows/plan-upgrade";
import {
  getAdapter,
  intervalToMs,
  invalidateSubscriptionCache,
  resolveProviderAccount,
} from "../../../src/lib/workflows/utils";
import { createSqliteD1Database } from "../helpers/sqlite-d1";
import {
  buildWorkflowEnv,
  insertPlan,
  insertSubscription,
  runWorkflow,
  seedWorkflowBase,
  SimulatedProviderAdapter,
} from "../helpers/workflow-runtime";

describe("PlanUpgradeWorkflow runtime integration", () => {
  it("starts a fresh billing cycle when checkout payment lands after the old period already ended", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T17:00:15.000Z"));

    const db = createSqliteD1Database();
    const adapter = new SimulatedProviderAdapter({
      expectedEnvironment: "live",
    });
    const previousDependencies = PlanUpgradeWorkflow.dependencies;

    PlanUpgradeWorkflow.dependencies = {
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
      });
      await insertPlan(db, {
        id: "plan_old",
        providerId: "paystack",
        providerPlanId: "plan_remote_old",
        paystackPlanId: "plan_remote_old",
        name: "Old",
        slug: "old",
        price: 2000,
        currency: "NGN",
        interval: "monthly",
        type: "paid",
        billingType: "recurring",
      });
      await insertSubscription(db, {
        id: "sub_old_upgrade_1",
        planId: "plan_old",
        status: "active",
        currentPeriodStart: new Date("2026-03-01T00:00:00.000Z").getTime(),
        currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z").getTime(),
      });

      const paidAt = "2026-04-05T17:00:15.000Z";
      await runWorkflow(
        PlanUpgradeWorkflow,
        buildWorkflowEnv(db, { ENVIRONMENT: "production" }),
        {
          customerId: "cust_1",
          oldSubscriptionId: "sub_old_upgrade_1",
          oldPlanId: "plan_old",
          newPlanId: "plan_1",
          organizationId: "org_1",
          providerId: "paystack",
          environment: "test",
          paidAt,
        },
      );

      const subscription = await db
        .prepare(
          `SELECT status, current_period_start, current_period_end, provider_subscription_code, paystack_subscription_code, cancel_at
           FROM subscriptions
           WHERE customer_id = ? AND plan_id = ?
           LIMIT 1`,
        )
        .bind("cust_1", "plan_1")
        .first<{
          status: string;
          current_period_start: number;
          current_period_end: number;
          provider_subscription_code: string | null;
          paystack_subscription_code: string | null;
          cancel_at: number | null;
        }>();

      const expectedStart = new Date(paidAt).getTime();
      const expectedEnd =
        expectedStart + 30 * 24 * 60 * 60 * 1000;

      expect(subscription?.status).toBe("active");
      expect(subscription?.current_period_start).toBe(expectedStart);
      expect(subscription?.current_period_end).toBe(expectedEnd);
      expect(subscription?.provider_subscription_code).toBe("sub_remote_1");
      expect(subscription?.paystack_subscription_code).toBe("sub_remote_1");
      expect(subscription?.cancel_at).toBeNull();
      expect(adapter.operations).toEqual([
        {
          kind: "createSubscription",
          environment: "live",
          customerId: "cus_remote_1",
          email: "customer@example.com",
          authorizationCode: "AUTH_123",
          planId: "plan_remote_1",
          startDate: "2026-05-05T17:00:15.000Z",
        },
      ]);
    } finally {
      PlanUpgradeWorkflow.dependencies = previousDependencies;
      db.close();
      vi.useRealTimers();
    }
  });

  it("records renewal setup failure and clears placeholder provider codes when recurring setup fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T17:00:15.000Z"));

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
    const previousDependencies = PlanUpgradeWorkflow.dependencies;

    PlanUpgradeWorkflow.dependencies = {
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
      });
      await insertPlan(db, {
        id: "plan_old",
        providerId: "paystack",
        providerPlanId: "plan_remote_old",
        paystackPlanId: "plan_remote_old",
        name: "Old",
        slug: "old",
        price: 2000,
        currency: "NGN",
        interval: "monthly",
        type: "paid",
        billingType: "recurring",
      });
      await insertSubscription(db, {
        id: "sub_old_upgrade_2",
        planId: "plan_old",
        status: "active",
        currentPeriodStart: new Date("2026-03-05T17:00:15.000Z").getTime(),
        currentPeriodEnd: new Date("2026-05-05T17:00:15.000Z").getTime(),
      });

      const paidAt = "2026-04-05T17:00:15.000Z";
      await runWorkflow(
        PlanUpgradeWorkflow,
        buildWorkflowEnv(db, { ENVIRONMENT: "production" }),
        {
          customerId: "cust_1",
          oldSubscriptionId: "sub_old_upgrade_2",
          oldPlanId: "plan_old",
          newPlanId: "plan_1",
          organizationId: "org_1",
          providerId: "paystack",
          environment: "test",
          paidAt,
        },
      );

      const subscription = await db
        .prepare(
          `SELECT status, provider_subscription_code, paystack_subscription_code, cancel_at, metadata
           FROM subscriptions
           WHERE customer_id = ? AND plan_id = ?
           LIMIT 1`,
        )
        .bind("cust_1", "plan_1")
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
        new Date("2026-05-05T17:00:15.000Z").getTime(),
      );
      expect(metadata.renewal_setup_status).toBe("failed");
      expect(metadata.renewal_setup_last_source).toBe("plan_upgrade");
      expect(String(metadata.renewal_setup_last_error)).toContain(
        "provider create subscription failed",
      );
      expect(adapter.operations).toEqual([
        {
          kind: "createSubscription",
          environment: "live",
          customerId: "cus_remote_1",
          email: "customer@example.com",
          authorizationCode: "AUTH_123",
          planId: "plan_remote_1",
          startDate: "2026-05-05T17:00:15.000Z",
        },
      ]);
    } finally {
      PlanUpgradeWorkflow.dependencies = previousDependencies;
      db.close();
      vi.useRealTimers();
    }
  });
});
