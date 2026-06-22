import { describe, expect, it } from "vitest";

import {
  formatCurrency,
  getCurrencyMinorUnitExponent,
} from "./currency";

describe("currency utilities", () => {
  it("uses ISO minor units when formatting standard two-decimal currencies", () => {
    expect(getCurrencyMinorUnitExponent("USD")).toBe(2);
    expect(formatCurrency(12345, "USD")).toBe("$123.45");
  });

  it("does not divide zero-decimal currencies by 100", () => {
    expect(getCurrencyMinorUnitExponent("JPY")).toBe(0);
    expect(formatCurrency(12345, "JPY")).toBe("￥12,345");
  });
});
