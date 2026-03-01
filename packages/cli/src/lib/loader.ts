import { resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

export function resolveConfigPath(configPath: string): string {
  return isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath);
}

export async function loadOwostackFromConfig(fullPath: string): Promise<any> {
  const fileUrl = pathToFileURL(fullPath).href;
  const configModule = await import(fileUrl);
  return configModule.default || configModule.owo;
}

export interface ConfigSettings {
  apiUrl?: string;
  environments?: { test?: string; live?: string };
  filters?: {
    group?: string;
    interval?: string;
    currency?: string;
    includeInactive?: boolean;
  };
  connect?: {
    dashboardUrl?: string;
    autoOpenBrowser?: boolean;
    timeout?: number;
  };
}

export async function loadConfigSettings(
  configPath: string,
): Promise<ConfigSettings> {
  const fullPath = resolveConfigPath(configPath);
  if (!existsSync(fullPath)) return {};

  try {
    const owo = await loadOwostackFromConfig(fullPath);
    if (!owo || !owo._config) return {};
    return {
      apiUrl: owo._config.apiUrl,
      environments: owo._config.environments,
      filters: owo._config.filters,
      connect: owo._config.connect,
    };
  } catch (e) {
    // If we fail to load the config (e.g. missing owostack package in fresh project),
    // we just return empty settings and let the CLI continue with defaults.
    return {};
  }
}
