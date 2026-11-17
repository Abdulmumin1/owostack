import { and, eq, or } from "drizzle-orm";
import { schema } from "@owostack/db";

export interface PrepaidCreditAccess {
  creditSystemId: string;
  creditSystemSlug: string;
  costPerUnit: number;
  trackingFeatureId: string;
  trackingFeatureSlug: string;
  balance: number;
}

type FeatureReference = {
  id: string;
  slug?: string | null;
};

/**
 * Resolve a pack-backed credit system without requiring a subscription.
 * A persisted balance row is the proof that the customer has participated in
 * the prepaid system; zero-balance rows remain resolvable so callers can return
 * an insufficient-balance response instead of claiming the feature has no plan.
 */
export async function resolvePrepaidCreditAccess(params: {
  db: any;
  organizationId: string;
  customerId: string;
  feature: FeatureReference;
  requestedUnits: number;
}): Promise<PrepaidCreditAccess | null> {
  if (!params.db?.query?.creditSystemBalances?.findFirst) {
    return null;
  }

  const featureSlug = params.feature.slug || params.feature.id;

  const directSystems = await params.db
    .select({
      creditSystemId: schema.creditSystems.id,
      creditSystemSlug: schema.creditSystems.slug,
      balance: schema.creditSystemBalances.balance,
    })
    .from(schema.creditSystems)
    .innerJoin(
      schema.creditSystemBalances,
      and(
        eq(schema.creditSystemBalances.creditSystemId, schema.creditSystems.id),
        eq(schema.creditSystemBalances.customerId, params.customerId),
      ),
    )
    .where(
      and(
        eq(schema.creditSystems.organizationId, params.organizationId),
        or(
          eq(schema.creditSystems.slug, featureSlug),
          eq(schema.creditSystems.id, params.feature.id),
        ),
      ),
    );

  const mappedSystems = await params.db
    .select({
      creditSystemId: schema.creditSystems.id,
      creditSystemSlug: schema.creditSystems.slug,
      costPerUnit: schema.creditSystemFeatures.cost,
      balance: schema.creditSystemBalances.balance,
    })
    .from(schema.creditSystemFeatures)
    .innerJoin(
      schema.creditSystems,
      eq(schema.creditSystems.id, schema.creditSystemFeatures.creditSystemId),
    )
    .innerJoin(
      schema.creditSystemBalances,
      and(
        eq(schema.creditSystemBalances.creditSystemId, schema.creditSystems.id),
        eq(schema.creditSystemBalances.customerId, params.customerId),
      ),
    )
    .where(
      and(
        eq(schema.creditSystems.organizationId, params.organizationId),
        eq(schema.creditSystemFeatures.featureId, params.feature.id),
      ),
    );

  const candidates: PrepaidCreditAccess[] = [
    ...directSystems.map((system: any) => ({
      creditSystemId: system.creditSystemId,
      creditSystemSlug: system.creditSystemSlug,
      costPerUnit: 1,
      trackingFeatureId: params.feature.id,
      trackingFeatureSlug: featureSlug,
      balance: system.balance,
    })),
    ...mappedSystems.map((system: any) => ({
      creditSystemId: system.creditSystemId,
      creditSystemSlug: system.creditSystemSlug,
      costPerUnit: system.costPerUnit,
      trackingFeatureId: params.feature.id,
      trackingFeatureSlug: system.creditSystemSlug,
      balance: system.balance,
    })),
  ];

  if (candidates.length === 0) return null;

  const affordable = candidates.find(
    (candidate) =>
      candidate.balance >= candidate.costPerUnit * params.requestedUnits,
  );
  const selected =
    affordable ?? candidates.sort((a, b) => b.balance - a.balance)[0];
  if (!selected) return null;

  const trackingFeature = await params.db.query.features.findFirst({
    where: and(
      eq(schema.features.organizationId, params.organizationId),
      eq(schema.features.slug, selected.creditSystemSlug),
    ),
  });

  return {
    ...selected,
    trackingFeatureId: trackingFeature?.id ?? selected.trackingFeatureId,
  };
}

/**
 * Adapt prepaid access to the existing entitlement evaluator. The zero plan
 * balance makes all allowed usage come from the scoped pack balance, while the
 * non-resetting period prevents prepaid credits from being replenished.
 */
export function buildPrepaidCreditGrant(
  access: PrepaidCreditAccess,
  now: number,
) {
  return {
    subscription: {
      id: null,
      planId: null,
      status: "active",
      currentPeriodStart: 0,
      currentPeriodEnd: 253_402_300_799_999,
      plan: { name: "Prepaid credits", slug: null, type: "free" },
      createdAt: now,
      updatedAt: now,
    },
    planFeature: {
      id: `prepaid:${access.creditSystemId}`,
      planId: null,
      featureId: access.trackingFeatureId,
      enabled: true,
      limitValue: 0,
      trialLimitValue: null,
      resetInterval: "never",
      resetOnEnable: false,
      rolloverEnabled: false,
      rolloverMaxBalance: null,
      usageModel: "included",
      overage: "block",
      overagePrice: null,
      maxOverageUnits: null,
      billingUnits: 1,
      creditCost: access.costPerUnit,
    },
  };
}
