---
title: "Just charge customers for what they use they said!"
excerpt: "Lessons learned from implementing real-time metering for thousands of AI SaaS customers."
date: "2026-02-15"
readTime: "6 min read"
category: "Engineering"
layout: blog
thumbnail: ""
---

# \_Just charge customers for what they use\_

Usage-based billing sounds simple, right? "Just charge people for what they use."

Oh sweet summer child.

![This is fine dog meme - everything is on fire](https://media.giphy.com/media/QMHoU66sBXqqLqYvGO/giphy.gif)

After working on billing integration contracts for a number of AI SaaS companies, I can tell you that "simple" billing has approximately 47 different ways to ruin your weekend. Let's talk about the ones that matter.

--

Real-time metering means your billing system should:

1. **Track usage atomically** - No double-counting, no lost events
2. **Enforce limits instantly** - Customers hit limits at the exact moment they exceed them
3. **Handle burst traffic** - Some workloads especially AI can generate thousands of events per second
4. **Support complex pricing** - Tiered pricing, volume discounts, minimum commitments, generous rate limits
5. **Show real-time usage** - Customers need to see their current consumption

## Common Pitfalls

### Race Conditions

When multiple API calls happen simultaneously, naive usage tracking creates race conditions:

```javascript
// BAD: Read-modify-write without locking
const usage = await db.usage.findOne({ customerId });
if (usage.consumed < usage.limit) {
  await db.usage.updateOne({ customerId }, { $inc: { consumed: 1 } });
  return { allowed: true };
}
```

Two simultaneous requests can both read the same value, both increment, and both return `allowed: true` even though the limit should have been exceeded after the first.

### Eventual Consistency

Some billing systems use event streaming with eventual consistency. This works for analytics, but not for enforcing limits. A customer might exceed their quota by 1000 requests before the system catches up.

### Inaccurate Forecasting

Customers need to know three things: How much have I used this billing period? How much will I owe at current usage rates? And when will I hit my limit? Delayed or inaccurate usage data makes this impossible.

## \_What Works\_

### Atomic Operations

Database-level atomic operations prevent race conditions:

```javascript
// GOOD: Atomic findAndModify with limit check
const result = await db.usage.findOneAndUpdate(
  {
    customerId,
    consumed: { $lt: limit },
  },
  { $inc: { consumed: 1 } },
  { returnDocument: "after" },
);

return { allowed: result !== null };
```

This uses the database's atomic compare-and-swap to ensure only one concurrent request succeeds when at the limit.

### Pre-aggregation

For high-volume metering, pre-aggregate events in memory before writing to the database. Batch 1000 events into one database update, use sliding windows to handle bursty traffic, and flush aggregates every few seconds. This reduces database load while maintaining accuracy.

### Real-Time Dashboards

Customers need immediate visibility. Show current period usage with progress bars, projected bills based on current usage trends, alerts at 50%, 80%, and 100% of limits, plus historical usage patterns so customers can understand their consumption habits.

### Reset Intervals: \_Rate limits\_ as we call it

Most billing systems only reset usage monthly. But AI SaaS doesn't work like that. Your customers might need hourly resets for high-throughput inference jobs, daily resets for API quotas, weekly resets for batch processing, or monthly for standard subscriptions. Some even need custom intervals.

Imagine a customer hitting their claude limit same day they subscribed. With monthly billing, they wait until next month or upgrade. With hourly resets, they get fresh quota in 5 hours. No angry support tickets. No lost revenue from customers who just needed to wait.

\_ Claude rate limit is still annoying for me though 🫠\_

With Owostack, you configure reset intervals when defining your features in the catalog:

```typescript

// Define a metered feature
const apiCalls = metered("api_calls", { name: "API Calls" });

plan("pro", {
  name: "Pro Plan",
  price: 49,
  currency: "USD",
  interval: "monthly",
  features: [
    // 1000 calls per hour, then block
    apiCalls.included(1000, { reset: "hourly", overage: "block" }),
  ],
}),
```

Now when you check usage:

```typescript
const { allowed, balance, resetsAt } = await owo.check({
  customer: "user@acme.com",
  feature: "api_calls",
});

// Customer sees: "847 calls remaining, resets at 3:00 PM"
console.log(
  `${balance} calls remaining, resets at ${new Date(resetsAt).toLocaleTimeString()}`,
);
```

The SDK returns `resetsAt` as an ISO timestamp. You format it however you want.

This changes the conversation from "You can't use this until next month" to "You're at your limit, but it'll reset in 47 minutes."

### Graceful Degradation

When the metering system is temporarily unavailable, fail open for existing customers so you don't block service. Fail closed for new signups to prevent abuse. Queue events for later processing. And alert the team immediately.

## Owostack's Approach

We handle all of this complexity for you. Check usage and track in separate calls:

```typescript
// Check if customer can use feature
const { allowed, balance, resetsAt } = await owo.check({
  customer: "user@acme.com",
  feature: "api_calls",
});

if (!allowed) {
  return {
    error: "Quota exceeded",
    message: `Resets at ${new Date(resetsAt).toLocaleTimeString()}`,
  };
}

// Record actual usage
await owo.track({
  customer: "user@acme.com",
  feature: "api_calls",
  value: tokensUsed,
});
```

Or combine check and track atomically:

```typescript
// Check AND track in one atomic operation
const { allowed, balance } = await owo.check({
  customer: "user@acme.com",
  feature: "api_calls",
  sendEvent: true, // atomically track if allowed
});
```

Behind the scenes, we use distributed locks for atomic operations, pre-aggregate high-volume events, maintain real-time usage dashboards, handle provider-specific quirks, and manage reset intervals automatically.

## Pricing Models That Work

Different AI products need different pricing strategies. Pure usage or pay-as-you-go works well for sporadic usage and experimentation, though customers may experience bill shock from unexpected spikes. Subscription plus overage charges work for predictable baselines with variable spikes, though customers generally dislike overage surprises. Prepaid credits appeal to budget-conscious customers and work well for gift cards or enterprise procurement, though they add credit management complexity. Tiered pricing incentivizes higher usage by offering better rates at higher volumes, though it can be complex to implement and explain.

## The Human Element

Most billing systems treat limits as hard stops. But humans don't work that way. They need context.

With flexible reset intervals, you can show "resets in 47 minutes" instead of just "quota exceeded." Offer soft limits with warnings at 80% and 90%. Let customers finish current batch jobs even if they hit the limit mid-job. And suggest upgrades when someone consistently hits hourly limits.

Your support team will thank you. Your customers will stay longer.

## Conclusion

Usage-based billing is \_really\_ hard, but a rewarding experience. Any product doing this needs: real-time visibility so customers know what they're spending, flexible reset intervals or \_rate limits\_ instead of forcing everyone into monthly cycles.

OpenAI recently publised how they built their billing system: [Beyond Rate Limits](https://openai.com/index/beyond-rate-limits/).

Or you could just use Owostack and get back to building your actual product.
