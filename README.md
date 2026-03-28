# Owostack

> Billing engine for AI SaaS.

\> Yes, the infra is built entirely on the cloudflare stack. heavy use of DO and Workflows.

\> Yes, self hosting is pretty much easy and would run work perfectly with free workers plan.

\> optional events log uses cf data platform or analytics engine. (use AE if you're smol)

\> yes u can use /check as middleware, and maybe a smol cache on ur end. (the endpoint is average 175ms response time)

\> No, tests are not 100% of core data paths yet.

## What is Owostack?

Owostack is a developer-friendly billing engine that lets you implement subscriptions, usage-based billing, and feature gating.

Owostack supports multiple payment gateways while providing first-class features for:

- **Usage Metering** (track tokens, API calls, seats)
- **Flexible Resets** (minutes, hourly, daily, monthly quotas, yearly, custom)
- **Credit Systems** (shared balances across features)
- **Add-on** (purchased against credit systems, or could be plan based addons)
- **Multi-provider** payment provider is abstracted into an adapter mechanism. (currently implemented - Paystack,  Stripe & Dodo Payments)

## Quick Start

```bash
# Install SDK
bun add owostack
```

### 1. Define your features
Create a config file (e.g. `owo.config.ts`) or run `bunx owosk init`.
define your features using metered(), boolean(), and entity():

```ts
import { metered, boolean, entity } from "owostack";
apiCalls = metered("api-calls", { name: "API Calls" });
analytics = boolean("analytics", { name: "Analytics Dashboard" });
seats = entity("seats", { name: "Team Seats" });
````

### 2. Define your plans.

Define plans and configure features.

```ts
export default new Owostack({
  secretKey: process.env.OWOSTACK_SECRET_KEY!,
  catalog: [
    plan("starter", {
      name: "Starter",
      price: 0,
      currency: "NGN",
      interval: "monthly",
      autoEnable:true,
      features: [
        apiCalls.limit(1000),
        analytics.off(),
        seats.limit(3),
      ],
    }),
    plan("pro", {
      name: "Pro",
      price: 500000,
      currency: "NGN",
      interval: "monthly",
      features: [
        apiCalls.limit(50000, { overage: "charge", overagePrice: 100 }),
        analytics.on(),
        seats.limit(20),
      ],
    }),
    plan("enterprise", {
      name: "Enterprise",
      price: 2000000,
      currency: "NGN",
      interval: "monthly",
      features: [apiCalls.unlimited(), analytics.on(), seats.unlimited()],
    }),
  ],
});
```

### 3. Sync to the API
Using the CLI

```bash
npx owosk sync --config ./owo.config.ts
```

### 4. Runtime primitives.
This are the calls that would be sprinkled all over ur codebase.

```ts
// 1. Checkout (attach)
const { url } = await owo.attach({
  customer: "user_123",
  product: "pro_plan",
});

// 2. Check access (check)
const { allowed } = await owo.check({
  customer: "user_123",
  feature: "api_calls",
});

// 3. Track usage (track)
await owo.track({
  customer: "user_123",
  feature: "api_calls",
  value: 1,
});
```

That's it. No webhooks (yet), no state syncing, no custom billig logic.

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

## Credits

This entire project might not directly be a fork of [autumnpricing](https://github.com/useautumn/autumn), but has heavily taken concepts from their implementation. even UX of the dashboard.

Thanks Autumn!

[autumpricing](https://useautumn.com)
[autumpricing github](https://github.com/useautumn/autumn)
[autumpricing dashboard](https://app.useautumn.com)
[autumpricing docs](https://docs.useautumn.com)

[owostack blog](https://owostack.com)
[owostack dashboard](https://app.owostack.com)
[owostack docs](https://docs.owostack.com)
