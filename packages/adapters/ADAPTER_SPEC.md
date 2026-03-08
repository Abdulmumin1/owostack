# Payment Provider Adapter Specification

This document describes how to build a new payment provider adapter for Owostack. An adapter translates Owostack's normalized interface into provider-specific API calls.

## Architecture Overview

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Owostack   │────▶│ ProviderAdapter  │────▶│  Provider API    │
│  API/SDK    │     │  (your adapter)  │     │  (Stripe, etc.)  │
│             │◀────│                  │◀────│                  │
└─────────────┘     └──────────────────┘     └──────────────────┘
```

**Key files to touch when adding a new adapter:**

| File                                  | Purpose                                            |
| ------------------------------------- | -------------------------------------------------- |
| `packages/adapters/src/<provider>.ts` | Adapter implementation (create this)               |
| `packages/adapters/src/index.ts`      | Export your adapter                                |
| `apps/api/src/lib/providers.ts`       | Register adapter in the provider registry          |
| `apps/dashboard/src/lib/providers.ts` | Dashboard UI config (credentials form, currencies) |

## Step 1: Create the Provider Client

The client wraps raw HTTP calls to the provider's API. Follow this pattern:

```ts
// packages/adapters/src/<provider>.ts
import { Result } from "better-result";
import type {
  CheckoutSession,
  NormalizedWebhookEvent,
  ProviderAccount,
  ProviderAdapter,
  ProviderCustomerRef,
  ProviderPlanRef,
  ProviderProductRef,
  ProviderResult,
  ProviderSubscriptionDetail,
  ProviderSubscriptionRef,
} from "./index";

class MyProviderClient {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(config: {
    apiKey: string;
    baseUrl: string;
    timeout?: number;
    maxRetries?: number;
  }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout ?? 10000;
    this.maxRetries = config.maxRetries ?? 2;
  }

  // All API methods should return ProviderResult<T>
  private async request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<ProviderResult<T>> {
    return Result.tryPromise({
      try: async () => {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(
              () => controller.abort(),
              this.timeout,
            );

            const response = await fetch(`${this.baseUrl}${path}`, {
              method,
              headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
              },
              body: body ? JSON.stringify(body) : undefined,
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              const errorBody = await response.text();
              throw new Error(`${response.status}: ${errorBody}`);
            }

            const text = await response.text();
            if (!text) return {} as T;
            return JSON.parse(text) as T;
          } catch (error) {
            lastError = error as Error;
            if (attempt < this.maxRetries) {
              await new Promise((r) =>
                setTimeout(r, Math.pow(2, attempt) * 100),
              );
            }
          }
        }

        throw lastError || new Error("Request failed after retries");
      },
      catch: (error) => ({
        code: "request_failed" as const,
        message: error instanceof Error ? error.message : String(error),
        providerId: "my_provider",
        cause: error,
      }),
    });
  }

  // Add typed methods for each API endpoint your adapter needs:
  // createCheckout(...), createCustomer(...), createPlan(...), etc.
}
```

### Client helper: resolveClient

Each adapter needs a helper to extract credentials from the `ProviderAccount` and instantiate the client:

```ts
function resolveClient(
  account: ProviderAccount,
): ProviderResult<MyProviderClient> {
  const secretKey = account.credentials.secretKey;
  if (typeof secretKey !== "string" || !secretKey) {
    return Result.err({
      code: "configuration_missing",
      message: "Provider secret key missing",
      providerId: "my_provider",
    });
  }

  // If your provider has test/live base URLs, select based on environment:
  const baseUrl =
    account.environment === "live"
      ? "https://api.myprovider.com"
      : "https://sandbox.myprovider.com";

  return Result.ok(new MyProviderClient({ apiKey: secretKey, baseUrl }));
}
```

## Step 2: Implement the ProviderAdapter

The adapter object satisfies the `ProviderAdapter` interface. Methods marked with `?` are optional.

```ts
export const myProviderAdapter: ProviderAdapter = {
  // =========================================================================
  // Identity & Configuration
  // =========================================================================
  id: "my_provider",                    // Unique provider ID (stored in DB)
  displayName: "My Provider",           // Human-readable name
  signatureHeaderName: "x-my-signature", // HTTP header containing webhook signature
  supportsNativeTrials: false,          // true if provider handles trial periods natively
  defaultCurrency: "USD",              // Primary currency for this provider

  // =========================================================================
  // Required Methods
  // =========================================================================

  // --- Checkout ---
  async createCheckoutSession(params) { ... },

  // --- Customers ---
  async createCustomer(params) { ... },

  // --- Plans (recurring products) ---
  async createPlan(params) { ... },

  // --- Subscriptions ---
  async createSubscription(params) { ... },
  async cancelSubscription(params) { ... },
  async fetchSubscription(params) { ... },

  // --- Charges ---
  async chargeAuthorization(params) { ... },

  // --- Webhooks ---
  async verifyWebhook(params) { ... },
  parseWebhookEvent(params) { ... },      // Synchronous — returns ProviderResult, not Promise

  // =========================================================================
  // Optional Methods
  // =========================================================================

  // async createProduct(params) { ... },   // One-time products (credit packs)
  // async updatePlan(params) { ... },      // Update plan price/name on provider
  // async changePlan(params) { ... },      // Swap subscription to different plan
  // async refundCharge(params) { ... },    // Refund a charge
};
```

## Step 3: Method Signatures & Return Types

### Required Methods

#### `createCheckoutSession`

Creates a payment/subscription checkout URL.

```ts
async createCheckoutSession(params: {
  customer: ProviderCustomerRef;          // { id, email }
  plan?: ProviderPlanRef | null;          // { id } — the provider plan ID
  amount: number;                         // Amount in smallest currency unit (e.g. kobo, cents)
  currency: string;                       // ISO currency code
  callbackUrl?: string;                   // Where to redirect after checkout
  metadata?: Record<string, unknown>;
  channels?: string[];                    // Payment channels (provider-specific)
  lineItems?: CheckoutLineItem[];         // For providers with cart-based checkout
  trialDays?: number;                     // Only if supportsNativeTrials = true
  onDemand?: { mandateOnly: boolean };    // For card-on-file / mandate setup
  environment: ProviderEnvironment;
  account: ProviderAccount;
}): Promise<ProviderResult<CheckoutSession>>
// Returns: { url: string; reference: string; accessCode?: string | null }
```

#### `createCustomer`

Creates a customer record on the provider.

```ts
async createCustomer(params: {
  email: string;
  name?: string | null;
  metadata?: Record<string, unknown>;
  environment: ProviderEnvironment;
  account: ProviderAccount;
}): Promise<ProviderResult<ProviderCustomerRef>>
// Returns: { id: string; email: string; metadata?: Record<string, unknown> }
```

#### `createPlan`

Creates a recurring subscription plan/product.

```ts
async createPlan(params: {
  name: string;
  amount: number;
  interval: string;           // "monthly" | "yearly" | "quarterly" | "weekly" | "annually"
  currency: string;
  description?: string | null;
  environment: ProviderEnvironment;
  account: ProviderAccount;
}): Promise<ProviderResult<ProviderPlanRef>>
// Returns: { id: string; metadata?: Record<string, unknown> }
// The `id` is stored as `providerPlanId` in the plans table.
```

#### `createSubscription`

Creates a subscription for a customer on a plan.

```ts
async createSubscription(params: {
  customer: ProviderCustomerRef;
  plan: ProviderPlanRef;
  authorizationCode?: string | null;   // Saved card/payment method token
  startDate?: string;                  // ISO date for delayed start
  environment: ProviderEnvironment;
  account: ProviderAccount;
  metadata?: Record<string, unknown>;
}): Promise<ProviderResult<ProviderSubscriptionRef>>
// Returns: { id: string; status: string; metadata?: Record<string, unknown> }
```

#### `cancelSubscription`

```ts
async cancelSubscription(params: {
  subscription: ProviderSubscriptionRef;  // { id, status }
  environment: ProviderEnvironment;
  account: ProviderAccount;
}): Promise<ProviderResult<{ canceled: boolean }>>
```

#### `fetchSubscription`

```ts
async fetchSubscription(params: {
  subscriptionId: string;
  environment: ProviderEnvironment;
  account: ProviderAccount;
}): Promise<ProviderResult<ProviderSubscriptionDetail>>
// Returns: { id, status, planCode?, startDate?, nextPaymentDate?, cancelToken?, metadata? }
```

#### `chargeAuthorization`

Charges a saved payment method (card on file).

```ts
async chargeAuthorization(params: {
  customer: ProviderCustomerRef;
  authorizationCode: string;          // The saved payment method token
  amount: number;
  currency: string;
  reference?: string;
  metadata?: Record<string, unknown>;
  environment: ProviderEnvironment;
  account: ProviderAccount;
}): Promise<ProviderResult<{ reference: string }>>
```

#### `verifyWebhook`

Verifies the webhook signature. Must be async (may use crypto.subtle).

```ts
async verifyWebhook(params: {
  signature: string;                  // Value from the signature header
  payload: string;                    // Raw request body
  secret: string;                     // Webhook signing secret
  headers?: Record<string, string>;   // All request headers (for multi-header schemes)
}): Promise<ProviderResult<boolean>>
```

#### `parseWebhookEvent`

Parses a raw webhook payload into a `NormalizedWebhookEvent`. **Synchronous** (returns `ProviderResult`, not a `Promise`).

```ts
parseWebhookEvent(params: {
  payload: Record<string, unknown>;    // Parsed JSON body
}): ProviderResult<NormalizedWebhookEvent>
```

### Webhook Event Mapping

Your adapter must map the provider's event types to these normalized types:

| Normalized Type          | When to emit                              |
| ------------------------ | ----------------------------------------- |
| `subscription.created`   | Subscription created (not yet active)     |
| `subscription.active`    | Subscription activated / renewed          |
| `subscription.canceled`  | Subscription canceled / expired           |
| `subscription.not_renew` | Subscription won't renew at end of period |
| `subscription.past_due`  | Payment failed, subscription at risk      |
| `charge.success`         | Payment succeeded                         |
| `charge.failed`          | Payment failed                            |
| `refund.success`         | Refund processed                          |
| `refund.failed`          | Refund failed                             |
| `customer.identified`    | Customer identity verified (optional)     |

### NormalizedWebhookEvent Structure

```ts
{
  type: WebhookEventType;
  provider: "my_provider";              // Your adapter's id
  customer: {
    email: string;
    providerCustomerId: string;         // Provider's customer ID
  };
  subscription?: {
    providerCode: string;               // Provider's subscription ID/code
    providerSubscriptionId?: string;
    status: string;
    planCode?: string;                  // Provider's plan ID
    startDate?: string;
    nextPaymentDate?: string;
  };
  payment?: {
    amount: number;
    currency: string;
    reference: string;                  // Provider's transaction reference
    paidAt?: string;
  };
  authorization?: {                     // Card/payment method details
    code: string;                       // Reusable token for chargeAuthorization
    reusable: boolean;
    cardType?: string;
    last4?: string;
    expMonth?: string;
    expYear?: string;
  };
  plan?: {
    providerPlanCode: string;
  };
  refund?: {
    amount: number;
    currency: string;
    reference: string;
    reason?: string;
  };
  metadata: Record<string, unknown>;    // Metadata from the original request
  raw: Record<string, unknown>;         // Full raw payload for debugging
}
```

### Optional Methods

#### `updatePlan?`

Updates an existing plan's price/name/interval on the provider. Routes send **full plan values** (not just changed fields), so you can always build a complete API request.

```ts
async updatePlan(params: {
  planId: string;           // Provider's plan ID
  name?: string;
  amount?: number;
  interval?: string;
  currency?: string;
  description?: string | null;
  environment: ProviderEnvironment;
  account: ProviderAccount;
}): Promise<
  ProviderResult<{
    updated: boolean;
    nextPlanId?: string;    // Return when provider requires creating a replacement price/plan
    metadata?: Record<string, unknown>;
  }>
>
```

If the provider's pricing objects are immutable (for example Stripe Prices),
`updatePlan` should create the replacement provider object and return its new ID
in `nextPlanId`. Callers will persist that new provider plan ID for future
checkouts instead of assuming in-place mutation.

#### `createProduct?`

Creates a one-time product (used for credit packs / add-ons).

```ts
async createProduct(params: {
  name: string;
  description?: string | null;
  amount: number;
  currency: string;
  environment: ProviderEnvironment;
  account: ProviderAccount;
  metadata?: Record<string, unknown>;
}): Promise<ProviderResult<ProviderProductRef>>
// Returns: { productId: string; priceId: string; metadata?: Record<string, unknown> }
```

#### `changePlan?`

Provider-managed plan switching with proration (e.g. Stripe, Dodo).

```ts
async changePlan(params: {
  subscriptionId: string;
  newPlanId: string;
  prorationMode?: "prorated_immediately" | "full_immediately" | "difference_immediately";
  quantity?: number;
  metadata?: Record<string, unknown>;
  environment: ProviderEnvironment;
  account: ProviderAccount;
}): Promise<ProviderResult<{ changed: boolean }>>
```

#### `refundCharge?`

Refunds a previous charge.

```ts
async refundCharge(params: {
  reference: string;         // Transaction reference to refund
  amount?: number;           // Partial refund amount (omit for full)
  currency?: string;
  reason?: string;
  environment: ProviderEnvironment;
  account: ProviderAccount;
}): Promise<ProviderResult<{ refunded: boolean; reference: string }>>
```

## Step 4: Register the Adapter

### 4a. Export from the adapters package

```ts
// packages/adapters/src/index.ts
export { myProviderAdapter } from "./my-provider";
```

### 4b. Register in the API provider registry

```ts
// apps/api/src/lib/providers.ts
import { myProviderAdapter } from "@owostack/adapters";

export function getProviderRegistry() {
  const registry = createProviderRegistry();
  registry.register(paystackAdapter);
  registry.register(dodoAdapter);
  registry.register(myProviderAdapter); // ← add here
  return registry;
}
```

Also update `providerCredentialsNeedingDecrypt()` if your provider uses different credential keys than `secretKey` / `webhookSecret`.

### 4c. Add dashboard UI config

```ts
// apps/dashboard/src/lib/providers.ts
export const SUPPORTED_PROVIDERS: ProviderConfig[] = [
  // ... existing providers ...
  {
    id: "my_provider", // Must match adapter.id
    name: "My Provider",
    description: "Description for the settings page",
    color: "blue", // Tailwind color for UI accents
    docsUrl: "https://docs.myprovider.com/api-keys",
    fields: [
      {
        key: "secretKey",
        label: "Secret Key",
        placeholder: "sk_xxx",
        secret: true,
      },
      // Add any extra credential fields your provider needs:
      // { key: "webhookSecret", label: "Webhook Secret", placeholder: "whsec_xxx", secret: true },
      // { key: "publicKey", label: "Public Key", placeholder: "pk_xxx", secret: false },
    ],
    supportedCurrencies: ["USD", "EUR", "GBP"],
  },
];
```

## Step 5: Webhook Verification Patterns

### HMAC-SHA256 (most common)

```ts
async verifyWebhook(params) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(params.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(params.payload));
  const computed = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return Result.ok(computed === params.signature);
}
```

### HMAC-SHA512 (Paystack)

Same as above but with `hash: "SHA-512"`.

### Standard Webhooks (Dodo, Svix)

Uses `webhook-id`, `webhook-signature`, `webhook-timestamp` headers. The signed message is `{webhook-id}.{webhook-timestamp}.{body}`. The secret may have a `whsec_` prefix and be base64-encoded.

```ts
async verifyWebhook(params) {
  const headers = params.headers || {};
  const webhookId = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatures = params.signature.split(" ");

  let secret = params.secret;
  if (secret.startsWith("whsec_")) secret = secret.slice(6);
  const keyBytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));

  const signedContent = `${webhookId}.${timestamp}.${params.payload}`;
  const key = await crypto.subtle.importKey(
    "raw", keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return Result.ok(signatures.some((s) => {
    const [, sigValue] = s.split(",");
    return sigValue === expected;
  }));
}
```

## Error Handling

All adapter methods return `ProviderResult<T>` which is `Result<T, ProviderError>`.

```ts
interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  providerId?: string;
  cause?: unknown;
}

type ProviderErrorCode =
  | "configuration_missing" // Credentials not set or invalid
  | "request_failed" // API call failed (network, 4xx, 5xx)
  | "unsupported" // Operation not supported by this provider
  | "invalid_request" // Bad input params
  | "invalid_payload" // Webhook payload can't be parsed
  | "unknown_event"; // Webhook event type not recognized
```

Use `Result.ok(value)` for success and `Result.err({ code, message, providerId })` for errors.

For operations your provider doesn't support, return:

```ts
return Result.err({
  code: "unsupported",
  message: "My Provider does not support this operation",
  providerId: "my_provider",
});
```

## Provider-Specific Considerations

### Authorization Codes

Not all providers expose reusable card tokens the same way:

- **Paystack**: `authorization.authorization_code` from `charge.success` webhook
- **Dodo**: Uses on-demand subscription IDs instead of card auth codes
- **Stripe**: `payment_method` IDs

The `authorization.code` in `NormalizedWebhookEvent` is what gets stored and passed to `chargeAuthorization()`.

### Trial Handling

- If `supportsNativeTrials = true`: Owostack passes `trialDays` to `createCheckoutSession`, and the provider handles deferring the first charge.
- If `supportsNativeTrials = false`: Owostack creates a small auth-capture checkout (e.g. $0.50), auto-refunds it via `refundCharge`, and manages the trial period internally.

### Subscription Creation

Some providers (e.g. Dodo) don't support direct subscription creation via API — subscriptions must be created through checkout. In this case, `createSubscription` should create a checkout session and return the relevant IDs.

## Checklist

- [ ] Client class with typed API methods and retry logic
- [ ] `resolveClient()` helper that extracts credentials from `ProviderAccount`
- [ ] All **required** adapter methods implemented
- [ ] Relevant **optional** methods implemented (`updatePlan`, `refundCharge`, etc.)
- [ ] Webhook verification using the correct signature scheme
- [ ] `parseWebhookEvent` maps all relevant provider events to `NormalizedWebhookEvent`
- [ ] Adapter exported from `packages/adapters/src/index.ts`
- [ ] Adapter registered in `apps/api/src/lib/providers.ts`
- [ ] Dashboard config added in `apps/dashboard/src/lib/providers.ts`
- [ ] `signatureHeaderName` set to the correct HTTP header
- [ ] `defaultCurrency` set
- [ ] `supportsNativeTrials` set correctly
