# Bachs Provider Adapter — Implementation Plan

> **Status: implemented** (`packages/adapters/src/bachs.ts`, registered in `apps/api/src/lib/providers.ts`).
> Everything in §1–§7 is done and covered by tests. §8 (sandbox verification) is still open:
> the webhook field mapping was built from Bachs' public docs/OpenAPI, not from live sandbox payloads.
> Before enabling Bachs for a live organization, run the §8 checks with a real sandbox key.

Target: add **Bachs** (https://bachs.io) as a fifth payment provider in Owostack, alongside
Paystack, Stripe, Dodo Payments and Polar. Scope: everything Owostack supports today —
one-time payments (credit packs), subscriptions (incl. trials, upgrades/downgrades, cancel),
usage/overage billing, refunds, customer portal, webhooks.

This file is written for an implementing agent. Read it top to bottom before touching code.
Read `packages/adapters/ADAPTER_SPEC.md` next; it is the authoritative adapter contract and
this plan only tells you how to fill it in for Bachs.

Repo conventions you must follow (from `/AGENTS.md` and `/apps/api/test/AGENTS.md`):

- Say "bismillah" before starting, "Alhamdulillah" when done, then give your report.
- Tests: **no mocking of app modules** (`vi.mock` is banned). Use `SequencedFetchTransport`
  (`apps/api/test/runtime/helpers/fetch-transport.ts`) for HTTP and the in-memory SQLite D1
  helpers for DB. Tests must reflect production behaviour.
- `@owostack/adapters` is in the changeset `ignore` list — **no changeset needed** for this work.
- Any new/changed OpenAPI route needs `pnpm docs:api:check`. This plan adds **no** routes.
- Package manager: `pnpm`. Node >= 22. Run tests with `pnpm --filter owostack-api test`.
- Do the work on a new branch off `main` (e.g. `feat/bachs-adapter`). Current checkout is on
  `fix/issue-187-credit-purchase-recovery`; do not build on it.

---

## 0. Bachs in 60 seconds (what you need to know about the API)

| Topic                        | Fact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL                     | sandbox `https://sandbox-api.bachs.io`, production `https://api.bachs.io`. Choose by `account.environment` (`test` → sandbox, `live` → production).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Auth                         | `Authorization: Bearer sk_sandbox_…` / `sk_live_…`. JSON bodies. Optional `Idempotency-Key` header on POST.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Money                        | **Decimal strings** at currency precision, e.g. `"29.00"`, `"75000.00"`. Never minor units. Owostack passes **integer minor units** (kobo/cents) everywhere → the adapter must convert both ways.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| IDs                          | prefixed: `cust_`, `prod_`, `sub_`, `chk_`, `inv_`, `ref_`/`rfnd_`, payments `pay_`/`ch_`/`chr_`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Errors                       | `{ "detail": string, "error_code": string, "doc_url"?: string, "errors"?: [{field,message,type}] }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Lists                        | `{ items, pagination }` with cursor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Products                     | `POST /v1/products` — `{ name, price: { currency, price_type:"fixed", amount }, billing_cycle?: { interval: day                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | week            | month                                                                                                                   | year, frequency }, trial_period?: { interval, frequency }, metadata? }`. A product **with** `billing_cycle`is recurring; **without** is one-time.`billing_cycle`is **immutable** after creation.`PATCH /v1/products/{id}`updates`name`, `metadata`, `price.amount`, `trial_period`. `POST /v1/products/{id}/archive`. Currencies enum: USD, NGN, GHS, KES, MWK, RWF, TZS, UGX, XAF, XOF, ZMW. |
| Customers                    | `POST /v1/customers` `{ email, name?, phone_number?, metadata? }` → `{ customer_id, email, name, … }`. `GET/PATCH /v1/customers/{id}`. `GET /v1/customers?search=email`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Checkout                     | `POST /v1/checkout-sessions` → `{ checkout_id, checkout_url, status, expires_at, reference }`. Body: `product_cart: [{ product_id, quantity, pricing?: {price_type, amount} }]` **or** `pricing: { currency, amount, price_type }` (product-less), `customer: { customer_id } \| { email, name }` (name **required** for new customer), `success_url`, `cancel_url`, `metadata` (≤20 keys), `payment_method_types?: ["card","crypto","bank_transfer","mobile_money"]`, `reference?` (≤128 chars), `expires_in_minutes?` (1–1440, default 60), `customer_creation?`. If a cart product has `billing_cycle`, the checkout becomes a **subscription checkout** automatically.                                          |
| Subscriptions                | **No create endpoint** — created by completing a recurring checkout. `GET /v1/subscriptions/{id}`; `PATCH /v1/subscriptions/{id}` with **exactly one** of `product_id` (+ `proration_behavior: invoice_now\|next_cycle\|none`), `trial_end`, `payment_method_id`, `metadata`; `DELETE /v1/subscriptions/{id}` body `{ cancel_at_period_end: boolean, reason? }`. Status enum: `trialing, active, past_due, unpaid, canceled, paused`. Fields: `id, customer{customer_id,…}, status, currency, amount, billing_cycle, current_period_start/end, next_billed_at, trial_end, cancel_at_period_end, canceled_at, created_at, product{ id }, items[], metadata`. **Subscriptions are USD card-only today** (Bachs docs). |
| Trials                       | Native: `trial_period` on the product; first charge deferred, card saved at checkout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Refunds                      | `POST /v1/refunds` `{ charge_id, reference (required, unique per org), amount?, reason?, idempotency_key? }` → `{ refund_id, status: processing\|success\|failed }`. Only **one** refund per charge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Off-session charge           | **Does not exist.** There is no "charge saved card" / payment-intent API. `chargeAuthorization` must return `unsupported`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Customer portal              | `POST /v1/customers/{customer_id}/portal-sessions` → `{ id, url }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Webhooks                     | Headers `X-Bachs-Timestamp` (unix seconds) and `X-Bachs-Signature` = HMAC-SHA256 hex of `` `${timestamp}.${rawBody}` ``. Reject if `                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | now - timestamp | > 300s`. Envelope `{ id: "evt\_…", type, created_at, organization_id, data }`. At-least-once delivery → dedupe on `id`. |
| Webhook events we care about | `checkout.completed`, `collection.succeeded`, `collection.failed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`, `refund.paid`, `refund.failed`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Docs index: https://docs.bachs.io/llms.txt · OpenAPI: https://docs.bachs.io/docs/openapi/openapi.json
(download it with curl and query with `jq` when you need an exact schema).

---

## 1. Files to touch (checklist)

Must-touch — the build/tests break or the feature is unreachable otherwise:

- [ ] `packages/adapters/src/bachs.ts` — **new** adapter (model on `polar.ts`: product-centric, native trials, checkout-based subscriptions).
- [ ] `packages/adapters/src/index.ts` (~line 347–352) — `export { bachsAdapter } from "./bachs";`
- [ ] `apps/api/src/lib/providers.ts` (`getProviderRegistry`, lines 24–31) — `registry.register(bachsAdapter);`
- [ ] `apps/api/src/lib/provider-validation.ts` — add `validateBachsCredentials()` + `case "bachs"` in `validateProviderCredentials()` (~line 489–507) and `providerLabel()` (~line 74–87). Without this the dashboard refuses to save a Bachs account.
- [ ] `apps/api/src/routes/dashboard/providers.ts` (~line 105) — add `bachs` to the `ENABLED_PROVIDERS` default string; also set the `ENABLED_PROVIDERS` secret/var in `apps/api/wrangler.jsonc` environments if it is defined there.
- [ ] `apps/dashboard/src/lib/providers.ts` — add a `SUPPORTED_PROVIDERS` entry (see §6).
- [ ] `apps/dashboard/static/images/bachs.png` — logo (grab from bachs.io; a simple placeholder PNG is acceptable if you cannot fetch one).
- [ ] `apps/api/test/runtime/adapters/registry-contract.test.ts` — `createBachsFixture()` and add `bachs:` to `adapterFixtures` (~line 2985). The lockstep test fails the moment you register the adapter without this.

Should-touch:

- [ ] `apps/api/src/lib/provider-minimums.ts` — `bachs: { NGN: 100000, USD: 100 }` (minor units; Bachs minimum is ₦1000 / $1). Also fix the latent key mismatch (`dodo` vs adapter id `dodopayments`) only if trivially safe; otherwise leave and mention in the report.
- [ ] `apps/api/src/lib/workflows/overage-billing.ts` (~line 1192–1198) — add `unsupported` to the "permanent" error regex so an `unsupported` chargeAuthorization does **not** burn three retries with 30s/60s sleeps.
- [ ] `apps/api/test/bachs.adapter.behaviour.test.ts` — **new**, mirrors `polar.adapter.behaviour.test.ts` / `paystack.adapter.behaviour.test.ts`.
- [ ] `apps/api/test/runtime/routes/dashboard-providers.validation.test.ts` (~line 15) — add `bachs` to the env list and one validation case.
- [ ] Docs: `apps/docs/content/docs/(core)/getting-started/providers.mdx` (supported-providers table + behaviour matrix), `README.md:23`, `packages/core/README.md:103`.

No DB schema changes. No webhook route changes (`POST /webhooks/{org}/bachs` already works for any registered adapter id).

---

## 2. Adapter design decisions (do not re-decide these)

| Adapter field          | Value                          | Why                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | `"bachs"`                      | Stored in `provider_accounts.provider_id`; webhook URL becomes `/webhooks/{org}/bachs`; default signature header becomes `x-bachs-signature` which matches Bachs — so **do not set** `signatureHeaderName`.             |
| `displayName`          | `"Bachs"`                      |                                                                                                                                                                                                                         |
| `supportsNativeTrials` | `true`                         | Bachs defers first charge via `trial_period`. This makes `trial-end.ts:632` and `plan-upgrade.ts:284` skip the auth-capture/refund flow and `createSubscription`.                                                       |
| `defaultCurrency`      | `"USD"`                        | Subscriptions are USD-only on Bachs.                                                                                                                                                                                    |
| Credentials            | `{ secretKey, webhookSecret }` | `secretKey` = `sk_sandbox_…`/`sk_live_…`. `webhookSecret` = endpoint signing secret from the Bachs Developer Portal. Both are auto-encrypted by `providerCredentialsNeedingDecrypt` in `apps/api/src/lib/providers.ts`. |

Money conversion helpers (put them in `bachs.ts`, unit-test them):

```ts
// Owostack minor units -> Bachs decimal string. All Bachs fiat currencies we enable are 2-decimal.
// Owostack stores every amount x100 regardless of ISO exponent, so ALWAYS divide by 100.
function toDecimalString(minor: number): string; // 2999 -> "29.99", 100 -> "1.00"
// Bachs decimal string -> Owostack minor units. Parse by splitting on ".", never via parseFloat*100.
function toMinorUnits(decimal: string | number | null | undefined): number; // "29.99" -> 2999, "75000" -> 7500000
```

Interval mapping (Owostack `plans.interval` text → Bachs `billing_cycle`). Copy the input set from
`mapInterval()` in `polar.ts:250` and produce `{ interval: "day"|"week"|"month"|"year", frequency }`
(`quarterly` → month/3, `biannually` → month/6, `monthly` → month/1, `yearly`/`annually` → year/1,
`weekly` → week/1, `daily` → day/1; default month/1).

Environment/base URL:

```ts
const baseUrl =
  account.environment === "live"
    ? "https://api.bachs.io"
    : "https://sandbox-api.bachs.io";
```

HTTP client: copy the `PolarClient`/`PaystackClient` pattern — private class, `request<T>()`, native
`fetch`, `AbortController` 10s timeout, `maxRetries = 2` with `2^attempt * 100ms` backoff on 5xx/network,
map non-2xx to `Result.err({ code: "request_failed", message: body.detail ?? statusText, providerId: "bachs", cause: body })`.
Do **not** retry 4xx. Send `Idempotency-Key` on `POST /v1/checkout-sessions` and `POST /v1/refunds`
when the caller gives a stable reference (`params.metadata?.invoice_id`, `params.reference`, etc.).

---

## 3. Method-by-method mapping

Implement every required method; implement the optional ones marked ✔. Return
`Result.err({ code: "configuration_missing" })` from a shared `resolveClient(account, environment)`
when `account.credentials.secretKey` is missing (see `paystack.ts:260–279`).

### 3.1 `createCheckoutSession(params)` — required

Inputs of note: `customer {id, email}`, `plan? {id}`, `amount` (minor), `currency`, `callbackUrl`,
`metadata`, `lineItems? [{priceId, quantity}]`, `trialDays?`, `onDemand?.mandateOnly`.

1. If `params.onDemand?.mandateOnly` → `Result.err({ code: "unsupported", message: "Bachs does not support mandate-only (card setup) checkout" })`. Same for `metadata.type === "card_setup"`.
2. Build `customer`: if `params.customer.id` looks like a Bachs id (`startsWith("cust_")`) → `{ customer_id }`; else `{ email, name: params.metadata?.customer_name ?? params.customer.email.split("@")[0] }` (Bachs requires `name` for a new customer). Prefer calling `createCustomer` up-front via the existing checkout flow; do not create customers inside this method.
3. Build the cart:
   - `plan?.id` present → `product_cart: [{ product_id: plan.id, quantity: 1 }]`. If `params.amount` differs from the plan price (Owostack prorated one-time checkouts do this) **and** the product is one-time, add `pricing: { price_type: "fixed", amount: toDecimalString(amount) }`. Never add a price override to a recurring product (it would become the subscription's price for life).
   - `lineItems` present → `product_cart: lineItems.map(li => ({ product_id: li.priceId, quantity: li.quantity }))` (Owostack stores the Bachs product id in both `providerProductId` and `providerPriceId`; see `createProduct`).
   - Neither → product-less: `pricing: { currency, amount: toDecimalString(amount), price_type: "fixed" }`.
4. `success_url = params.callbackUrl`, `cancel_url = params.callbackUrl` (Owostack has one URL), `metadata = coerceMetadata(params.metadata)` (stringify values; **cap to 20 keys** — Owostack sets ~13 keys at `checkout.ts:709–724`, so keep everything but drop `null`s), `reference = metadata.reference ?? undefined`.
5. Map `params.channels` (Paystack-style `card|bank|mobile_money|…`) → `payment_method_types` (`card`, `bank_transfer`, `mobile_money`, `crypto`); omit if empty/unknown.
6. `trialDays`: **ignore at checkout** — the trial lives on the product (`trial_period`). If `trialDays > 0` and the plan's product has no trial, log a warning; do not fail.
7. Return `{ url: checkout_url, reference: checkout_id, accessCode: null }`.

### 3.2 `createCustomer(params)` — required

`POST /v1/customers { email, name?, metadata }` → `{ id: customer_id, email, metadata }`.
On `409`/"already exists" style error, fall back to `GET /v1/customers?search=<email>` and return the first exact-email match.

### 3.3 `createPlan(params)` — required

`POST /v1/products { name, metadata: { description? }, price: { currency, price_type: "fixed", amount: toDecimalString(amount) }, billing_cycle: mapInterval(interval) }`
→ `{ id: product.id, metadata: { billing_cycle } }`.
Pre-validate: if `currency !== "USD"` return `Result.err({ code: "invalid_request", message: "Bachs subscriptions currently support USD only" })` — do not let this fail late at checkout.
Owostack has no trial on the plan create call; trials are set via `updatePlan`/checkout. Because `trialDays` cannot be attached at checkout on Bachs, **also** accept `params.description`-independent trial info if present in metadata later (see §8 open item).

### 3.4 `updatePlan(params)` — optional ✔

`PATCH /v1/products/{planId}` with only the provided fields: `name`, `price: { amount }`.
If `params.interval` is provided **and** differs from the current cadence: `billing_cycle` is immutable → create a **new** product (`createPlan` semantics) and return `{ updated: true, nextPlanId: newProduct.id }`; optionally archive the old product. Mirror how `stripe.ts` returns `nextPlanId`.

### 3.5 `createProduct(params)` — optional ✔ (credit packs / one-time)

`POST /v1/products { name, metadata, price: { currency, price_type: "fixed", amount } }` with **no** `billing_cycle`
→ `{ productId: id, priceId: id, metadata: {} }`.

### 3.6 `createSubscription(params)` — required (but Bachs has no direct create)

Mirror `polar.ts:1000–1029`: create a checkout session for `[{ product_id: params.plan.id }]` with
`customer: { customer_id }` and return `{ id: checkout_id, status: "pending", metadata: { checkout_url, ...params.metadata } }`.
Because `supportsNativeTrials: true`, the trial and upgrade workflows skip this method; it exists to satisfy the contract.

### 3.7 `cancelSubscription(params)` — required

`DELETE /v1/subscriptions/{subscription.id}` body `{ cancel_at_period_end: false, reason: "Canceled via Owostack" }` → `{ canceled: true }`.
Rationale: every caller (`plan-upgrade.ts:110`, `downgrade.ts:171`, `plan-switch.ts:1242`, `refund.ts:164`, `charge-success.ts:1388`, `dashboard/subscriptions.ts:666`) expects the provider to stop billing immediately and Owostack itself manages the access window; Polar's `revoke` does the same. If a `400` says already canceled, return `{ canceled: true }`.

### 3.8 `chargeAuthorization(params)` — required

Return `Result.err({ code: "unsupported", message: "Bachs has no off-session charge API; use a checkout session (invoice pay link) instead", providerId: "bachs" })`.
Consequences you must verify (see §7 tests):

- `routes/api/billing.ts:702` only calls it when `customer.providerAuthorizationCode` exists. For Bachs customers we never store one (no card token is exposed by webhooks), so the route already falls back to `createCheckoutSession` at `billing.ts:935`. Confirm.
- `workflows/overage-billing.ts:925–930` skips the charge when no `authCode` and leaves the invoice `open`. Confirm and add `unsupported` to the permanent-error regex (~line 1193–1196).
- `workflows/trial-end.ts:446` — not reached because `supportsNativeTrials: true`.

### 3.9 `changePlan(params)` — optional ✔

`PATCH /v1/subscriptions/{subscriptionId} { product_id: newPlanId, proration_behavior }` where
`prorated_immediately | difference_immediately → "invoice_now"`, `full_immediately → "invoice_now"`, undefined → `"invoice_now"`.
Return `{ changed: true }`. Note Bachs requires the target product to bill at the **same interval**; if it returns `400`, propagate `invalid_request` so `plan-switch.ts:604` falls back to its non-native path.

### 3.10 `refundCharge(params)` — optional ✔

`POST /v1/refunds { charge_id: params.reference, reference: "owo_" + crypto.randomUUID(), amount?: toDecimalString(amount), reason? }`
→ `{ refunded: true, reference: refund_id }`. `params.reference` is what we stored from `collection.succeeded`
(`payment_id ?? charge_id`) — make sure `parseWebhookEvent` puts that id in `payment.reference` (see 3.13).
Refund completion arrives later as `refund.paid`.

### 3.11 `fetchSubscription(params)` — required

`GET /v1/subscriptions/{subscriptionId}` →

```ts
{
  id, status: mapStatus(status),          // see 3.13 status table
  planCode: product?.id ?? items[0]?.price?.product_id ?? null,
  startDate: created_at, nextPaymentDate: next_billed_at,
  cancelToken: null,
  metadata: { current_period_end, cancel_at_period_end, trial_end, currency, amount },
}
```

### 3.12 `createCustomerSession(params)` — optional ✔

Require a Bachs customer id (`cust_…`), else `invalid_request` (same guard as Polar `polar.ts:885–896`).
`POST /v1/customers/{id}/portal-sessions` → `{ url, token: id }`.

### 3.13 `verifyWebhook(params)` — required

```
timestamp = headers["x-bachs-timestamp"]   // headers are passed lower-cased by routes/webhooks.ts:323
if missing or |now/1000 - Number(timestamp)| > 300  -> Result.ok(false)
expected = hex(HMAC_SHA256(secret, `${timestamp}.${payload}`))
return Result.ok(constantTimeEqual(expected, signature.trim().toLowerCase()))
```

Use WebCrypto (`crypto.subtle`) like `paystack.ts:478–503` — this runs on Cloudflare Workers, **no** `node:crypto`.
If `headers` is undefined → `Result.ok(false)` (Stripe-style: signature cannot be verified without the timestamp).

### 3.14 `parseWebhookEvent({ payload })` — required, synchronous

Validate the envelope: `payload.type` string and `payload.data` object, else `Result.err({ code: "invalid_payload" })`.
Always set `metadata.event_id = payload.id` and merge `data.metadata` (our checkout metadata round-trips there) into `event.metadata`.

| Bachs `type`                                                                                       | Normalized `type`                                                                                                                                                                                                                                                                                                                                                                                                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `collection.succeeded`                                                                             | `charge.success`                                                                                                                                                                                                                                                                                                                                                                                                                                 | `payment.reference = data.payment_id ?? data.charge_id ?? data.reference`; `payment.amount = toMinorUnits(data.amount)`; `payment.currency`; `customer = { id: data.customer.id ?? data.customer.customer_id, email }`; `checkout = { id: data.checkout_id }`; `subscription = data.subscription_id ? { id } : undefined`; `metadata.billing_reason = data.billing_reason`. Guard `charge_id` may be `null` (test tool). |
| `collection.failed`                                                                                | `charge.failed`                                                                                                                                                                                                                                                                                                                                                                                                                                  | same shape + `metadata.reason`.                                                                                                                                                                                                                                                                                                                                                                                          |
| `collection.underpaid`, `collection.abandoned`, `checkout.expired`                                 | `unknown_event` (skipped)                                                                                                                                                                                                                                                                                                                                                                                                                        |                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `checkout.completed`                                                                               | `unknown_event` **unless** `data.mode === "subscription"` and `data.payment_status === "no_payment_required"` → emit `subscription.created` with `subscription = { id: data.subscription.subscription_id, status: "trialing" }`, `customer`, `metadata` from `data.metadata`. Otherwise skip: the payment is reported by `collection.succeeded` and the subscription by `customer.subscription.created`; emitting here too would double-process. |
| `customer.subscription.created`                                                                    | `subscription.created`                                                                                                                                                                                                                                                                                                                                                                                                                           | `subscription = { id: data.subscription_id, status: mapStatus(data.status) }`, `plan = { id: data.product_id }`, `customer`, `metadata` (includes our checkout metadata).                                                                                                                                                                                                                                                |
| `customer.subscription.updated`                                                                    | by status: `canceled` → `subscription.canceled`; `cancel_at_period_end === true` → `subscription.not_renew`; `past_due`/`unpaid` → `subscription.past_due`; `active`/`trialing` → `subscription.active`; `paused` → `subscription.past_due`                                                                                                                                                                                                      | Mirror `polar.ts:1561–1580`.                                                                                                                                                                                                                                                                                                                                                                                             |
| `customer.subscription.deleted`                                                                    | `subscription.canceled`                                                                                                                                                                                                                                                                                                                                                                                                                          |                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `invoice.paid`                                                                                     | `unknown_event` (skipped)                                                                                                                                                                                                                                                                                                                                                                                                                        | Renewal money is already reported by `collection.succeeded`. **Verify in sandbox** (§8) that renewals do emit `collection.succeeded` with `subscription_id`; if they do not, switch this row to `charge.success` with `payment.reference = data.charge?.payment_id ?? data.invoice_id`.                                                                                                                                  |
| `invoice.payment_failed`                                                                           | `charge.failed`                                                                                                                                                                                                                                                                                                                                                                                                                                  | `subscription = { id: data.subscription.subscription_id }`, amount from `data.total`. Paystack maps the same event this way (`paystack.ts:544–705`).                                                                                                                                                                                                                                                                     |
| `refund.paid`                                                                                      | `refund.success`                                                                                                                                                                                                                                                                                                                                                                                                                                 | `refund = { id: refund_id, reference: charge_id, amount: toMinorUnits(refunded_amount ?? requested_amount) }`.                                                                                                                                                                                                                                                                                                           |
| `refund.failed`                                                                                    | `refund.failed`                                                                                                                                                                                                                                                                                                                                                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `refund.created`, `customer.*`, `payout.*`, `dispute.*`, `conversion.*`, `account.*`, `transfer.*` | `unknown_event`                                                                                                                                                                                                                                                                                                                                                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                                          |

`mapStatus`: `active → active`, `trialing → trialing`, `past_due → past_due`, `unpaid → past_due`,
`paused → past_due`, `canceled → canceled`. Check `ProviderSubscriptionDetail.status` and the handlers
in `apps/api/src/lib/webhooks/handlers/subscription-status.ts` for the accepted strings before finalizing.

---

## 4. Credential validation (`apps/api/src/lib/provider-validation.ts`)

```ts
async function validateBachsCredentials(creds, environment, fetchImpl) {
  // 1. shape: secretKey required, webhookSecret required (Bachs always signs)
  // 2. prefix/environment cross-check:
  //    environment === "live"  && !secretKey.startsWith("sk_live_")    -> error "Live accounts need an sk_live_ key"
  //    environment === "test"  && !secretKey.startsWith("sk_sandbox_") -> error "Test accounts need an sk_sandbox_ key"
  // 3. live call: GET {baseUrl}/v1/products?limit=1 with Bearer; 401/403 -> "Invalid Bachs API key or missing products:read scope"
}
```

Follow the exact return shape used by `validatePolarCredentials` (~line 423). Add `case "bachs": return "Bachs";` to `providerLabel()`.

---

## 5. Registration & enablement

- `packages/adapters/src/index.ts`: `export { bachsAdapter } from "./bachs";`
- `apps/api/src/lib/providers.ts`: import + `registry.register(bachsAdapter);`
- `apps/api/src/routes/dashboard/providers.ts:105`: default → `"paystack,stripe,dodopayments,polar,bachs"` (check whether `polar` is already there; keep existing order).
- `apps/api/wrangler.jsonc`: if `ENABLED_PROVIDERS` is a `vars` entry per environment, add `bachs`. If it is a secret, note in the report that the operator must update it.

---

## 6. Dashboard entry (`apps/dashboard/src/lib/providers.ts`)

```ts
{
  id: "bachs",
  name: "Bachs",
  description: "Cards, mobile money, bank transfer and stablecoins for African internet businesses",
  color: "emerald",            // pick an unused color from the existing entries
  logoUrl: "/images/bachs.png",
  docsUrl: "https://docs.bachs.io/authentication",
  fields: [
    { key: "secretKey",     label: "Secret Key",             placeholder: "sk_sandbox_xxxxxxxx or sk_live_xxxxxxxx", secret: true },
    { key: "webhookSecret", label: "Webhook Signing Secret", placeholder: "from Developer Portal → Webhooks",         secret: true },
  ],
  supportedCurrencies: ["USD", "NGN", "GHS", "KES"],  // one-time; subscriptions are USD-only (say so in the description or a hint if the component supports one)
}
```

Do not change the hardcoded `"paystack"` defaults in onboarding/ProviderForm components.

---

## 7. Tests (no mocks; use existing harnesses)

1. **Contract fixture** — `apps/api/test/runtime/adapters/registry-contract.test.ts`
   Add `createBachsFixture()` modeled on `createPolarFixture()`:
   - `buildAccount()` with `credentials: { secretKey: "sk_sandbox_contract", webhookSecret: "whsec_contract" }`.
   - `webhook`: build `payload` (a `collection.succeeded` event), `secret`, `headers: { "x-bachs-timestamp": String(Math.floor(Date.now()/1000)) }`, `signature = hexHmacSha256(secret, `${ts}.${payload}`)`, `tamperedPayload = payload + " "`.
     There are helpers for hex HMAC at ~line 160–200 (`signHexHmac`); reuse them.
   - `parseCases` for every row in the §3.14 table (at least: collection.succeeded, collection.failed, customer.subscription.created, customer.subscription.updated with `cancel_at_period_end: true`, customer.subscription.deleted, invoice.payment_failed, refund.paid, checkout.completed trial start, and one `unknown_event`).
   - `scenarios` for **all 7 required** methods and for **every optional method you implement** (`createProduct`, `updatePlan`, `changePlan`, `refundCharge`, `createCustomerSession`). The suite asserts optional scenarios exist iff the method is implemented (~line 3078–3100). Each scenario enqueues `SequencedFetchTransport` expectations asserting method, origin (`https://sandbox-api.bachs.io`), path, Bearer header and JSON body (use `expectJsonRequest`, and assert amounts are decimal strings like `"29.99"`).
   - `chargeAuthorization` scenario: assert `Result.err` with `code === "unsupported"` and **zero** fetch calls.
2. **Behaviour test** — `apps/api/test/bachs.adapter.behaviour.test.ts`
   - `toDecimalString` / `toMinorUnits` round-trips incl. `"75000"`, `"0.10"`, `"29.99"`, `1` → `"0.01"`.
   - Signature verification: valid; wrong secret; stale timestamp (now − 301s) → false; missing timestamp header → false.
   - `createCheckoutSession`: plan vs lineItems vs product-less body shapes; metadata capped at 20 keys; `mandateOnly` → `unsupported`; `payment_method_types` mapping.
   - `updatePlan` with interval change returns `nextPlanId` and issues `POST /v1/products` (new product).
3. **Webhook runtime** — `apps/api/test/runtime/webhooks/` add one test that POSTs a signed `collection.succeeded` to `/webhooks/{org}/bachs` using the route harness + in-memory D1 seeded with a `provider_accounts` row (`providerId: "bachs"`), and asserts the customer/subscription rows the `charge-success` handler writes. Copy the structure of an existing provider webhook route test.
4. **Dashboard validation** — extend `test/runtime/routes/dashboard-providers.validation.test.ts`: `bachs` in `ENABLED_PROVIDERS`; `sk_live_` key on a `test` account is rejected; a 200 from `GET /v1/products` accepts.
5. **Overage fallback** — in the existing overage/billing runtime tests, add a case with a Bachs customer with no saved payment method: invoice stays `open`, no charge attempted, `POST /billing/invoice/:id/pay` returns a checkout URL from `POST /v1/checkout-sessions`.

Run: `pnpm --filter owostack-api test` (all), or `pnpm --filter owostack-api test:runtime:adapters` while iterating. Also `pnpm --filter @owostack/adapters build` and `pnpm typecheck` if the script exists (check root `package.json`).

---

## 8. Open items to verify against the real sandbox (do these first if you have a key; otherwise implement per this plan and list them in the report)

You need a Bachs sandbox account (free at signup) → Developer Portal → API key with scopes
`products:*`, `customers:*`, `payments:*`, `refunds:write`, `subscriptions:*`; and a webhook endpoint
pointed at `https://<your-dev-tunnel>/webhooks/<org>/bachs` (Bachs also has a "Local Testing" tool).

1. **Renewal events**: complete a recurring checkout in sandbox and inspect Developer Portal → Events. Confirm that (a) `collection.succeeded` fires for the first cycle with `subscription_id`/`billing_reason` present and (b) whether renewals emit `collection.succeeded` too. Adjust the `invoice.paid` row in §3.14 accordingly.
2. **Metadata propagation**: confirm checkout `metadata` appears on `collection.succeeded.data.metadata` **and** `customer.subscription.created.data.metadata` (docs say yes). Owostack's handlers depend on `organization_id`, `plan_id`, `customer_id`, `environment`, `provider_id` being there.
3. **Payment id field**: docs are mid-migration (`charge_id` → `payment_id`). Read both; store whichever is non-null. Confirm which one `POST /v1/refunds.charge_id` accepts.
4. **Subscription checkout with existing `customer_id`** works and does not require `name`.
5. **Trial on product**: confirm `PATCH /v1/products/{id}` accepts `trial_period` so Owostack plan trials (`plans.trialDays`, if it exists on the plan) can be pushed at plan-sync time; if Owostack has no per-plan trial field, document that Bachs trials must be configured on the product and Owostack's `trialDays` at checkout is ignored for Bachs.
6. **Zero-decimal currencies** (RWF, UGX, XAF, XOF): not enabled in this iteration; keep them out of `supportedCurrencies`.

---

## 9. Order of work (suggested, ~1 day)

1. bismillah. New branch. Read `ADAPTER_SPEC.md`, skim `polar.ts` fully, skim `paystack.ts` `verifyWebhook`.
2. Write `bachs.ts`: client → money/interval helpers → `verifyWebhook` → `parseWebhookEvent` → remaining methods.
3. Export + register + validation + dashboard + minimums + ENABLED_PROVIDERS.
4. `createBachsFixture()`; run `test:runtime:adapters` until green.
5. Behaviour test, webhook runtime test, dashboard validation test, overage fallback test.
6. Overage regex tweak. Docs (providers.mdx table/matrix, READMEs).
7. Full `pnpm --filter owostack-api test`, build adapters package, `pnpm docs:api:check` (should be a no-op).
8. Alhamdulillah. Report: what was built, which §8 items were verified vs assumed, anything the operator must do (set `ENABLED_PROVIDERS`, add logo, configure Bachs webhook endpoint with the events listed in §0).
