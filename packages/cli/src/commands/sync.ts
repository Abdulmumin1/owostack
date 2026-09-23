import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadOwostackFromConfig, resolveConfigPath } from "../lib/loader.js";
import {
  fetchPlans,
  fetchCreditSystems,
  fetchCreditPacks,
} from "../lib/api.js";
import { diffPlans, printDiff, type DiffResult } from "../lib/diff.js";
import {
  announceMode,
  resolveCommandContext,
  type CommonCommandOptions,
} from "../lib/context.js";
import { CliError, EXIT_CODES, failure, usageError } from "../lib/errors.js";
import { stripAnsi, type Reporter } from "../lib/output.js";

export interface SyncOptions extends CommonCommandOptions {
  dryRun?: boolean;
  yes?: boolean;
}

/** Plain (no ANSI) summary of a diff, used for --json and for change lists. */
export function summarizeDiff(diff: DiffResult) {
  const section = (s: {
    onlyLocal: string[];
    onlyRemote: string[];
    changed: { slug: string; details: string[] }[];
  }) => ({
    added: s.onlyLocal,
    removed: s.onlyRemote,
    changed: s.changed.map((item) => ({
      slug: item.slug,
      details: item.details.map(stripAnsi),
    })),
  });

  const plans = section(diff);
  const features = section(diff.features);
  const creditSystems = section(diff.creditSystems);
  const creditPacks = section(diff.creditPacks);
  const total = [plans, features, creditSystems, creditPacks].reduce(
    (n, s) => n + s.added.length + s.removed.length + s.changed.length,
    0,
  );

  return { plans, features, creditSystems, creditPacks, total };
}

function changeLines(diff: DiffResult): string[] {
  const lines: string[] = [];
  const push = (s: {
    onlyLocal: string[];
    onlyRemote: string[];
    changed: { slug: string; details: string[] }[];
  }) => {
    for (const slug of s.onlyLocal)
      lines.push(`${pc.green("+")} ${pc.bold(slug)}`);
    for (const slug of s.onlyRemote)
      lines.push(`${pc.red("-")} ${pc.bold(slug)}`);
    for (const item of s.changed) {
      lines.push(`${pc.cyan("~")} ${pc.bold(item.slug)}`);
      for (const detail of item.details) lines.push(`  ${detail}`);
    }
  };
  push(diff);
  push(diff.features);
  push(diff.creditSystems);
  push(diff.creditPacks);
  return lines;
}

function countsLine(diff: DiffResult): string {
  const part = (n: number, color: (s: string) => string, label: string) =>
    n > 0 ? `${color(pc.bold(String(n)))} ${label}` : "";
  return [
    part(diff.onlyLocal.length, pc.green, "plans added"),
    part(diff.onlyRemote.length, pc.red, "plans removed"),
    part(diff.changed.length, pc.cyan, "plans modified"),
    part(diff.creditSystems.onlyLocal.length, pc.green, "systems added"),
    part(diff.creditSystems.onlyRemote.length, pc.red, "systems removed"),
    part(diff.creditSystems.changed.length, pc.cyan, "systems modified"),
    part(diff.creditPacks.onlyLocal.length, pc.green, "packs added"),
    part(diff.creditPacks.onlyRemote.length, pc.red, "packs removed"),
    part(diff.creditPacks.changed.length, pc.cyan, "packs modified"),
  ]
    .filter(Boolean)
    .join(pc.dim("  ·  "));
}

async function loadCatalog(configPath: string | undefined, reporter: Reporter) {
  const fullPath = resolveConfigPath(configPath);
  if (!fullPath) {
    throw usageError(
      "config_not_found",
      `Configuration file not found.${configPath ? ` Looked at ${configPath}.` : " Searched the default locations."}`,
      "Create one with `owosk init`, or pass --config <path>.",
    );
  }

  const s = reporter.spinner();
  s.start(`Loading ${pc.cyan(fullPath)}`);

  let owo: any;
  try {
    owo = await loadOwostackFromConfig(fullPath);
  } catch (e: any) {
    s.stop(pc.red("Failed to load configuration"));
    throw usageError(
      "config_invalid",
      `Could not load ${fullPath}: ${e.message}`,
      "Make sure 'owostack' is installed in your project (npm install owostack) and the file exports an Owostack instance.",
    );
  }

  if (!owo || typeof owo.sync !== "function") {
    s.stop(pc.red("Invalid configuration"));
    throw usageError(
      "config_invalid",
      "Config file must export an Owostack instance.",
      'export default new Owostack({ secretKey: "...", catalog: [...] });',
    );
  }

  s.stop("Configuration loaded");
  return { owo, fullPath };
}

/**
 * Compute the local-vs-remote diff for a mode. Shared by sync and diff.
 */
export async function computeCatalogDiff(params: {
  owo: any;
  apiKey: string;
  apiUrl: string;
  reporter: Reporter;
  modeLabel: string;
}): Promise<DiffResult> {
  const { owo, apiKey, apiUrl, reporter } = params;
  const { buildSyncPayload } = (await import("owostack").catch(() => ({
    buildSyncPayload: null,
  }))) as any;
  const localPayload = buildSyncPayload?.(owo._config.catalog);

  const s = reporter.spinner();
  s.start(`Fetching remote catalog from ${pc.dim(params.modeLabel)}...`);
  const remotePlans = await fetchPlans({ apiKey, apiUrl });
  const remoteCreditSystems = await fetchCreditSystems(apiKey, apiUrl);
  const remoteCreditPacks = await fetchCreditPacks(apiKey, apiUrl);
  s.stop("Remote catalog fetched");

  return diffPlans({
    localPlans: localPayload?.plans ?? [],
    remotePlans,
    localFeatures: localPayload?.features ?? [],
    remoteFeatures: [],
    localCreditSystems: localPayload?.creditSystems ?? [],
    remoteCreditSystems,
    localCreditPacks: localPayload?.creditPacks ?? [],
    remoteCreditPacks,
  });
}

export async function runSync(options: SyncOptions, reporter: Reporter) {
  reporter.intro("sync");

  const ctx = await resolveCommandContext(options, reporter);
  announceMode(reporter, ctx, "syncing to");

  const { owo } = await loadCatalog(options.config, reporter);
  const diff = await computeCatalogDiff({
    owo,
    apiKey: ctx.apiKey,
    apiUrl: ctx.apiUrl,
    reporter,
    modeLabel: ctx.mode,
  });
  const summary = summarizeDiff(diff);
  const hasChanges = summary.total > 0;

  if (!reporter.json) printDiff(diff);

  const base = {
    ok: true,
    command: "sync",
    mode: ctx.mode,
    apiUrl: ctx.apiUrl,
    dryRun: !!options.dryRun,
    hasChanges,
    changes: summary,
  };

  if (!hasChanges) {
    reporter.outro(pc.green("Everything is already in sync! ✨"));
    reporter.emit({ ...base, applied: false });
    return;
  }

  if (options.dryRun) {
    reporter.info(pc.yellow("Dry run - no changes were applied."));
    reporter.emit({ ...base, applied: false });
    return;
  }

  if (!options.yes) {
    if (reporter.json) {
      throw usageError(
        "config_invalid",
        "Refusing to prompt in --json mode. Pass --yes to apply, or --dry-run to preview.",
      );
    }
    const confirm = await p.confirm({
      message: `Proceed with sync to ${pc.cyan(ctx.mode)}?`,
      initialValue: false,
    });
    if (p.isCancel(confirm) || !confirm) {
      reporter.outro(pc.yellow("Sync cancelled"));
      throw new CliError("cancelled", "Sync cancelled", EXIT_CODES.ok);
    }
  }

  const s = reporter.spinner();
  s.start(`Syncing with ${pc.cyan(ctx.mode)}...`);
  owo.setSecretKey(ctx.apiKey);
  owo.setApiUrl(ctx.apiUrl);

  let result: any;
  try {
    result = await owo.sync();
  } catch (e: any) {
    s.stop(pc.red("Sync failed"));
    throw failure("sync_failed", e?.message ?? "Sync failed");
  }

  if (!result?.success) {
    s.stop(pc.red("Sync failed"));
    throw failure(
      "sync_failed",
      result?.warnings?.length
        ? `Sync failed: ${result.warnings.join("; ")}`
        : "Sync failed",
    );
  }
  s.stop(pc.green("Sync completed"));

  const lines = changeLines(diff);
  if (lines.length > 0) {
    reporter.note(lines.join("\n"), "Changes applied");
    reporter.info(countsLine(diff));
  }
  if (result.warnings?.length) {
    reporter.warn(pc.yellow(`Warnings:\n${result.warnings.join("\n")}`));
  }

  reporter.outro(pc.green("Done! ✨"));
  reporter.emit({
    ...base,
    applied: true,
    result: {
      features: result.features,
      creditSystems: result.creditSystems,
      creditPacks: result.creditPacks,
      plans: result.plans,
      warnings: result.warnings ?? [],
    },
  });
}
