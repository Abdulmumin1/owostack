---
title: "The weird pricing trick taking over every AI app"
excerpt: "As of March 21, 2026, ChatGPT, Claude, and Perplexity all use some version of rolling or staggered usage resets. That is not a coincidence."
date: "2026-03-21"
readTime: "6 min read"
category: "Product & Strategy"
layout: blog
thumbnail: ""
author: "yaqeen"
---

I do not know if "reset-window pricing" is the name that will stick.

But I keep seeing the same pattern.

The old subscription shape was easy to recognize. Pay every month, get one big
bucket or maybe just unlimited access, use it however you want.

AI products have been moving away from that pretty fast.

The new shape is closer to this:

you get some amount of usage every few hours, every day, or on some other short
window, and the window matters just as much as the total amount.

Once you notice it, you start seeing it everywhere.

As of March 21, 2026, OpenAI, Anthropic, and Perplexity are all doing some
version of this.

- ChatGPT Plus now mixes shorter windows and longer ones, depending on the model
- Claude Pro has a five-hour session-style limit and also a weekly one
- Perplexity Pro restores used credits on a rolling 24-hour basis

Those products are not identical, but they are all moving in the same direction.

That usually means something real is going on underneath.

## Why the old monthly model starts breaking

I think the simplest way to say it is that monthly quotas are too blunt for AI.

AI usage is not very smooth.

Someone can barely use a product for a few days, then suddenly run a lot of
heavy requests in one afternoon. Another user can look "light" on a monthly
basis but still create expensive spikes because they use the most expensive
model, with the biggest context, all in one sitting.

That is a bad fit for one giant monthly bucket.

The company is trying to control bursty cost.
The user is trying to build a habit.
The pricing model is trying to pretend both problems happen on the same monthly
schedule.

A lot of the time, they do not.

## What these companies are really selling

A normal SaaS subscription mostly sells access to software.

A lot of AI subscriptions are doing something a bit different.

They are selling access to compute with a software wrapper around it.

That does not mean the product has no real value beyond the model. It does. But
it does mean the economics are more sensitive to when usage happens, how heavy
it is, and how concentrated it gets.

That is why the reset window matters.

It is not just a billing detail. It is part of the product.

If a user gets 40 advanced actions every 3 hours, that is not the same product
as getting 9,600 actions per month, even if the arithmetic can be made to look
similar. One product is shaped around rhythm and control. The other is shaped
around a big delayed cliff.

People feel that difference immediately.

## Why shorter windows keep showing up

Shorter windows solve a few problems at once.

They make the plan feel less final when someone hits a limit.
They reduce how much damage one account can do in one burst.
They line up a bit better with the way AI costs actually show up.

Most importantly, they let the company answer a more useful question than "how
much can we afford to give away this month?"

The better question is usually:

how much usage can we safely include before we need the product to slow down,
reset, or spill into paid overflow?

That is a much more AI-shaped question.

## This is why subscriptions and consumption are blending together

The interesting thing is that these products are not moving fully back to
pay-as-you-go either.

They are building layers.

Subscription for the base experience.
Short reset windows for included usage.
Credits or overage for spikes.
Harder blocks after that.

That stack makes more sense than the old:

- subscription
- one monthly allowance
- hard stop

You can see why some products end up feeling confusing, though.

If the subscription is mostly acting like an entry ticket to the real pricing
model underneath, users notice that too. People say things like "this feels like
I am paying monthly just to unlock the chance to keep paying."

Sometimes that criticism is unfair.
Sometimes it is not.

## The implementation detail is the real work

This part is easy to underestimate.

If your plan says "credits restore 24 hours after use" or "40 advanced actions
every 3 hours," you do not have a normal monthly counter anymore.

You need actual rolling logic.
You need accurate timestamps.
You need per-feature or per-model limits.
You need something the UI can explain clearly.
You need support tooling for when a customer says the counter is wrong.

By this point, you are not just working on billing. You are working on
entitlements, rate limiting, product UX, and finance all at once.

That is part of why this pattern matters to us at **[Owostack](/)**.

If your product needs quotas that reset every few hours, credits that come back
on a rolling basis, or hybrid pricing with included usage plus overflow, that
logic should not be smeared across webhook handlers, caches, and feature flags.

It should live in one place.

## My take

I would not say reset-window pricing is the final answer for every AI company.

But I do think enough serious products are converging on it that it is fair to
call it a default pattern now.

Not because it is elegant.
Because it fits the economics better.

If I were designing an AI plan today, I would not start with one giant monthly
bucket. I would start with a subscription, a clear reset window, and a decision
about what should happen when someone needs more than the included amount.

Maybe that means credits.
Maybe that means overage.
Maybe that means an upgrade path.

But I would not leave the reset shape as an afterthought.

That part changes the product more than it first appears.

## Sources checked for this piece

- OpenAI: [What is ChatGPT Plus?](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus), [GPT-5.3 and GPT-5.4 in ChatGPT](https://help.openai.com/en/articles/11909943-gpt-53-and-54-in-chatgpt), [Using Credits for Flexible Usage in ChatGPT](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-free-go-plus-pro-sora), [ChatGPT Rate Card](https://help.openai.com/en/articles/11481834-chatgpt-rate-card)
- Anthropic: [What is the Pro plan?](https://support.claude.com/en/articles/8325606-what-is-the-pro-plan)
- Anthropic: [Extra usage for paid Claude plans](https://support.claude.com/en/articles/12429409-extra-usage-for-paid-claude-plans), [Understanding usage and length limits](https://support.claude.com/en/articles/11647753-understanding-usage-and-length-)
- Perplexity: [What is Perplexity Pro?](https://www.perplexity.ai/help-center/en/articles/9385876-what-is-perplexity-pro)
