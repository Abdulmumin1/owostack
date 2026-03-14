import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { updateBillingRun } from "./billing-runs";

export async function getCustomerOverageBlock(db: any, customerId: string) {
  return db.query.customerOverageBlocks.findFirst({
    where: eq(schema.customerOverageBlocks.customerId, customerId),
  });
}

export async function blockCustomerOverage(
  db: any,
  params: {
    customerId: string;
    organizationId: string;
    reason: string;
    invoiceId?: string | null;
    billingRunId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  const now = Date.now();
  await db
    .insert(schema.customerOverageBlocks)
    .values({
      id: crypto.randomUUID(),
      customerId: params.customerId,
      organizationId: params.organizationId,
      billingRunId: params.billingRunId ?? null,
      invoiceId: params.invoiceId ?? null,
      reason: params.reason,
      metadata: params.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.customerOverageBlocks.customerId,
      set: {
        billingRunId: params.billingRunId ?? null,
        invoiceId: params.invoiceId ?? null,
        reason: params.reason,
        metadata: params.metadata ?? null,
        updatedAt: now,
      },
    });
}

export async function clearCustomerOverageBlock(db: any, customerId: string) {
  await db
    .delete(schema.customerOverageBlocks)
    .where(eq(schema.customerOverageBlocks.customerId, customerId));
}

export async function clearCustomerOverageBlockForInvoice(
  db: any,
  invoiceId: string,
) {
  const block = db.query?.customerOverageBlocks
    ? await db.query.customerOverageBlocks.findFirst({
        where: eq(schema.customerOverageBlocks.invoiceId, invoiceId),
      })
    : null;

  if (db.delete) {
    await db
      .delete(schema.customerOverageBlocks)
      .where(eq(schema.customerOverageBlocks.invoiceId, invoiceId));
  }

  if (block?.billingRunId && db.update) {
    await updateBillingRun(db, block.billingRunId, {
      status: "completed",
      invoiceId,
      activeLockKey: null,
      failureReason: null,
      metadata: {
        recovery: "invoice_paid",
        invoiceId,
      },
    });
  }
}

export async function releaseCustomerOverageBlockForInvoice(
  db: any,
  invoiceId: string,
  params: {
    failureReason: string;
    metadata?: Record<string, unknown> | null;
  },
) {
  const block = db.query?.customerOverageBlocks
    ? await db.query.customerOverageBlocks.findFirst({
        where: eq(schema.customerOverageBlocks.invoiceId, invoiceId),
      })
    : null;

  if (db.delete) {
    await db
      .delete(schema.customerOverageBlocks)
      .where(eq(schema.customerOverageBlocks.invoiceId, invoiceId));
  }

  if (block?.billingRunId && db.update) {
    await updateBillingRun(db, block.billingRunId, {
      status: "deferred",
      invoiceId,
      activeLockKey: null,
      failureReason: params.failureReason,
      metadata: {
        recovery: "usage_released",
        invoiceId,
        ...(params.metadata ?? {}),
      },
    });
  }
}
