import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { getApiKey, getApiUrl, getTestApiUrl } from "../lib/config.js";
import { loadConfigSettings, resolveConfigPath } from "../lib/loader.js";
import { fetchPlans, fetchCreditSystems } from "../lib/api.js";
import { generateConfig } from "../lib/generate.js";
import { printBrand } from "../lib/brand.js";

interface PullOptions {
  config: string;
  key?: string;
  force?: boolean;
  prod?: boolean;
  dryRun?: boolean;
}

export async function runPull(options: PullOptions) {
  p.intro(pc.bgYellow(pc.black(" pull ")));

  const fullPath = resolveConfigPath(options.config);
  const apiKey = getApiKey(options.key);
  const configSettings = await loadConfigSettings(options.config);
  const baseUrl = getApiUrl(configSettings.apiUrl);
  const filters = configSettings.filters || {};

  const s = p.spinner();

  if (options.prod) {
    p.log.step(pc.magenta("Production Mode: Fetching both environments"));

    const testUrl = getTestApiUrl(configSettings.environments?.test);
    const liveUrl = getApiUrl(configSettings.environments?.live);

    s.start(`Fetching from ${pc.dim("test")}...`);
    const testPlans = await fetchPlans({
      apiKey,
      apiUrl: `${testUrl}/api/v1`,
      ...filters,
    });
    s.stop(`Fetched ${testPlans.length} plans from test`);

    s.start(`Fetching from ${pc.dim("live")}...`);
    const livePlans = await fetchPlans({
      apiKey,
      apiUrl: `${liveUrl}/api/v1`,
      ...filters,
    });
    s.stop(`Fetched ${livePlans.length} plans from live`);

    s.start(`Fetching credit systems...`);
    const creditSystems = await fetchCreditSystems(apiKey, `${liveUrl}/api/v1`);
    s.stop(`Fetched ${creditSystems.length} credit systems`);

    // Detect common provider for default
    const providers = new Set(
      livePlans.map((p: any) => p.provider).filter(Boolean),
    );
    const defaultProvider =
      providers.size === 1 ? Array.from(providers)[0] : undefined;

    const configContent = generateConfig(
      livePlans,
      creditSystems,
      defaultProvider,
    );

    if (options.dryRun) {
      p.note(configContent, "Generated Config (Dry Run)");
      p.outro(pc.yellow("Dry run complete. No changes made."));
      return;
    }

    if (existsSync(fullPath) && !options.force) {
      p.log.error(pc.red(`Config file already exists at ${fullPath}`));
      p.log.info(pc.dim("Use --force to overwrite."));
      process.exit(1);
    }

    await writeFile(fullPath, configContent, "utf8");
    p.log.success(pc.green(`Wrote configuration to ${fullPath}`));
  } else {
    s.start(`Fetching plans from ${pc.dim(baseUrl)}...`);
    const plans = await fetchPlans({
      apiKey,
      apiUrl: `${baseUrl}/api/v1`,
      ...filters,
    });
    s.stop(`Fetched ${plans.length} plans`);

    s.start(`Fetching credit systems...`);
    const creditSystems = await fetchCreditSystems(apiKey, `${baseUrl}/api/v1`);
    s.stop(`Fetched ${creditSystems.length} credit systems`);

    // Detect common provider for default
    const providers = new Set(
      plans.map((p: any) => p.provider).filter(Boolean),
    );
    const defaultProvider =
      providers.size === 1 ? Array.from(providers)[0] : undefined;

    const configContent = generateConfig(plans, creditSystems, defaultProvider);

    if (options.dryRun) {
      p.note(configContent, "Generated Config (Dry Run)");
      p.outro(pc.yellow("Dry run complete. No changes made."));
      return;
    }

    if (existsSync(fullPath) && !options.force) {
      const confirm = await p.confirm({
        message: `Config file already exists. Overwrite?`,
        initialValue: false,
      });

      if (p.isCancel(confirm) || !confirm) {
        p.outro(pc.yellow("Operation cancelled"));
        process.exit(0);
      }
    }

    await writeFile(fullPath, configContent, "utf8");
    p.log.success(pc.green(`Wrote configuration to ${fullPath}`));
  }

  p.outro(pc.green("Pull complete! ✨"));
}
