import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  getApiKey,
  getLiveApiUrl,
  getTestApiUrl,
} from "../lib/config.js";
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
import { diffPlans, printDiff, DiffResult } from "../lib/diff.js";

interface SyncOptions {
  config?: string;
  dryRun?: boolean;
  key?: string;
  prod?: boolean;
  yes?: boolean;
}

async function runSyncSingle(options: {
  configPath?: string;
  dryRun: boolean;
  autoApprove: boolean;
  apiKey: string;
  apiUrl: string;
  environment: string;
}) {
  const { configPath, dryRun, autoApprove, environment } = options;
  const apiKey = getApiKey(options.apiKey);
  // Construct full API URL with /api/v1
  const apiUrl = `${options.apiUrl}/api/v1`;
  const fullPath = resolveConfigPath(configPath);

  if (!fullPath) {
    p.log.error(
      pc.red(
        `Configuration file not found.${configPath ? ` looked at ${configPath}` : " searched defaults."}`,
      ),
    );
    process.exit(1);
  }

  const s = p.spinner();
  s.start(`Loading ${pc.cyan(fullPath)}`);

  let owo: any;
  try {
    owo = await loadOwostackFromConfig(fullPath);
  } catch (e: any) {
    s.stop(pc.red("Failed to load configuration"));
    p.log.error(pc.red(`Error: ${e.message}`));
    p.note(
      `import { Owostack, metered, boolean, plan } from "owostack";\nexport default new Owostack({ secretKey: "...", catalog: [...] });`,
      "Example owo.config.ts",
    );
    p.log.info(
      pc.dim(
        "Make sure 'owostack' is installed in your project: 'npm install owostack'",
      ),
    );
    process.exit(1);
  }

  if (!owo || typeof owo.sync !== "function") {
    s.stop(pc.red("Invalid configuration"));
    p.log.error("Config file must export an Owostack instance.");
    process.exit(1);
  }

  s.stop("Configuration loaded");

  // Build payload for diff
  const { buildSyncPayload } = (await import("owostack").catch(() => ({
    buildSyncPayload: null,
  }))) as any;
  const localPayload = buildSyncPayload?.(owo._config.catalog);

  // Fetch remote state for diff
  s.start(`Fetching remote catalog from ${pc.dim(environment)}...`);
  const remotePlans = await fetchPlans({ apiKey, apiUrl: apiUrl });
  const remoteCreditSystems = await fetchCreditSystems(apiKey, apiUrl);
  const remoteCreditPacks = await fetchCreditPacks(apiKey, apiUrl);
  s.stop("Remote catalog fetched");

  // Show diff
  const diff = diffPlans(
    localPayload?.plans ?? [],
    remotePlans,
    localPayload?.creditSystems ?? [],
    remoteCreditSystems,
    localPayload?.creditPacks ?? [],
    remoteCreditPacks,
  );
  printDiff(diff);

  // Check if there are any changes
  const hasChanges =
    diff.onlyLocal.length > 0 ||
    diff.onlyRemote.length > 0 ||
    diff.changed.length > 0 ||
    diff.creditSystems.onlyLocal.length > 0 ||
    diff.creditSystems.onlyRemote.length > 0 ||
    diff.creditSystems.changed.length > 0 ||
    diff.creditPacks.onlyLocal.length > 0 ||
    diff.creditPacks.onlyRemote.length > 0 ||
    diff.creditPacks.changed.length > 0;

  if (!hasChanges) {
    p.outro(pc.green("Everything is already in sync! ✨"));
    return;
  }

  // If dry run, stop here
  if (dryRun) {
    p.log.info(pc.yellow("Dry run - no changes were applied."));
    return;
  }

  // Interactive confirmation (unless --yes flag)
  if (!autoApprove) {
    const confirm = await p.confirm({
      message: `Proceed with sync to ${pc.cyan(environment)}?`,
      initialValue: false,
    });

    if (p.isCancel(confirm) || !confirm) {
      p.outro(pc.yellow("Sync cancelled"));
      process.exit(0);
    }
  }

  // Proceed with sync
  s.start(`Syncing with ${pc.cyan(environment)}...`);

  if (apiKey && typeof owo.setSecretKey === "function") {
    owo.setSecretKey(apiKey);
  }
  if (apiUrl && typeof owo.setApiUrl === "function") {
    // SDK expects the full base URL including /api/v1
    owo.setApiUrl(apiUrl);
  }

  try {
    const result = await owo.sync();
    s.stop(pc.green("Sync completed"));

    if (!result.success) {
      p.log.error(pc.red("Sync failed"));
      process.exit(1);
    }

    // Use the diff data to show detailed changes, same format as Plans Diff
    const lines: string[] = [];

    // Plans changes
    if (diff.onlyLocal.length > 0) {
      for (const slug of diff.onlyLocal) {
        lines.push(`${pc.green("+")} ${pc.bold(slug)}`);
      }
    }
    if (diff.onlyRemote.length > 0) {
      for (const slug of diff.onlyRemote) {
        lines.push(`${pc.red("-")} ${pc.bold(slug)}`);
      }
    }
    if (diff.changed.length > 0) {
      for (const item of diff.changed) {
        lines.push(`${pc.cyan("~")} ${pc.bold(item.slug)}`);
        for (const detail of item.details) {
          lines.push(`  ${detail}`);
        }
      }
    }

    // Credit Systems changes
    if (diff.creditSystems.onlyLocal.length > 0) {
      for (const slug of diff.creditSystems.onlyLocal) {
        lines.push(`${pc.green("+")} ${pc.bold(slug)}`);
      }
    }
    if (diff.creditSystems.onlyRemote.length > 0) {
      for (const slug of diff.creditSystems.onlyRemote) {
        lines.push(`${pc.red("-")} ${pc.bold(slug)}`);
      }
    }
    if (diff.creditSystems.changed.length > 0) {
      for (const item of diff.creditSystems.changed) {
        lines.push(`${pc.cyan("~")} ${pc.bold(item.slug)}`);
        for (const detail of item.details) {
          lines.push(`  ${detail}`);
        }
      }
    }

    // Credit Packs changes
    if (diff.creditPacks.onlyLocal.length > 0) {
      for (const slug of diff.creditPacks.onlyLocal) {
        lines.push(`${pc.green("+")} ${pc.bold(slug)}`);
      }
    }
    if (diff.creditPacks.onlyRemote.length > 0) {
      for (const slug of diff.creditPacks.onlyRemote) {
        lines.push(`${pc.red("-")} ${pc.bold(slug)}`);
      }
    }
    if (diff.creditPacks.changed.length > 0) {
      for (const item of diff.creditPacks.changed) {
        lines.push(`${pc.cyan("~")} ${pc.bold(item.slug)}`);
        for (const detail of item.details) {
          lines.push(`  ${detail}`);
        }
      }
    }

    if (lines.length > 0) {
      p.note(lines.join("\n"), "Changes applied");

      const counts = [
        diff.onlyLocal.length > 0
          ? `${pc.green(pc.bold(diff.onlyLocal.length.toString()))} plans added`
          : "",
        diff.onlyRemote.length > 0
          ? `${pc.red(pc.bold(diff.onlyRemote.length.toString()))} plans removed`
          : "",
        diff.changed.length > 0
          ? `${pc.cyan(pc.bold(diff.changed.length.toString()))} plans modified`
          : "",
        diff.creditSystems.onlyLocal.length > 0
          ? `${pc.green(pc.bold(diff.creditSystems.onlyLocal.length.toString()))} systems added`
          : "",
        diff.creditSystems.onlyRemote.length > 0
          ? `${pc.red(pc.bold(diff.creditSystems.onlyRemote.length.toString()))} systems removed`
          : "",
        diff.creditSystems.changed.length > 0
          ? `${pc.cyan(pc.bold(diff.creditSystems.changed.length.toString()))} systems modified`
          : "",
        diff.creditPacks.onlyLocal.length > 0
          ? `${pc.green(pc.bold(diff.creditPacks.onlyLocal.length.toString()))} packs added`
          : "",
        diff.creditPacks.onlyRemote.length > 0
          ? `${pc.red(pc.bold(diff.creditPacks.onlyRemote.length.toString()))} packs removed`
          : "",
        diff.creditPacks.changed.length > 0
          ? `${pc.cyan(pc.bold(diff.creditPacks.changed.length.toString()))} packs modified`
          : "",
      ]
        .filter(Boolean)
        .join(pc.dim("  ·  "));

      p.log.info(counts);
    } else {
      p.log.success(pc.dim("No changes detected. Catalog is up to date."));
    }

    if (result.warnings && result.warnings.length) {
      p.log.warn(pc.yellow(`Warnings:\n${result.warnings.join("\n")}`));
    }
  } catch (e: any) {
    s.stop(pc.red("Sync failed"));
    p.log.error(e.message);
    throw e;
  }
}

export async function runSync(options: SyncOptions) {
  p.intro(pc.bgYellow(pc.black(" sync ")));

  const configSettings = await loadConfigSettings(options.config);
  const testUrl = getTestApiUrl(configSettings.environments?.test);
  const liveUrl = getLiveApiUrl(configSettings.environments?.live);

  // Default to sandbox environment, prod only with --prod flag
  if (options.prod) {
    p.log.step(pc.magenta("Production Mode: Syncing to PROD environment"));

    await runSyncSingle({
      configPath: options.config,
      dryRun: !!options.dryRun,
      autoApprove: !!options.yes,
      apiKey: options.key || "",
      apiUrl: liveUrl,
      environment: "prod",
    });
  } else {
    p.log.step(pc.cyan("Sandbox Mode: Syncing to SANDBOX environment"));

    await runSyncSingle({
      configPath: options.config,
      dryRun: !!options.dryRun,
      autoApprove: !!options.yes,
      apiKey: options.key || "",
      apiUrl: testUrl,
      environment: "sandbox",
    });
  }

  p.outro(pc.green("Done! ✨"));
}
