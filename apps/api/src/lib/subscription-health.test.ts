import { describe, expect, it } from "vitest";
import {
  PAID_SUBSCRIPTION_PERIOD_GRACE_MS,
  getSubscriptionHealthState,
  isPaidActivePastGracePeriod,
  isPaidSubscriptionProviderLinkMissing,
} from "./subscription-health";

describe("subscription-health", () => {
  it("marks active paid subscriptions as stale only after grace", () => {
    const now = PAID_SUBSCRIPTION_PERIOD_GRACE_MS * 2;
    expect(
      isPaidActivePastGracePeriod(
        {
          status: "active",
          currentPeriodEnd: now - PAID_SUBSCRIPTION_PERIOD_GRACE_MS + 1,
          planType: "paid",
        },
        now,
      ),
    ).toBe(false);

    expect(
      isPaidActivePastGracePeriod(
        {
          status: "active",
          currentPeriodEnd: now - PAID_SUBSCRIPTION_PERIOD_GRACE_MS - 1,
          planType: "paid",
        },
        now,
      ),
    ).toBe(true);
  });

  it("does not mark free subscriptions as stale", () => {
    const now = PAID_SUBSCRIPTION_PERIOD_GRACE_MS * 2;
    expect(
      isPaidActivePastGracePeriod(
        {
          status: "active",
          currentPeriodEnd: now - PAID_SUBSCRIPTION_PERIOD_GRACE_MS - 1,
          planType: "free",
        },
        now,
      ),
    ).toBe(false);
  });

  it("flags missing provider linkage for active paid subscriptions", () => {
    expect(
      isPaidSubscriptionProviderLinkMissing({
        status: "active",
        planType: "paid",
        providerId: null,
        providerSubscriptionCode: "sub_123",
      }),
    ).toBe(true);

    expect(
      isPaidSubscriptionProviderLinkMissing({
        status: "active",
        planType: "paid",
        providerId: "dodo",
        providerSubscriptionCode: "trial-abc",
      }),
    ).toBe(true);

    expect(
      isPaidSubscriptionProviderLinkMissing({
        status: "active",
        planType: "paid",
        providerId: "dodo",
        providerSubscriptionCode: "sub_123",
      }),
    ).toBe(false);
  });

  it("returns combined health state", () => {
    const now = PAID_SUBSCRIPTION_PERIOD_GRACE_MS * 2;
    const state = getSubscriptionHealthState(
      {
        status: "active",
        planType: "paid",
        currentPeriodEnd: now - PAID_SUBSCRIPTION_PERIOD_GRACE_MS - 1,
        providerId: "",
        providerSubscriptionCode: "",
      },
      now,
    );

    expect(state.pastGracePeriodEnd).toBe(true);
    expect(state.providerLinkMissing).toBe(true);
    expect(state.requiresAction).toBe(true);
  });
});
