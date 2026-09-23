#!/usr/bin/env node

import { Command, Option } from "commander";
import { runSync } from "./commands/sync.js";
import { runPull } from "./commands/pull.js";
import { runDiff } from "./commands/diff.js";
import { runInit } from "./commands/init.js";
import { runValidate } from "./commands/validate.js";
import { runConnect } from "./commands/connect.js";
import { printBrand } from "./lib/brand.js";
import { createReporter, reportFailure, type Reporter } from "./lib/output.js";
import { EXIT_CODES } from "./lib/errors.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const program = new Command();

const wantsJson = process.argv.includes("--json");
if (!wantsJson) printBrand();

program
  .name("owosk")
  .description(
    [
      "CLI for Owostack billing infrastructure.",
      "",
      "Environment (mode) is never guessed. Select it with --mode sandbox|live,",
      "OWOSTACK_MODE, or an environment-scoped key (owo_sk_test_… / owo_sk_live_…).",
      "",
      "Exit codes: 0 ok · 1 failed · 2 usage/config error · 3 drift (diff --exit-code)",
    ].join("\n"),
  )
  .version(pkg.version)
  // Deprecated global alias kept so `owosk --prod sync` keeps working.
  .addOption(new Option("--prod").hideHelp());

/** Flags shared by every command that talks to the API. */
function withApiOptions(command: Command): Command {
  return command
    .option("--config <path>", "Path to owo.config.ts")
    .option("--key <api-key>", "API secret key (or OWOSTACK_SECRET_KEY)")
    .addOption(
      new Option(
        "--mode <mode>",
        "Environment to target (or OWOSTACK_MODE)",
      ).choices(["sandbox", "live"]),
    )
    .addOption(
      new Option("--prod", "Deprecated alias for --mode live").hideHelp(),
    )
    .option(
      "--json",
      "Machine-readable JSON on stdout; no spinners or prompts",
    );
}

type Runner<T> = (options: T, reporter: Reporter) => Promise<void>;

/**
 * Run a command with uniform error handling and exit codes.
 * Global --prod is merged in for backwards compatibility.
 */
function run<T extends object>(name: string, runner: Runner<T>) {
  return async (options: T & { json?: boolean; prod?: boolean }) => {
    const merged = {
      ...options,
      prod: options.prod || program.opts().prod,
    } as T & { json?: boolean; prod?: boolean };
    const reporter = createReporter(merged.json);
    try {
      await runner(merged, reporter);
      process.exit(EXIT_CODES.ok);
    } catch (error) {
      process.exit(reportFailure(reporter, name, error));
    }
  };
}

withApiOptions(
  program
    .command("sync")
    .description("Push catalog to the selected environment"),
)
  .option("--dry-run", "Show what would change without applying")
  .option(
    "--yes",
    "Apply without the interactive prompt (required with --json)",
  )
  .action(run("sync", runSync));

withApiOptions(
  program
    .command("diff")
    .description("Compare local config to the remote catalog"),
)
  .option("--exit-code", "Exit with code 3 when the catalogs differ (for CI)")
  .action(run("diff", runDiff));

withApiOptions(
  program
    .command("pull")
    .description("Pull the remote catalog into owo.config.ts"),
)
  .option("--force", "Overwrite existing config file", false)
  .option("--dry-run", "Print the generated config without writing it")
  .action(run("pull", runPull));

withApiOptions(
  program
    .command("validate")
    .description(
      "Validate local config and check the environment is reachable",
    ),
).action(run("validate", runValidate));

program
  .command("init")
  .description("Initialize owo.config.ts from your sandbox catalog")
  .option("--config <path>", "Path to config file")
  .option("--key <api-key>", "API secret key")
  .option("--force", "Overwrite existing config file", false)
  .action(run("init", runInit));

program
  .command("connect")
  .description(
    "Connect CLI to dashboard via browser (issues sandbox + live keys)",
  )
  .option("--no-browser", "Don't open the browser automatically")
  .action(run("connect", runConnect));

program.parse();
