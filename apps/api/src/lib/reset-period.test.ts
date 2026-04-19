import { afterEach, describe, expect, it, vi } from "vitest";
import { getResetPeriod } from "./reset-period";

afterEach(() => {
  vi.useRealTimers();
});

describe("getResetPeriod", () => {
  it("treats never as an alias of none", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00.000Z"));

    const periodStart = Date.UTC(2026, 3, 1, 0, 0, 0, 0);
    const periodEnd = Date.UTC(2026, 3, 30, 23, 59, 59, 999);

    expect(getResetPeriod("never", periodStart, periodEnd)).toEqual({
      periodStart,
      periodEnd,
    });
  });
});
