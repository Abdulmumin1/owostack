import pc from "picocolors";
import { loadOwostackFromConfig, resolveConfigPath } from "../lib/loader.js";
import { printDiff } from "../lib/diff.js";
import {
  announceMode,
  resolveCommandContext,
  type CommonCommandOptions,
} from "../lib/context.js";
import { CliError, EXIT_CODES, usageError } from "../lib/errors.js";
import type { Reporter } from "../lib/output.js";
import { computeCatalogDiff, summarizeDiff } from "./sync.js";

export interface DiffOptions extends CommonCommandOptions {
  /** Exit with code 3 when the local catalog differs from the remote one. */
  exitCode?: boolean;
}

export async function runDiff(options: DiffOptions, reporter: Reporter) {
  reporter.intro("diff");

  const fullPath = resolveConfigPath(options.config);
  if (!fullPath) {
    throw usageError(
      "config_not_found",
      "No configuration file found.",
      "Create one with `owosk init`, or pass --config <path>.",
    );
  }

  const ctx = await resolveCommandContext(options, reporter);
  announceMode(reporter, ctx, "comparing with");

  const s = reporter.spinner();
  s.start("Loading local configuration...");
  let owo: any;
  try {
    owo = await loadOwostackFromConfig(fullPath);
  } catch (e: any) {
    s.stop(pc.red("Failed to load configuration"));
    throw usageError(
      "config_invalid",
      `Could not load ${fullPath}: ${e.message}`,
      "Make sure 'owostack' is installed in your project: npm install owostack",
    );
  }
  if (!owo || !owo._config) {
    s.stop(pc.red("Invalid configuration"));
    throw usageError(
      "config_invalid",
      "Config file must export an Owostack instance.",
    );
  }
  s.stop("Configuration loaded");

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

  reporter.emit({
    ok: true,
    command: "diff",
    mode: ctx.mode,
    apiUrl: ctx.apiUrl,
    hasChanges,
    changes: summary,
  });

  if (hasChanges && options.exitCode) {
    throw new CliError(
      "cancelled",
      "Local catalog differs from remote (--exit-code).",
      EXIT_CODES.drift,
    );
  }

  reporter.outro(
    hasChanges
      ? pc.yellow("Catalog differs from remote")
      : pc.green("In sync ✨"),
  );
}
