import * as p from "@clack/prompts";
import pc from "picocolors";
import { getApiKey, getApiUrl, getTestApiUrl } from "../lib/config.js";
import {
  loadConfigSettings,
  loadOwostackFromConfig,
  resolveConfigPath,
} from "../lib/loader.js";
import { fetchPlans } from "../lib/api.js";
import { diffPlans, printDiff } from "../lib/diff.js";
import { printBrand } from "../lib/brand.js";

interface DiffOptions {
  config?: string;
  key?: string;
  prod?: boolean;
}

export async function runDiff(options: DiffOptions) {
  p.intro(pc.bgYellow(pc.black(" diff ")));

  const fullPath = resolveConfigPath(options.config);

  if (!fullPath) {
    p.log.error(pc.red("No configuration file found."));
    process.exit(1);
  }

  const apiKey = getApiKey(options.key);
  const configSettings = await loadConfigSettings(options.config);
  const baseUrl = getApiUrl(configSettings.apiUrl);

  const s = p.spinner();

  if (options.prod) {
    p.log.step(pc.magenta("Production Mode: Comparing both environments"));

    const testUrl = getTestApiUrl(configSettings.environments?.test);
    const liveUrl = getApiUrl(configSettings.environments?.live);

    s.start("Loading local configuration...");
    const owo = await loadOwostackFromConfig(fullPath);
    s.stop("Configuration loaded");

    const { buildSyncPayload } = (await import("owostack").catch(() => ({
      buildSyncPayload: null,
    }))) as any;
    const localPayload = buildSyncPayload(owo._config.catalog);

    p.log.step(pc.cyan(`Comparing with TEST: ${testUrl}`));
    const testPlans = await fetchPlans({ apiKey, apiUrl: `${testUrl}/api/v1` });
    printDiff(diffPlans(localPayload?.plans ?? [], testPlans));

    p.log.step(pc.cyan(`Comparing with LIVE: ${liveUrl}`));
    const livePlans = await fetchPlans({ apiKey, apiUrl: `${liveUrl}/api/v1` });
    printDiff(diffPlans(localPayload?.plans ?? [], livePlans));
  } else {
    s.start("Loading local configuration...");
    const owo = await loadOwostackFromConfig(fullPath);
    s.stop("Configuration loaded");

    const { buildSyncPayload } = (await import("owostack").catch(() => ({
      buildSyncPayload: null,
    }))) as any;
    const localPayload = buildSyncPayload(owo._config.catalog);

    s.start(`Fetching remote plans from ${pc.dim(baseUrl)}...`);
    const remotePlans = await fetchPlans({
      apiKey,
      apiUrl: `${baseUrl}/api/v1`,
    });
    s.stop("Remote plans fetched");

    printDiff(diffPlans(localPayload?.plans ?? [], remotePlans));
  }

  p.outro(pc.green("Diff complete ✨"));
}
