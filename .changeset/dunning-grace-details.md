---
"@owostack/types": minor
"owostack": minor
"owosk": minor
---

`check()` and `track()` keep granting a subscription's entitlements while the payment provider is retrying a failed renewal (`past_due`); access is revoked when the provider ends the subscription. During dunning `details.paymentStatus` is `"past_due"` (and `details.graceEndsAt` gives the 45-day backstop), so apps can show an "update your payment method" prompt instead of an upgrade prompt.
