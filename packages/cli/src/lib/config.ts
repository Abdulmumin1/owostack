import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

export const GLOBAL_CONFIG_DIR = join(homedir(), ".owostack");
export const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, "config.json");

export interface GlobalConfig {
  apiKey?: string;
  organizationId?: string;
}

export function getApiUrl(configUrl?: string): string {
  return (
    process.env.OWOSTACK_API_URL || configUrl || "https://sandbox.owostack.com"
  );
}

export function getTestApiUrl(configUrl?: string): string {
  return (
    process.env.OWOSTACK_API_TEST_URL ||
    configUrl ||
    "https://sandbox.owostack.com"
  );
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

export function getApiKey(cliKey?: string): string {
  if (cliKey) return cliKey;
  if (process.env.OWOSTACK_SECRET_KEY) return process.env.OWOSTACK_SECRET_KEY;
  if (process.env.OWOSTACK_API_KEY) return process.env.OWOSTACK_API_KEY;
  return loadGlobalConfig().apiKey || "";
}
