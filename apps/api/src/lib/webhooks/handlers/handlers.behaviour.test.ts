import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleChargeSuccess } from "./charge-success";
import { handleSubscriptionCreated } from "./subscription-created";
import { handleRefund } from "./refund";
import { handleCustomerIdentified } from "./customer-identified";
import { topUpScopedBalance } from "../../addon-credits";
import { provisionEntitlements } from "../../plan-switch";
import { upsertPaymentMethod } from "../../payment-methods";

vi.mock("@owostack/db", () => ({
  schema: {
    customers: { id: "id", email: "email", organizationId: "organizationId" },
    subscriptions: {
      id: "id",
      customerId: "customerId",
      status: "status",
      planId: "planId",
      paystackSubscriptionCode: "paystackSubscriptionCode",
      providerSubscriptionCode: "providerSubscriptionCode",
    },
    plans: {
      id: "id",
      organizationId: "organizationId",
      paystackPlanId: "paystackPlanId",
      providerPlanId: "providerPlanId",
    },
    entitlements: { customerId: "customerId" },
    credits: { id: "id", customerId: "customerId", balance: "balance" },
    creditPurchases: { paymentReference: "paymentReference" },
  },
}));

vi.mock("../../addon-credits", () => ({
  topUpScopedBalance: vi.fn(async () => null),
}));

vi.mock("../../plan-switch", () => ({
  provisionEntitlements: vi.fn(async () => null),
}));

vi.mock("../../payment-methods", () => ({
  upsertPaymentMethod: vi.fn(async () => null),
}));

function createDbMock() {
  const insertValuesMock = vi.fn(async () => []);
  const insertMock = vi.fn(() => ({
    values: insertValuesMock,
  }));

  const updateWhereMock = vi.fn(async () => []);
  const updateSetMock = vi.fn(() => ({
    where: updateWhereMock,
  }));
  const updateMock = vi.fn(() => ({
    set: updateSetMock,
  }));

  const deleteWhereMock = vi.fn(async () => []);
  const deleteMock = vi.fn(() => ({
    where: deleteWhereMock,
  }));

  const db: any = {
    query: {
      customers: { findFirst: vi.fn() },
      subscriptions: { findFirst: vi.fn(), findMany: vi.fn() },
      plans: { findFirst: vi.fn() },
      credits: { findFirst: vi.fn() },
      creditPurchases: { findFirst: vi.fn() },
    },
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
  };

  return {
    db,
    insertValuesMock,
    updateSetMock,
    deleteMock,
  };
}

function makeCtx(db: any, event: any, extra?: Partial<any>) {
  return {
    db,
    organizationId: "org_1",
    event,
    adapter: null,
    providerAccount: null,
    workflows: {
      trialEnd: null,
      planUpgrade: null,
    },
    cache: null,
    ...extra,
  } as any;
}

describe("Webhook handlers behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("charge.success credit purchase recalculates quantity from checkout line items and tops up scoped balance", async () => {
    const { db, insertValuesMock } = createDbMock();

    db.query.customers.findFirst.mockResolvedValue({
      id: "cus_1",
      email: "customer@example.com",
      organizationId: "org_1",
    });
    db.query.creditPurchases.findFirst.mockResolvedValue(null);

    const event = {
      type: "charge.success",
      provider: "paystack",
      customer: {
        email: "customer@example.com",
        providerCustomerId: "prov_cus_1",
      },
      payment: {
        amount: 7500,
        currency: "USD",
        reference: "ref_credit_1",
      },
      checkout: {
        lineItems: [{ quantity: 3 }],
      },
      metadata: {
        type: "credit_purchase",
        credit_pack_id: "pack_1",
        credit_system_id: "cs_1",
        credits: "20",
        credits_per_pack: "20",
        quantity: "1",
      },
      raw: { event: "charge.success" },
    };

    await handleChargeSuccess(makeCtx(db, event));

    expect(vi.mocked(topUpScopedBalance)).toHaveBeenCalledWith(db, "cus_1", "cs_1", 60);

    const purchaseInsert = insertValuesMock.mock.calls[0]?.[0];
    expect(purchaseInsert.credits).toBe(60);
    expect(purchaseInsert.quantity).toBe(3);
    expect(purchaseInsert.paymentReference).toBe("ref_credit_1");
  });

  it("charge.success credit purchase is idempotent when payment reference already processed", async () => {
    const { db, insertValuesMock } = createDbMock();

    db.query.customers.findFirst.mockResolvedValue({
      id: "cus_1",
      email: "customer@example.com",
      organizationId: "org_1",
    });
    db.query.creditPurchases.findFirst.mockResolvedValue({ id: "cp_existing" });

    const event = {
      type: "charge.success",
      provider: "paystack",
      customer: {
        email: "customer@example.com",
        providerCustomerId: "prov_cus_1",
      },
      payment: {
        amount: 7500,
        currency: "USD",
        reference: "ref_credit_1",
      },
      metadata: {
        type: "credit_purchase",
        credit_pack_id: "pack_1",
        credit_system_id: "cs_1",
        credits: "20",
      },
      raw: { event: "charge.success" },
    };

    await handleChargeSuccess(makeCtx(db, event));

    expect(vi.mocked(topUpScopedBalance)).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("subscription.created without plan code links provider subscription code to an existing active sub", async () => {
    const { db, updateSetMock } = createDbMock();

    db.query.customers.findFirst.mockResolvedValue({
      id: "cus_1",
      email: "customer@example.com",
      organizationId: "org_1",
    });
    db.query.subscriptions.findFirst.mockResolvedValue({
      id: "sub_local_1",
      paystackSubscriptionId: null,
      paystackSubscriptionCode: null,
    });

    const event = {
      type: "subscription.created",
      provider: "paystack",
      customer: {
        email: "customer@example.com",
        providerCustomerId: "prov_cus_1",
      },
      subscription: {
        providerCode: "sub_provider_1",
      },
      metadata: {},
      raw: { event: "subscription.created" },
    };

    await handleSubscriptionCreated(makeCtx(db, event));

    const updatePayload = updateSetMock.mock.calls[0]?.[0];
    expect(updatePayload.providerSubscriptionCode).toBe("sub_provider_1");
    expect(updatePayload.paystackSubscriptionCode).toBe("sub_provider_1");
    expect(vi.mocked(provisionEntitlements)).not.toHaveBeenCalled();
  });

  it("subscription.created creates subscription, provisions entitlements, and stores provider-managed payment method", async () => {
    const { db, insertValuesMock } = createDbMock();

    db.query.customers.findFirst.mockResolvedValue({
      id: "cus_2",
      email: "dodo@example.com",
      organizationId: "org_1",
    });
    db.query.plans.findFirst.mockResolvedValue({
      id: "plan_db_1",
      organizationId: "org_1",
    });
    db.query.subscriptions.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const event = {
      type: "subscription.created",
      provider: "dodopayments",
      customer: {
        email: "dodo@example.com",
        providerCustomerId: "dodo_cus_1",
      },
      subscription: {
        providerCode: "dodo_sub_1",
        startDate: "2025-01-01T00:00:00.000Z",
        nextPaymentDate: "2025-02-01T00:00:00.000Z",
      },
      plan: {
        providerPlanCode: "dodo_plan_1",
      },
      metadata: {},
      raw: { event: "subscription.created" },
    };

    await handleSubscriptionCreated(makeCtx(db, event));

    const insertPayload = insertValuesMock.mock.calls[0]?.[0]?.[0];
    expect(insertPayload.planId).toBe("plan_db_1");
    expect(insertPayload.providerSubscriptionCode).toBe("dodo_sub_1");
    expect(insertPayload.status).toBe("active");

    expect(vi.mocked(provisionEntitlements)).toHaveBeenCalledWith(db, "cus_2", "plan_db_1");
    expect(vi.mocked(upsertPaymentMethod)).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        customerId: "cus_2",
        providerId: "dodopayments",
        token: "dodo_sub_1",
        type: "provider_managed",
      }),
    );
  });

  it("refund.success partial refund records refund metadata without revoking access", async () => {
    const { db, updateSetMock, deleteMock } = createDbMock();
    const cancelSubscription = vi.fn(async () => null);

    db.query.customers.findFirst.mockResolvedValue({
      id: "cus_3",
      email: "partial@example.com",
      organizationId: "org_1",
    });
    db.query.subscriptions.findMany.mockResolvedValue([
      {
        id: "sub_partial",
        planId: "plan_1",
        status: "active",
        metadata: { existing: true },
        plan: { price: 10000 },
      },
    ]);

    const event = {
      type: "refund.success",
      provider: "paystack",
      customer: {
        email: "partial@example.com",
        providerCustomerId: "cus_provider_3",
      },
      refund: {
        amount: 1000,
        currency: "USD",
        reference: "refund_partial_1",
        reason: "partial",
      },
      metadata: {},
      raw: { event: "refund.success" },
    };

    await handleRefund(
      makeCtx(db, event, {
        adapter: { cancelSubscription },
        providerAccount: { environment: "test" },
      }),
    );

    const updatePayload = updateSetMock.mock.calls[0]?.[0];
    expect(updatePayload.metadata.existing).toBe(true);
    expect(updatePayload.metadata.refunds[0].amount).toBe(1000);

    expect(cancelSubscription).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("refund.success full refund cancels subscriptions, revokes entitlements, invalidates cache, and deducts credits", async () => {
    const { db, updateSetMock, deleteMock } = createDbMock();
    const cancelSubscription = vi.fn(async () => null);

    const cache = {
      invalidateCustomer: vi.fn(async () => null),
      invalidateSubscriptions: vi.fn(async () => null),
    };

    db.query.customers.findFirst.mockResolvedValue({
      id: "cus_4",
      email: "full@example.com",
      organizationId: "org_1",
    });
    db.query.subscriptions.findMany.mockResolvedValue([
      {
        id: "sub_full",
        customerId: "cus_4",
        planId: "plan_1",
        status: "active",
        providerSubscriptionCode: "sub_provider_live",
        paystackSubscriptionCode: null,
        metadata: {},
        plan: { price: 10000 },
      },
    ]);
    db.query.credits.findFirst.mockResolvedValue({
      id: "credits_1",
      customerId: "cus_4",
      balance: 500,
    });

    const event = {
      type: "refund.success",
      provider: "paystack",
      customer: {
        email: "full@example.com",
        providerCustomerId: "cus_provider_4",
      },
      refund: {
        amount: 10000,
        currency: "USD",
        reference: "refund_full_1",
      },
      metadata: {
        credits: "200",
      },
      raw: { event: "refund.success" },
    };

    await handleRefund(
      makeCtx(db, event, {
        adapter: { cancelSubscription },
        providerAccount: { environment: "test" },
        cache,
      }),
    );

    expect(cancelSubscription).toHaveBeenCalledWith({
      subscription: { id: "sub_provider_live", status: "active" },
      environment: "test",
      account: { environment: "test" },
    });

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(cache.invalidateCustomer).toHaveBeenCalledWith("org_1", "full@example.com");
    expect(cache.invalidateSubscriptions).toHaveBeenCalledWith("org_1", "cus_4");

    expect(updateSetMock.mock.calls.some((call) => call[0].status === "refunded")).toBe(true);
    expect(updateSetMock.mock.calls.some((call) => call[0].balance !== undefined)).toBe(true);
  });

  it("customer.identified merges metadata and marks customer verified", async () => {
    const { db, updateSetMock } = createDbMock();

    db.query.customers.findFirst.mockResolvedValue({
      id: "cus_5",
      email: "verify@example.com",
      organizationId: "org_1",
      metadata: { tier: "pro" },
    });

    const event = {
      type: "customer.identified",
      provider: "paystack",
      customer: {
        email: "verify@example.com",
        providerCustomerId: "cus_provider_5",
      },
      metadata: {},
      raw: { event: "customer.identified" },
    };

    await handleCustomerIdentified(makeCtx(db, event));

    const updatePayload = updateSetMock.mock.calls[0]?.[0];
    expect(updatePayload.metadata.tier).toBe("pro");
    expect(updatePayload.metadata.verified).toBe(true);
    expect(typeof updatePayload.metadata.verifiedAt).toBe("string");
  });
});
