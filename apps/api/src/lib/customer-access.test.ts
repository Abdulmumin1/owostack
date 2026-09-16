import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCustomerAccessSnapshot,
  composeCustomerAccessEntries,
  filterAccessGrantingSubscriptions,
  selectAccessGrantingPlanFeature,
} from "./customer-access";
import { appendUsageRecord } from "./usage-ledger";
import { SimulatedUsageLedgerNamespace } from "../../test/runtime/helpers/overage-runtime";

afterEach(() => {
  vi.useRealTimers();
});

describe("customer access helpers", () => {
  it("filters subscriptions down to currently access-granting rows", () => {
    const now = Date.UTC(2026, 2, 27, 12, 0, 0);

    const filtered = filterAccessGrantingSubscriptions(
      [
        {
          id: "sub_active",
          status: "active",
          planId: "plan_pro",
          currentPeriodEnd: now + 60_000,
          planType: "paid",
        },
        {
          id: "sub_expired_trial",
          status: "trialing",
          planId: "plan_trial",
          currentPeriodEnd: now - 60_000,
          planType: "free",
        },
        {
          id: "sub_stale_paid",
          status: "active",
          planId: "plan_old",
          currentPeriodEnd: now - 5 * 24 * 60 * 60 * 1000,
          planType: "paid",
        },
      ],
      now,
    );

    expect(filtered.map((subscription) => subscription.id)).toEqual([
      "sub_active",
    ]);
  });

  it("keeps a free plan with a stale period as an access grant when the plan type is on the relation", () => {
    // /check and /track load subscriptions `with: { plan: true }`; the plan
    // type lives on `plan.type`, not on a `planType` column. A free plan is
    // never subject to the paid-period grace eviction.
    const now = Date.UTC(2026, 2, 27, 12, 0, 0);
    const staleEnd = now - 30 * 24 * 60 * 60 * 1000;

    const grant = selectAccessGrantingPlanFeature(
      [
        {
          id: "sub_free",
          status: "active",
          planId: "plan_free",
          currentPeriodStart: staleEnd - 30 * 24 * 60 * 60 * 1000,
          currentPeriodEnd: staleEnd,
          plan: { type: "free" },
        },
      ],
      [{ id: "pf_free", planId: "plan_free" }],
      now,
    );

    expect(grant?.subscription.id).toBe("sub_free");

    const paidGrant = selectAccessGrantingPlanFeature(
      [
        {
          id: "sub_paid_stale",
          status: "active",
          planId: "plan_paid",
          currentPeriodStart: staleEnd - 30 * 24 * 60 * 60 * 1000,
          currentPeriodEnd: staleEnd,
          plan: { type: "paid" },
        },
      ],
      [{ id: "pf_paid", planId: "plan_paid" }],
      now,
    );

    expect(paidGrant).toBeNull();
  });

  it("picks the subscription with the latest period end when several grant the feature", () => {
    const now = Date.UTC(2026, 2, 27, 12, 0, 0);

    const grant = selectAccessGrantingPlanFeature(
      [
        {
          id: "sub_short",
          status: "active",
          planId: "plan_short",
          currentPeriodStart: now - 60_000,
          currentPeriodEnd: now + 60_000,
          planType: "paid",
        },
        {
          id: "sub_long",
          status: "pending_cancel",
          planId: "plan_long",
          currentPeriodStart: now - 30_000,
          currentPeriodEnd: now + 120_000,
          cancelAt: now + 120_000,
          planType: "paid",
        },
      ],
      [
        { id: "pf_short", planId: "plan_short" },
        { id: "pf_long", planId: "plan_long" },
      ],
      now,
    );

    expect(grant?.subscription.id).toBe("sub_long");
    expect(grant?.planFeature.id).toBe("pf_long");
  });

  it("prefers manual entitlements over plan rows while keeping plan context", () => {
    const entries = composeCustomerAccessEntries({
      subscriptions: [
        {
          id: "sub_pro",
          status: "active",
          planId: "plan_pro",
          planName: "Pro",
        },
      ],
      planFeatures: [
        {
          planId: "plan_pro",
          featureId: "feature_ai_credits",
          featureName: "AI Credits",
          featureSlug: "ai-credits",
          featureType: "metered",
          unit: "credits",
          limitValue: 25_000,
          resetInterval: "monthly",
          usageModel: "included",
          creditCost: 0,
          resetOnEnable: false,
          rolloverEnabled: false,
          rolloverMaxBalance: null,
        },
      ],
      planEntitlements: [
        {
          id: "ent_plan",
          featureId: "feature_ai_credits",
          featureName: "AI Credits",
          featureSlug: "ai-credits",
          featureType: "metered",
          unit: "credits",
          limitValue: 25_000,
          resetInterval: "monthly",
          expiresAt: null,
          source: "plan",
        },
      ],
      manualEntitlements: [
        {
          id: "ent_manual",
          featureId: "feature_ai_credits",
          featureName: "AI Credits",
          featureSlug: "ai-credits",
          featureType: "metered",
          unit: "credits",
          limitValue: 50_000,
          resetInterval: "monthly",
          expiresAt: null,
          source: "manual",
          grantedReason: "Support extension",
        },
      ],
      manualBonusEntitlements: [],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.manualEntitlement?.id).toBe("ent_manual");
    expect(entries[0]?.effectiveEntitlement.limitValue).toBe(50_000);
    expect(entries[0]?.planFeature?.limitValue).toBe(25_000);
    expect(entries[0]?.subscription?.planName).toBe("Pro");
  });

  it("resets included balance to the new plan scope", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-04T12:00:00.000Z"));

    const usageLedger = new SimulatedUsageLedgerNamespace();
    const periodStart = Date.UTC(2026, 3, 1, 0, 0, 0, 0);
    const periodEnd = Date.UTC(2026, 3, 30, 23, 59, 59, 999);

    await appendUsageRecord(
      {
        usageLedger: usageLedger as unknown as DurableObjectNamespace<any>,
        organizationId: "org_1",
      },
      {
        customerId: "cust_1",
        featureId: "feature_ai_credits",
        amount: 5,
        periodStart,
        periodEnd,
        subscriptionId: "sub_free",
        planId: "plan_free",
        createdAt: Date.UTC(2026, 3, 4, 10, 0, 0, 0),
      },
    );

    const snapshot = await buildCustomerAccessSnapshot({
      env: {
        USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
      },
      organizationId: "org_1",
      customerId: "cust_1",
      subscriptions: [
        {
          id: "sub_pro",
          status: "active",
          planId: "plan_pro",
          planName: "Pro",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        },
      ],
      planFeatures: [
        {
          planId: "plan_pro",
          featureId: "feature_ai_credits",
          featureName: "AI Credits",
          featureSlug: "ai-credits",
          featureType: "metered",
          unit: "credits",
          limitValue: 50,
          resetInterval: "monthly",
          usageModel: "included",
          creditCost: 0,
          resetOnEnable: true,
          rolloverEnabled: false,
          rolloverMaxBalance: null,
        },
      ],
      planEntitlements: [],
      manualEntitlements: [],
      manualBonusEntitlements: [],
      creditBalances: [],
    });

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.usage).toBe(0);
    expect(snapshot[0]?.balance).toBe(50);
  });

  it("ignores resetOnEnable=false for included balances and still resets on plan change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-04T12:00:00.000Z"));

    const usageLedger = new SimulatedUsageLedgerNamespace();
    const periodStart = Date.UTC(2026, 3, 1, 0, 0, 0, 0);
    const periodEnd = Date.UTC(2026, 3, 30, 23, 59, 59, 999);

    await appendUsageRecord(
      {
        usageLedger: usageLedger as unknown as DurableObjectNamespace<any>,
        organizationId: "org_1",
      },
      {
        customerId: "cust_1",
        featureId: "feature_ai_credits",
        amount: 5,
        periodStart,
        periodEnd,
        subscriptionId: "sub_free",
        planId: "plan_free",
        createdAt: Date.UTC(2026, 3, 4, 10, 0, 0, 0),
      },
    );

    const snapshot = await buildCustomerAccessSnapshot({
      env: {
        USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
      },
      organizationId: "org_1",
      customerId: "cust_1",
      subscriptions: [
        {
          id: "sub_pro",
          status: "active",
          planId: "plan_pro",
          planName: "Pro",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        },
      ],
      planFeatures: [
        {
          planId: "plan_pro",
          featureId: "feature_ai_credits",
          featureName: "AI Credits",
          featureSlug: "ai-credits",
          featureType: "metered",
          unit: "credits",
          limitValue: 50,
          resetInterval: "monthly",
          usageModel: "included",
          creditCost: 0,
          resetOnEnable: false,
          rolloverEnabled: false,
          rolloverMaxBalance: null,
        },
      ],
      planEntitlements: [],
      manualEntitlements: [],
      manualBonusEntitlements: [],
      creditBalances: [],
    });

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.usage).toBe(0);
    expect(snapshot[0]?.balance).toBe(50);
  });

  it("resets included balance when the same plan is re-enabled on a new subscription", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-04T12:00:00.000Z"));

    const usageLedger = new SimulatedUsageLedgerNamespace();
    const periodStart = Date.UTC(2026, 3, 1, 0, 0, 0, 0);
    const periodEnd = Date.UTC(2026, 3, 30, 23, 59, 59, 999);

    await appendUsageRecord(
      {
        usageLedger: usageLedger as unknown as DurableObjectNamespace<any>,
        organizationId: "org_1",
      },
      {
        customerId: "cust_1",
        featureId: "feature_ai_credits",
        amount: 5,
        periodStart,
        periodEnd,
        subscriptionId: "sub_pro_old",
        planId: "plan_pro",
        createdAt: Date.UTC(2026, 3, 4, 10, 0, 0, 0),
      },
    );

    const snapshot = await buildCustomerAccessSnapshot({
      env: {
        USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
      },
      organizationId: "org_1",
      customerId: "cust_1",
      subscriptions: [
        {
          id: "sub_pro_new",
          status: "active",
          planId: "plan_pro",
          planName: "Pro",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        },
      ],
      planFeatures: [
        {
          planId: "plan_pro",
          featureId: "feature_ai_credits",
          featureName: "AI Credits",
          featureSlug: "ai-credits",
          featureType: "metered",
          unit: "credits",
          limitValue: 50,
          resetInterval: "monthly",
          usageModel: "included",
          creditCost: 0,
          resetOnEnable: true,
          rolloverEnabled: false,
          rolloverMaxBalance: null,
        },
      ],
      planEntitlements: [],
      manualEntitlements: [],
      manualBonusEntitlements: [],
      creditBalances: [],
    });

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.usage).toBe(0);
    expect(snapshot[0]?.balance).toBe(50);
  });

  it("rehydrates current usage from legacy plan-scoped rows without subscription ids", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T12:00:00.000Z"));

    const usageLedger = new SimulatedUsageLedgerNamespace();
    const subscriptionStart = Date.UTC(2026, 3, 15, 0, 0, 0, 0);
    const subscriptionEnd = Date.UTC(2026, 4, 14, 23, 59, 59, 999);
    const periodStart = Date.UTC(2026, 3, 1, 0, 0, 0, 0);
    const periodEnd = Date.UTC(2026, 3, 30, 23, 59, 59, 999);

    await appendUsageRecord(
      {
        usageLedger: usageLedger as unknown as DurableObjectNamespace<any>,
        organizationId: "org_1",
      },
      {
        customerId: "cust_1",
        featureId: "feature_ai_credits",
        amount: 5,
        periodStart,
        periodEnd,
        planId: "plan_pro",
        createdAt: Date.UTC(2026, 3, 18, 10, 0, 0, 0),
      },
    );

    const snapshot = await buildCustomerAccessSnapshot({
      env: {
        USAGE_LEDGER: usageLedger as unknown as DurableObjectNamespace<any>,
      },
      organizationId: "org_1",
      customerId: "cust_1",
      subscriptions: [
        {
          id: "sub_pro",
          status: "active",
          planId: "plan_pro",
          planName: "Pro",
          currentPeriodStart: subscriptionStart,
          currentPeriodEnd: subscriptionEnd,
        },
      ],
      planFeatures: [
        {
          planId: "plan_pro",
          featureId: "feature_ai_credits",
          featureName: "AI Credits",
          featureSlug: "ai-credits",
          featureType: "metered",
          unit: "credits",
          limitValue: 50,
          resetInterval: "monthly",
          usageModel: "included",
          creditCost: 0,
          resetOnEnable: true,
          rolloverEnabled: false,
          rolloverMaxBalance: null,
        },
      ],
      planEntitlements: [],
      manualEntitlements: [],
      manualBonusEntitlements: [],
      creditBalances: [],
    });

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.usage).toBe(5);
    expect(snapshot[0]?.balance).toBe(45);
  });
});
