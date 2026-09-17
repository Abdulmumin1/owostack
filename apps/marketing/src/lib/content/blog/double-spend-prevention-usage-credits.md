---
title: "Double-spend prevention for usage-based credits"
excerpt: "Two concurrent requests, one credit balance. Here's how we made sure they can't both win."
date: "2026-09-17"
readTime: "7 min read"
category: "Engineering"
layout: blog
thumbnail: ""
author: "yaqeen"
---

One of the models we support for usage-based billing is the prepaid balance model. Your plan has features, each feature has a `creditCost`, and the customer has a credit balance. Every usage event costs some credits. When the balance hits zero, the feature stops working.

Simple enough. Check the balance, deduct the cost, move on with your life.

That's what i thought too, and the first version of this was exactly what you'd write on a friday afternoon:

```ts
// read the balance
const creditRecord = await db.query.credits.findFirst({
  where: eq(schema.credits.customerId, customer.id),
});

if ((creditRecord?.balance || 0) < cost) {
  return denied("insufficient_credits");
}

// ...validate the event, track usage...

// deduct "later" so we don't slow down the response
c.executionCtx.waitUntil(
  db.update(schema.credits)
    .set({ balance: sql`balance - ${cost}` })
    .where(eq(schema.credits.customerId, customer.id)),
);
```

Looks fine. passes every test where requests arrive one at a time. which is cute, because requests do not arrive one at a time.

### The race

Two `/track` calls land at the same millisecond. Balance is 10 credits, each event costs 10.

- Request A reads the balance: 10. Enough.
- Request B reads the balance: 10. Enough. (A hasn't deducted yet — its deduction is waiting in `waitUntil`.)
- Both get `allowed: true`. Both spend 10 credits from a balance of 10.

The customer got 20 credits worth of API calls out of 10 credits. Nobody errored, nothing crashed, the ledger just quietly went negative. The worst kind of bug: the system *works*, it just works incorrectly.

This is the classic double-spend problem, the same one bitcoin exists because of. We don't have a blockchain budget (thank god), so we needed something smaller: a single statement that both checks and spends in one shot.

### The fix: one guarded UPDATE

D1 (and sqlite, and every sql engine really) evaluates the `WHERE` clause against the row as it is *right now*, and only one writer gets to change it at a time. So instead of read → decide → deduct as three separate steps, you collapse the whole decision into a single statement:

```ts
async function tryDeductPrepaidCredits(
  db: any,
  customerId: string,
  amount: number,
): Promise<boolean> {
  const result = await db.run(
    sql`UPDATE credits
        SET balance = balance - ${amount}, updated_at = ${Date.now()}
        WHERE customer_id = ${customerId} AND balance >= ${amount}`,
  );
  return (result?.meta?.changes ?? 0) > 0;
}
```

The `balance >= ${amount}` in the WHERE clause is the whole trick. It's a compare-and-swap in sql form:

- if the balance covers the cost, the row gets updated and `changes` is 1 → the request "won" the credits
- if it doesn't, nothing updates and `changes` is 0 → denied

Two requests racing on the same balance? The database serializes them. One wins, one gets `insufficient_credits`. There is no window between "check" and "deduct" anymore, because they're the same statement.

No transactions to orchestrate, no distributed lock, no "acquire a mutex on a DO first". One UPDATE. i genuinely love when the fix is smaller than the bug.

### the fix that had a bug in it

Now here's the part that keeps me humble. The atomic reservation shipped, the double-spend tests went green, and i moved on. Then a few weeks later a beta user reported something funny: `/check` calls were letting requests through that should have been denied.

What happened: the guarded UPDATE lived in the `sendEvent` path (the one that actually spends credits). But `/check` without `sendEvent` is a read-only call — "would this request be allowed?" — and during the refactor, that path stopped re-reading the prepaid balance. It silently allowed everything.

So we had gone from "credits can be double-spent" to "credits are never enforced at all on read-only checks". An upgrade in the wrong direction :)

The fix came in two pieces:

**1. keep read-only checks read-only, but actually check**

```ts
async function hasPrepaidCredits(
  db: any,
  customerId: string,
  amount: number,
): Promise<boolean> {
  const creditRecord = await db.query.credits.findFirst({
    where: eq(schema.credits.customerId, customerId),
  });
  return (creditRecord?.balance ?? 0) >= amount;
}
```

`/check` without `sendEvent` reads the balance and answers honestly. It never mutates anything, so it can't race itself into a bad state.

**2. refund when the meter says no**

There's a second race that the guarded UPDATE can't save you from: we reserve the credits first (atomic, correct), then the usage meter validates the event — and the meter says no. Limits hit, event denied. But the credits are already gone.

So every reservation that gets denied needs a compensating action:

```ts
async function refundPrepaidCredits(
  db: any,
  customerId: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  await db.run(
    sql`UPDATE credits
        SET balance = balance + ${amount}, updated_at = ${Date.now()}
        WHERE customer_id = ${customerId}`,
  );
}
```

Reserve → meter says no → refund. Credits never lost on a denied request, and the usage meter stays the source of truth for plan limits, so `/check` keeps seeing real usage after a `/track`.

### what i took from this

- the safe version of "check then act" is not more careful checking. it's collapsing the check and the act into one statement and letting the database be the arbiter.
- every fix needs a fix-for-the-fix test. the regression was only visible when a *different* endpoint (read-only `/check`) was exercised against the new code path — so the tests now cover both paths, not just the happy one.
- compensating actions beat distributed transactions. reserve, meter, refund. it's a mini saga, and it's enough.

we're still in beta, and i'd rather find these now than after someone's production invoice depends on it. if you're building usage-based credits too and you've run into this (or solved it differently — i know some folks do the ledger-with-events approach instead of mutable balances), i would genuinely love to compare notes.

Would love to know your ideas and opinions on this. Join our discord.. https://discord.gg/jQ3TyEn6WR
