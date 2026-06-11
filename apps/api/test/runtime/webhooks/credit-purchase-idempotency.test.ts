import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedWebhookEvent } from "@owostack/adapters";
import { WebhookHandler } from "../../../src/lib/webhooks";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { insertCustomer, insertOrganization } from "../helpers/workflow-runtime";

type BalanceRow = { balance: number };
type CountRow = { count: number };

async function insertCreditSystem(db: D1Database) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO credit_systems
       (id, organization_id, slug, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      "cs_ai",
      "org_1",
      "ai-credits",
      "AI Credits",
      "Runtime test credit system",
      now,
      now,
    )
    .run();
}

async function loadBalance(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT balance
       FROM credit_system_balances
       WHERE customer_id = ? AND credit_system_id = ?`,
    )
    .bind("cust_1", "cs_ai")
    .first<BalanceRow>();
  return row?.balance ?? 0;
}

async function countPurchases(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM credit_purchases
       WHERE payment_reference = ?`,
    )
    .bind("ref_credit_duplicate")
    .first<CountRow>();
  return row?.count ?? 0;
}

function creditPurchaseEvent(): NormalizedWebhookEvent {
  return {
    type: "charge.success",
    provider: "paystack",
    customer: {
      email: "customer@example.com",
      providerCustomerId: "cus_remote_1",
    },
    payment: {
      amount: 7500,
      currency: "NGN",
      reference: "ref_credit_duplicate",
    },
    checkout: {
      lineItems: [{ quantity: 2 }],
    },
    metadata: {
      type: "credit_purchase",
      credit_system_id: "cs_ai",
      credits: "20",
      credits_per_pack: "20",
      quantity: "1",
      customer_id: "cust_1",
    },
    raw: { event: "charge.success", data: { reference: "ref_credit_duplicate" } },
  };
}

describe("Credit purchase webhook idempotency runtime integration", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let handler: WebhookHandler;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T12:00:00.000Z"));

    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_1" });
    await insertCustomer(businessDb.d1, {
      id: "cust_1",
      organizationId: "org_1",
      providerId: "paystack",
      providerCustomerId: "cus_remote_1",
      paystackCustomerId: "cus_remote_1",
      email: "customer@example.com",
    });
    await insertCreditSystem(businessDb.d1);
    handler = new WebhookHandler(businessDb.db, "org_1");
  });

  afterEach(() => {
    businessDb.close();
    vi.useRealTimers();
  });

  it("credits a duplicate provider payment reference only once under concurrent delivery", async () => {
    const [first, second] = await Promise.all([
      handler.handle(creditPurchaseEvent()),
      handler.handle(creditPurchaseEvent()),
    ]);

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    expect(await countPurchases(businessDb.d1)).toBe(1);
    expect(await loadBalance(businessDb.d1)).toBe(40);
  });
});
