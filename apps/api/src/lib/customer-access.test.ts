import { describe, expect, it } from "vitest";
import {
  composeCustomerAccessEntries,
  filterAccessGrantingSubscriptions,
} from "./customer-access";

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
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.manualEntitlement?.id).toBe("ent_manual");
    expect(entries[0]?.effectiveEntitlement.limitValue).toBe(50_000);
    expect(entries[0]?.planFeature?.limitValue).toBe(25_000);
    expect(entries[0]?.subscription?.planName).toBe("Pro");
  });
});
