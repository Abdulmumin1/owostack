import { describe, expect, it } from "vitest";
import { buildMeteredInvoiceLineData } from "../src/lib/invoice-line-items";

describe("invoice-line-items", () => {
  it("stores graduated pricing as tier metadata instead of a synthetic unit price", () => {
    const line = buildMeteredInvoiceLineData({
      featureName: "API Calls",
      billableQuantity: 1500,
      pricePerUnit: null,
      billingUnits: null,
      ratingModel: "graduated",
      tierBreakdown: [
        { tier: 0, units: 1000, unitPrice: 10, flatFee: 2000, amount: 12000 },
        { tier: 1, units: 500, unitPrice: 8, amount: 4000 },
      ],
    });

    expect(line).toEqual({
      description: "API Calls: 1500 units (graduated pricing)",
      unitPrice: 0,
      metadata: {
        ratingModel: "graduated",
        tierBreakdown: [
          { tier: 0, units: 1000, unitPrice: 10, flatFee: 2000, amount: 12000 },
          { tier: 1, units: 500, unitPrice: 8, amount: 4000 },
        ],
      },
    });
  });

  it("preserves flat-only volume bands without inventing a per-unit rate", () => {
    const line = buildMeteredInvoiceLineData({
      featureName: "Agent Runs",
      billableQuantity: 1200,
      pricePerUnit: null,
      billingUnits: null,
      ratingModel: "volume",
      tierBreakdown: [
        { tier: 1, units: 1200, unitPrice: 0, flatFee: 25000, amount: 25000 },
      ],
    });

    expect(line).toEqual({
      description: "Agent Runs: 1200 units (volume pricing)",
      unitPrice: 0,
      metadata: {
        ratingModel: "volume",
        tierBreakdown: [
          { tier: 1, units: 1200, unitPrice: 0, flatFee: 25000, amount: 25000 },
        ],
      },
    });
  });
});
