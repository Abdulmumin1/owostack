import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@owostack/db";
import { resolveOrCreateCustomer } from "../../src/lib/customers";
import { createRuntimeBusinessDb } from "./helpers/business-db";
import { insertOrganization } from "./helpers/workflow-runtime";

describe("resolveOrCreateCustomer runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_customer_create" });
  });

  afterEach(() => {
    businessDb.close();
  });

  it("coalesces concurrent auto-create requests for the same organization-scoped aliases", async () => {
    const created = await Promise.all(
      Array.from({ length: 12 }, () =>
        resolveOrCreateCustomer({
          db: businessDb.db,
          organizationId: "org_customer_create",
          customerId: "external_user_123",
          customerData: {
            email: "USER@example.com",
            name: "Runtime User",
          },
        }),
      ),
    );

    const customerIds = new Set(created.map((customer) => customer?.id));
    expect(customerIds.size).toBe(1);

    const rows = await businessDb.db.query.customers.findMany({
      where: and(
        eq(schema.customers.organizationId, "org_customer_create"),
        eq(schema.customers.email, "user@example.com"),
      ),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: "org_customer_create",
      externalId: "external_user_123",
      email: "user@example.com",
      name: "Runtime User",
    });
  });

  it("keeps the same email reusable across different organizations", async () => {
    await insertOrganization(businessDb.d1, { id: "org_customer_create_2" });

    const first = await resolveOrCreateCustomer({
      db: businessDb.db,
      organizationId: "org_customer_create",
      customerId: "shared_user",
      customerData: { email: "shared@example.com" },
    });
    const second = await resolveOrCreateCustomer({
      db: businessDb.db,
      organizationId: "org_customer_create_2",
      customerId: "shared_user",
      customerData: { email: "shared@example.com" },
    });

    expect(first?.id).toBeTruthy();
    expect(second?.id).toBeTruthy();
    expect(first?.id).not.toBe(second?.id);
  });
});
