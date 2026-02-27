# Owostack

> Billing infrastructure for AI SaaS. 3 API calls. Zero webhooks.

**Stack**: Cloudflare + SvelteKit

## What is Owostack?

Owostack is a developer-friendly billing infrastructure that lets you implement subscriptions, usage-based billing, and feature gating with just **3 API calls** and **zero webhook code**.

Owostack supports multiple payment gateways while providing first-class features for:

- 🚀 **Usage Metering** (track tokens, API calls, seats)
- 🏦 **Flexible Resets** (hourly, daily, monthly quotas)
- 📱 **Credit Systems** (shared balances across features)
- 💰 **Multi-provider** (Paystack, Dodo Payments, Polar)
- ⚡ **Edge-native** (Cloudflare Workers for global speed)

## Quick Start

```bash
# Install SDK
pnpm add @owostack/core
```

```typescript
// Initialize
import { Owostack } from "@owostack/core";

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
│   ├── core/          # Core TypeScript SDK
│   ├── svelte/        # Svelte stores & components
│   ├── react/         # React hooks & components
│   └── types/         # Shared TypeScript types
├── apps/
│   ├── api/           # Cloudflare Workers API
│   ├── dashboard/     # SvelteKit dashboard
│   └── docs/          # Documentation site
└── examples/
    ├── sveltekit-saas/
    ├── ai-api-metering/
    └── mobile-money-checkout/
```

## Development

```bash
# Install dependencies
pnpm install

# Run all apps in dev mode
pnpm dev

# Build all packages
pnpm build

# Deploy to Cloudflare
pnpm deploy
```

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

MIT

---

**Built with ❤️ for African developers**
