import { describe, expect, it } from "vitest";
import {
  eventMatchesCustomerPlanScope,
  filterDashboardEventsToPlanScope,
  invoiceMatchesCustomerPlanScope,
} from "./customer-plan-scope";

describe("customer plan scope helpers", () => {
  it("matches events that carry a nested plan id", () => {
    const matches = eventMatchesCustomerPlanScope(
      {
        metadata: {
          plan_id: "plan_pro",
        },
      },
      { planId: "plan_pro" },
    );

    expect(matches).toBe(true);
  });

  it("matches events that reference a scoped subscription id", () => {
    const matches = eventMatchesCustomerPlanScope(
      {
        payload: {
          subscriptionId: "sub_123",
        },
      },
      {
        planId: "plan_pro",
        subscriptionIds: ["sub_123"],
      },
    );

    expect(matches).toBe(true);
  });

  it("rejects unrelated plan and subscription references", () => {
    const matches = eventMatchesCustomerPlanScope(
      {
        metadata: {
          plan_id: "plan_basic",
          subscriptionId: "sub_other",
        },
      },
      {
        planId: "plan_pro",
        subscriptionIds: ["sub_123"],
      },
    );

    expect(matches).toBe(false);
  });

  it("filters and limits dashboard events to the active plan scope", () => {
    const events = [
      {
        id: "evt_1",
        data: {
          metadata: {
            plan_id: "plan_pro",
          },
        },
      },
      {
        id: "evt_2",
        data: {
          payload: {
            subscriptionId: "sub_123",
          },
        },
      },
      {
        id: "evt_3",
        data: {
          metadata: {
            plan_id: "plan_basic",
          },
        },
      },
    ];

    const filtered = filterDashboardEventsToPlanScope(events, {
      planId: "plan_pro",
      subscriptionIds: ["sub_123"],
      limit: 2,
    });

    expect(filtered.map((event) => event.id)).toEqual(["evt_1", "evt_2"]);
  });

  it("matches invoices by subscription plan id", () => {
    const matches = invoiceMatchesCustomerPlanScope(
      {
        subscriptionPlanId: "plan_pro",
      },
      {
        planId: "plan_pro",
      },
    );

    expect(matches).toBe(true);
  });

  it("matches invoices by scoped feature ids", () => {
    const matches = invoiceMatchesCustomerPlanScope(
      {
        featureIds: ["feature_ai_credits"],
      },
      {
        planId: "plan_pro",
        scopedFeatureIds: ["feature_ai_credits"],
      },
    );

    expect(matches).toBe(true);
  });
});
