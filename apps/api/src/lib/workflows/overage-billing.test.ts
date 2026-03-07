import { describe, expect, it } from "vitest";
import {
  deriveReconciledPeriodStart,
  rollPeriodForward,
} from "./overage-billing";

describe("rollPeriodForward", () => {
  it("moves to the immediate next period", () => {
    const currentPeriodEnd = 1_000;
    const dayMs = 24 * 60 * 60 * 1000;

    const next = rollPeriodForward(currentPeriodEnd, "daily", currentPeriodEnd);

    expect(next.nextPeriodStart).toBe(currentPeriodEnd);
    expect(next.nextPeriodEnd).toBe(currentPeriodEnd + dayMs);
  });

  it("catches up across multiple elapsed periods", () => {
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    const currentPeriodEnd = 0;
    const now = monthMs * 3 + 100;

    const next = rollPeriodForward(currentPeriodEnd, "monthly", now);

    expect(next.nextPeriodStart).toBe(monthMs * 3);
    expect(next.nextPeriodEnd).toBe(monthMs * 4);
  });

  it("falls back to monthly duration for unknown intervals", () => {
    const currentPeriodEnd = 5_000;
    const monthMs = 30 * 24 * 60 * 60 * 1000;

    const next = rollPeriodForward(
      currentPeriodEnd,
      "unknown_interval",
      currentPeriodEnd,
    );

    expect(next.nextPeriodStart).toBe(currentPeriodEnd);
    expect(next.nextPeriodEnd).toBe(currentPeriodEnd + monthMs);
  });
});

describe("deriveReconciledPeriodStart", () => {
  it("uses provider start date when it is within the reconciled period", () => {
    const start = deriveReconciledPeriodStart(
      1_000,
      2_000,
      "1970-01-01T00:00:01.500Z",
    );
    expect(start).toBe(1_500);
  });

  it("falls back to current period end for missing or invalid provider start", () => {
    expect(deriveReconciledPeriodStart(1_000, 2_000, null)).toBe(1_000);
    expect(deriveReconciledPeriodStart(1_000, 2_000, "not-a-date")).toBe(1_000);
  });

  it("falls back when provider start is outside of the new period boundaries", () => {
    expect(
      deriveReconciledPeriodStart(1_000, 2_000, "1970-01-01T00:00:00.500Z"),
    ).toBe(1_000);
    expect(
      deriveReconciledPeriodStart(1_000, 2_000, "1970-01-01T00:00:02.000Z"),
    ).toBe(1_000);
  });
});
