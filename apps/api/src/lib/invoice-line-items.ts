import type { BillingTierBreakdown, RatingModel } from "@owostack/types";

export interface RatedMeteredInvoiceFeature {
  featureName: string;
  billableQuantity: number;
  pricePerUnit: number | null;
  billingUnits: number | null;
  ratingModel?: RatingModel;
  tierBreakdown?: BillingTierBreakdown[];
}

export interface MeteredInvoiceLineData {
  description: string;
  unitPrice: number;
  metadata?: Record<string, unknown>;
}

function buildDescription(feature: RatedMeteredInvoiceFeature): string {
  if (feature.ratingModel === "graduated" || feature.ratingModel === "volume") {
    return `${feature.featureName}: ${feature.billableQuantity} units (${feature.ratingModel} pricing)`;
  }

  return `${feature.featureName}: ${feature.billableQuantity} ${feature.billingUnits && feature.billingUnits > 1 ? `units (${feature.billingUnits} per package)` : "units"}`;
}

function getTieredUnitPrice(feature: RatedMeteredInvoiceFeature): number {
  if (feature.ratingModel === "volume") {
    return feature.tierBreakdown?.[0]?.unitPrice ?? 0;
  }

  // Graduated pricing has no single canonical unit price.
  return 0;
}

export function buildMeteredInvoiceLineData(
  feature: RatedMeteredInvoiceFeature,
): MeteredInvoiceLineData {
  if (feature.ratingModel === "graduated" || feature.ratingModel === "volume") {
    return {
      description: buildDescription(feature),
      unitPrice: getTieredUnitPrice(feature),
      metadata: {
        ratingModel: feature.ratingModel,
        tierBreakdown: feature.tierBreakdown || [],
      },
    };
  }

  return {
    description: buildDescription(feature),
    unitPrice: Math.round(
      (feature.pricePerUnit || 0) / (feature.billingUnits || 1),
    ),
  };
}
