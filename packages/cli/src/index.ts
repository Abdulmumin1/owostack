#!/usr/bin/env node

import { Command } from "commander";
import { runSync } from "./commands/sync.js";
import { runPull } from "./commands/pull.js";
import { runDiff } from "./commands/diff.js";
import { runInit } from "./commands/init.js";
import { runValidate } from "./commands/validate.js";
import { runConnect } from "./commands/connect.js";
import { printBrand } from "./lib/brand.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const program = new Command();

printBrand();
program
  .name("owostack")
  .description("CLI for Owostack billing infrastructure")
  .version(pkg.version)
  .option("--prod", "Execute in production environment (default: sandbox)");

program
  .command("sync")
  .description("Push catalog to the API")
  .option("--config <path>", "Path to config file")
  .option("--key <api-key>", "API secret key")
  .option("--dry-run", "Show what would change without applying")
  .option("--yes", "Auto-approve changes without interactive prompt")
  .action((options) => runSync({ ...options, ...program.opts() }));

program
  .command("pull")
  .description("Pull plans from dashboard into owo.config.ts")
  .option("--config <path>", "Path to config file")
  .option("--key <api-key>", "API secret key")
  .option("--force", "Overwrite existing config file", false)
  .option("--dry-run", "Show what would change without applying")
  .action((options) => runPull({ ...options, ...program.opts() }));

program
  .command("diff")
  .description("Compare local config to dashboard plans")
  .option("--config <path>", "Path to config file")
  .option("--key <api-key>", "API secret key")
  .action((options) => runDiff({ ...options, ...program.opts() }));

program
  .command("init")
  .description("Initialize owo.config.ts from dashboard")
  .option("--config <path>", "Path to config file")
  .option("--key <api-key>", "API secret key")
  .option("--force", "Overwrite existing config file", false)
  .action(runInit);

program
  .command("validate")
  .description("Validate local config without syncing")
  .option("--config <path>", "Path to config file")
  .action((options) => runValidate({ ...options, ...program.opts() }));

program
  .command("connect")
  .description("Connect CLI to dashboard via browser")
  .option("--no-browser", "Don't open the browser automatically")
  .action(runConnect);

program.parse();
