/**
 * Public API environment handling.
 *
 * Owostack runs one worker deployment per environment:
 *   - sandbox  -> https://sandbox.owostack.com  (ENVIRONMENT = "test" | "development")
 *   - live     -> https://api.owostack.com      (ENVIRONMENT = "live" | "production")
 *
 * API keys are scoped to an environment via their prefix:
 *   - owo_sk_test_... -> sandbox only
 *   - owo_sk_live_... -> live only
 *   - owo_sk_...      -> legacy, accepted by both (issued before scoping existed)
 *
 * The prefix is authoritative and tamper-proof: the full key string is hashed
 * for lookup, so changing the prefix invalidates the key.
 */

/** Public environment label used in headers, response bodies and the SDK. */
export type PublicEnvironment = "sandbox" | "live";

/** Environment a key is scoped to (matches `api_keys.environment`). */
export type ApiKeyEnvironment = "test" | "live";

export const ENVIRONMENT_HEADER = "X-Owostack-Environment";
export const ORGANIZATION_HEADER = "X-Owostack-Organization";

const PUBLIC_HOSTS: Record<PublicEnvironment, string> = {
  sandbox: "https://sandbox.owostack.com",
  live: "https://api.owostack.com",
};

const ENV_SCOPED_KEY_PATTERN = /^owo_sk_(test|live)_\w+$/i;
const LEGACY_KEY_PATTERN = /^owo_sk_\w+$/i;

/**
 * Map the worker's ENVIRONMENT var to the public environment label.
 * Anything that is not explicitly live is treated as sandbox, so a
 * misconfigured deployment can never silently present itself as live.
 */
export function resolvePublicEnvironment(
  envVar: string | undefined | null,
): PublicEnvironment {
  return envVar === "live" || envVar === "production" ? "live" : "sandbox";
}

export function keyEnvironmentToPublic(
  environment: ApiKeyEnvironment,
): PublicEnvironment {
  return environment === "live" ? "live" : "sandbox";
}

export function publicEnvironmentToKeyEnvironment(
  environment: PublicEnvironment,
): ApiKeyEnvironment {
  return environment === "live" ? "live" : "test";
}

export function apiKeyPrefixForEnvironment(
  environment: ApiKeyEnvironment,
): string {
  return `owo_sk_${environment}_`;
}

/** Whether the string has the shape of an Owostack secret key (any scope). */
export function isOwostackApiKey(value: string): boolean {
  return ENV_SCOPED_KEY_PATTERN.test(value) || LEGACY_KEY_PATTERN.test(value);
}

/**
 * Extract the environment a key is scoped to from its prefix.
 * Returns null for legacy keys (no scope) and for malformed input.
 */
export function parseApiKeyEnvironment(
  apiKey: string,
): ApiKeyEnvironment | null {
  const match = apiKey.match(ENV_SCOPED_KEY_PATTERN);
  if (!match) return null;
  return match[1].toLowerCase() as ApiKeyEnvironment;
}

export function extractBearerToken(
  authorizationHeader: string | undefined | null,
): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

export type ApiKeyEnvironmentCheck =
  | { ok: true; keyEnvironment: PublicEnvironment | null }
  | {
      ok: false;
      keyEnvironment: PublicEnvironment;
      requestEnvironment: PublicEnvironment;
      message: string;
    };

/**
 * Verify that a key's scope matches the environment serving the request.
 * Legacy keys (no scope) and non-key tokens pass through untouched so that
 * downstream auth can reject them with its usual "invalid key" response.
 */
export function checkApiKeyEnvironment(
  apiKey: string | null,
  requestEnvironment: PublicEnvironment,
): ApiKeyEnvironmentCheck {
  if (!apiKey) return { ok: true, keyEnvironment: null };

  const scoped = parseApiKeyEnvironment(apiKey);
  if (!scoped) return { ok: true, keyEnvironment: null };

  const keyEnvironment = keyEnvironmentToPublic(scoped);
  if (keyEnvironment === requestEnvironment) {
    return { ok: true, keyEnvironment };
  }

  return {
    ok: false,
    keyEnvironment,
    requestEnvironment,
    message:
      `This API key is scoped to the ${keyEnvironment} environment but the request was sent to the ` +
      `${requestEnvironment} API (${PUBLIC_HOSTS[requestEnvironment]}). ` +
      `Use an ${apiKeyPrefixForEnvironment(publicEnvironmentToKeyEnvironment(requestEnvironment))}… key, ` +
      `or send this request to ${PUBLIC_HOSTS[keyEnvironment]}.`,
  };
}

export function environmentMismatchBody(
  check: Extract<ApiKeyEnvironmentCheck, { ok: false }>,
) {
  return {
    success: false as const,
    error: {
      code: "environment_mismatch",
      message: check.message,
    },
    environment: check.requestEnvironment,
    keyEnvironment: check.keyEnvironment,
  };
}
