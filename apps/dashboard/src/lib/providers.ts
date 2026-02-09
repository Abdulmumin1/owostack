/**
 * Single source of truth for provider UI configuration.
 *
 * Add new providers here — both the Settings page and the
 * Deploy to Production modal read from this file.
 */

export interface ProviderField {
  key: string;
  label: string;
  placeholder: string;
  secret: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  description: string;
  color: string;
  docsUrl: string;
  fields: ProviderField[];
}

export const SUPPORTED_PROVIDERS: ProviderConfig[] = [
  {
    id: "paystack",
    name: "Paystack",
    description: "Accept payments across Africa",
    color: "teal",
    docsUrl: "https://dashboard.paystack.com/#/settings/developers",
    fields: [
      { key: "secretKey", label: "Secret Key", placeholder: "sk_test_xxxxxxxxxxxxxxx", secret: true },
      { key: "publicKey", label: "Public Key", placeholder: "pk_test_xxxxxxxxxxxxxxx", secret: false },
    ],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Global payment infrastructure",
    color: "indigo",
    docsUrl: "https://dashboard.stripe.com/apikeys",
    fields: [
      { key: "secretKey", label: "Secret Key", placeholder: "sk_test_xxxxxxxxxxxxxxx", secret: true },
      { key: "publishableKey", label: "Publishable Key", placeholder: "pk_test_xxxxxxxxxxxxxxx", secret: false },
    ],
  },
  {
    id: "dodopayments",
    name: "Dodo Payments",
    description: "Simple payment processing",
    color: "violet",
    docsUrl: "https://dodopayments.com/docs",
    fields: [
      { key: "secretKey", label: "API Key", placeholder: "dodo_sk_xxxxxxxxxxxxxxx", secret: true },
    ],
  },
];

/** Lookup map for quick access by provider ID. */
export const PROVIDER_MAP = new Map(SUPPORTED_PROVIDERS.map((p) => [p.id, p]));

/** Get a provider config by ID, returns undefined for unknown providers. */
export function getProviderConfig(providerId: string): ProviderConfig | undefined {
  return PROVIDER_MAP.get(providerId);
}
