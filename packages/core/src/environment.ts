import type { OwostackConfig } from "@owostack/types";

/**
 * Environment resolution for the SDK.
 *
 * Owostack has two isolated environments, each on its own host:
 *   sandbox -> https://sandbox.owostack.com
 *   live    -> https://api.owostack.com
 *
 * API keys are scoped to one of them via their prefix:
 *   owo_sk_test_... -> sandbox
 *   owo_sk_live_... -> live
 *   owo_sk_...      -> legacy key, no scope
 *
 * The SDK never picks an environment silently. It is resolved from, in order:
 *   1. `apiUrl`  (explicit override — self-hosted or custom host)
 *   2. `mode`    (explicit "sandbox" | "live")
 *   3. the key prefix
 * When `mode` and the key prefix disagree that is a configuration error, and
 * when nothing determines the environment the first request fails loudly
 * instead of defaulting to production.
 */
export type OwostackMode = "sandbox" | "live";

export const OWOSTACK_HOSTS: Record<OwostackMode, string> = {
  sandbox: "https://sandbox.owostack.com",
  live: "https://api.owostack.com",
};

export const OWOSTACK_API_VERSION_PATH = "/v1";

const SCOPED_KEY_PATTERN = /^owo_sk_(test|live)_\w+$/i;

/** Infer the environment a secret key is scoped to. null for legacy/unknown keys. */
export function inferModeFromSecretKey(
  secretKey: string | undefined | null,
): OwostackMode | null {
  if (!secretKey) return null;
  const match = secretKey.match(SCOPED_KEY_PATTERN);
  if (!match) return null;
  return match[1].toLowerCase() === "live" ? "live" : "sandbox";
}

export function apiUrlForMode(mode: OwostackMode): string {
  return `${OWOSTACK_HOSTS[mode]}${OWOSTACK_API_VERSION_PATH}`;
}

export interface ResolvedEnvironment {
  /** Resolved environment, or null when it could not be determined. */
  mode: OwostackMode | null;
  /** Fully-qualified base URL (including the version path), or null when unresolved. */
  apiUrl: string | null;
  /** Where the resolution came from. */
  source: "apiUrl" | "mode" | "secretKey" | "unresolved";
  /** Human-readable explanation when the configuration is inconsistent or incomplete. */
  error: string | null;
}

export function resolveEnvironment(
  config: Pick<OwostackConfig, "secretKey" | "mode" | "apiUrl">,
): ResolvedEnvironment {
  const keyMode = inferModeFromSecretKey(config.secretKey);
  const explicitMode = config.mode ?? null;

  if (explicitMode && keyMode && explicitMode !== keyMode) {
    return {
      mode: null,
      apiUrl: null,
      source: "unresolved",
      error:
        `Owostack: mode is "${explicitMode}" but the secret key is scoped to ${keyMode} ` +
        `(${keyMode === "live" ? "owo_sk_live_" : "owo_sk_test_"}…). ` +
        `Use a ${explicitMode} key or set mode: "${keyMode}".`,
    };
  }

  if (config.apiUrl) {
    return {
      mode: explicitMode ?? keyMode,
      apiUrl: config.apiUrl,
      source: "apiUrl",
      error: null,
    };
  }

  if (explicitMode) {
    return {
      mode: explicitMode,
      apiUrl: apiUrlForMode(explicitMode),
      source: "mode",
      error: null,
    };
  }

  if (keyMode) {
    return {
      mode: keyMode,
      apiUrl: apiUrlForMode(keyMode),
      source: "secretKey",
      error: null,
    };
  }

  return {
    mode: null,
    apiUrl: null,
    source: "unresolved",
    error:
      'Owostack: no environment configured. Pass mode: "sandbox" | "live" to new Owostack({...}), ' +
      "or use an environment-scoped key (owo_sk_test_… for sandbox, owo_sk_live_… for live). " +
      "The SDK will not default to live silently.",
  };
}
