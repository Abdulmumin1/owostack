import { inferModeFromSecretKey } from "owostack";
import { getApiKey } from "./config.js";
import {
  resolveApiBaseUrl,
  resolveApiHost,
  resolveMode,
  type ModeSource,
  type OwostackMode,
} from "./environment.js";
import { usageError } from "./errors.js";
import { loadConfigSettings, type ConfigSettings } from "./loader.js";
import type { Reporter } from "./output.js";
import pc from "picocolors";

/** Options shared by every command that talks to the API. */
export interface CommonCommandOptions {
  config?: string;
  key?: string;
  mode?: string;
  /** @deprecated alias for --mode live */
  prod?: boolean;
  json?: boolean;
}

export interface CommandContext {
  mode: OwostackMode;
  modeSource: ModeSource;
  apiKey: string;
  /** Host without version path, e.g. https://sandbox.owostack.com */
  host: string;
  /** Full base URL, e.g. https://sandbox.owostack.com/api/v1 */
  apiUrl: string;
  settings: ConfigSettings;
}

/**
 * Resolve mode, key and URL for a command — and refuse to continue if any of
 * them is ambiguous or contradictory. No network calls happen here.
 */
export async function resolveCommandContext(
  options: CommonCommandOptions,
  reporter: Reporter,
  params: { requireKey?: boolean } = {},
): Promise<CommandContext> {
  const settings = await loadConfigSettings(options.config);

  // First pass: whatever key we can see without knowing the mode lets a
  // scoped key select the mode on its own.
  const candidateKey = getApiKey(options.key);
  const resolved = resolveMode({
    flagMode: options.mode,
    prod: options.prod,
    envMode: process.env.OWOSTACK_MODE,
    apiKey: candidateKey,
  });

  if (resolved.legacyProdFlag) {
    reporter.warn(
      pc.yellow(
        "--prod is deprecated; use --mode live (or OWOSTACK_MODE=live).",
      ),
    );
  }

  // Second pass: with the mode known, prefer the stored key for that mode.
  const apiKey = getApiKey(options.key, resolved.mode);
  const keyMode = inferModeFromSecretKey(apiKey);
  if (keyMode && keyMode !== resolved.mode) {
    throw usageError(
      "mode_mismatch",
      `Selected mode is ${resolved.mode} but the API key is scoped to ${keyMode}.`,
      `Use a ${resolved.mode} key (--key / OWOSTACK_SECRET_KEY) or run with --mode ${keyMode}.`,
    );
  }

  if (params.requireKey !== false && !apiKey) {
    throw usageError(
      "missing_api_key",
      `Missing API key for ${resolved.mode}. Pass --key, set OWOSTACK_SECRET_KEY, or run \`owosk connect\`.`,
    );
  }

  const urlInput = {
    mode: resolved.mode,
    envApiUrl: process.env.OWOSTACK_API_URL,
    envTestUrl: process.env.OWOSTACK_API_TEST_URL,
    envLiveUrl: process.env.OWOSTACK_API_LIVE_URL,
    configEnvironments: settings.environments,
  };

  return {
    mode: resolved.mode,
    modeSource: resolved.source,
    apiKey,
    host: resolveApiHost(urlInput),
    apiUrl: resolveApiBaseUrl(urlInput),
    settings,
  };
}

export function announceMode(
  reporter: Reporter,
  ctx: CommandContext,
  verb: string,
) {
  const label = ctx.mode === "live" ? pc.magenta("LIVE") : pc.cyan("SANDBOX");
  const via =
    ctx.modeSource === "key"
      ? "from key prefix"
      : ctx.modeSource === "env"
        ? "from OWOSTACK_MODE"
        : "from --mode";
  reporter.step(`${label} ${pc.dim(`(${via})`)} · ${verb} ${pc.dim(ctx.host)}`);
}
