import { eq, and } from "drizzle-orm";
import { schema } from "@owostack/db";
import { BillingService } from "./billing";
import {
  createThresholdBillingRun,
  getActiveThresholdBillingRun,
  updateBillingRun,
} from "./billing-runs";
import { getCustomerOverageBlock } from "./overage-blocks";
import { getOrgOverageSettings } from "./overage-guards";
import { getMinimumChargeAmount } from "./provider-minimums";
import type { UsageLedgerDO } from "./usage-ledger-do";

export async function evaluateThresholdBillingCandidate(params: {
  db: any;
  organizationId: string;
  customerId: string;
  usageLedger?: DurableObjectNamespace<UsageLedgerDO>;
  workflow: any;
}) {
  const settings = await getOrgOverageSettings(
    params.db,
    params.organizationId,
  );
  if (!settings || !settings.thresholdEnabled || !settings.thresholdAmount) {
    return { created: false, reason: "threshold_disabled" as const };
  }

  if (!settings.autoCollect) {
    return {
      created: false,
      reason: "threshold_requires_auto_collect" as const,
    };
  }

  const overageBlock = await getCustomerOverageBlock(
    params.db,
    params.customerId,
  );
  if (overageBlock) {
    return { created: false, reason: "customer_blocked" as const };
  }

  const activeRun = await getActiveThresholdBillingRun(
    params.db,
    params.customerId,
  );
  if (activeRun) {
    return {
      created: false,
      reason: "active_run_exists" as const,
      run: activeRun,
    };
  }

  const billingService = new BillingService(params.db, {
    usageLedger: params.usageLedger,
  });
  const previewResult = await billingService.getUnbilledUsage(
    params.customerId,
    params.organizationId,
  );

  if (previewResult.isErr()) {
    return {
      created: false,
      reason: "preview_failed" as const,
      error: previewResult.error,
    };
  }

  const preview = previewResult.value;
  if (preview.features.length === 0 || preview.totalEstimated === 0) {
    return { created: false, reason: "no_billable_usage" as const };
  }

  const paymentMethod = await params.db.query.paymentMethods.findFirst({
    where: and(
      eq(schema.paymentMethods.customerId, params.customerId),
      eq(schema.paymentMethods.isValid, 1),
      eq(schema.paymentMethods.isDefault, 1),
    ),
  });
  const providerMinimum = getMinimumChargeAmount(
    paymentMethod?.providerId || "unknown",
    preview.currency,
  );
  const effectiveThreshold = Math.max(
    settings.thresholdAmount,
    providerMinimum,
  );

  if (preview.totalEstimated < effectiveThreshold) {
    return {
      created: false,
      reason: "below_effective_threshold" as const,
      preview,
      effectiveThreshold,
    };
  }

  const idempotencyKey = `threshold:${params.organizationId}:${params.customerId}:${preview.usageWindowEnd}`;
  const runResult = await createThresholdBillingRun(params.db, {
    organizationId: params.organizationId,
    customerId: params.customerId,
    thresholdAmount: settings.thresholdAmount,
    usageWindowEnd: preview.usageWindowEnd,
    idempotencyKey,
    metadata: {
      effectiveThreshold,
      previewAmount: preview.totalEstimated,
      currency: preview.currency,
    },
  });

  if (!runResult.run || !runResult.created) {
    return {
      created: false,
      reason: runResult.reason || "run_not_created",
      run: runResult.run,
    };
  }

  try {
    await params.workflow.create({
      id: `overage-threshold-${runResult.run.id}`,
      params: {
        organizationId: params.organizationId,
        customerId: params.customerId,
        trigger: "threshold",
        billingRunId: runResult.run.id,
      },
    });
  } catch (error) {
    await updateBillingRun(params.db, runResult.run.id, {
      status: "failed",
      failureReason:
        error instanceof Error ? error.message : "workflow_create_failed",
      activeLockKey: null,
    });
    throw error;
  }

  return {
    created: true,
    reason: null,
    run: runResult.run,
    preview,
    effectiveThreshold,
  };
}
