import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve, extname, isAbsolute } from "node:path";
import { getApiKey, getApiUrl, getTestApiUrl } from "../lib/config.js";
import { loadConfigSettings, resolveConfigPath } from "../lib/loader.js";
import { fetchPlans, fetchCreditSystems } from "../lib/api.js";
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
  const baseUrl = getApiUrl(configSettings.apiUrl);
  const filters = configSettings.filters || {};

  const format = determineFormat(fullPath);

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
      format,
    );

    if (options.dryRun) {
      p.note(configContent, "Generated Config (Dry Run)");
      p.outro(pc.yellow("Dry run complete. No changes made."));
      return;
    }

    if (existsSync(fullPath) && !options.force) {
      // If pull is updating existing file, force check might be weird if it's the intended behavior.
      // But typically pull overwrites. The flag --force implies protection.
      // But usually 'pull' implies "update my local state".
      // Let's keep existing logic but maybe warn.
      // Actually, if we resolved the path from default, we definitely want to overwrite it?
      // The original logic checked for existsSync(fullPath) && !options.force.
      // So 'pull' requires --force to overwrite? That seems strict for a 'pull' command.
      // Usually 'pull' overwrites local changes.
      // But let's respect the flag if that was the design.

      // Wait, if options.config was NOT provided, we found an existing file.
      // If we found it, we are about to overwrite it.
      // If !options.force, we fail?
      // That means `owostack pull` fails by default if config exists?
      // That seems wrong. `owostack pull` should update.
      // But let's look at original logic:
      /*
      if (existsSync(fullPath) && !options.force) {
        p.log.error(pc.red(`Config file already exists at ${fullPath}`));
        p.log.info(pc.dim("Use --force to overwrite."));
        process.exit(1);
      }
      */
      // Yes, original logic required --force. I will keep it.
      p.log.error(pc.red(`Config file already exists at ${fullPath}`));
      p.log.info(pc.dim("Use --force to overwrite."));
      process.exit(1);
    }

    await writeFile(fullPath, configContent, "utf8");
    p.log.success(pc.green(`Wrote configuration to ${fullPath}`));
  } else {
    // ... Non-prod mode ...
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

    const configContent = generateConfig(
      plans,
      creditSystems,
      defaultProvider,
      format,
    );

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
