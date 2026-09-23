# owostack

## 0.7.0

### Minor Changes

- [#271](https://github.com/Abdulmumin1/owostack/pull/271) [`15fecce`](https://github.com/Abdulmumin1/owostack/commit/15fecce70995ef106866438bd73d59b96bac3682) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - `check()` and `track()` keep granting a subscription's entitlements while the payment provider is retrying a failed renewal (`past_due`); access is revoked when the provider ends the subscription. During dunning `details.paymentStatus` is `"past_due"` (and `details.graceEndsAt` gives the 45-day backstop), so apps can show an "update your payment method" prompt instead of an upgrade prompt.

### Patch Changes

- Updated dependencies [[`15fecce`](https://github.com/Abdulmumin1/owostack/commit/15fecce70995ef106866438bd73d59b96bac3682)]:
  - @owostack/types@0.7.0

## 0.6.0

### Minor Changes

- [#267](https://github.com/Abdulmumin1/owostack/pull/267) [`586a099`](https://github.com/Abdulmumin1/owostack/commit/586a099e44225f557eb1f0785f019f1db1ecf10c) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - `AttachResult` now matches what `attach()` actually returns. `checkoutUrl`, `reference` and `accessCode` are optional (absent for free plans, lateral moves, native upgrades and scheduled downgrades), and the type gains `success`, `requiresCheckout`, `subscriptionId`, `customer_id`, `type`, `message`, `trial*`, `scheduledAt` and the new `pending` flag. `pending: true` means the provider accepted a native upgrade but is still collecting the prorated charge; the customer stays on the current plan until the provider confirms and `check()` reflects the switch.

### Patch Changes

- Updated dependencies [[`586a099`](https://github.com/Abdulmumin1/owostack/commit/586a099e44225f557eb1f0785f019f1db1ecf10c)]:
  - @owostack/types@0.6.0

## 0.5.0

### Minor Changes

- [#246](https://github.com/Abdulmumin1/owostack/pull/246) [`c638330`](https://github.com/Abdulmumin1/owostack/commit/c6383300c0ef034e248158104ea3fa9e0919b474) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Customer reads accept the same identifier you write with.
  - `GET /customers/{id}` and `GET /customers/{id}/usage/history` now resolve your external customer ID (the `customer` value passed to `track`/`check`) and the customer's email, not only the internal UUID. Ambiguous matches return `409`.
  - New `GET /customers` list/search endpoint with `limit`, `offset`, `search`, `email` and `externalId` filters, exposed as `owo.customer.list()`.
  - New `owo.customer.get(customer)`.
  - `CustomerResult` now includes `externalId`, and `createdAt`/`updatedAt` are typed as the Unix millisecond numbers the API actually returns (they were typed as ISO strings).
  - New types: `CustomerListParams`, `CustomerListResult`, `CustomerSummary`.

- [#245](https://github.com/Abdulmumin1/owostack/pull/245) [`742f003`](https://github.com/Abdulmumin1/owostack/commit/742f00344621f74c2b01dc96b81838b01b4ae819) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Environment-aware check/track responses.
  - `CheckResult` and `TrackResult` now include `environment: "sandbox" | "live"` (the environment that served the request, also echoed in the `X-Owostack-Environment` response header) and an explicit `unlimited: boolean` alongside `limit: null`.
  - `ResponseDetails.plan` carries the slug of the plan granting access, next to `planName`.
  - New `OwostackEnvironment` type export.

- [#247](https://github.com/Abdulmumin1/owostack/pull/247) [`5959740`](https://github.com/Abdulmumin1/owostack/commit/59597405e94da0c20a0ed355bc37e3267279cb4e) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - No more silent production default.
  - `new Owostack({ secretKey })` resolves its environment from `apiUrl`, then `mode`, then the key prefix (`owo_sk_test_…` → sandbox, `owo_sk_live_…` → live). When none of those determine it — a legacy `owo_sk_…` key with no `mode` — the client still constructs, but the first request throws `OwostackError` with code `config_error` instead of talking to `api.owostack.com`. A `mode` that contradicts a scoped key is also a `config_error`.
  - New `owo.mode` and `owo.apiUrl` getters, plus exported helpers `inferModeFromSecretKey`, `resolveEnvironment`, `apiUrlForMode`, `OWOSTACK_HOSTS`.
  - `OwostackConfig.environments` is now declared (per-environment hosts used by the CLI).

  **Migration:** if you use a legacy key without `mode`, add `mode: "sandbox"` or `mode: "live"` — or rotate to an environment-scoped key from the dashboard.

### Patch Changes

- Updated dependencies [[`c638330`](https://github.com/Abdulmumin1/owostack/commit/c6383300c0ef034e248158104ea3fa9e0919b474), [`742f003`](https://github.com/Abdulmumin1/owostack/commit/742f00344621f74c2b01dc96b81838b01b4ae819), [`5959740`](https://github.com/Abdulmumin1/owostack/commit/59597405e94da0c20a0ed355bc37e3267279cb4e)]:
  - @owostack/types@0.5.0

## 0.4.6

### Patch Changes

- Updated dependencies [[`3f48a2a`](https://github.com/Abdulmumin1/owostack/commit/3f48a2a1d75b39519c7bb03224e67854450fa006)]:
  - @owostack/types@0.4.6

## 0.4.5

### Patch Changes

- [#165](https://github.com/Abdulmumin1/owostack/pull/165) [`3dd03eb`](https://github.com/Abdulmumin1/owostack/commit/3dd03eb3b8996fb8cabee7b580491a28d6bdc2dc) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Fail closed when shared feature handles are rebound to a different Owostack client.

## 0.4.4

### Patch Changes

- [#162](https://github.com/Abdulmumin1/owostack/pull/162) [`6aa4af8`](https://github.com/Abdulmumin1/owostack/commit/6aa4af83475d883611b6c7d19d21b5f1aa0035b0) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Bind feature handles for features that are only referenced through credit systems in the configured catalog.

## 0.4.3

### Patch Changes

- [#148](https://github.com/Abdulmumin1/owostack/pull/148) [`0d6faa2`](https://github.com/Abdulmumin1/owostack/commit/0d6faa2b6c876886f9c58e3cf74b3bc7409ba4e0) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Add `customer.usageHistory()` to the SDK and export the matching customer usage history types.

- Updated dependencies [[`0d6faa2`](https://github.com/Abdulmumin1/owostack/commit/0d6faa2b6c876886f9c58e3cf74b3bc7409ba4e0)]:
  - @owostack/types@0.4.3

## 0.4.2

### Patch Changes

- [#141](https://github.com/Abdulmumin1/owostack/pull/141) [`33c309c`](https://github.com/Abdulmumin1/owostack/commit/33c309ce0bf05378862fd882aa4d6f5499d2d97c) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Redesign credit-backed check and track responses to return a canonical `credits` object instead of loose top-level credit fields.

  The new shape distinguishes between `credit_system` and `prepaid` balances, includes plan balance details consistently, and aligns direct credit-system feature checks with child features resolved through a credit pool.

- Updated dependencies [[`33c309c`](https://github.com/Abdulmumin1/owostack/commit/33c309ce0bf05378862fd882aa4d6f5499d2d97c)]:
  - @owostack/types@0.4.2

## 0.4.1

### Patch Changes

- [#137](https://github.com/Abdulmumin1/owostack/pull/137) [`df27166`](https://github.com/Abdulmumin1/owostack/commit/df2716678c83a3d39947479b3333729163ac12f6) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Add customer billing config support to the SDK, including `owo.customer` setters for per-feature overage config and customer-wide overage limits, plus enriched customer responses that include active billing config state.

- Updated dependencies [[`df27166`](https://github.com/Abdulmumin1/owostack/commit/df2716678c83a3d39947479b3333729163ac12f6)]:
  - @owostack/types@0.4.1

## 0.4.0

### Minor Changes

- [#130](https://github.com/Abdulmumin1/owostack/pull/130) [`646af7f`](https://github.com/Abdulmumin1/owostack/commit/646af7fdfecfb671f9dbf65460f26ea0ff216fe8) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Redesign credit-backed check and track responses to return a canonical `credits` object instead of loose top-level credit fields.

  The new shape distinguishes between `credit_system` and `prepaid` balances, includes plan balance details consistently, and aligns direct credit-system feature checks with child features resolved through a credit pool.

### Patch Changes

- Updated dependencies [[`646af7f`](https://github.com/Abdulmumin1/owostack/commit/646af7fdfecfb671f9dbf65460f26ea0ff216fe8)]:
  - @owostack/types@0.4.0

## 0.3.3

### Patch Changes

- [#119](https://github.com/Abdulmumin1/owostack/pull/119) [`372581d`](https://github.com/Abdulmumin1/owostack/commit/372581d3c9353ab8d7b7a7a094f06347db7f625f) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Add `trialLimit` support for metered features. Trial limits allow different usage caps during trial periods vs active subscriptions. CLI diff now detects trialLimit changes.

- Updated dependencies [[`372581d`](https://github.com/Abdulmumin1/owostack/commit/372581d3c9353ab8d7b7a7a094f06347db7f625f)]:
  - @owostack/types@0.3.3

## 0.3.2

### Patch Changes

- [#98](https://github.com/Abdulmumin1/owostack/pull/98) [`73b560a`](https://github.com/Abdulmumin1/owostack/commit/73b560aa7af6884b6ee2d371e834ce9b25220896) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Add `billingType` support to catalog sync payloads and preserve it in CLI-generated configs and diffs.

- Updated dependencies [[`73b560a`](https://github.com/Abdulmumin1/owostack/commit/73b560aa7af6884b6ee2d371e834ce9b25220896)]:
  - @owostack/types@0.3.2

## 0.3.1

### Patch Changes

- [#78](https://github.com/Abdulmumin1/owostack/pull/78) [`2947418`](https://github.com/Abdulmumin1/owostack/commit/2947418d4b72b971672ee84f42da4578e16882b4) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Publish a linked patch release for the public packages. The SDK now preserves
  string and nested API error messages instead of collapsing them to a generic
  request failure.
- Updated dependencies [[`2947418`](https://github.com/Abdulmumin1/owostack/commit/2947418d4b72b971672ee84f42da4578e16882b4)]:
  - @owostack/types@0.3.1

## 0.3.0

### Minor Changes

- [#74](https://github.com/Abdulmumin1/owostack/pull/74) [`0fa8ff0`](https://github.com/Abdulmumin1/owostack/commit/0fa8ff0c6827d5f49c0a8032718224fe0e83557e) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Add first-class volumetric pricing support across the SDK, types, and CLI.

  `owostack` adds metered pricing helpers for `perUnit`, `graduated`, and `volume` usage models, validates tier definitions before sync, and sends pricing metadata such as `usageModel`, `pricePerUnit`, `ratingModel`, `tiers`, `billingUnits`, and normalized overage behavior in the sync payload.

  `@owostack/types` adds the shared pricing primitives (`PricingTier`, `RatingModel`, `PricingDetails`, `CurrentPricingTier`, and `BillingTierBreakdown`) and extends metered feature config, public plan payloads, billing usage results, invoice line items, and sync payloads so tiered pricing and pricing context can round-trip cleanly. It also expands `ResetInterval` to include `none` and `semi_annual`.

  `owosk` now round-trips volumetric pricing fields when generating configs, normalizes reset aliases in generated output, and makes `init`, `pull`, and `diff` consistent for plans, credit systems, and credit packs so a fresh import can diff cleanly.

### Patch Changes

- Updated dependencies [[`0fa8ff0`](https://github.com/Abdulmumin1/owostack/commit/0fa8ff0c6827d5f49c0a8032718224fe0e83557e)]:
  - @owostack/types@0.3.0

## 0.2.0

### Minor Changes

- [`b785947`](https://github.com/Abdulmumin1/owostack/commit/b7859477f0eedbf0283302e6b627be6bcf0ffb38) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Added comprehensive support for managing Credit Packs via SDK and CLI.
  - **SDK**: Added `creditPack()` builder function to define credit packs in the catalog.
  - **CLI**: Updated `sync`, `diff`, and `pull` commands to support credit packs.
  - **API**: Added support for syncing credit packs and a new endpoint to fetch them.
  - **Documentation**: Added guides and examples for programmatic credit pack management.

- [`b785947`](https://github.com/Abdulmumin1/owostack/commit/b7859477f0eedbf0283302e6b627be6bcf0ffb38) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Add `entity()` builder for non-consumable features and `autoEnable` for plans

  ### `entity()` — non-consumable features
  - New `entity(slug, opts?)` function — defines features managed via `.add()` / `.remove()` instead of `track()`
  - `EntityHandle` methods: `.add(customer, opts)`, `.remove(customer, entity)`, `.list(customer)`, `.check(customer)`
  - Defaults to `reset: "never"` — entity count reflects current state, not periodic usage
  - Sync payload now includes `meterType: "non_consumable"` for entity features
  - CLI (`owosk pull`) now generates `entity()` for non-consumable features
  - `/plans` API response now includes `meterType` on features

  ```ts
  import { entity, plan } from "owostack";

  const seats = entity("seats", { name: "Team Seats" });

  // In plan config
  seats.limit(5); // reset: "never" is implicit

  // At runtime
  await seats.add("org@acme.com", { entity: "user_123", name: "John" });
  await seats.remove("org@acme.com", "user_123");
  const { entities } = await seats.list("org@acme.com");
  ```

  ### `autoEnable` — auto-assign plans
  - `plan()` now accepts `autoEnable: true` to auto-assign plans to new customers
  - Syncs via SDK, returned from `/plans` API, and generated by CLI pull

  ```ts
  plan("free", {
    name: "Free",
    price: 0,
    currency: "USD",
    interval: "monthly",
    autoEnable: true,
    features: [apiCalls.limit(100)],
  });
  ```

### Patch Changes

- Updated dependencies [[`b785947`](https://github.com/Abdulmumin1/owostack/commit/b7859477f0eedbf0283302e6b627be6bcf0ffb38), [`b785947`](https://github.com/Abdulmumin1/owostack/commit/b7859477f0eedbf0283302e6b627be6bcf0ffb38)]:
  - @owostack/types@0.2.0

## 0.1.4

### Patch Changes

- [`acf4de8`](https://github.com/Abdulmumin1/owostack/commit/acf4de8738bce69cb754970b599c2be66b916af7) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Add `entity()` builder for non-consumable features (seats, projects, workspaces)
  - New `entity(slug, opts?)` function — defines features managed via `.add()` / `.remove()` instead of `track()`
  - `EntityHandle` methods: `.add(customer, opts)`, `.remove(customer, entity)`, `.list(customer)`, `.check(customer)`
  - Defaults to `reset: "never"` — entity count reflects current state, not periodic usage
  - Sync payload now includes `meterType: "non_consumable"` for entity features
  - CLI (`owosk pull`) now generates `entity()` for non-consumable features
  - `/plans` API response now includes `meterType` on features

  ```ts
  import { entity, plan } from "owostack";

  const seats = entity("seats", { name: "Team Seats" });

  // In plan config
  seats.limit(5); // reset: "never" is implicit

  // At runtime
  await seats.add("org@acme.com", { entity: "user_123", name: "John" });
  await seats.remove("org@acme.com", "user_123");
  const { entities } = await seats.list("org@acme.com");
  ```

- Updated dependencies [[`acf4de8`](https://github.com/Abdulmumin1/owostack/commit/acf4de8738bce69cb754970b599c2be66b916af7)]:
  - @owostack/types@0.1.4

## 0.1.2

### Patch Changes

- [#39](https://github.com/Abdulmumin1/owostack/pull/39) [`7b270cc`](https://github.com/Abdulmumin1/owostack/commit/7b270cc5e9f1b3e36c6af76d97cf8ce2a4789a78) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Rename packages to unscoped (owostack, owosk) and migrate license to Apache-2.0.

- Updated dependencies [[`7b270cc`](https://github.com/Abdulmumin1/owostack/commit/7b270cc5e9f1b3e36c6af76d97cf8ce2a4789a78)]:
  - @owostack/types@0.1.2
