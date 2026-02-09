#!/usr/bin/env node

import { resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (command === "sync") {
  await runSync(args.slice(1));
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

function printHelp() {
  console.log(`
  owostack CLI

  Usage:
    owostack sync [options]     Push catalog to the API

  Sync Options:
    --config <path>             Path to your owostack config file (default: ./owo.config.ts)
    --dry-run                   Show what would change without applying
    --key <api-key>             API secret key (or set OWOSTACK_SECRET_KEY env var)
    --url <api-url>             API URL override (default: https://api.owostack.dev)

  Examples:
    owostack sync
    owostack sync --config ./src/billing.ts
    owostack sync --dry-run
    owostack sync --key sk_test_abc123
  `);
}

async function runSync(syncArgs: string[]) {
  // Parse args
  let configPath = "./owo.config.ts";
  let dryRun = false;
  let apiKey = process.env.OWOSTACK_SECRET_KEY || process.env.OWOSTACK_API_KEY || "";
  let apiUrl = "";

  for (let i = 0; i < syncArgs.length; i++) {
    switch (syncArgs[i]) {
      case "--config":
        configPath = syncArgs[++i];
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--key":
        apiKey = syncArgs[++i];
        break;
      case "--url":
        apiUrl = syncArgs[++i];
        break;
    }
  }

  // Resolve config file
  const fullPath = isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath);

  console.log(`\n  📦 Owostack Sync\n`);
  console.log(`  Config: ${fullPath}`);

  let configModule: any;
  try {
    const fileUrl = pathToFileURL(fullPath).href;
    configModule = await import(fileUrl);
  } catch (e: any) {
    console.error(`\n  ❌ Failed to load config from ${fullPath}`);
    console.error(`     ${e.message}\n`);
    console.error(`  Make sure the file exports an Owostack instance as default or named 'owo'.`);
    console.error(`  Example owo.config.ts:\n`);
    console.error(`    import { Owostack, metered, boolean, plan } from "@owostack/core";`);
    console.error(`    export default new Owostack({ secretKey: "...", catalog: [...] });\n`);
    process.exit(1);
  }

  // Find the Owostack instance (default export or named 'owo')
  const owo = configModule.default || configModule.owo;

  if (!owo || typeof owo.sync !== "function") {
    console.error(`\n  ❌ Config file must export an Owostack instance with a catalog.`);
    console.error(`     Expected: default export or named export 'owo'\n`);
    process.exit(1);
  }

  // Override API key/URL if provided via CLI
  if (apiKey && typeof owo.setSecretKey === "function") {
    owo.setSecretKey(apiKey);
  }
  if (apiUrl && typeof owo.setApiUrl === "function") {
    owo.setApiUrl(apiUrl);
  }

  if (dryRun) {
    console.log(`  Mode: Dry run (no changes will be applied)\n`);
    // For dry run, we just show the payload that would be sent
    const { buildSyncPayload } = await import("@owostack/core").catch(() => {
      return { buildSyncPayload: null };
    }) as any;

    if (buildSyncPayload && owo._config?.catalog) {
      const payload = buildSyncPayload(owo._config.catalog);
      console.log(`  Features (${payload.features.length}):`);
      for (const f of payload.features) {
        console.log(`    - ${f.slug} (${f.type})`);
      }
      console.log(`\n  Plans (${payload.plans.length}):`);
      for (const p of payload.plans) {
        console.log(`    - ${p.slug} (${p.currency} ${p.price} / ${p.interval})`);
        for (const f of p.features) {
          const status = f.enabled ? "✓" : "✗";
          const limit = f.limit === null ? "unlimited" : f.limit === undefined ? "" : `limit: ${f.limit}`;
          console.log(`      ${status} ${f.slug} ${limit}`);
        }
      }
    }
    console.log(`\n  ✅ Dry run complete — no changes applied.\n`);
    process.exit(0);
  }

  // Run sync
  console.log(`  Syncing...\n`);

  try {
    const result = await owo.sync();

    if (!result.success) {
      console.error(`  ❌ Sync failed\n`);
      process.exit(1);
    }

    // Features
    const fc = result.features;
    console.log(`  Features:`);
    if (fc.created.length) console.log(`    Created: ${fc.created.join(", ")}`);
    if (fc.updated.length) console.log(`    Updated: ${fc.updated.join(", ")}`);
    if (fc.unchanged.length) console.log(`    Unchanged: ${fc.unchanged.join(", ")}`);
    if (!fc.created.length && !fc.updated.length && !fc.unchanged.length) {
      console.log(`    (none)`);
    }

    // Plans
    const pc = result.plans;
    console.log(`\n  Plans:`);
    if (pc.created.length) console.log(`    Created: ${pc.created.join(", ")}`);
    if (pc.updated.length) console.log(`    Updated: ${pc.updated.join(", ")}`);
    if (pc.unchanged.length) console.log(`    Unchanged: ${pc.unchanged.join(", ")}`);
    if (!pc.created.length && !pc.updated.length && !pc.unchanged.length) {
      console.log(`    (none)`);
    }

    // Warnings
    if (result.warnings.length) {
      console.log(`\n  ⚠️  Warnings:`);
      for (const w of result.warnings) {
        console.log(`    - ${w}`);
      }
    }

    const totalChanges = fc.created.length + fc.updated.length + pc.created.length + pc.updated.length;
    console.log(`\n  ✅ Sync complete — ${totalChanges} change${totalChanges !== 1 ? "s" : ""} applied.\n`);
  } catch (e: any) {
    console.error(`\n  ❌ Sync failed: ${e.message}\n`);
    process.exit(1);
  }
}
