import { and, eq, or, sql, desc } from "drizzle-orm";
import { schema } from "@owostack/db";
import { getResetPeriod } from "./reset-period";
import { sumScopedUsageAmount } from "./scoped-usage";
import type { UsageLedgerDO } from "./usage-ledger-do";
import type { UsageLedgerScope } from "./usage-scope";

export type ManualBonusEntitlement = {
  id: string;
  featureId: string;
  limitValue: number | null;
  resetInterval: string;
  expiresAt?: number | null;
  grantedReason?: string | null;
};

type BonusWindowSubscription = {
  currentPeriodStart?: number | null;
  currentPeriodEnd?: number | null;
};

export type ManualBonusBalanceState = {
  entitlement: ManualBonusEntitlement | null;
  usage: number;
  limit: number | null;
  balance: number | null;
  resetsAt: string | null;
};

function defaultWindowStart(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function defaultWindowEnd(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getTime();
}

export async function getActiveManualBonusEntitlement(
  db: any,
  customerId: string,
  featureId: string,
  now: number,
): Promise<ManualBonusEntitlement | null> {
  return (
    (await db.query.entitlements.findFirst({
      where: and(
        eq(schema.entitlements.customerId, customerId),
        eq(schema.entitlements.featureId, featureId),
        eq(schema.entitlements.source, "manual_bonus"),
        or(
          sql`${schema.entitlements.expiresAt} IS NULL`,
          sql`${schema.entitlements.expiresAt} > ${now}`,
        ),
      ),
      orderBy: [desc(schema.entitlements.updatedAt)],
    })) ?? null
  );
}

export async function resolveManualBonusBalanceState(params: {
  usageLedger?: DurableObjectNamespace<UsageLedgerDO>;
  organizationId?: string | null;
  customerId: string;
  featureId: string;
  entitlement: ManualBonusEntitlement | null;
  subscription?: BonusWindowSubscription | null;
  usageLedgerScope?: UsageLedgerScope;
  legacyUsageLedgerScope?: UsageLedgerScope;
}): Promise<ManualBonusBalanceState> {
  if (!params.entitlement) {
    return {
      entitlement: null,
      usage: 0,
      limit: null,
      balance: 0,
      resetsAt: null,
    };
  }

  const subscriptionWindowStart =
    params.subscription?.currentPeriodStart ?? defaultWindowStart(Date.now());
  const subscriptionWindowEnd =
    params.subscription?.currentPeriodEnd ?? defaultWindowEnd(Date.now());
  const resetWindow = getResetPeriod(
    params.entitlement.resetInterval,
    subscriptionWindowStart,
    subscriptionWindowEnd,
  );

  const usage =
    (await sumScopedUsageAmount(
      {
        usageLedger: params.usageLedger,
        organizationId: params.organizationId,
      },
      {
        customerId: params.customerId,
        featureId: params.featureId,
        createdAtFrom: resetWindow.periodStart,
        createdAtTo: resetWindow.periodEnd,
        coverageSource: "manual_bonus",
        coverageReferenceId: params.entitlement.id,
        scope: params.usageLedgerScope,
        legacyPlanScope: params.legacyUsageLedgerScope,
        legacyCreatedAtFloor: params.subscription?.currentPeriodStart ?? null,
      },
    )) ?? 0;

  const limit = params.entitlement.limitValue;
  return {
    entitlement: params.entitlement,
    usage,
    limit,
    balance: limit === null ? null : Math.max(0, limit - usage),
    resetsAt: new Date(resetWindow.periodEnd).toISOString(),
  };
}
