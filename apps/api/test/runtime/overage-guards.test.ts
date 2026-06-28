import { describe, expect, it } from "vitest";
import { hasPaymentMethod } from "../../src/lib/overage-guards";
import { createSqliteD1Database } from "./helpers/sqlite-d1";
import { seedWorkflowBase } from "./helpers/workflow-runtime";

// The overage guard must use the same chargeable payment-method invariant as
// invoice collection: a valid default method is required before paid usage is approved.
describe("overage guard payment method selection", () => {
  it("does not treat a valid non-default payment method as chargeable", async () => {
    const db = createSqliteD1Database();

    try {
      await seedWorkflowBase(db, {
        paymentMethods: [
          {
            id: "pm_backup",
            token: "AUTH_backup",
            isDefault: 0,
            isValid: 1,
          },
        ],
      });

      await expect(hasPaymentMethod(db, "cust_1")).resolves.toBe(false);
    } finally {
      db.close();
    }
  });

  it("treats a valid default payment method as chargeable", async () => {
    const db = createSqliteD1Database();

    try {
      await seedWorkflowBase(db, {
        paymentMethods: [
          {
            id: "pm_default",
            token: "AUTH_default",
            isDefault: 1,
            isValid: 1,
          },
        ],
      });

      await expect(hasPaymentMethod(db, "cust_1")).resolves.toBe(true);
    } finally {
      db.close();
    }
  });
});
