import type { ProviderEnvironment } from "@owostack/adapters";
import { decrypt } from "./encryption";

const DEFAULT_TIMEOUT_MS = 10000;

export interface ProviderValidationMetadata {
  status: "verified";
  validatedAt: number;
  verificationLevel:
    | "authentication"
    | "authentication_and_environment"
    | "authentication_and_scope_probe";
  warnings?: string[];
  details?: Record<string, unknown>;
}

type ProviderValidationSuccess = {
  ok: true;
  validation: ProviderValidationMetadata;
};

type ProviderValidationFailure = {
  ok: false;
  field: string;
  message: string;
};

export type ProviderValidationResult =
  | ProviderValidationSuccess
  | ProviderValidationFailure;

interface ProviderValidationParams {
  providerId: string;
  environment: ProviderEnvironment;
  credentials: Record<string, unknown>;
}

interface HttpResponsePayload {
  status: number;
  ok: boolean;
  json: unknown | null;
  text: string;
}

function getStringCredential(
  credentials: Record<string, unknown>,
  key: string,
): string | null {
  const value = credentials[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function fail(field: string, message: string): ProviderValidationFailure {
  return { ok: false, field, message };
}

function success(
  verificationLevel: ProviderValidationMetadata["verificationLevel"],
  details?: Record<string, unknown>,
  warnings?: string[],
): ProviderValidationSuccess {
  return {
    ok: true,
    validation: {
      status: "verified",
      validatedAt: Date.now(),
      verificationLevel,
      ...(warnings && warnings.length > 0 ? { warnings } : {}),
      ...(details ? { details } : {}),
    },
  };
}

function providerLabel(providerId: string): string {
  switch (providerId) {
    case "stripe":
      return "Stripe";
    case "paystack":
      return "Paystack";
    case "dodopayments":
      return "Dodo Payments";
    case "polar":
      return "Polar";
    default:
      return providerId;
  }
}

function objectHasKey(
  value: unknown,
  key: string,
): value is Record<string, unknown> {
  return !!value && typeof value === "object" && key in value;
}

function extractMessage(payload: HttpResponsePayload): string {
  if (objectHasKey(payload.json, "error")) {
    const error = payload.json.error;
    if (typeof error === "string" && error.length > 0) return error;
    if (objectHasKey(error, "message") && typeof error.message === "string") {
      return error.message;
    }
  }

  if (objectHasKey(payload.json, "message")) {
    const message = payload.json.message;
    if (typeof message === "string" && message.length > 0) return message;
  }

  if (objectHasKey(payload.json, "detail")) {
    const detail = payload.json.detail;
    if (typeof detail === "string" && detail.length > 0) return detail;
  }

  return payload.text || `HTTP ${payload.status}`;
}

async function httpRequest(params: {
  url: string;
  headers: Record<string, string>;
  timeoutMs?: number;
}): Promise<HttpResponsePayload> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await fetch(params.url, {
      method: "GET",
      headers: params.headers,
      signal: controller.signal,
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return {
      status: response.status,
      ok: response.ok,
      json,
      text,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function validateStripePublishableKey(
  environment: ProviderEnvironment,
  credentials: Record<string, unknown>,
): ProviderValidationFailure | null {
  const publishableKey = getStringCredential(credentials, "publishableKey");
  if (!publishableKey) return null;
  if (!publishableKey.startsWith("pk_")) {
    return fail("publishableKey", "Stripe publishable key must start with pk_");
  }
  if (environment === "test" && !publishableKey.startsWith("pk_test_")) {
    return fail(
      "publishableKey",
      "Stripe publishable key must be a test key for the test environment",
    );
  }
  if (environment === "live" && !publishableKey.startsWith("pk_live_")) {
    return fail(
      "publishableKey",
      "Stripe publishable key must be a live key for the live environment",
    );
  }
  return null;
}

function validatePaystackPublicKey(
  environment: ProviderEnvironment,
  credentials: Record<string, unknown>,
): ProviderValidationFailure | null {
  const publicKey = getStringCredential(credentials, "publicKey");
  if (!publicKey) return null;
  if (!publicKey.startsWith("pk_")) {
    return fail("publicKey", "Paystack public key must start with pk_");
  }
  if (environment === "test" && !publicKey.startsWith("pk_test_")) {
    return fail(
      "publicKey",
      "Paystack public key must be a test key for the test environment",
    );
  }
  if (environment === "live" && !publicKey.startsWith("pk_live_")) {
    return fail(
      "publicKey",
      "Paystack public key must be a live key for the live environment",
    );
  }
  return null;
}

function validateStripeWebhookSecret(
  credentials: Record<string, unknown>,
): ProviderValidationFailure | null {
  const webhookSecret = getStringCredential(credentials, "webhookSecret");
  if (!webhookSecret) return null;
  if (!webhookSecret.startsWith("whsec_")) {
    return fail(
      "webhookSecret",
      "Stripe webhook secret must start with whsec_",
    );
  }
  return null;
}

async function validateStripeCredentials(
  environment: ProviderEnvironment,
  credentials: Record<string, unknown>,
): Promise<ProviderValidationResult> {
  const secretKey = getStringCredential(credentials, "secretKey");
  if (!secretKey) {
    return fail("secretKey", "Stripe secret key is required");
  }
  if (secretKey.startsWith("pk_")) {
    return fail("secretKey", "Stripe secret key cannot be a publishable key");
  }
  if (secretKey.startsWith("rk_")) {
    return fail(
      "secretKey",
      "Stripe restricted keys are not supported for provider connections",
    );
  }
  if (secretKey.startsWith("sk_org_")) {
    return fail(
      "secretKey",
      "Stripe organization keys are not supported by this integration",
    );
  }
  if (!secretKey.startsWith("sk_")) {
    return fail(
      "secretKey",
      "Stripe secret key must start with sk_test_ or sk_live_",
    );
  }
  if (environment === "test" && !secretKey.startsWith("sk_test_")) {
    return fail(
      "secretKey",
      "Stripe test environment requires an sk_test_ secret key",
    );
  }
  if (environment === "live" && !secretKey.startsWith("sk_live_")) {
    return fail(
      "secretKey",
      "Stripe live environment requires an sk_live_ secret key",
    );
  }

  const publishableKeyError = validateStripePublishableKey(
    environment,
    credentials,
  );
  if (publishableKeyError) return publishableKeyError;

  const webhookSecretError = validateStripeWebhookSecret(credentials);
  if (webhookSecretError) return webhookSecretError;

  try {
    const response = await httpRequest({
      url: "https://api.stripe.com/v1/balance",
      headers: { Authorization: `Bearer ${secretKey}` },
    });

    if (!response.ok) {
      return fail(
        "secretKey",
        `Stripe rejected the secret key: ${extractMessage(response)}`,
      );
    }

    const livemode =
      objectHasKey(response.json, "livemode") &&
      typeof response.json.livemode === "boolean"
        ? response.json.livemode
        : null;

    if (livemode === null) {
      return fail(
        "secretKey",
        "Stripe validation succeeded but the response did not include livemode",
      );
    }

    if (livemode !== (environment === "live")) {
      return fail(
        "secretKey",
        `Stripe key belongs to the ${livemode ? "live" : "test"} environment`,
      );
    }

    return success("authentication_and_environment", {
      provider: "stripe",
      endpoint: "/v1/balance",
      livemode,
    });
  } catch (error) {
    return fail(
      "secretKey",
      `Stripe validation request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function validatePaystackCredentials(
  environment: ProviderEnvironment,
  credentials: Record<string, unknown>,
): Promise<ProviderValidationResult> {
  const secretKey = getStringCredential(credentials, "secretKey");
  if (!secretKey) {
    return fail("secretKey", "Paystack secret key is required");
  }
  if (!secretKey.startsWith("sk_")) {
    return fail(
      "secretKey",
      "Paystack secret key must start with sk_test_ or sk_live_",
    );
  }
  if (environment === "test" && !secretKey.startsWith("sk_test_")) {
    return fail(
      "secretKey",
      "Paystack test environment requires an sk_test_ secret key",
    );
  }
  if (environment === "live" && !secretKey.startsWith("sk_live_")) {
    return fail(
      "secretKey",
      "Paystack live environment requires an sk_live_ secret key",
    );
  }

  const publicKeyError = validatePaystackPublicKey(environment, credentials);
  if (publicKeyError) return publicKeyError;

  try {
    const response = await httpRequest({
      url: "https://api.paystack.co/integration/payment_session_timeout",
      headers: { Authorization: `Bearer ${secretKey}` },
    });

    if (!response.ok) {
      const message = extractMessage(response);
      if (response.status === 403 && /whitelist|allowlist|ip/i.test(message)) {
        return fail(
          "secretKey",
          `Paystack rejected the key from this server: ${message}`,
        );
      }

      return fail("secretKey", `Paystack rejected the secret key: ${message}`);
    }

    return success("authentication_and_environment", {
      provider: "paystack",
      endpoint: "/integration/payment_session_timeout",
      environment,
    });
  } catch (error) {
    return fail(
      "secretKey",
      `Paystack validation request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function validateDodoCredentials(
  environment: ProviderEnvironment,
  credentials: Record<string, unknown>,
): Promise<ProviderValidationResult> {
  const secretKey = getStringCredential(credentials, "secretKey");
  if (!secretKey) {
    return fail("secretKey", "Dodo Payments API key is required");
  }

  const baseUrl =
    environment === "live"
      ? "https://live.dodopayments.com"
      : "https://test.dodopayments.com";

  try {
    const response = await httpRequest({
      url: `${baseUrl}/products?page_size=1&page_number=0`,
      headers: { Authorization: `Bearer ${secretKey}` },
    });

    if (!response.ok) {
      return fail(
        "secretKey",
        `Dodo Payments rejected the API key: ${extractMessage(response)}`,
      );
    }

    return success(
      "authentication",
      {
        provider: "dodopayments",
        endpoint: "/products?page_size=1&page_number=0",
        baseUrl,
      },
      [
        "Dodo Payments authentication was verified with a read-only request. Write permissions cannot be confirmed without a side-effecting call.",
      ],
    );
  } catch (error) {
    return fail(
      "secretKey",
      `Dodo Payments validation request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function validatePolarCredentials(
  environment: ProviderEnvironment,
  credentials: Record<string, unknown>,
): Promise<ProviderValidationResult> {
  const secretKey = getStringCredential(credentials, "secretKey");
  if (!secretKey) {
    return fail("secretKey", "Polar access token is required");
  }

  const customBaseUrl = getStringCredential(credentials, "baseUrl");
  const baseUrl =
    customBaseUrl ||
    (environment === "live"
      ? "https://api.polar.sh"
      : "https://sandbox-api.polar.sh");

  const probes = [
    { path: "/v1/products?limit=1", field: "products" },
    { path: "/v1/customers?limit=1", field: "customers" },
    { path: "/v1/subscriptions?limit=1", field: "subscriptions" },
  ];

  try {
    for (const probe of probes) {
      const response = await httpRequest({
        url: `${baseUrl}${probe.path}`,
        headers: { Authorization: `Bearer ${secretKey}` },
      });

      if (response.ok) {
        continue;
      }

      const message = extractMessage(response);
      if (response.status === 403) {
        return fail(
          "secretKey",
          `Polar token is missing permission for ${probe.field}: ${message}`,
        );
      }

      return fail("secretKey", `Polar rejected the access token: ${message}`);
    }

    return success(
      "authentication_and_scope_probe",
      {
        provider: "polar",
        baseUrl,
        probes: probes.map((probe) => probe.path),
      },
      [
        "Polar authentication was verified with read probes. Write scopes cannot be confirmed without a side-effecting call.",
      ],
    );
  } catch (error) {
    return fail(
      "secretKey",
      `Polar validation request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function validateProviderCredentials(
  params: ProviderValidationParams,
): Promise<ProviderValidationResult> {
  switch (params.providerId) {
    case "stripe":
      return validateStripeCredentials(params.environment, params.credentials);
    case "paystack":
      return validatePaystackCredentials(
        params.environment,
        params.credentials,
      );
    case "dodopayments":
      return validateDodoCredentials(params.environment, params.credentials);
    case "polar":
      return validatePolarCredentials(params.environment, params.credentials);
    default:
      return fail(
        "providerId",
        `Provider "${providerLabel(params.providerId)}" is not supported`,
      );
  }
}

export function normalizeProviderCredentials(
  credentials: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(credentials)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        next[key] = trimmed;
      }
      continue;
    }

    if (value !== undefined) {
      next[key] = value;
    }
  }

  return next;
}

export async function hydratePlaintextProviderCredentials(params: {
  credentials: Record<string, unknown> | null | undefined;
  encryptionKey?: string;
}): Promise<Record<string, unknown>> {
  const next = { ...(params.credentials || {}) };

  if (!params.encryptionKey) {
    return next;
  }

  for (const key of ["secretKey", "webhookSecret"]) {
    const value = next[key];
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }

    try {
      next[key] = await decrypt(value, params.encryptionKey);
    } catch {
      next[key] = value;
    }
  }

  return next;
}

export function buildProviderValidationMetadata(
  validation: ProviderValidationMetadata,
  existingMetadata?: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    ...(existingMetadata || {}),
    providerValidation: validation,
  };
}
