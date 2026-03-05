import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve, extname, isAbsolute } from "node:path";
import { getApiKey, getApiUrl, getTestApiUrl } from "../lib/config.js";
import { loadConfigSettings, resolveConfigPath } from "../lib/loader.js";
import {
  fetchPlans,
  fetchCreditSystems,
  fetchCreditPacks,
} from "../lib/api.js";
import { generateConfig, ConfigFormat } from "../lib/generate.js";

interface PullOptions {
  config?: string;
  key?: string;
  force?: boolean;
  prod?: boolean;
  dryRun?: boolean;
}

function getProjectInfo() {
  const cwd = process.cwd();
  let isEsm = false;
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    isEsm = pkg.type === "module";
  } catch {}
  return { isEsm };
}

function determineFormat(fullPath: string): ConfigFormat {
  const ext = extname(fullPath);
  const { isEsm } = getProjectInfo();

  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return "ts";
  if (ext === ".mjs") return "esm";
  if (ext === ".cjs") return "cjs";
  if (ext === ".js") return isEsm ? "esm" : "cjs";
  return "ts"; // default
}

export async function runPull(options: PullOptions) {
  p.intro(pc.bgYellow(pc.black(" pull ")));

  let fullPath: string;

  if (options.config) {
    fullPath = isAbsolute(options.config)
      ? options.config
      : resolve(process.cwd(), options.config);
  } else {
    const resolved = resolveConfigPath();
    if (!resolved) {
      p.log.error(
        pc.red("No configuration file found. Run 'owostack init' first."),
      );
      process.exit(1);
    }
    fullPath = resolved;
  }

  const apiKey = getApiKey(options.key);
  const configSettings = await loadConfigSettings(options.config);
  const testUrl = getTestApiUrl(configSettings.environments?.test);
  const liveUrl = getApiUrl(configSettings.environments?.live);
  const filters = configSettings.filters || {};

  const format = determineFormat(fullPath);

  const s = p.spinner();

  // Default to sandbox environment, prod only with --prod flag
  if (options.prod) {
    p.log.step(pc.magenta("Production Mode: Pulling from PROD environment"));
    const apiUrl = `${liveUrl}/api/v1`;

    s.start(`Fetching plans from ${pc.dim("prod")}...`);
    const plans = await fetchPlans({
      apiKey,
      apiUrl: apiUrl,
      ...filters,
    });
    s.stop(`Fetched ${plans.length} plans from prod`);

    s.start(`Fetching credit systems...`);
    const creditSystems = await fetchCreditSystems(apiKey, apiUrl);
    s.stop(`Fetched ${creditSystems.length} credit systems`);

    s.start(`Fetching credit packs...`);
    const creditPacks = await fetchCreditPacks(apiKey, apiUrl);
    s.stop(`Fetched ${creditPacks.length} credit packs`);

    // Detect common provider for default
    const providers = new Set(
      plans.map((p: any) => p.provider).filter(Boolean),
    );
    const defaultProvider =
      providers.size === 1 ? Array.from(providers)[0] : undefined;

    const configContent = generateConfig(
      plans,
      creditSystems,
      creditPacks,
      defaultProvider,
      format,
    );

    if (options.dryRun) {
      p.note(configContent, "Generated Config (Dry Run)");
      printPullSummary(plans, creditSystems, creditPacks);
      p.outro(pc.yellow("Dry run complete. No changes made."));
      return;
    }

    if (existsSync(fullPath) && !options.force) {
      const confirm = await p.confirm({
        message: `Config file already exists at ${fullPath}. Overwrite?`,
        initialValue: false,
      });

      if (p.isCancel(confirm) || !confirm) {
        p.outro(pc.yellow("Operation cancelled"));
        process.exit(0);
      }
    }

    await writeFile(fullPath, configContent, "utf8");
    p.log.success(pc.green(`Wrote configuration to ${fullPath}`));

    printPullSummary(plans, creditSystems, creditPacks);
  } else {
    p.log.step(pc.cyan("Sandbox Mode: Pulling from SANDBOX environment"));
    const apiUrl = `${testUrl}/api/v1`;

    s.start(`Fetching plans from ${pc.dim("sandbox")}...`);
    const plans = await fetchPlans({
      apiKey,
      apiUrl: apiUrl,
      ...filters,
    });
    s.stop(`Fetched ${plans.length} plans from sandbox`);

    s.start(`Fetching credit systems...`);
    const creditSystems = await fetchCreditSystems(apiKey, apiUrl);
    s.stop(`Fetched ${creditSystems.length} credit systems`);

    s.start(`Fetching credit packs...`);
    const creditPacks = await fetchCreditPacks(apiKey, apiUrl);
    s.stop(`Fetched ${creditPacks.length} credit packs`);

    // Detect common provider for default
    const providers = new Set(
      plans.map((p: any) => p.provider).filter(Boolean),
    );
    const defaultProvider =
      providers.size === 1 ? Array.from(providers)[0] : undefined;

    const configContent = generateConfig(
      plans,
      creditSystems,
      creditPacks,
      defaultProvider,
      format,
    );

    if (options.dryRun) {
      p.note(configContent, "Generated Config (Dry Run)");
      printPullSummary(plans, creditSystems, creditPacks);
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

    printPullSummary(plans, creditSystems, creditPacks);
  }

  p.outro(pc.green("Pull complete! ✨"));
}

function printPullSummary(
  plans: any[],
  creditSystems: any[],
  creditPacks: any[] = [],
) {
  const featureSlugs = new Set<string>();
  for (const plan of plans) {
    for (const f of plan.features || []) {
      featureSlugs.add(f.slug);
    }
  }

  const lines: string[] = [];
  for (const plan of plans) {
    const featureCount = (plan.features || []).length;
    lines.push(
      `${pc.green("↓")} ${pc.bold(plan.slug)} ${pc.dim(`${plan.currency} ${plan.price}/${plan.interval}`)} ${pc.dim(`(${featureCount} features)`)} ${plan.isAddon ? pc.cyan("(addon)") : ""}`,
    );
  }

  if (creditSystems.length > 0) {
    lines.push("");
    for (const cs of creditSystems) {
      const childCount = (cs.features || []).length;
      lines.push(
        `${pc.green("↓")} ${pc.bold(cs.slug)} ${pc.dim(`credit system (${childCount} features)`)}`,
      );
    }
  }

  if (creditPacks.length > 0) {
    lines.push("");
    for (const pack of creditPacks) {
      lines.push(
        `${pc.green("↓")} ${pc.bold(pack.slug)} ${pc.dim(`${pack.currency} ${pack.price} for ${pack.credits} credits`)} ${pc.cyan("(pack)")}`,
      );
    }
  }

  p.note(lines.join("\n"), "Pulled");

  const counts = [
    `${pc.bold(plans.length.toString())} plans`,
    `${pc.bold(featureSlugs.size.toString())} features`,
    creditSystems.length > 0
      ? `${pc.bold(creditSystems.length.toString())} credit systems`
      : "",
  ]
    .filter(Boolean)
    .join(pc.dim("  ·  "));

  p.log.info(counts);
}
