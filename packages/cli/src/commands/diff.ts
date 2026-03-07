import * as p from "@clack/prompts";
import pc from "picocolors";
import { getApiKey, getApiUrl, getTestApiUrl } from "../lib/config.js";
import {
  loadConfigSettings,
  loadOwostackFromConfig,
  resolveConfigPath,
} from "../lib/loader.js";
import {
  fetchPlans,
  fetchCreditSystems,
  fetchCreditPacks,
} from "../lib/api.js";
import { diffPlans, printDiff } from "../lib/diff.js";

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
  const testUrl = getTestApiUrl(configSettings.environments?.test);
  const liveUrl = getApiUrl(configSettings.environments?.live);

  const s = p.spinner();

  // Default to sandbox environment, prod only with --prod flag
  if (options.prod) {
    p.log.step(pc.magenta("Production Mode: Comparing with PROD environment"));
    const apiUrl = `${liveUrl}/api/v1`;

    s.start("Loading local configuration...");
    let owo: any;
    try {
      owo = await loadOwostackFromConfig(fullPath);
    } catch (e: any) {
      s.stop(pc.red("Failed to load configuration"));
      p.log.error(pc.red(`Error: ${e.message}`));
      p.log.info(
        pc.dim(
          "Make sure 'owostack' is installed in your project: 'npm install owostack'",
        ),
      );
      process.exit(1);
    }
    if (!owo || !owo._config) {
      s.stop(pc.red("Invalid configuration"));
      p.log.error("Config file must export an Owostack instance.");
      process.exit(1);
    }

    s.stop("Configuration loaded");

    const { buildSyncPayload } = (await import("owostack").catch(() => ({
      buildSyncPayload: null,
    }))) as any;
    const localPayload = buildSyncPayload(owo._config.catalog);

    s.start(`Fetching remote catalog from ${pc.dim("prod")}...`);
    const livePlans = await fetchPlans({ apiKey, apiUrl: apiUrl });
    const liveCreditSystems = await fetchCreditSystems(apiKey, apiUrl);
    const liveCreditPacks = await fetchCreditPacks(apiKey, apiUrl);
    s.stop("Remote catalog fetched");

    printDiff(
      diffPlans(
        localPayload?.plans ?? [],
        livePlans,
        localPayload?.creditSystems ?? [],
        liveCreditSystems,
        localPayload?.creditPacks ?? [],
        liveCreditPacks,
      ),
    );
  } else {
    p.log.step(pc.cyan("Sandbox Mode: Comparing with SANDBOX environment"));
    const apiUrl = `${testUrl}/api/v1`;

    s.start("Loading local configuration...");
    let owo: any;
    try {
      owo = await loadOwostackFromConfig(fullPath);
    } catch (e: any) {
      s.stop(pc.red("Failed to load configuration"));
      p.log.error(pc.red(`Error: ${e.message}`));
      p.log.info(
        pc.dim(
          "Make sure 'owostack' is installed in your project: 'npm install owostack'",
        ),
      );
      process.exit(1);
    }
    if (!owo || !owo._config) {
      s.stop(pc.red("Invalid configuration"));
      p.log.error("Config file must export an Owostack instance.");
      process.exit(1);
    }

    s.stop("Configuration loaded");

    const { buildSyncPayload } = (await import("owostack").catch(() => ({
      buildSyncPayload: null,
    }))) as any;
    const localPayload = buildSyncPayload(owo._config.catalog);

    s.start(`Fetching remote catalog from ${pc.dim("sandbox")}...`);
    const remotePlans = await fetchPlans({
      apiKey,
      apiUrl: apiUrl,
    });
    const remoteCreditSystems = await fetchCreditSystems(apiKey, apiUrl);
    const remoteCreditPacks = await fetchCreditPacks(apiKey, apiUrl);
    s.stop("Remote catalog fetched");

    printDiff(
      diffPlans(
        localPayload?.plans ?? [],
        remotePlans,
        localPayload?.creditSystems ?? [],
        remoteCreditSystems,
        localPayload?.creditPacks ?? [],
        remoteCreditPacks,
      ),
    );
  }

  p.outro(pc.green("Diff complete ✨"));
}
