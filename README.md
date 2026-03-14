# Owostack

> Billing infrastructure for AI SaaS. 3 API calls. Zero webhooks.

**Stack**: Cloudflare + SvelteKit

## What is Owostack?

Owostack is a developer-friendly billing infrastructure that lets you implement subscriptions, usage-based billing, and feature gating with just **3 API calls** and **zero webhook code**.

Owostack supports multiple payment gateways while providing first-class features for:

- **Usage Metering** (track tokens, API calls, seats)
- **Flexible Resets** (hourly, daily, monthly quotas)
- **Credit Systems** (shared balances across features)
- **Multi-provider** (Paystack, Dodo Payments, Polar)
- **Edge-native** (Cloudflare Workers for global speed)

## Quick Start

```bash
# Install SDK
pnpm add owostack
```

```typescript
// Initialize
import { Owostack } from "owostack";

const owo = new Owostack({
  secretKey: process.env.OWOSTACK_SECRET_KEY,
});

// 1. Checkout (attach)
const { url } = await owo.attach({
  customer: "customer@example.com",
  product: "pro_plan",
});

// 2. Check access (check)
const { allowed } = await owo.check({
  customer: "customer@example.com",
  feature: "api_calls",
});

// 3. Track usage (track)
await owo.track({
  customer: "customer@example.com",
  feature: "api_calls",
  value: 1,
});
```

That's it. No webhooks, no state syncing, no billing logic.

## Monorepo Structure

```
owostack/
├── packages/
│   ├── core/          # Public TypeScript SDK (`owostack`)
│   ├── cli/           # CLI (`owosk`)
│   ├── types/         # Shared public types
│   ├── svelte/        # Svelte bindings (currently internal/private)
│   ├── adapters/      # Provider adapter layer
│   ├── analytics/     # Analytics abstraction
│   └── db/            # Database schema and utilities
├── apps/
│   ├── api/           # Cloudflare Workers API
│   ├── dashboard/     # SvelteKit dashboard
│   ├── docs/          # Documentation site
│   ├── marketing/     # Marketing site
│   └── demo-app/      # Local SDK demo app
```

## Development

```bash
# Install dependencies
pnpm install

# Build the workspace
pnpm build

# Run focused apps
pnpm api:dev
pnpm docs:dev
pnpm --filter owostack-dashboard dev
pnpm --filter owostack-marketing dev
```

## Repository Status

This is an active monorepo. Some packages are intended for public consumption (`owostack`, `owosk`, `@owostack/types`) while others are internal implementation packages that support the API, dashboard, and docs.

## Optional: Cloudflare Analytics Engine

`apps/api` now writes lightweight request and billing analytics to Workers Analytics Engine when an `ANALYTICS` dataset binding is present.

- Local/dev dataset: `owostack_api_dev`
- Test dataset: `owostack_api_test`
- Live dataset: `owostack_api_live`

You can query it with Cloudflare SQL API for latency trends, cache hit rates, and invoice flow outcomes without growing D1 with extra telemetry rows.

Dashboard Events now read from Analytics Engine (instead of D1) and require:

- `CF_ACCOUNT_ID`
- `CF_ANALYTICS_READ_TOKEN` (Cloudflare API token with `Analytics:Read`)

## Usage Ledger (Durable Object SQLite)

High-volume usage metering now supports a per-organization Durable Object SQLite ledger (`USAGE_LEDGER`) for track/check/invoice paths.

- Durable Object class: `UsageLedgerDO`
- Binding: `USAGE_LEDGER`
- Wrangler migration tag: `v2`

This reduces reliance on D1 `usage_records` for overage and invoice-critical calculations while keeping fallback compatibility.

## License

Apache-2.0
