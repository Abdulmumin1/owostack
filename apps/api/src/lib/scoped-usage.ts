import type { UsageLedgerDO, UsageSumQuery } from "./usage-ledger-do";
import { sumUsageAmount } from "./usage-ledger";
import type { UsageLedgerScope } from "./usage-scope";

type UsageLedgerOptions = {
  usageLedger?: DurableObjectNamespace<UsageLedgerDO>;
  organizationId?: string | null;
};

type SumScopedUsageParams = Omit<UsageSumQuery, "subscriptionId" | "planId"> & {
  scope?: UsageLedgerScope;
  legacyPlanScope?: UsageLedgerScope;
  legacyCreatedAtFloor?: number | null;
};

export async function sumScopedUsageAmount(
  opts: UsageLedgerOptions,
  params: SumScopedUsageParams,
): Promise<number | null> {
  const { scope, legacyPlanScope, legacyCreatedAtFloor, ...baseQuery } = params;

  const primary = await sumUsageAmount(opts, {
    ...baseQuery,
    ...scope,
  });

  if (primary === null) {
    return null;
  }

  if (!legacyPlanScope?.planId || legacyPlanScope.subscriptionId !== null) {
    return primary;
  }

  const legacy = await sumUsageAmount(opts, {
    ...baseQuery,
    ...legacyPlanScope,
    ...(typeof legacyCreatedAtFloor === "number"
      ? {
          createdAtFrom: Math.max(
            baseQuery.createdAtFrom ?? Number.MIN_SAFE_INTEGER,
            legacyCreatedAtFloor,
          ),
        }
      : {}),
  });

  if (legacy === null) {
    return null;
  }

  return primary + legacy;
}
