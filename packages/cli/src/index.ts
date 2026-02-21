#!/usr/bin/env node

import { Command } from "commander";
import { runSync } from "./commands/sync.js";
import { runPull } from "./commands/pull.js";
import { runDiff } from "./commands/diff.js";
import { runInit } from "./commands/init.js";
import { runValidate } from "./commands/validate.js";
import { runConnect } from "./commands/connect.js";
import { printBrand } from "./lib/brand.js";

const program = new Command();

program
  .name("owostack")
  .description("CLI for Owostack billing infrastructure")
  .version("0.1.0");

program
  .command("sync")
  .description("Push catalog to the API")
  .option("--config <path>", "Path to config file", "./owo.config.ts")
  .option("--key <api-key>", "API secret key")
  .option("--prod", "Execute in both test and live environments")
  .option("--dry-run", "Show what would change without applying")
  .action(runSync);

program
  .command("pull")
  .description("Pull plans from dashboard into owo.config.ts")
  .option("--config <path>", "Path to config file", "./owo.config.ts")
  .option("--key <api-key>", "API secret key")
  .option("--force", "Overwrite existing config file", false)
  .option("--prod", "Execute in both test and live environments")
  .option("--dry-run", "Show what would change without applying")
  .action(runPull);

program
  .command("diff")
  .description("Compare local config to dashboard plans")
  .option("--config <path>", "Path to config file", "./owo.config.ts")
  .option("--key <api-key>", "API secret key")
  .option("--prod", "Execute in both test and live environments")
  .action(runDiff);

program
  .command("init")
  .description("Initialize owo.config.ts from dashboard")
  .option("--config <path>", "Path to config file", "./owo.config.ts")
  .option("--key <api-key>", "API secret key")
  .option("--force", "Overwrite existing config file", false)
  .action(runInit);

program
  .command("validate")
  .description("Validate local config without syncing")
  .option("--config <path>", "Path to config file", "./owo.config.ts")
  .option("--prod", "Execute in both test and live environments")
  .action(runValidate);

program
  .command("connect")
  .description("Connect CLI to dashboard via browser")
  .option("--no-browser", "Don't open the browser automatically")
  .action(runConnect);

program.parse();
