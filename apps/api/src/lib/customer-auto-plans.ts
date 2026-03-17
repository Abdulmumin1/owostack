import { createDb, schema } from "@owostack/db";
import { and, eq } from "drizzle-orm";

type DB = ReturnType<typeof createDb>;

type AutoAssignPlansOptions = {
  db: DB;
  organizationId: string;
  customerId: string;
  now?: number;
};

export async function autoAssignPlansToNewCustomer(
  opts: AutoAssignPlansOptions,
) {
  const autoEnablePlans = await opts.db.query.plans.findMany({
    where: and(
      eq(schema.plans.organizationId, opts.organizationId),
      eq(schema.plans.autoEnable, true),
      eq(schema.plans.isActive, true),
    ),
  });

  if (autoEnablePlans.length === 0) {
    return [];
  }

  const now = opts.now ?? Date.now();
  const thirtyDaysFromNow = now + 30 * 24 * 60 * 60 * 1000;
  const subscriptions = autoEnablePlans.map(
    (plan: (typeof autoEnablePlans)[number]) => ({
      id: crypto.randomUUID(),
      customerId: opts.customerId,
      planId: plan.id,
      status: plan.type === "free" ? "active" : "pending",
      currentPeriodStart: now,
      currentPeriodEnd: thirtyDaysFromNow,
    }),
  );

  await opts.db.insert(schema.subscriptions).values(subscriptions);

  return subscriptions;
}
