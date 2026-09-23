import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { resolveConfigPath } from "../lib/loader.js";
import {
  buildRemoteCatalogSnapshot,
  determineConfigFormat,
} from "../lib/catalog-import.js";
import {
  announceMode,
  resolveCommandContext,
  type CommonCommandOptions,
} from "../lib/context.js";
import { CliError, EXIT_CODES, usageError } from "../lib/errors.js";
import type { Reporter } from "../lib/output.js";

export interface PullOptions extends CommonCommandOptions {
  force?: boolean;
  dryRun?: boolean;
}

export async function runPull(options: PullOptions, reporter: Reporter) {
  reporter.intro("pull");

  let fullPath: string;

  if (options.config) {
    fullPath = isAbsolute(options.config)
      ? options.config
      : resolve(process.cwd(), options.config);
  } else {
    const resolved = resolveConfigPath();
    if (!resolved) {
      throw usageError(
        "config_not_found",
        "No configuration file found. Run 'owosk init' first, or pass --config <path>.",
      );
    }
    fullPath = resolved;
  }

  const ctx = await resolveCommandContext(options, reporter);
  const filters = ctx.settings.filters || {};
  const modeLabel = ctx.mode;

  let format;
  try {
    format = determineConfigFormat(fullPath);
  } catch (e: any) {
    throw usageError("config_invalid", e.message);
  }

  announceMode(reporter, ctx, "pulling from");

  const s = p.spinner();
  s.start(`Fetching remote catalog from ${pc.dim(modeLabel)}...`);
  const snapshot = await buildRemoteCatalogSnapshot({
    apiKey: ctx.apiKey,
    apiUrl: ctx.apiUrl,
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
      message: `Config file already exists at ${fullPath}. Overwrite?`,
      initialValue: false,
    });

    if (p.isCancel(confirm) || !confirm) {
      p.outro(pc.yellow("Operation cancelled"));
      throw new CliError("cancelled", "Operation cancelled", EXIT_CODES.ok);
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
