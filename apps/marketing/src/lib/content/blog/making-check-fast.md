---
title: "Thoughts on making our /check endpoint fast"
excerpt: "Engineering efforts we've been making to make our /check endpoint fast"
date: "2026-03-01"
readTime: "5 min read"
category: "Engineering"
layout: blog
thumbnail: "https://mac-file.yaqeen.me/3B499EC5-Generated%20Image%20March%2004%2C%202026%20-%205_49PM.png"
---

A simple principle i've been sticking with for a while is a quote from steve jobs - where he said: "start with the customer experience, then walk up the technology" i don't know if i got that right (could google it though);

I got too confident in the beginning, as i've put together experiences i've gathered to build a solid foundation for our api design to make sure we're not accumulating unnecessary overhead in terms of speed. 

In our development stage, the average speed for /check was just a bit over 20ms, which we use as a base to predict what the average speed might look like for entities scattered around the world. our prediction was in the range of 100-150ms which at the time, feels fine.

Then I started to beta test it with more and more people, the regions start to expand and the numbers showed completely different result from what I predicted :)

![alt text](/images/blog/making-check-fast-1.png)

Then we consulted the oracle and asked for a solution (i'm not kidding!)


![alt text](/images/blog/making-check-fast-CONSULTING-ORACLE.png)


The first step was to  parallelizing the sequential customer→feature→subscription fetches with Promise.all, and housekeeping should use ctx.waitUntil  (a thing in cf workers that allow the worker to respond early, but stay awake till the task is complete). 

But there are calls that depends on another..

- Resolve Customer (needs organizationId, customerId) → returns customer
- Resolve Feature (needs organizationId, featureId) → returns feature
- Validate Entity (needs customer.id, feature.id, entity) → depends on both 1 & 2
- Check Subscriptions (needs customer.id) → depends on 1
- Check Plan Features (needs planIds from subscriptions, feature.id) → depends on 2 & 4

Hence our parallelization opportunities were:

- **Group 1** (parallel): Customer + Feature
- **Group 2** (after group 1, parallel): Entity validation + Subscriptions
- **Group 3** (after subscriptions): Plan Features

This effectively shoved off about 50-80ms from our lookups, and even better with cache hits!

![alt text](/images/blog/making-check-fast-2.png)

### Websocket

I also thought of another method to reduce network overhead with websocket endpoints, which can keep connection alive for multiple check calls, significantly cutting down pure network latency and per-request overhead, but this has been unexplored yet.

as you can see here, most of the time was spent just initiating the connection, not waiting for the server:

![alt text](/images/blog/making-check-fast-3.png)

A websocket connection opened with our servers before you even hit any of our endpoint, would eat up alot of these ugly numbers.

We currently don't have a "client-side" sdk yet :/ (soon though) which would have significantly benefitted from such websocket connection. on the server side, it is unsure where our customers are on a server or serverless, but I assumed serverless, which can't make a persistent connection.

---

Those were great, but we're not still where we wanted, BUT thanks to opus 4.6 in Amp code we had another proposal: 

### The "Compiled Entitlement Graph"

I.e we move from "Read-Time Assembly" to "Write-Time Assembly."

Instead of fetching 5 separate entities to answer "does this customer have access to this feature?", we pre-compute the answer.

**Materialized View in KV:** Whenever a subscription is created, a plan changed, or an add-on bought (via webhooks or dashboard mutations), a background job compiles a JSON object: `customer_entitlements:<orgId>:<customerId>`.

```json

{

"subscriptions": [{ "id": "sub_1", "status": "active", "planId": "plan_1" }],

"features": {

"feature_1": { "type": "boolean", "allowed": true },

"feature_2": { "type": "metered", "limit": 100, "resetInterval": "month" }

}

}

```

**O(1) Fetch:** The `/check` endpoint now makes **exactly ONE** KV read for this object. If it exists, the access decision is pure CPU logic (0ms). Total latency: **KV Read Time (~10-20ms) + Execution Time (~5ms) = 15-25ms.**

**Fallback & Rebuild:** If the KV object is missing, fallback to the old sequential D1 fetch, serve the request, and trigger an asynchronous rebuild (`waitUntil`) to populate the cache.

This one really challenged our design, and reminded me that, if we had truely started with the customer experience, before walking up to the technology, a solution like this might be what we will have from the beginning. 

But the above proposal is not implemented in any of our test environment yet, i'm still actively battling alot of issues and edge cases that this has, though the result (when it works) makes me think this might be work it.

Would love to know your ideas and opinions on this. Join our discord.. https://discord.gg/jQ3TyEn6WR
