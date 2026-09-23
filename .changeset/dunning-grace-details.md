---
"@owostack/types": minor
"owostack": minor
"owosk": minor
---

`check()` and `track()` keep granting a subscription's entitlements for a 7-day dunning grace window after a renewal fails (`past_due`), while the payment provider retries the card. During the window `details.paymentStatus` is `"past_due"` and `details.graceEndsAt` says when access will be revoked, so apps can show an "update your payment method" prompt instead of an upgrade prompt.
