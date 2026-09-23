import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import type { OwostackMode } from "./environment.js";
import { usageError } from "./errors.js";

export const GLOBAL_CONFIG_DIR = join(homedir(), ".owostack");
export const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, "config.json");

export interface GlobalConfig {
  /**
   * @deprecated single key from before environment scoping. Still honoured as
   * a fallback for either mode; `owosk connect` now writes `keys` instead.
   */
  apiKey?: string;
  /** Environment-scoped keys written by `owosk connect`. */
  keys?: Partial<Record<OwostackMode, string>>;
  organizationId?: string;
}

export function getDashboardUrl(configUrl?: string): string {
  return (
    process.env.OWOSTACK_DASHBOARD_URL ||
    configUrl ||
    "https://app.owostack.com"
  );
}

export async function saveGlobalConfig(data: GlobalConfig): Promise<void> {
  if (!existsSync(GLOBAL_CONFIG_DIR)) {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  }
  await writeFile(GLOBAL_CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
}

export function loadGlobalConfig(): GlobalConfig {
  try {
    if (existsSync(GLOBAL_CONFIG_PATH)) {
      return JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, "utf8"));
    }
  } catch {}
  return {};
}

/**
 * Pick the API key for a command, in order:
 *   --key  >  OWOSTACK_SECRET_KEY  >  OWOSTACK_API_KEY  >  ~/.owostack/config.json
 *
 * The stored config may hold one key per mode (from `owosk connect`); when the
 * mode is known the matching one is used, otherwise the legacy single key.
 * Returns "" when nothing is configured so callers can decide how to fail.
 */
export function getApiKey(cliKey?: string, mode?: OwostackMode): string {
  if (cliKey) return cliKey;
  if (process.env.OWOSTACK_SECRET_KEY) return process.env.OWOSTACK_SECRET_KEY;
  if (process.env.OWOSTACK_API_KEY) return process.env.OWOSTACK_API_KEY;

  const stored = loadGlobalConfig();
  if (mode && stored.keys?.[mode]) return stored.keys[mode]!;
  return stored.apiKey || "";
}

export function requireApiKey(cliKey?: string, mode?: OwostackMode): string {
  const apiKey = getApiKey(cliKey, mode);
  if (apiKey) return apiKey;
  throw usageError(
    "missing_api_key",
    `Missing API key${mode ? ` for ${mode}` : ""}. Pass --key, set OWOSTACK_SECRET_KEY, or run \`owosk connect\`.`,
  );
}
