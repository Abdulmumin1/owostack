---
title: "What usage-based billing looks like once you actually have to build it"
excerpt: "Usage-based billing sounds clean in theory. In practice, the hard part is not charging for usage. It is deciding access correctly while traffic, pricing, and user expectations keep moving."
date: "2026-02-15"
readTime: "7 min read"
category: "Engineering"
layout: blog
thumbnail: ""
author: "yaqeen"
---

The phrase always sounds simpler than the work.

Just charge people for what they use.

That sounds reasonable right until you have to build the part that decides, in
real time, whether a customer is still allowed to do the thing they are trying
to do.

That is usually when teams realize they are not building a pricing page problem.
They are building a systems problem.

The moment usage actually matters, a lot of questions show up all at once.

What happens if two requests hit the meter at the same time?
What happens if the customer is right at the limit?
What happens if pricing is tiered, or there is overage, or there are credits on
top of a subscription?
What do you show the user when they run out?

That is the part people usually mean when they say usage-based billing is hard.

## The moment it stops being simple

I think the cleanest way to understand the problem is to imagine a normal API
request.

A customer makes a call. Your app needs to decide if they should be allowed
through. If yes, you need to record usage. If no, you need to tell them why.

That sounds small enough.

But now make it real.

That customer might have multiple requests landing together. They might have a
monthly included allowance with daily resets. They might be allowed into overage
after the included amount. They might have prepaid credits that should be used
before you block anything. They might open the dashboard right after and expect
to see the same number you used to make the decision.

So the problem is no longer "count usage."

The problem is: can the billing system make the same answer hold up across
entitlements, enforcement, pricing, invoices, and UI?

That is where a lot of implementations start drifting.

## Where teams usually get hurt

The first problem is race conditions.

If you read a usage counter, check whether it is still under the limit, then
write the new value in a second step, you have already made the system easier to
break under concurrency.

```js
const usage = await db.usage.findOne({ customerId });

if (usage.consumed < usage.limit) {
  await db.usage.updateOne({ customerId }, { $inc: { consumed: 1 } });
  return { allowed: true };
}
```

That code looks normal. It is also enough for two requests to read the same
value, both decide they are allowed, and both increment.

The second problem is eventual consistency.

For analytics, delayed updates are fine. For enforcement, they are not. If the
system catches up a few seconds later, the customer may already be well past the
limit you thought you were enforcing.

The third problem is product trust.

If the dashboard says one thing, the API says another, and support has to piece
together what happened from logs, users stop trusting the pricing long before
they start trusting it.

## What the system actually needs to do

At minimum, a real usage billing system has to do a few things at once.

It has to track usage safely.
It has to enforce access at the right moment.
It has to keep pricing logic consistent with the thing that generated the bill.
And it has to explain the state back to the user in a way that does not feel
made up.

That usually means atomic decisions first.

```js
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

That does not solve everything, but it solves an important class of bugs. The
read and the write are now part of one decision.

After that, you still need the surrounding structure.

If traffic is high, you probably need some form of aggregation or batching so
the storage layer does not become the product bottleneck.
If pricing is more complex than flat pay-as-you-go, the usage decision also has
to understand included amounts, overage rules, tiering, and resets.
If the user is near a limit, the product should be able to tell them more than
just "denied."

## Reset intervals matter more than they look

One thing that keeps showing up in AI products is that monthly-only resets are
too blunt.

A customer can use a lot of value in one afternoon. If your only mental model is
"this plan resets next month," your pricing starts creating product problems.

That is why reset intervals matter.

Sometimes the right model is monthly.
Sometimes it is daily.
Sometimes it is hourly.

That changes the user experience quite a lot.

"You are out till next month" is one kind of product.
"You are out for now, resets in 47 minutes" is another.

That difference affects support, retention, and how fair the plan feels.

In **[Owostack](https://owostack.com)**, reset intervals are part of the feature config itself:

```ts
const apiCalls = metered("api_calls", { name: "API Calls" });

plan("pro", {
  name: "Pro Plan",
  price: 49,
  currency: "USD",
  interval: "monthly",
  features: [
    apiCalls.included(1000, {
      reset: "hourly",
      overage: "block",
    }),
  ],
});
```

And when the app checks access, it can also get the next reset time back:

```ts
const { allowed, balance, resetsAt } = await owo.check({
  customer: "user@acme.com",
  feature: "api_calls",
});

console.log(
  `${balance} calls remaining, resets at ${new Date(resetsAt).toLocaleTimeString()}`,
);
```

That does not just help the backend. It gives the product something useful to
say.

## Why this touches more than billing

Once a meter controls access, usage-based billing stops being isolated billing
logic.

It is now part of product behavior.

It affects what the API allows.
It affects what the dashboard shows.
It affects support conversations.
It affects whether a user feels they hit a fair limit or a broken one.

That is why I think the human part gets missed too often. A hard limit with no
context feels worse than a limit with a clear reset time, current balance, and a
sane path forward.

The customer usually does not care whether your internal model is called
"included usage" or "prepaid credits." They care whether the product makes sense
the moment they hit the edge.

## What we ended up caring about

Inside Owostack, the things that matter most here are pretty consistent.

- atomic metering, so access decisions hold up under concurrency
- one pricing model that feeds both enforcement and billing
- support for reset intervals beyond monthly
- clear runtime responses like `resetsAt`, not just allow or deny
- room for credits, overage, and hybrid pricing without rewriting the model

That is the difference between a meter that only counts events and a billing
layer you can actually build a product on top of.

## The point

Usage-based billing is not hard because multiplication is hard.

It is hard because once usage matters, the billing system is suddenly
responsible for product truth.

It has to decide access correctly.
It has to count correctly.
It has to price correctly.
And it has to explain itself clearly enough that users do not feel like the
numbers came from nowhere.

That is the part people usually leave out when they say, "just charge for what
they use."

OpenAI wrote about some of this in [Beyond Rate Limits](https://openai.com/index/beyond-rate-limits/).

That piece makes the same thing obvious in a different way:
once usage becomes the product, billing logic and product logic stop being clean
separate boxes.
