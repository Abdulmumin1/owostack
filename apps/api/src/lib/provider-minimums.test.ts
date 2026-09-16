import { describe, expect, it } from "vitest";
import { getProviderRegistry } from "./providers";
import {
  PROVIDER_MINIMUMS,
  getMinimumChargeAmount,
  meetsMinimumCharge,
} from "./provider-minimums";

describe("provider minimums", () => {
  it("enforces the Bachs documented floors in minor units", () => {
    // https://docs.bachs.io/api-reference/payments/create-checkout-session
    // pricing.amount: "Minimum 1000 for NGN, 1 for USD"
    expect(getMinimumChargeAmount("bachs", "USD")).toBe(100);
    expect(getMinimumChargeAmount("bachs", "NGN")).toBe(100000);
    expect(getMinimumChargeAmount("BACHS", "usd")).toBe(100);

    expect(meetsMinimumCharge(99, "bachs", "USD")).toBe(false);
    expect(meetsMinimumCharge(100, "bachs", "USD")).toBe(true);
    expect(meetsMinimumCharge(99999, "bachs", "NGN")).toBe(false);
    expect(meetsMinimumCharge(100000, "bachs", "NGN")).toBe(true);
  });

  it("allows any amount for currencies without a documented floor", () => {
    expect(getMinimumChargeAmount("bachs", "GHS")).toBe(0);
    expect(meetsMinimumCharge(1, "bachs", "GHS")).toBe(true);
  });

  it("keys every minimum entry by a registered adapter id", () => {
    const registeredIds = new Set(
      getProviderRegistry()
        .list()
        .map((adapter) => adapter.id),
    );

    // Known legacy mismatch: the Dodo entry is keyed "dodo" while the adapter
    // id is "dodopayments". Guard against introducing new mismatches.
    const knownLegacyKeys = new Set(["dodo"]);

    for (const key of Object.keys(PROVIDER_MINIMUMS)) {
      if (knownLegacyKeys.has(key)) continue;
      expect(registeredIds.has(key)).toBe(true);
    }
  });
});
