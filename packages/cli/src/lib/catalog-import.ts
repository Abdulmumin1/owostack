import { extname } from "node:path";
import {
  fetchPlans,
  fetchCreditSystems,
  fetchCreditPacks,
} from "./api.js";
import { generateConfig, type ConfigFormat } from "./generate.js";

export interface CatalogImportFilters {
  group?: string;
  interval?: string;
  currency?: string;
  includeInactive?: boolean;
}

export interface RemoteCatalogSnapshot {
  plans: any[];
  creditSystems: any[];
  creditPacks: any[];
  defaultProvider?: string;
  configContent: string;
}

export function determineConfigFormat(fullPath: string): ConfigFormat {
  const ext = extname(fullPath);

  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return "ts";
  if (ext === ".mjs") return "esm";
  if (ext === ".cjs") {
    throw new Error(
      "CommonJS config files are not supported. Use owo.config.js or owo.config.ts.",
    );
  }
  if (ext === ".js") return "esm";
  return "ts";
}

export async function buildRemoteCatalogSnapshot(params: {
  apiKey: string;
  apiUrl: string;
  format: ConfigFormat;
  filters?: CatalogImportFilters;
}): Promise<RemoteCatalogSnapshot> {
  const plans = await fetchPlans({
    apiKey: params.apiKey,
    apiUrl: params.apiUrl,
    ...(params.filters || {}),
  });
  const creditSystems = await fetchCreditSystems(params.apiKey, params.apiUrl);
  const creditPacks = await fetchCreditPacks(params.apiKey, params.apiUrl);

  const providers = new Set(plans.map((plan: any) => plan.provider).filter(Boolean));
  const defaultProvider =
    providers.size === 1 ? Array.from(providers)[0] : undefined;

  return {
    plans,
    creditSystems,
    creditPacks,
    defaultProvider,
    configContent: generateConfig(
      plans,
      creditSystems,
      creditPacks,
      defaultProvider,
      params.format,
    ),
  };
}
