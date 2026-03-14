import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { getApiKey, getLiveApiUrl, getTestApiUrl } from "../lib/config.js";
import { loadConfigSettings, resolveConfigPath } from "../lib/loader.js";
import {
  buildRemoteCatalogSnapshot,
  determineConfigFormat,
} from "../lib/catalog-import.js";

interface PullOptions {
  config?: string;
  key?: string;
  force?: boolean;
  prod?: boolean;
  dryRun?: boolean;
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
  const liveUrl = getLiveApiUrl(configSettings.environments?.live);
  const filters = configSettings.filters || {};

  let format;
  try {
    format = determineConfigFormat(fullPath);
  } catch (e: any) {
    p.log.error(pc.red(e.message));
    process.exit(1);
  }

  const s = p.spinner();

  const modeLabel = options.prod ? "prod" : "sandbox";
  const modeMessage = options.prod
    ? pc.magenta("Production Mode: Pulling from PROD environment")
    : pc.cyan("Sandbox Mode: Pulling from SANDBOX environment");
  const apiUrl = `${options.prod ? liveUrl : testUrl}/api/v1`;

  p.log.step(modeMessage);

  s.start(`Fetching remote catalog from ${pc.dim(modeLabel)}...`);
  const snapshot = await buildRemoteCatalogSnapshot({
    apiKey,
    apiUrl,
    format,
    filters,
  });
  s.stop(
    `Fetched ${snapshot.plans.length} plans, ${snapshot.creditSystems.length} credit systems, and ${snapshot.creditPacks.length} credit packs from ${modeLabel}`,
  );

  if (options.dryRun) {
    p.note(snapshot.configContent, "Generated Config (Dry Run)");
    printPullSummary(
      snapshot.plans,
      snapshot.creditSystems,
      snapshot.creditPacks,
    );
    p.outro(pc.yellow("Dry run complete. No changes made."));
    return;
  }

  if (existsSync(fullPath) && !options.force) {
    const confirm = await p.confirm({
      message: `Config file already exists${options.prod ? ` at ${fullPath}` : ""}. Overwrite?`,
      initialValue: false,
    });

    if (p.isCancel(confirm) || !confirm) {
      p.outro(pc.yellow("Operation cancelled"));
      process.exit(0);
    }
  }

  await writeFile(fullPath, snapshot.configContent, "utf8");
  p.log.success(pc.green(`Wrote configuration to ${fullPath}`));

  printPullSummary(
    snapshot.plans,
    snapshot.creditSystems,
    snapshot.creditPacks,
  );

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
