import { describe, expect, it } from "vitest";
import { calculateProration, detectSwitchType } from "./plan-switch";

describe("detectSwitchType", () => {
  it("returns new when there is no current plan", () => {
    const result = detectSwitchType(null, { price: 5000, interval: "monthly" });
    expect(result).toBe("new");
  });

  it("returns upgrade when normalized monthly price increases", () => {
    const result = detectSwitchType(
      { price: 12000, interval: "yearly" },
      { price: 1500, interval: "monthly" },
    );

    expect(result).toBe("upgrade");
  });

  it("returns downgrade when normalized monthly price decreases", () => {
    const result = detectSwitchType(
      { price: 1500, interval: "monthly" },
      { price: 12000, interval: "yearly" },
    );

    expect(result).toBe("downgrade");
  });

  it("returns lateral when normalized monthly prices are equal", () => {
    const result = detectSwitchType(
      { price: 3000, interval: "quarterly" },
      { price: 1000, interval: "monthly" },
    );

    expect(result).toBe("lateral");
  });
});

describe("calculateProration", () => {
  const hour = 60 * 60 * 1000;

  it("returns full new plan price when period bounds are invalid", () => {
    const result = calculateProration(
      { price: 10000 },
      { price: 20000 },
      2000,
      1000,
      1500,
    );

    expect(result).toBe(20000);
  });

  it("charges full price difference at period start", () => {
    const periodStart = 10 * hour;
    const periodEnd = 20 * hour;

    const result = calculateProration(
      { price: 10000 },
      { price: 16000 },
      periodStart,
      periodEnd,
      periodStart,
    );

    expect(result).toBe(6000);
  });

  it("computes prorated difference in the middle of period", () => {
    const periodStart = 0;
    const periodEnd = 10 * hour;
    const now = 6 * hour; // 40% remaining

    const result = calculateProration(
      { price: 10000 },
      { price: 15000 },
      periodStart,
      periodEnd,
      now,
    );

    expect(result).toBe(2000);
  });

  it("returns zero when period is already over", () => {
    const periodStart = 0;
    const periodEnd = 10 * hour;
    const now = 12 * hour;

    const result = calculateProration(
      { price: 10000 },
      { price: 15000 },
      periodStart,
      periodEnd,
      now,
    );

    expect(result).toBe(0);
  });
});
