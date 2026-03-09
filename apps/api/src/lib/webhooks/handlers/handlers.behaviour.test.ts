import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  chargeSuccessDependencies,
  handleChargeSuccess,
} from "./charge-success";
import {
  handleSubscriptionCreated,
  subscriptionCreatedDependencies,
} from "./subscription-created";
import { handleRefund } from "./refund";
import {
  customerIdentifiedDependencies,
  handleCustomerIdentified,
} from "./customer-identified";
import {
  handleSubscriptionStatus,
  subscriptionStatusDependencies,
} from "./subscription-status";

interface MockDb {
  query: {
    customers: { findFirst: Mock };
    subscriptions: { findFirst: Mock; findMany: Mock };
    plans: { findFirst: Mock };
    invoices: { findFirst: Mock };
    credits: { findFirst: Mock };
    creditPurchases: { findFirst: Mock };
  };
  insert: Mock;
  update: Mock;
  delete: Mock;
}

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
    where: vi.fn(() => ({
      returning: deleteWhereMock,
    })),
  }));

  const db: MockDb = {
    query: {
      customers: { findFirst: vi.fn() },
      subscriptions: { findFirst: vi.fn(), findMany: vi.fn() },
      plans: { findFirst: vi.fn() },
      invoices: { findFirst: vi.fn() },
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

interface WebhookEventData {
  type: string;
  provider: string;
  customer: { email: string; providerCustomerId: string };
  payment?: {
    amount: number;
    currency: string;
    reference: string;
    paidAt?: string;
  };
  subscription?: {
    providerCode: string;
    startDate?: string;
    nextPaymentDate?: string;
  };
  plan?: { providerPlanCode: string };
  checkout?: { lineItems: { quantity: number }[] };
  refund?: {
    amount: number;
    currency: string;
    reference: string;
    reason?: string;
  };
  metadata: Record<string, unknown>;
  raw: { event: string };
}

interface HandlerContext {
  db: MockDb;
  organizationId: string;
  event: WebhookEventData;
  adapter: unknown;
  providerAccount: unknown;
  workflows: { trialEnd: null; planUpgrade: null };
  cache: unknown;
}

function makeCtx(
  db: MockDb,
  event: WebhookEventData,
  extra?: Partial<HandlerContext>,
) {
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
  } as unknown as HandlerContext;
}

describe("Webhook handlers behavior", () => {
  const topUpScopedBalanceMock = vi.fn(async () => null);
  const provisionEntitlementsMock = vi.fn(async () => null);
  const upsertPaymentMethodMock = vi.fn(async () => null);

  beforeEach(() => {
    vi.clearAllMocks();
    chargeSuccessDependencies.topUpScopedBalance =
      topUpScopedBalanceMock as unknown as typeof chargeSuccessDependencies.topUpScopedBalance;
    chargeSuccessDependencies.provisionEntitlements =
      provisionEntitlementsMock as unknown as typeof chargeSuccessDependencies.provisionEntitlements;
    chargeSuccessDependencies.upsertPaymentMethod =
      upsertPaymentMethodMock as unknown as typeof chargeSuccessDependencies.upsertPaymentMethod;
    subscriptionCreatedDependencies.provisionEntitlements =
      provisionEntitlementsMock as unknown as typeof subscriptionCreatedDependencies.provisionEntitlements;
    subscriptionCreatedDependencies.upsertPaymentMethod =
      upsertPaymentMethodMock as unknown as typeof subscriptionCreatedDependencies.upsertPaymentMethod;
    subscriptionStatusDependencies.provisionEntitlements =
      provisionEntitlementsMock as unknown as typeof subscriptionStatusDependencies.provisionEntitlements;
    subscriptionStatusDependencies.upsertPaymentMethod =
      upsertPaymentMethodMock as unknown as typeof subscriptionStatusDependencies.upsertPaymentMethod;
    customerIdentifiedDependencies.upsertPaymentMethod =
      upsertPaymentMethodMock as unknown as typeof customerIdentifiedDependencies.upsertPaymentMethod;
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

    expect(topUpScopedBalanceMock).toHaveBeenCalledWith(
      db,
      "cus_1",
      "cs_1",
      60,
    );

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

    expect(topUpScopedBalanceMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("charge.success skips processing when customer email is ambiguous", async () => {
    const { db, insertValuesMock, updateSetMock } = createDbMock();

    db.query.customers.findFirst
      .mockResolvedValueOnce({
        id: "cus_1",
        email: "customer@example.com",
        organizationId: "org_1",
      })
      .mockResolvedValueOnce({
        id: "cus_2",
        email: "customer@example.com",
        organizationId: "org_1",
      });

    const event = {
      type: "charge.success",
      provider: "paystack",
      customer: {
        email: "customer@example.com",
        providerCustomerId: "",
      },
      payment: {
        amount: 7500,
        currency: "USD",
        reference: "ref_credit_ambiguous",
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

    expect(updateSetMock).not.toHaveBeenCalled();
    expect(topUpScopedBalanceMock).not.toHaveBeenCalled();
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
    expect(provisionEntitlementsMock).not.toHaveBeenCalled();
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

    expect(provisionEntitlementsMock).toHaveBeenCalledWith(
      db,
      "cus_2",
      "plan_db_1",
    );
    expect(upsertPaymentMethodMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        customerId: "cus_2",
        providerId: "dodopayments",
        token: "dodo_sub_1",
        type: "provider_managed",
      }),
    );
  });

  it("subscription.active updates billing dates from provider renewal data", async () => {
    const { db, updateSetMock } = createDbMock();

    db.query.subscriptions.findFirst.mockResolvedValue({
      id: "sub_active_1",
      customerId: "cus_1",
      planId: "plan_1",
      status: "active",
      currentPeriodEnd: new Date("2026-03-08T00:00:00.000Z").getTime(),
      metadata: {},
    });

    const event = {
      type: "subscription.active",
      provider: "paystack",
      customer: {
        email: "renew@example.com",
        providerCustomerId: "prov_cus_renew",
      },
      subscription: {
        providerCode: "SUB_renew_1",
        startDate: "2026-03-06T17:00:15.000Z",
        nextPaymentDate: "2026-04-06T17:00:15.000Z",
      },
      metadata: {},
      raw: { event: "invoice.update" },
    };

    await handleSubscriptionStatus("active")(makeCtx(db, event));

    const updatePayload = updateSetMock.mock.calls.find(
      (call) => call[0].status === "active",
    )?.[0];
    expect(updatePayload.status).toBe("active");
    expect(updatePayload.currentPeriodStart).toBe(
      new Date("2026-03-06T17:00:15.000Z").getTime(),
    );
    expect(updatePayload.currentPeriodEnd).toBe(
      new Date("2026-04-06T17:00:15.000Z").getTime(),
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

  it("charge.success invoice update fallback advances renewal by customer and plan when subscription code is missing", async () => {
    const { db, updateSetMock } = createDbMock();

    db.query.customers.findFirst.mockResolvedValue({
      id: "cus_renew_1",
      email: "customerx12@example.com",
      organizationId: "org_1",
      externalId: null,
      providerId: "paystack",
      providerCustomerId: "CUS_41uuf7daarvgkkw",
      paystackAuthorizationCode: null,
      providerAuthorizationCode: null,
      paystackCustomerId: "CUS_41uuf7daarvgkkw",
    });
    db.query.plans.findFirst.mockResolvedValue({
      id: "plan_pro_1",
      organizationId: "org_1",
      interval: "monthly",
    });
    db.query.subscriptions.findFirst.mockResolvedValue({
      id: "sub_local_1",
      customerId: "cus_renew_1",
      planId: "plan_pro_1",
      status: "active",
      currentPeriodStart: new Date("2026-02-06T16:14:28.000Z").getTime(),
      currentPeriodEnd: new Date("2026-03-08T00:00:00.000Z").getTime(),
      plan: { interval: "monthly" },
    });

    const event = {
      type: "charge.success",
      provider: "paystack",
      customer: {
        email: "customerx12@example.com",
        providerCustomerId: "CUS_41uuf7daarvgkkw",
      },
      payment: {
        amount: 3000000,
        currency: "NGN",
        reference: "renew_ref_1",
        paidAt: "2026-03-06T17:00:15.000Z",
      },
      plan: {
        providerPlanCode: "PLN_mfm3iy6fyattbda",
      },
      metadata: {
        invoice_action: "update",
      },
      raw: { event: "charge.success" },
    };

    await handleChargeSuccess(makeCtx(db, event));

    const updatePayload = updateSetMock.mock.calls.find(
      (call) => call[0].status === "active",
    )?.[0];
    expect(updatePayload.status).toBe("active");
    expect(updatePayload.currentPeriodStart).toBe(
      new Date("2026-03-06T17:00:15.000Z").getTime(),
    );
    expect(updatePayload.currentPeriodEnd).toBe(
      new Date("2026-04-05T17:00:15.000Z").getTime(),
    );
  });

  it("charge.success invoice payment without email resolves customer from invoice metadata and marks invoice paid", async () => {
    const { db, updateSetMock } = createDbMock();

    db.query.invoices.findFirst.mockResolvedValue({
      id: "inv_1",
      organizationId: "org_1",
      customerId: "cus_1",
    });
    db.query.customers.findFirst.mockResolvedValue({
      id: "cus_1",
      email: "buyer@example.com",
      organizationId: "org_1",
      providerId: null,
      providerCustomerId: null,
      providerAuthorizationCode: null,
      paystackCustomerId: null,
      paystackAuthorizationCode: null,
    });

    const event = {
      type: "charge.success",
      provider: "stripe",
      customer: {
        email: "",
        providerCustomerId: "cus_stripe_123",
      },
      payment: {
        amount: 1000,
        currency: "USD",
        reference: "pi_test_123",
      },
      authorization: {
        code: "pm_test_123",
        reusable: true,
      },
      metadata: {
        type: "invoice_payment",
        invoice_id: "inv_1",
        invoice_number: "INV-001",
      },
      raw: { event: "charge.success" },
    };

    await handleChargeSuccess(makeCtx(db, event as any));

    expect(
      updateSetMock.mock.calls.some(
        (call) =>
          call[0].providerCustomerId === "cus_stripe_123" &&
          call[0].providerAuthorizationCode === "pm_test_123",
      ),
    ).toBe(true);
    expect(
      updateSetMock.mock.calls.some(
        (call) =>
          call[0].status === "paid" &&
          call[0].amountPaid === 1000 &&
          call[0].amountDue === 0,
      ),
    ).toBe(true);
  });

  it("charge.success Stripe card setup stores a provider-managed wallet method when card details are absent", async () => {
    const { db } = createDbMock();

    db.query.customers.findFirst.mockResolvedValue({
      id: "cus_1",
      email: "buyer@example.com",
      organizationId: "org_1",
      providerId: null,
      providerCustomerId: null,
      providerAuthorizationCode: null,
      paystackCustomerId: null,
      paystackAuthorizationCode: null,
    });

    const event = {
      type: "charge.success",
      provider: "stripe",
      customer: {
        email: "buyer@example.com",
        providerCustomerId: "cus_stripe_123",
      },
      payment: {
        amount: 100,
        currency: "USD",
        reference: "pi_card_setup_1",
      },
      authorization: {
        code: "pm_test_123",
        reusable: true,
      },
      metadata: {
        type: "card_setup",
        customer_id: "cus_1",
      },
      raw: { event: "charge.success" },
    };

    await handleChargeSuccess(makeCtx(db, event as any));

    expect(upsertPaymentMethodMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        customerId: "cus_1",
        providerId: "stripe",
        token: "pm_test_123",
        type: "provider_managed",
      }),
    );
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
    expect(cache.invalidateCustomer).toHaveBeenCalledWith(
      "org_1",
      "full@example.com",
    );
    expect(cache.invalidateSubscriptions).toHaveBeenCalledWith(
      "org_1",
      "cus_4",
    );

    expect(
      updateSetMock.mock.calls.some((call) => call[0].status === "refunded"),
    ).toBe(true);
    expect(
      updateSetMock.mock.calls.some((call) => call[0].balance !== undefined),
    ).toBe(true);
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

  it("customer.identified resolves Stripe customers by provider customer id and stores full card metadata", async () => {
    const { db, updateSetMock } = createDbMock();

    db.query.customers.findFirst.mockResolvedValue({
      id: "cus_6",
      email: "verify@example.com",
      organizationId: "org_1",
      providerId: "stripe",
      providerCustomerId: "cus_stripe_123",
      providerAuthorizationCode: null,
      paystackCustomerId: null,
      paystackAuthorizationCode: null,
      metadata: { tier: "pro" },
    });

    const event = {
      type: "customer.identified",
      provider: "stripe",
      customer: {
        email: "",
        providerCustomerId: "cus_stripe_123",
      },
      authorization: {
        code: "pm_test_card_123",
        reusable: true,
        cardType: "visa",
        last4: "4242",
        expMonth: "12",
        expYear: "2030",
      },
      metadata: {
        type: "payment_method_attached",
      },
      raw: { event: "customer.identified" },
    };

    await handleCustomerIdentified(makeCtx(db, event as any));

    expect(
      updateSetMock.mock.calls.some(
        (call) =>
          call[0].providerCustomerId === "cus_stripe_123" &&
          call[0].providerAuthorizationCode === "pm_test_card_123",
      ),
    ).toBe(true);
    expect(upsertPaymentMethodMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        customerId: "cus_6",
        providerId: "stripe",
        token: "pm_test_card_123",
        type: "card",
        cardLast4: "4242",
        cardBrand: "visa",
      }),
    );
  });
});
