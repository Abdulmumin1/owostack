# Owostack

> Paystack made delightful. 3 API calls. Zero webhooks.

**Stack**: Cloudflare + SvelteKit

## What is Owostack?

Owostack is a developer-friendly wrapper for Paystack that lets you implement subscriptions, usage-based billing, and feature gating with just **3 API calls** and **zero webhook code**.

Inspired by [Autumn](https://useautumn.com) (for Stripe), but built for African markets with first-class support for:

- 🚀 **Mobile Money** (M-Pesa, MTN, Airtel)
- 🏦 **Virtual Bank Accounts** (automatic per-customer accounts)
- 📱 **USSD Payments** (feature phone support)
- 💰 **Multi-currency** (NGN, GHS, ZAR, KES)
- ⚡ **Edge-native** (Cloudflare Workers for global speed)

## Quick Start

```bash
# Install SDK
pnpm add @owostack/core

# Initialize
import { Owostack } from '@owostack/core';

const owo = new Owostack({
  secretKey: process.env.PAYSTACK_SECRET_KEY
});

// 1. Checkout (attach)
const { url } = await owo.attach({
  customer: 'customer@example.com',
  product: 'pro_plan'
});

// 2. Check access (check)
const access = await owo.check({
  customer: 'customer@example.com',
  feature: 'api_calls'
});

// 3. Track usage (track)
await owo.track({
  customer: 'customer@example.com',
  feature: 'api_calls',
  amount: 1
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

## License

MIT

---

**Built with ❤️ for African developers**
