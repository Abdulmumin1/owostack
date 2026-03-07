import { eq, and, sql } from "drizzle-orm";
import { schema } from "@owostack/db";

/**
 * Top up a customer's scoped credit system balance.
 * Uses INSERT ... ON CONFLICT upsert pattern for atomicity.
 * Requires UNIQUE index on (customer_id, credit_system_id).
 */
export async function topUpScopedBalance(
  db: any,
  customerId: string,
  creditSystemId: string,
  amount: number,
): Promise<number> {
  const now = Date.now();
  // Upsert: insert new row or increment existing balance atomically
  await (db as any).run(
    sql`INSERT INTO credit_system_balances (id, customer_id, credit_system_id, balance, updated_at)
        VALUES (${crypto.randomUUID()}, ${customerId}, ${creditSystemId}, ${amount}, ${now})
        ON CONFLICT (customer_id, credit_system_id)
        DO UPDATE SET balance = balance + ${amount}, updated_at = ${now}`
  );

  // Return updated balance 
  const row = await (db as any)
    .select({ balance: (schema as any).creditSystemBalances.balance })
    .from((schema as any).creditSystemBalances)
    .where(
      and(
        eq((schema as any).creditSystemBalances.customerId, customerId),
        eq((schema as any).creditSystemBalances.creditSystemId, creditSystemId),
      ),
    )
    .limit(1);

  return row[0]?.balance || amount;
}

/**
 * Get a customer's scoped credit system balance.
 */
export async function getScopedBalance(
  db: any,
  customerId: string,
  creditSystemId: string,
): Promise<number> {
  try {
    const row = await (db as any)
      .select({ balance: (schema as any).creditSystemBalances.balance })
      .from((schema as any).creditSystemBalances)
      .where(
        and(
          eq((schema as any).creditSystemBalances.customerId, customerId),
          eq((schema as any).creditSystemBalances.creditSystemId, creditSystemId),
        ),
      )
      .limit(1);
    return row[0]?.balance || 0;
  } catch {
    return 0;
  }
}

/**
 * Atomically deduct from a customer's scoped credit system balance.
 * Uses WHERE balance >= amount guard to prevent going negative under concurrency.
 * Returns true if deduction succeeded, false if insufficient balance.
 */
export async function deductScopedBalance(
  db: any,
  customerId: string,
  creditSystemId: string,
  amount: number,
): Promise<boolean> {
  const result = await (db as any).run(
    sql`UPDATE credit_system_balances
        SET balance = balance - ${amount}, updated_at = ${Date.now()}
        WHERE customer_id = ${customerId}
          AND credit_system_id = ${creditSystemId}
          AND balance >= ${amount}`
  );
  // D1 .run() returns { meta: { changes } } — if 0 rows changed, balance was insufficient
  return (result?.meta?.changes ?? result?.changes ?? 0) > 0;
}
