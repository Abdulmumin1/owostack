import { describe, expect, it, vi } from "vitest";
import {
  calculateProration,
  detectSwitchType,
  provisionEntitlements,
} from "./plan-switch";

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

describe("provisionEntitlements", () => {
  it("falls back when db.transaction is unsupported in D1", async () => {
    const whereMock = vi.fn(async () => []);
    const deleteMock = vi.fn(() => ({ where: whereMock }));
    const valuesMock = vi.fn(async () => []);
    const insertMock = vi.fn(() => ({ values: valuesMock }));

    const db: any = {
      query: {
        planFeatures: {
          findMany: vi
            .fn()
            .mockResolvedValueOnce([
              {
                featureId: "feat_new_1",
                limitValue: 100,
                resetInterval: "monthly",
                resetOnEnable: true,
                feature: { id: "feat_new_1" },
              },
            ])
            .mockResolvedValueOnce([{ featureId: "feat_old_1" }]),
        },
      },
      transaction: vi.fn(async () => {
        throw new Error(
          "D1_ERROR: To execute a transaction, please use the state.storage.transaction() APIs instead of SQL BEGIN TRANSACTION.",
        );
      }),
      delete: deleteMock,
      insert: insertMock,
    };

    await provisionEntitlements(db, "cus_1", "plan_new", "plan_old");

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(whereMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledTimes(1);
  });
});
