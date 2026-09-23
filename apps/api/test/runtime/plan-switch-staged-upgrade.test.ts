import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { bachsAdapter, type ProviderAccount } from "@owostack/adapters";
import { executeSwitch } from "../../src/lib/plan-switch";
import { createRuntimeBusinessDb } from "./helpers/business-db";
import {
  jsonResponse,
  SequencedFetchTransport,
  withFetchTransport,
} from "./helpers/fetch-transport";
import {
  insertCustomer,
  insertOrganization,
  insertPlan,
  insertSubscription,
} from "./helpers/workflow-runtime";

/**
 * Sandbox incident: upgrading a Bachs subscriber returned "Upgraded …
 * (provider-managed proration)" and we flipped the plan + entitlements, but
 * Bachs had only *staged* the change behind an open $29.97 proration invoice.
 * The subscription stayed on Pro at Bachs while we served Business.
 *
 * Real executeSwitch, real D1, real Bachs adapter over captured HTTP.
 */

const ACCOUNT: ProviderAccount = {
  id: "managed_sandbox_bachs",
  organizationId: "org_1",
  providerId: "bachs",
  environment: "test",
  credentials: { secretKey: "sk_sandbox_test" },
  createdAt: 0,
  updatedAt: 0,
};

const SUB_CODE = "sub_5c79f94258be4d409619";

const stagedByBachs = {
  id: SUB_CODE,
  status: "active",
  amount: "19.00",
  currency: "USD",
  product: { id: "prod_pro", name: "Pro (Bachs)" },
  pending_update: {
    kind: "plan_change",
    product_id: "prod_business",
    amount: "49.00",
    effective_at: null,
    proration_invoice_id: "inv_c6d0632c75fa413287ba",
    staged_at: "2026-09-23T16:28:59.597512Z",
  },
};

describe("executeSwitch with a provider that stages plan changes", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_1" });
    await insertCustomer(businessDb.d1, {
      id: "cust_1",
      organizationId: "org_1",
      email: "pro.bachs@owostack.dev",
      providerId: "bachs",
    });
    for (const [id, slug, price, product] of [
      ["plan_pro", "pro-bachs", 1900, "prod_pro"],
      ["plan_business", "business-bachs", 4900, "prod_business"],
    ] as const) {
      await insertPlan(businessDb.d1, {
        id,
        organizationId: "org_1",
        slug,
        name: slug,
        price,
        currency: "USD",
        interval: "monthly",
        planGroup: "main",
        providerId: "bachs",
        providerPlanId: product,
        paystackPlanId: null,
        type: "paid",
        billingType: "recurring",
      });
    }
    await insertSubscription(businessDb.d1, {
      id: "sub_local",
      customerId: "cust_1",
      planId: "plan_pro",
      providerId: "bachs",
      providerSubscriptionCode: SUB_CODE,
      status: "active",
    });
  });

  afterEach(() => businessDb.close());

  function bachsPatch(response: Record<string, unknown>) {
    return new SequencedFetchTransport([
      {
        method: "PATCH",
        origin: "https://sandbox-api.bachs.io",
        path: `/v1/subscriptions/${SUB_CODE}`,
        respond: jsonResponse(response),
      },
    ]);
  }

  async function subscription() {
    return businessDb.db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.id, "sub_local"),
    });
  }

  it("keeps the customer on the old plan and reports the upgrade as pending", async () => {
    const transport = bachsPatch(stagedByBachs);
    const result = await withFetchTransport(transport, () =>
      executeSwitch(
        businessDb.db,
        "cust_1",
        "plan_business",
        { adapter: bachsAdapter, account: ACCOUNT },
        { organizationId: "org_1", environment: "test" },
      ),
    );
    transport.assertComplete();

    expect(result).toMatchObject({
      success: true,
      type: "upgrade",
      requiresCheckout: false,
      pending: true,
      subscriptionId: "sub_local",
    });
    expect(result.message).toMatch(/pending/i);

    const sub = await subscription();
    expect(sub?.planId).toBe("plan_pro");
    expect(sub?.status).toBe("active");
    expect(sub?.metadata).toMatchObject({
      pending_plan_change: {
        new_plan_id: "plan_business",
        old_plan_id: "plan_pro",
        provider_reference: "inv_c6d0632c75fa413287ba",
      },
    });

    // No entitlements for the new plan were provisioned.
    const entitlements = await businessDb.db.query.entitlements.findMany({
      where: eq(schema.entitlements.customerId, "cust_1"),
    });
    expect(entitlements).toHaveLength(0);
  });

  it("switches immediately when the provider applies the change in the same call", async () => {
    const transport = bachsPatch({
      ...stagedByBachs,
      amount: "49.00",
      product: { id: "prod_business", name: "Business (Bachs)" },
      pending_update: null,
    });
    const result = await withFetchTransport(transport, () =>
      executeSwitch(
        businessDb.db,
        "cust_1",
        "plan_business",
        { adapter: bachsAdapter, account: ACCOUNT },
        { organizationId: "org_1", environment: "test" },
      ),
    );
    transport.assertComplete();

    expect(result).toMatchObject({ success: true, type: "upgrade" });
    expect(result.pending).toBeUndefined();
    expect((await subscription())?.planId).toBe("plan_business");
  });
});
