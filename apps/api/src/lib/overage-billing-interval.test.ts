import { describe, expect, it } from "vitest";
import {
  normalizeOverageBillingInterval,
  normalizeOverageSettings,
} from "./overage-billing-interval";

describe("normalizeOverageBillingInterval", () => {
  it("canonicalizes all inputs to end_of_period", () => {
    expect(normalizeOverageBillingInterval("threshold")).toBe("end_of_period");
    expect(normalizeOverageBillingInterval("end_of_period")).toBe(
      "end_of_period",
    );
    expect(normalizeOverageBillingInterval("daily")).toBe("end_of_period");
    expect(normalizeOverageBillingInterval("weekly")).toBe("end_of_period");
    expect(normalizeOverageBillingInterval("monthly")).toBe("end_of_period");
    expect(normalizeOverageBillingInterval(undefined)).toBe("end_of_period");
  });
});

describe("normalizeOverageSettings", () => {
  it("maps legacy threshold intervals into period-end billing with threshold enabled", () => {
    expect(
      normalizeOverageSettings({
        billingInterval: "threshold",
        thresholdAmount: 5000,
        autoCollect: true,
        gracePeriodHours: 4,
      }),
    ).toEqual({
      billingMode: "end_of_period",
      billingInterval: "end_of_period",
      thresholdEnabled: true,
      thresholdAmount: 5000,
      autoCollect: true,
      gracePeriodHours: 4,
    });
  });

  it("clears threshold amount when threshold collection is disabled", () => {
    expect(
      normalizeOverageSettings({
        billingMode: "end_of_period",
        thresholdEnabled: false,
        thresholdAmount: 5000,
        autoCollect: false,
      }),
    ).toEqual({
      billingMode: "end_of_period",
      billingInterval: "end_of_period",
      thresholdEnabled: false,
      thresholdAmount: null,
      autoCollect: false,
      gracePeriodHours: 0,
    });
  });

  it("defaults to period-end billing with threshold disabled", () => {
    expect(normalizeOverageSettings(null)).toEqual({
      billingMode: "end_of_period",
      billingInterval: "end_of_period",
      thresholdEnabled: false,
      thresholdAmount: null,
      autoCollect: false,
      gracePeriodHours: 0,
    });
  });
});
