---
"@owostack/types": minor
"owostack": minor
"owosk": minor
---

Add first-class volumetric pricing support across the SDK, types, and CLI.

`owostack` adds metered pricing helpers for `perUnit`, `graduated`, and `volume` usage models, validates tier definitions before sync, and sends pricing metadata such as `usageModel`, `pricePerUnit`, `ratingModel`, `tiers`, `billingUnits`, and normalized overage behavior in the sync payload.

`@owostack/types` adds the shared pricing primitives (`PricingTier`, `RatingModel`, `PricingDetails`, `CurrentPricingTier`, and `BillingTierBreakdown`) and extends metered feature config, public plan payloads, billing usage results, invoice line items, and sync payloads so tiered pricing and pricing context can round-trip cleanly. It also expands `ResetInterval` to include `none` and `semi_annual`.

`owosk` now round-trips volumetric pricing fields when generating configs, normalizes reset aliases in generated output, and makes `init`, `pull`, and `diff` consistent for plans, credit systems, and credit packs so a fresh import can diff cleanly.
