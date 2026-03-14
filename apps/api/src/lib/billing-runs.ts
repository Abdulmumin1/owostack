import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@owostack/db";

export type BillingRunStatus =
  | "pending"
  | "processing"
  | "completed"
  | "blocked"
  | "failed"
  | "deferred";

export async function getBillingRun(db: any, billingRunId: string) {
  return db.query.billingRuns.findFirst({
    where: eq(schema.billingRuns.id, billingRunId),
  });
}

export async function getActiveThresholdBillingRun(
  db: any,
  customerId: string,
) {
  return db.query.billingRuns.findFirst({
    where: and(
      eq(schema.billingRuns.customerId, customerId),
      eq(schema.billingRuns.trigger, "threshold"),
      inArray(schema.billingRuns.status, ["pending", "processing"]),
    ),
  });
}

export async function createThresholdBillingRun(
  db: any,
  params: {
    organizationId: string;
    customerId: string;
    thresholdAmount: number;
    usageWindowEnd: number;
    idempotencyKey: string;
    usageWindowStart?: number | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  const existingByKey = await db.query.billingRuns.findFirst({
    where: eq(schema.billingRuns.idempotencyKey, params.idempotencyKey),
  });
  if (existingByKey) {
    return {
      created: false,
      run: existingByKey,
      reason: "idempotent" as const,
    };
  }

  const activeLockKey = `threshold:${params.customerId}`;
  const now = Date.now();
  const runId = crypto.randomUUID();

  try {
    await db.insert(schema.billingRuns).values({
      id: runId,
      organizationId: params.organizationId,
      customerId: params.customerId,
      trigger: "threshold",
      status: "pending",
      idempotencyKey: params.idempotencyKey,
      activeLockKey,
      thresholdAmount: params.thresholdAmount,
      usageWindowStart: params.usageWindowStart ?? null,
      usageWindowEnd: params.usageWindowEnd,
      metadata: params.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    const existingActive = await db.query.billingRuns.findFirst({
      where: eq(schema.billingRuns.activeLockKey, activeLockKey),
    });
    if (existingActive) {
      return {
        created: false,
        run: existingActive,
        reason: "active_run_exists" as const,
      };
    }

    const existingRetry = await db.query.billingRuns.findFirst({
      where: eq(schema.billingRuns.idempotencyKey, params.idempotencyKey),
    });
    if (existingRetry) {
      return {
        created: false,
        run: existingRetry,
        reason: "idempotent" as const,
      };
    }

    throw error;
  }

  const createdRun = await db.query.billingRuns.findFirst({
    where: eq(schema.billingRuns.id, runId),
  });

  return { created: true, run: createdRun, reason: null };
}

export async function updateBillingRun(
  db: any,
  billingRunId: string,
  updates: {
    status?: BillingRunStatus;
    invoiceId?: string | null;
    failureReason?: string | null;
    activeLockKey?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  await db
    .update(schema.billingRuns)
    .set({
      ...(updates.status !== undefined ? { status: updates.status } : {}),
      ...(updates.invoiceId !== undefined
        ? { invoiceId: updates.invoiceId }
        : {}),
      ...(updates.failureReason !== undefined
        ? { failureReason: updates.failureReason }
        : {}),
      ...(updates.activeLockKey !== undefined
        ? { activeLockKey: updates.activeLockKey }
        : {}),
      ...(updates.metadata !== undefined ? { metadata: updates.metadata } : {}),
      updatedAt: Date.now(),
    })
    .where(eq(schema.billingRuns.id, billingRunId));
}
