import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "@owostack/db";
import { createSqliteD1Database } from "../../test/runtime/helpers/sqlite-d1";
import {
  insertCustomer,
  insertOrganization,
} from "../../test/runtime/helpers/workflow-runtime";
import {
  getDefaultPaymentMethod,
  upsertPaymentMethod,
} from "./payment-methods";

describe("payment method defaults", () => {
  let d1: ReturnType<typeof createSqliteD1Database> | undefined;

  afterEach(() => {
    d1?.close();
    d1 = undefined;
  });

  it("keeps one default payment method per customer and organization", async () => {
    d1 = createSqliteD1Database();
    const db = createDb(d1);

    await insertOrganization(d1, { id: "org_1" });
    await insertCustomer(d1, { id: "cust_1", organizationId: "org_1" });

    await upsertPaymentMethod(db, {
      customerId: "cust_1",
      organizationId: "org_1",
      providerId: "paystack",
      token: "AUTH_first",
      type: "card",
      isDefault: true,
    });
    await upsertPaymentMethod(db, {
      customerId: "cust_1",
      organizationId: "org_1",
      providerId: "stripe",
      token: "pm_second",
      type: "card",
      isDefault: true,
    });

    const defaultRows = await d1
      .prepare(
        `SELECT token
         FROM payment_methods
         WHERE customer_id = ? AND organization_id = ? AND is_default = 1
         ORDER BY token`,
      )
      .bind("cust_1", "org_1")
      .all<{ token: string }>();

    expect(defaultRows.results).toEqual([{ token: "pm_second" }]);
    await expect(
      d1
        .prepare(
          `UPDATE payment_methods
           SET is_default = 1
           WHERE customer_id = ? AND token = ?`,
        )
        .bind("cust_1", "AUTH_first")
        .run(),
    ).rejects.toThrow(/pm_customer_org_default_uniq|UNIQUE constraint failed/);

    await expect(getDefaultPaymentMethod(db, "cust_1")).resolves.toEqual({
      token: "pm_second",
      providerId: "stripe",
      type: "card",
    });
  });
});
