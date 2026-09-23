---
"@owostack/types": minor
"owostack": minor
"owosk": minor
---

`AttachResult` now matches what `attach()` actually returns. `checkoutUrl`, `reference` and `accessCode` are optional (absent for free plans, lateral moves, native upgrades and scheduled downgrades), and the type gains `success`, `requiresCheckout`, `subscriptionId`, `customer_id`, `type`, `message`, `trial*`, `scheduledAt` and the new `pending` flag. `pending: true` means the provider accepted a native upgrade but is still collecting the prorated charge; the customer stays on the current plan until the provider confirms and `check()` reflects the switch.
