# owostack

Core SDK for the Owostack billing infrastructure. Build a working billing flow for your AI SaaS or platform in minutes.

## Installation

```bash
npm install owostack
```

## Quickstart

Initialize the SDK with your API key from the Owostack dashboard:

```ts
import { Owostack } from "owostack";

const owo = new Owostack({
  secretKey: process.env.OWOSTACK_SECRET_KEY,
  mode: "sandbox", // use "live" for production
});
```

### 1. Attach a customer to a plan

Create a checkout session or manage an existing subscription:

```ts
const attach = await owo.attach({
  customer: "user_123",
  product: "starter_plan",
  customerData: { email: "user@example.com" },
});

if (attach.checkoutUrl) {
  // Redirect your user to checkout
  window.location.href = attach.checkoutUrl;
}
```

### 2. Check feature access

Verify if a customer has access to a feature based on their plan:

```ts
const access = await owo.check({
  customer: "user_123",
  feature: "api-calls",
});

if (access.allowed) {
  // Allow request
}
```

### 3. Track usage

Record usage for metered features:

```ts
await owo.track({
  customer: "user_123",
  feature: "api-calls",
  value: 1,
});
```

## Features

- **Feature Gating**: Instant access control for boolean and metered features.
- **Usage Metering**: Record usage and enforce limits automatically.
- **Checkout Flows**: Generate checkout sessions for new subscriptions or plan upgrades.
- **Catalog Synchronization**: Define plans and features declaratively in your codebase and sync to the cloud.
- **Multi-Provider Support**: Built-in support for Paystack and Dodo Payments.
- **Full TypeScript Support**: Comprehensive type definitions for all methods and responses.

## Related Packages

- [owosk](https://www.npmjs.com/package/owosk) - CLI for catalog sync and project initialization.
- [@owostack/types](https://www.npmjs.com/package/@owostack/types) - Shared type definitions.

## Documentation

For full documentation and guides, visit [docs.owostack.com](https://docs.owostack.com).

## License

Apache-2.0
