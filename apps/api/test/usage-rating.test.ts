import { describe, expect, it } from "vitest";
import {
  getCurrentPricingTier,
  rateUsage,
  rateUsageDelta,
} from "../src/lib/usage-rating";

describe("usage-rating", () => {
  it("rates package pricing with billing units", () => {
    const rated = rateUsage({
      usageModel: "usage_based",
      ratingModel: "package",
      usage: 1500,
      pricePerUnit: 500,
      billingUnits: 1000,
    });

    expect(rated.billableQuantity).toBe(1500);
    expect(rated.amount).toBe(1000);
    expect(rated.pricePerUnit).toBe(500);
    expect(rated.billingUnits).toBe(1000);
  });

  it("rates graduated pricing only on units inside each tier", () => {
    const rated = rateUsage({
      usageModel: "included",
      ratingModel: "graduated",
      usage: 6500,
      included: 5000,
      tiers: [
        { upTo: 1000, unitPrice: 10 },
        { upTo: 5000, unitPrice: 8 },
        { upTo: null, unitPrice: 5 },
      ],
    });

    expect(rated.billableQuantity).toBe(1500);
    expect(rated.amount).toBe(14000);
    expect(rated.tierBreakdown).toEqual([
      { tier: 0, units: 1000, unitPrice: 10, amount: 10000 },
      { tier: 1, units: 500, unitPrice: 8, amount: 4000 },
    ]);
  });

  it("rates graduated usage above a finite final tier at the final tier rate", () => {
    const rated = rateUsage({
      usageModel: "usage_based",
      ratingModel: "graduated",
      usage: 150,
      tiers: [{ upTo: 100, unitPrice: 1 }],
    });

    expect(rated.billableQuantity).toBe(150);
    expect(rated.amount).toBe(150);
    expect(rated.tierBreakdown).toEqual([
      { tier: 0, units: 150, unitPrice: 1, amount: 150 },
    ]);
  });

  it("rates graduated delta usage above a finite final tier at the final tier rate", () => {
    const rated = rateUsageDelta({
      usageModel: "usage_based",
      ratingModel: "graduated",
      previousUsage: 90,
      usage: 150,
      tiers: [{ upTo: 100, unitPrice: 1 }],
    });

    expect(rated.billableQuantity).toBe(60);
    expect(rated.amount).toBe(60);
    expect(rated.tierBreakdown).toEqual([
      { tier: 0, units: 60, unitPrice: 1, amount: 60 },
    ]);
  });

  it("rates volume pricing at the reached tier for all billable usage", () => {
    const rated = rateUsage({
      usageModel: "usage_based",
      ratingModel: "volume",
      usage: 1500,
      tiers: [
        { upTo: 1000, unitPrice: 100 },
        { upTo: 10000, unitPrice: 80 },
        { upTo: null, unitPrice: 50 },
      ],
    });

    expect(rated.billableQuantity).toBe(1500);
    expect(rated.amount).toBe(120000);
    expect(rated.tierBreakdown).toEqual([
      { tier: 1, units: 1500, unitPrice: 80, amount: 120000 },
    ]);
  });

  it("computes the current tier from billable usage", () => {
    const currentTier = getCurrentPricingTier({
      usageModel: "included",
      ratingModel: "graduated",
      usage: 6500,
      included: 5000,
      tiers: [
        { upTo: 1000, unitPrice: 10 },
        { upTo: 5000, unitPrice: 8 },
        { upTo: null, unitPrice: 5 },
      ],
    });

    expect(currentTier).toEqual({
      index: 1,
      startsAt: 1000,
      endsAt: 5000,
      unitPrice: 8,
    });
  });

  it("supports flat-only volume tiers", () => {
    const rated = rateUsage({
      usageModel: "usage_based",
      ratingModel: "volume",
      usage: 1200,
      tiers: [
        { upTo: 1000, unitPrice: 25 },
        { upTo: null, flatFee: 25000 },
      ],
    });

    expect(rated.billableQuantity).toBe(1200);
    expect(rated.amount).toBe(25000);
    expect(rated.pricePerUnit).toBe(0);
    expect(rated.tierBreakdown).toEqual([
      { tier: 1, units: 1200, unitPrice: 0, flatFee: 25000, amount: 25000 },
    ]);
  });

  it("supports flat fees inside graduated tiers", () => {
    const rated = rateUsage({
      usageModel: "included",
      ratingModel: "graduated",
      usage: 1250,
      included: 1000,
      tiers: [
        { upTo: 100, flatFee: 5000 },
        { upTo: null, unitPrice: 20, flatFee: 1000 },
      ],
    });

    expect(rated.billableQuantity).toBe(250);
    expect(rated.amount).toBe(9000);
    expect(rated.tierBreakdown).toEqual([
      { tier: 0, units: 100, unitPrice: 0, flatFee: 5000, amount: 5000 },
      { tier: 1, units: 150, unitPrice: 20, flatFee: 1000, amount: 4000 },
    ]);
  });

  it("includes flat-only tier metadata in the current tier response", () => {
    const currentTier = getCurrentPricingTier({
      usageModel: "usage_based",
      ratingModel: "volume",
      usage: 1200,
      tiers: [
        { upTo: 1000, unitPrice: 25 },
        { upTo: null, flatFee: 25000 },
      ],
    });

    expect(currentTier).toEqual({
      index: 1,
      startsAt: 1000,
      endsAt: null,
      unitPrice: 0,
      flatFee: 25000,
    });
  });

  it("rates only the follow-up overage after an earlier mid-period invoice", () => {
    const rated = rateUsageDelta({
      usageModel: "included",
      ratingModel: "package",
      previousUsage: 5100,
      usage: 5190,
      included: 5000,
      overagePrice: 25,
      billingUnits: 1,
    });

    expect(rated.usage).toBe(5190);
    expect(rated.billableQuantity).toBe(90);
    expect(rated.amount).toBe(2250);
    expect(rated.pricePerUnit).toBe(25);
    expect(rated.billingUnits).toBe(1);
  });

  it("rates only the newly reached graduated tiers after prior billed usage", () => {
    const rated = rateUsageDelta({
      usageModel: "included",
      ratingModel: "graduated",
      previousUsage: 6100,
      usage: 6500,
      included: 5000,
      tiers: [
        { upTo: 1000, unitPrice: 10 },
        { upTo: 5000, unitPrice: 8 },
        { upTo: null, unitPrice: 5 },
      ],
    });

    expect(rated.usage).toBe(6500);
    expect(rated.billableQuantity).toBe(400);
    expect(rated.amount).toBe(3200);
    expect(rated.tierBreakdown).toEqual([
      { tier: 1, units: 400, unitPrice: 8, amount: 3200 },
    ]);
  });
});
