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
  optional?: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  description: string;
  color: string;
  docsUrl: string;
  fields: ProviderField[];
  supportedCurrencies?: string[];
}

export const SUPPORTED_PROVIDERS: ProviderConfig[] = [
  {
    id: "paystack",
    name: "Paystack",
    description: "Accept payments across Africa",
    color: "teal",
    docsUrl: "https://dashboard.paystack.com/#/settings/developers",
    fields: [
      {
        key: "secretKey",
        label: "Secret Key",
        placeholder: "sk_test_xxxxxxxxxxxxxxx",
        secret: true,
      },
      {
        key: "publicKey",
        label: "Public Key",
        placeholder: "pk_test_xxxxxxxxxxxxxxx",
        secret: false,
      },
    ],
    supportedCurrencies: [
      "NGN",
      "GHS",
      "ZAR",
      "USD",
      "KES",
      "EGP",
      "RWF",
      "XOF",
    ],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Global payment infrastructure",
    color: "indigo",
    docsUrl: "https://dashboard.stripe.com/apikeys",
    fields: [
      {
        key: "secretKey",
        label: "Secret Key",
        placeholder: "sk_test_xxxxxxxxxxxxxxx",
        secret: true,
      },
      {
        key: "publishableKey",
        label: "Publishable Key",
        placeholder: "pk_test_xxxxxxxxxxxxxxx",
        secret: false,
      },
    ],
  },
  {
    id: "dodopayments",
    name: "Dodo Payments",
    description: "Global payment processing for digital products",
    color: "violet",
    docsUrl: "https://app.dodopayments.com/developers/api-keys",
    fields: [
      {
        key: "secretKey",
        label: "API Key",
        placeholder: "your_dodo_api_key",
        secret: true,
      },
      {
        key: "webhookSecret",
        label: "Webhook Secret",
        placeholder: "whsec_xxxxxxxxxxxxxxx",
        secret: true,
      },
    ],
    supportedCurrencies: ["USD", "EUR", "GBP", "INR"],
  },
  {
    id: "polar",
    name: "Polar",
    description: "Global billing and subscriptions for digital products",
    color: "rose",
    docsUrl: "https://polar.sh/dashboard",
    fields: [
      {
        key: "secretKey",
        label: "Access Token",
        placeholder: "polar_pat_xxxxxxxxxxxxxxx",
        secret: true,
      },
      {
        key: "webhookSecret",
        label: "Webhook Secret",
        placeholder: "polar_whs_xxxxxxxxxxxxxxx",
        secret: true,
      },
    ],
  },
];

/** Lookup map for quick access by provider ID. */
export const PROVIDER_MAP = new Map(SUPPORTED_PROVIDERS.map((p) => [p.id, p]));

/** Get a provider config by ID, returns undefined for unknown providers. */
export function getProviderConfig(
  providerId: string,
): ProviderConfig | undefined {
  return PROVIDER_MAP.get(providerId);
}
