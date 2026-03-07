import { eq, sql } from "drizzle-orm";
import type { UsageLedgerDO } from "./usage-ledger-do";
import { sumUnbilledByFeature, sumUsageAmount } from "./usage-ledger";

/**
 * Overage guard checks — called before allowing overage usage.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */

export interface OverageGuardResult {
  allowed: boolean;
  reason?: string;
  /** Current accumulated unbilled overage amount (minor units) */
  currentOverageAmount?: number;
  /** Customer's spending cap (minor units), if set */
  customerCap?: number | null;
}

/**
 * Check if a customer has a stored payment method (card on file or provider-managed).
 * Queries the payment_methods table — works for all providers.
 */
export async function hasPaymentMethod(
  db: any,
  customerId: string,
): Promise<boolean> {
  const result = await (db as any).run(
    sql`SELECT 1 FROM payment_methods
        WHERE customer_id = ${customerId} AND is_valid = 1
        LIMIT 1`,
  );
  return !!result?.results?.[0];
}

/**
 * Check the feature-level overage cap (maxOverageUnits).
 * Returns how many overage units have been used this period.
 */
export async function getOverageUnitsUsed(
  db: any,
  customerId: string,
  featureId: string,
  periodStart: number,
  periodEnd: number,
  included: number | null,
  opts?: {
    usageLedger?: DurableObjectNamespace<UsageLedgerDO>;
    organizationId?: string | null;
  },
): Promise<number> {
  const ledgerTotal = await sumUsageAmount(
    {
      usageLedger: opts?.usageLedger,
      organizationId: opts?.organizationId,
    },
    {
      customerId,
      featureId,
      periodStart,
      periodEnd,
    },
  );
  if (ledgerTotal !== null) {
    return Math.max(0, ledgerTotal - (included || 0));
  }

  const result = await (db as any).run(
    sql`SELECT COALESCE(SUM(amount), 0) as total
        FROM usage_records
        WHERE customer_id = ${customerId}
          AND feature_id = ${featureId}
          AND period_start >= ${periodStart}
          AND period_end <= ${periodEnd}`,
  );
  const totalUsage = Number(result?.results?.[0]?.total || 0);
  // Overage units = total usage minus included allowance
  return Math.max(0, totalUsage - (included || 0));
}

/**
 * Get the customer's accumulated unbilled overage cost (minor units).
 * Used to check against customer spending caps and org thresholds.
 */
export async function getUnbilledOverageAmount(
  db: any,
  customerId: string,
  opts?: {
    usageLedger?: DurableObjectNamespace<UsageLedgerDO>;
    organizationId?: string | null;
  },
): Promise<number> {
  const ledgerUsageRows = await sumUnbilledByFeature(
    {
      usageLedger: opts?.usageLedger,
      organizationId: opts?.organizationId,
    },
    customerId,
  );

  if (ledgerUsageRows !== null) {
    const planRows = await (db as any).run(
      sql`SELECT pf.feature_id,
                 pf.price_per_unit,
                 pf.overage_price,
                 pf.billing_units,
                 pf.limit_value,
                 pf.usage_model
          FROM subscriptions s
          JOIN plan_features pf ON pf.plan_id = s.plan_id
          WHERE s.customer_id = ${customerId}
            AND s.status IN ('active', 'canceled', 'pending_cancel')
            AND pf.overage = 'charge'`,
    );

    const featureConfig = new Map<
      string,
      {
        pricePerUnit: number;
        overagePrice: number;
        billingUnits: number;
        limitValue: number;
        usageModel: string;
      }
    >();

    for (const row of planRows?.results || []) {
      if (!row.feature_id || featureConfig.has(row.feature_id)) continue;
      featureConfig.set(row.feature_id, {
        pricePerUnit: Number(row.price_per_unit || 0),
        overagePrice: Number(row.overage_price || 0),
        billingUnits: Number(row.billing_units || 1),
        limitValue: Number(row.limit_value || 0),
        usageModel: String(row.usage_model || "included"),
      });
    }

    let totalAmount = 0;
    for (const entry of ledgerUsageRows) {
      const cfg = featureConfig.get(entry.featureId);
      if (!cfg) continue;

      const usage = Number(entry.totalUsage || 0);
      const billable =
        cfg.usageModel === "included"
          ? Math.max(0, usage - cfg.limitValue)
          : usage;
      if (billable <= 0) continue;

      const unitPrice = cfg.pricePerUnit || cfg.overagePrice || 0;
      const billingUnits = cfg.billingUnits || 1;
      const packages = Math.ceil(billable / billingUnits);
      totalAmount += packages * unitPrice;
    }

    return totalAmount;
  }

  // Sum up all uninvoiced usage for features with overage=charge
  // This is an approximation — we sum usage * pricePerUnit for all charge-mode features
  const result = await (db as any).run(
    sql`SELECT COALESCE(SUM(ur.amount), 0) as total_usage,
               pf.price_per_unit,
               pf.overage_price,
               pf.billing_units,
               pf.limit_value,
               pf.usage_model
        FROM usage_records ur
        JOIN subscriptions s ON s.customer_id = ur.customer_id AND s.status IN ('active', 'canceled', 'pending_cancel')
        JOIN plan_features pf ON pf.plan_id = s.plan_id AND pf.feature_id = ur.feature_id
        WHERE ur.customer_id = ${customerId}
          AND ur.invoice_id IS NULL
          AND pf.overage = 'charge'
        GROUP BY pf.feature_id`,
  );

  let totalAmount = 0;
  for (const row of result?.results || []) {
    const usage = Number(row.total_usage || 0);
    const included = Number(row.limit_value || 0);
    const billable =
      row.usage_model === "included" ? Math.max(0, usage - included) : usage;
    if (billable === 0) continue;

    const pricePerUnit = Number(row.price_per_unit || row.overage_price || 0);
    const billingUnits = Number(row.billing_units || 1);
    const packages = Math.ceil(billable / billingUnits);
    totalAmount += packages * pricePerUnit;
  }

  return totalAmount;
}

/**
 * Get the customer's overage spending cap (if set).
 */
export async function getCustomerOverageLimit(
  db: any,
  customerId: string,
): Promise<{ maxOverageAmount: number | null; onLimitReached: string } | null> {
  const result = await (db as any).run(
    sql`SELECT max_overage_amount, on_limit_reached
        FROM customer_overage_limits
        WHERE customer_id = ${customerId} LIMIT 1`,
  );
  const row = result?.results?.[0];
  if (!row) return null;
  return {
    maxOverageAmount: row.max_overage_amount,
    onLimitReached: row.on_limit_reached || "block",
  };
}

/**
 * Get the org's overage settings (threshold, billing interval, etc.).
 * Reads from overage_settings table in business database.
 */
export async function getOrgOverageSettings(
  db: any,
  organizationId: string,
): Promise<{
  billingInterval: string;
  thresholdAmount: number | null;
  autoCollect: boolean;
  gracePeriodHours: number;
} | null> {
  try {
    if (!organizationId) return null;

    const settings = await db.query.overageSettings.findFirst({
      where: eq(schema.overageSettings.organizationId, organizationId),
    });

    if (!settings) return null;

    return {
      billingInterval: settings.billingInterval || "end_of_period",
      thresholdAmount: settings.thresholdAmount,
      autoCollect: settings.autoCollect,
      gracePeriodHours: settings.gracePeriodHours || 0,
    };
  } catch (e) {
    console.error("[getOrgOverageSettings] Error:", e);
    return null;
  }
}

/**
 * Full overage guard check. Call this before allowing overage usage.
 *
 * Checks (in order):
 * 1. Customer has a payment method on file
 * 2. Feature-level maxOverageUnits cap not exceeded
 * 3. Customer-level spending cap not exceeded
 *
 * Returns { allowed: true } or { allowed: false, reason }.
 */
export async function checkOverageAllowed(
  db: any,
  customerId: string,
  featureId: string,
  periodStart: number,
  periodEnd: number,
  included: number | null,
  maxOverageUnits: number | null,
  requestedUnits: number,
  opts?: {
    usageLedger?: DurableObjectNamespace<UsageLedgerDO>;
    organizationId?: string | null;
  },
): Promise<OverageGuardResult> {
  // 1. Card on file check
  const hasCard = await hasPaymentMethod(db, customerId);
  if (!hasCard) {
    return {
      allowed: false,
      reason:
        "No payment method on file. Add a card to enable overage billing.",
    };
  }

  // 2. Feature-level max overage units check
  if (
    maxOverageUnits !== null &&
    maxOverageUnits !== undefined &&
    maxOverageUnits > 0
  ) {
    const overageUsed = await getOverageUnitsUsed(
      db,
      customerId,
      featureId,
      periodStart,
      periodEnd,
      included,
      opts,
    );
    if (overageUsed + requestedUnits > maxOverageUnits) {
      return {
        allowed: false,
        reason: `Overage cap reached (${overageUsed}/${maxOverageUnits} overage units used).`,
      };
    }
  }

  // 3. Customer spending cap check
  const customerLimit = await getCustomerOverageLimit(db, customerId);
  if (
    customerLimit?.maxOverageAmount !== null &&
    customerLimit?.maxOverageAmount !== undefined &&
    customerLimit.maxOverageAmount > 0
  ) {
    const currentAmount = await getUnbilledOverageAmount(db, customerId, opts);
    if (currentAmount >= customerLimit.maxOverageAmount) {
      if (customerLimit.onLimitReached === "block") {
        return {
          allowed: false,
          reason: `Overage spending cap reached (${currentAmount}/${customerLimit.maxOverageAmount} ${customerLimit.onLimitReached}).`,
          currentOverageAmount: currentAmount,
          customerCap: customerLimit.maxOverageAmount,
        };
      }
      // "notify" — allow but include warning in result
    }
  }

  return { allowed: true };
}
