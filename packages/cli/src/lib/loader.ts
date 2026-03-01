import { resolve, isAbsolute, extname } from "node:path";
import { existsSync } from "node:fs";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

export const DEFAULT_CONFIG_NAMES = [
  "owo.config.ts",
  "owo.config.js",
  "owo.config.mjs",
  "owo.config.cjs",
  "owo.config.mts",
  "owo.config.cts",
];

export function resolveConfigPath(configPath?: string): string | null {
  if (configPath) {
    const fullPath = isAbsolute(configPath)
      ? configPath
      : resolve(process.cwd(), configPath);

    if (existsSync(fullPath)) return fullPath;
    return null;
  }

  // Try defaults
  for (const name of DEFAULT_CONFIG_NAMES) {
    const fullPath = resolve(process.cwd(), name);
    if (existsSync(fullPath)) return fullPath;
  }

  return null;
}

export async function loadOwostackFromConfig(fullPath: string): Promise<any> {
  try {
    const configModule: any = await jiti.import(fullPath);

    // Handle ESM default export or named export 'owo'
    // Also handle CJS module.exports or exports.owo
    const instance = configModule.default || configModule.owo || configModule;

    if (instance && typeof instance.sync === "function") {
      return instance;
    }

    // If the module itself is the instance (common in CJS)
    if (typeof configModule.sync === "function") {
      return configModule;
    }

    return null;
  } catch (e: any) {
    console.error(`\n  ❌ Failed to load config from ${fullPath}`);
    console.error(`     ${e.message}\n`);
    console.error(
      `  Make sure the file exports an Owostack instance as default or named 'owo'.`,
    );
    const ext = extname(fullPath);
    const isTs = ext === ".ts" || ext === ".mts" || ext === ".cts";

    if (isTs) {
      console.error(`  Example owo.config.ts:\n`);
      console.error(
        `    import { Owostack, metered, boolean, plan } from "owostack";`,
      );
      console.error(
        `    export default new Owostack({ secretKey: "...", catalog: [...] });\n`,
      );
    } else {
      console.error(`  Example owo.config.js:\n`);
      console.error(
        `    const { Owostack, metered, boolean, plan } = require("owostack");`,
      );
      console.error(
        `    module.exports = new Owostack({ secretKey: "...", catalog: [...] });\n`,
      );
    }
    process.exit(1);
  }
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
  configPath?: string,
): Promise<ConfigSettings> {
  try {
    const fullPath = resolveConfigPath(configPath);
    if (!fullPath) return {};
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
