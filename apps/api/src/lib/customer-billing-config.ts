import { and, eq, inArray } from "drizzle-orm";
import { createDb, schema } from "@owostack/db";

type DB = ReturnType<typeof createDb>;

export type CustomerFeatureBillingConfig = {
  feature: {
    id: string;
    slug: string | null;
    name: string;
  };
  overage: "block" | "charge" | null;
  maxOverageUnits: number | null;
  createdAt: number;
  updatedAt: number;
};

export type CustomerOverageLimitConfig = {
  maxOverageAmount: number | null;
  onLimitReached: "block" | "notify";
  createdAt: number;
  updatedAt: number;
};

export type CustomerBillingConfig = {
  overageLimit: CustomerOverageLimitConfig | null;
  featureConfigs: CustomerFeatureBillingConfig[];
};

export type CustomerFeatureBillingOverride = {
  overage: "block" | "charge" | null;
  maxOverageUnits: number | null;
} | null;

export async function getCustomerFeatureBillingConfigs(
  db: DB,
  organizationId: string,
  customerId: string,
): Promise<CustomerFeatureBillingConfig[]> {
  const rows = await db
    .select({
      featureId: schema.customerFeatureConfigs.featureId,
      featureSlug: schema.features.slug,
      featureName: schema.features.name,
      overage: schema.customerFeatureConfigs.overage,
      maxOverageUnits: schema.customerFeatureConfigs.maxOverageUnits,
      createdAt: schema.customerFeatureConfigs.createdAt,
      updatedAt: schema.customerFeatureConfigs.updatedAt,
    })
    .from(schema.customerFeatureConfigs)
    .innerJoin(
      schema.features,
      eq(schema.customerFeatureConfigs.featureId, schema.features.id),
    )
    .where(
      and(
        eq(schema.customerFeatureConfigs.organizationId, organizationId),
        eq(schema.customerFeatureConfigs.customerId, customerId),
      ),
    );

  return rows.map((row) => ({
    feature: {
      id: row.featureId,
      slug: row.featureSlug,
      name: row.featureName,
    },
    overage:
      row.overage === "block" || row.overage === "charge" ? row.overage : null,
    maxOverageUnits: row.maxOverageUnits ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function getCustomerOverageLimitConfig(
  db: DB,
  organizationId: string,
  customerId: string,
): Promise<CustomerOverageLimitConfig | null> {
  const row = await db.query.customerOverageLimits.findFirst({
    where: and(
      eq(schema.customerOverageLimits.organizationId, organizationId),
      eq(schema.customerOverageLimits.customerId, customerId),
    ),
  });

  if (!row) {
    return null;
  }

  return {
    maxOverageAmount: row.maxOverageAmount ?? null,
    onLimitReached: row.onLimitReached === "notify" ? "notify" : "block",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getCustomerBillingConfig(
  db: DB,
  organizationId: string,
  customerId: string,
): Promise<CustomerBillingConfig> {
  const [overageLimit, featureConfigs] = await Promise.all([
    getCustomerOverageLimitConfig(db, organizationId, customerId),
    getCustomerFeatureBillingConfigs(db, organizationId, customerId),
  ]);

  return {
    overageLimit,
    featureConfigs,
  };
}

export async function setCustomerFeatureBillingConfig(params: {
  db: DB;
  organizationId: string;
  customerId: string;
  featureId: string;
  overage?: "block" | "charge" | null;
  maxOverageUnits?: number | null;
  now?: number;
}) {
  const {
    db,
    organizationId,
    customerId,
    featureId,
    overage,
    maxOverageUnits,
  } = params;
  const now = params.now ?? Date.now();
  const normalizedOverage =
    overage === "block" || overage === "charge" ? overage : null;
  const normalizedMaxOverageUnits = maxOverageUnits ?? null;

  if (normalizedOverage === null && normalizedMaxOverageUnits === null) {
    await db
      .delete(schema.customerFeatureConfigs)
      .where(
        and(
          eq(schema.customerFeatureConfigs.organizationId, organizationId),
          eq(schema.customerFeatureConfigs.customerId, customerId),
          eq(schema.customerFeatureConfigs.featureId, featureId),
        ),
      );
    return null;
  }

  await db
    .insert(schema.customerFeatureConfigs)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      customerId,
      featureId,
      overage: normalizedOverage,
      maxOverageUnits: normalizedMaxOverageUnits,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.customerFeatureConfigs.customerId,
        schema.customerFeatureConfigs.featureId,
      ],
      set: {
        overage: normalizedOverage,
        maxOverageUnits: normalizedMaxOverageUnits,
        updatedAt: now,
      },
    });

  return true;
}

export async function setCustomerOverageLimitConfig(params: {
  db: DB;
  organizationId: string;
  customerId: string;
  maxOverageAmount: number | null;
  onLimitReached?: "block" | "notify";
  now?: number;
}) {
  const { db, organizationId, customerId, maxOverageAmount, onLimitReached } =
    params;
  const now = params.now ?? Date.now();

  if (maxOverageAmount === null) {
    await db
      .delete(schema.customerOverageLimits)
      .where(
        and(
          eq(schema.customerOverageLimits.organizationId, organizationId),
          eq(schema.customerOverageLimits.customerId, customerId),
        ),
      );
    return null;
  }

  await db
    .insert(schema.customerOverageLimits)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      customerId,
      maxOverageAmount,
      onLimitReached: onLimitReached === "notify" ? "notify" : "block",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.customerOverageLimits.customerId,
      set: {
        maxOverageAmount,
        onLimitReached: onLimitReached === "notify" ? "notify" : "block",
        updatedAt: now,
      },
    });

  return true;
}

export async function resolveCustomerFeatureBillingOverride(
  db: DB,
  organizationId: string,
  customerId: string,
  featureIds: Iterable<string>,
): Promise<CustomerFeatureBillingOverride> {
  const requestedFeatureIds = [...new Set(featureIds)].filter(Boolean);
  if (requestedFeatureIds.length === 0) {
    return null;
  }

  const rows = await db
    .select({
      featureId: schema.customerFeatureConfigs.featureId,
      overage: schema.customerFeatureConfigs.overage,
      maxOverageUnits: schema.customerFeatureConfigs.maxOverageUnits,
    })
    .from(schema.customerFeatureConfigs)
    .where(
      and(
        eq(schema.customerFeatureConfigs.organizationId, organizationId),
        eq(schema.customerFeatureConfigs.customerId, customerId),
        inArray(schema.customerFeatureConfigs.featureId, requestedFeatureIds),
      ),
    );

  const rowByFeatureId = new Map(rows.map((row) => [row.featureId, row]));

  for (const featureId of requestedFeatureIds) {
    const row = rowByFeatureId.get(featureId);
    if (!row) continue;
    return {
      overage:
        row.overage === "block" || row.overage === "charge"
          ? row.overage
          : null,
      maxOverageUnits: row.maxOverageUnits ?? null,
    };
  }

  return null;
}

export function applyCustomerFeatureBillingOverride<T extends object>(
  planFeature: T,
  override: CustomerFeatureBillingOverride,
): T {
  const planFeatureRecord = planFeature as T & {
    usageModel?: string | null;
    overage?: "block" | "charge" | null;
  };

  const effectiveOverage =
    planFeatureRecord.usageModel === "usage_based"
      ? planFeatureRecord.overage
      : override?.overage ?? "block";

  return {
    ...planFeature,
    ...(effectiveOverage ? { overage: effectiveOverage } : {}),
    ...(override?.maxOverageUnits !== null &&
    override?.maxOverageUnits !== undefined
      ? { maxOverageUnits: override.maxOverageUnits }
      : {}),
  };
}
