import { resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

export function resolveConfigPath(configPath: string): string {
  return isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath);
}

export async function loadOwostackFromConfig(fullPath: string): Promise<any> {
  let configModule: any;
  try {
    const fileUrl = pathToFileURL(fullPath).href;
    configModule = await import(fileUrl);
  } catch (e: any) {
    console.error(`\n  ❌ Failed to load config from ${fullPath}`);
    console.error(`     ${e.message}\n`);
    console.error(
      `  Make sure the file exports an Owostack instance as default or named 'owo'.`,
    );
    console.error(`  Example owo.config.ts:\n`);
    console.error(
      `    import { Owostack, metered, boolean, plan } from "owostack";`,
    );
    console.error(
      `    export default new Owostack({ secretKey: "...", catalog: [...] });\n`,
    );
    process.exit(1);
  }
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
  try {
    const fullPath = resolveConfigPath(configPath);
    if (!existsSync(fullPath)) return {};
    const owo = await loadOwostackFromConfig(fullPath);
    if (!owo || !owo._config) return {};
    return {
      apiUrl: owo._config.apiUrl,
      environments: owo._config.environments,
      filters: owo._config.filters,
      connect: owo._config.connect,
    };
  } catch {
    return {};
  }
}
