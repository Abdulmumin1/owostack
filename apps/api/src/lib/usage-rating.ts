import type {
  BillingTierBreakdown,
  CurrentPricingTier,
  PricingTier,
  RatingModel,
} from "@owostack/types";

type UsageModel = "included" | "usage_based" | "prepaid";

export interface RateUsageParams {
  usageModel?: string | null;
  ratingModel?: string | null;
  usage: number;
  included?: number | null;
  pricePerUnit?: number | null;
  billingUnits?: number | null;
  overagePrice?: number | null;
  tiers?: PricingTier[] | null;
}

export interface RatedUsage {
  usageModel: UsageModel;
  ratingModel: RatingModel;
  usage: number;
  included: number | null;
  billableQuantity: number;
  amount: number;
  pricePerUnit: number | null;
  billingUnits: number | null;
  tierBreakdown?: BillingTierBreakdown[];
}

function normalizeUsageModel(usageModel?: string | null): UsageModel {
  if (usageModel === "usage_based" || usageModel === "prepaid") {
    return usageModel;
  }
  return "included";
}

export function normalizeRatingModel(ratingModel?: string | null): RatingModel {
  if (ratingModel === "graduated" || ratingModel === "volume") {
    return ratingModel;
  }
  return "package";
}

function getBillableQuantity(
  usageModel: UsageModel,
  usage: number,
  included: number | null,
): number {
  const normalizedUsage = Math.max(0, usage);
  if (usageModel === "usage_based") return normalizedUsage;
  if (usageModel === "included") {
    return Math.max(0, normalizedUsage - (included || 0));
  }
  return 0;
}

function findTierIndex(
  usage: number,
  tiers: PricingTier[],
): { index: number; startsAt: number; tier: PricingTier } | null {
  if (tiers.length === 0 || usage <= 0) return null;

  let startsAt = 0;
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    if (tier.upTo === null || usage <= tier.upTo) {
      return { index, startsAt, tier };
    }
    startsAt = tier.upTo;
  }

  const lastIndex = tiers.length - 1;
  return {
    index: lastIndex,
    startsAt: tiers[lastIndex - 1]?.upTo ?? 0,
    tier: tiers[lastIndex],
  };
}

function getTierUnitPrice(tier: PricingTier): number {
  return tier.unitPrice ?? 0;
}

function getPackagePrice(
  params: RateUsageParams,
  usageModel: UsageModel,
): number {
  if (usageModel === "included") {
    return params.overagePrice ?? params.pricePerUnit ?? 0;
  }
  return params.pricePerUnit ?? params.overagePrice ?? 0;
}

export function getCurrentPricingTier(params: {
  usage: number;
  included?: number | null;
  usageModel?: string | null;
  ratingModel?: string | null;
  tiers?: PricingTier[] | null;
}): CurrentPricingTier | undefined {
  const ratingModel = normalizeRatingModel(params.ratingModel);
  if (ratingModel === "package" || !params.tiers || params.tiers.length === 0) {
    return undefined;
  }

  const usageModel = normalizeUsageModel(params.usageModel);
  const billableQuantity = getBillableQuantity(
    usageModel,
    params.usage,
    params.included ?? null,
  );
  const locatedTier = findTierIndex(billableQuantity, params.tiers);
  if (!locatedTier) return undefined;

  return {
    index: locatedTier.index,
    startsAt: locatedTier.startsAt,
    endsAt: locatedTier.tier.upTo,
    unitPrice: getTierUnitPrice(locatedTier.tier),
    ...(locatedTier.tier.flatFee !== undefined
      ? { flatFee: locatedTier.tier.flatFee }
      : {}),
  };
}

export function rateUsage(params: RateUsageParams): RatedUsage {
  const usageModel = normalizeUsageModel(params.usageModel);
  const ratingModel = normalizeRatingModel(params.ratingModel);
  const usage = Math.max(0, params.usage);
  const included = params.included ?? null;
  const billableQuantity = getBillableQuantity(usageModel, usage, included);

  if (billableQuantity === 0) {
    return {
      usageModel,
      ratingModel,
      usage,
      included,
      billableQuantity: 0,
      amount: 0,
      pricePerUnit:
        ratingModel === "package" ? getPackagePrice(params, usageModel) : null,
      billingUnits:
        ratingModel === "package" ? (params.billingUnits ?? 1) : null,
      tierBreakdown: ratingModel === "package" ? undefined : [],
    };
  }

  if (ratingModel === "package") {
    const packagePrice = getPackagePrice(params, usageModel);
    const billingUnits = Math.max(1, params.billingUnits ?? 1);
    const packages = Math.ceil(billableQuantity / billingUnits);

    return {
      usageModel,
      ratingModel,
      usage,
      included,
      billableQuantity,
      amount: packages * packagePrice,
      pricePerUnit: packagePrice,
      billingUnits,
    };
  }

  const tiers = params.tiers ?? [];
  if (tiers.length === 0) {
    return {
      usageModel,
      ratingModel,
      usage,
      included,
      billableQuantity,
      amount: 0,
      pricePerUnit: null,
      billingUnits: null,
      tierBreakdown: [],
    };
  }

  if (ratingModel === "volume") {
    const locatedTier = findTierIndex(billableQuantity, tiers);
    if (!locatedTier) {
      return {
        usageModel,
        ratingModel,
        usage,
        included,
        billableQuantity,
        amount: 0,
        pricePerUnit: null,
        billingUnits: null,
        tierBreakdown: [],
      };
    }

    const amount =
      billableQuantity * getTierUnitPrice(locatedTier.tier) +
      (locatedTier.tier.flatFee ?? 0);

    return {
      usageModel,
      ratingModel,
      usage,
      included,
      billableQuantity,
      amount,
      pricePerUnit: getTierUnitPrice(locatedTier.tier),
      billingUnits: 1,
      tierBreakdown: [
        {
          tier: locatedTier.index,
          units: billableQuantity,
          unitPrice: getTierUnitPrice(locatedTier.tier),
          ...(locatedTier.tier.flatFee !== undefined
            ? { flatFee: locatedTier.tier.flatFee }
            : {}),
          amount,
        },
      ],
    };
  }

  let remainingUsage = billableQuantity;
  let previousBound = 0;
  let totalAmount = 0;
  const tierBreakdown: BillingTierBreakdown[] = [];

  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    const tierBound = tier.upTo ?? Number.POSITIVE_INFINITY;
    const tierCapacity = tierBound - previousBound;
    const unitsInTier = Math.min(remainingUsage, tierCapacity);

    if (unitsInTier <= 0) {
      previousBound = Number.isFinite(tierBound) ? tierBound : previousBound;
      continue;
    }

    const unitPrice = getTierUnitPrice(tier);
    const amount = unitsInTier * unitPrice + (tier.flatFee ?? 0);
    totalAmount += amount;
    tierBreakdown.push({
      tier: index,
      units: unitsInTier,
      unitPrice,
      ...(tier.flatFee !== undefined ? { flatFee: tier.flatFee } : {}),
      amount,
    });

    remainingUsage -= unitsInTier;
    previousBound = Number.isFinite(tierBound) ? tierBound : previousBound;
    if (remainingUsage <= 0) break;
  }

  return {
    usageModel,
    ratingModel,
    usage,
    included,
    billableQuantity,
    amount: totalAmount,
    pricePerUnit: null,
    billingUnits: null,
    tierBreakdown,
  };
}
