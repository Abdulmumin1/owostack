import { describe, expect, it, vi } from "vitest";
import { clearCustomerOverageBlockForInvoice } from "./overage-blocks";

function createDbMock(options?: {
  block?: { id: string; invoiceId: string; billingRunId: string | null } | null;
}) {
  const findFirst = vi.fn(async () => options?.block ?? null);
  const deleteWhere = vi.fn(async () => []);
  const updateWhere = vi.fn(async () => []);
  const updateSet = vi.fn(() => ({
    where: updateWhere,
  }));

  return {
    db: {
      query: {
        customerOverageBlocks: {
          findFirst,
        },
      },
      delete: vi.fn(() => ({
        where: deleteWhere,
      })),
      update: vi.fn(() => ({
        set: updateSet,
      })),
    },
    findFirst,
    deleteWhere,
    updateSet,
    updateWhere,
  };
}

describe("clearCustomerOverageBlockForInvoice", () => {
  it("clears the block and completes the linked billing run", async () => {
    const { db, deleteWhere, updateSet, updateWhere } = createDbMock({
      block: {
        id: "block_1",
        invoiceId: "inv_1",
        billingRunId: "run_1",
      },
    });

    await clearCustomerOverageBlockForInvoice(db as any, "inv_1");

    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        invoiceId: "inv_1",
        activeLockKey: null,
        failureReason: null,
        metadata: {
          recovery: "invoice_paid",
          invoiceId: "inv_1",
        },
      }),
    );
    expect(updateWhere).toHaveBeenCalledTimes(1);
  });

  it("does not update a billing run when no linked block exists", async () => {
    const { db, deleteWhere, updateSet } = createDbMock({
      block: null,
    });

    await clearCustomerOverageBlockForInvoice(db as any, "inv_1");

    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(updateSet).not.toHaveBeenCalled();
  });
});
