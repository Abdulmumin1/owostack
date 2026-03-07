import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";
import { getApiKey, getDashboardUrl, getTestApiUrl } from "../lib/config.js";
import { loadConfigSettings, resolveConfigPath } from "../lib/loader.js";
import {
  buildRemoteCatalogSnapshot,
  determineConfigFormat,
} from "../lib/catalog-import.js";
import { executeConnectFlow } from "../lib/connect.js";

interface InitOptions {
  config?: string;
  key?: string;
  force?: boolean;
}

function getProjectInfo() {
  const cwd = process.cwd();
  const isTs = existsSync(join(cwd, "tsconfig.json"));
  return { isTs };
}

export async function runInit(options: InitOptions) {
  p.intro(pc.bgYellow(pc.black(" init ")));

  let targetPath = options.config;

  // If no path provided, try to find existing or determine default
  if (!targetPath) {
    const existing = resolveConfigPath();
    if (existing) {
      targetPath = existing;
    } else {
      const { isTs } = getProjectInfo();
      targetPath = isTs ? "owo.config.ts" : "owo.config.js";
    }
  }

  const fullPath = isAbsolute(targetPath)
    ? targetPath
    : resolve(process.cwd(), targetPath);
  const configSettings = await loadConfigSettings(options.config);
  const testUrl = getTestApiUrl(
    configSettings.environments?.test || configSettings.apiUrl,
  );
  const filters = configSettings.filters || {};

  let apiKey = getApiKey(options.key);

  if (!apiKey) {
    p.log.warn(
      pc.yellow("No API key found. Let's connect your account first."),
    );

    apiKey =
      (await executeConnectFlow({
        apiUrl: testUrl,
        dashboardUrl: getDashboardUrl(configSettings.connect?.dashboardUrl),
        noBrowser: false,
        timeout: configSettings.connect?.timeout || 300,
      })) || "";

    if (!apiKey) {
      p.log.error(pc.red("Could not obtain API key. Initialization aborted."));
      process.exit(1);
    }
  }

  if (existsSync(fullPath) && !options.force) {
    const confirm = await p.confirm({
      message: `Config file already exists at ${fullPath}. Overwrite?`,
      initialValue: false,
    });

    if (p.isCancel(confirm) || !confirm) {
      p.outro(pc.yellow("Initialization cancelled"));
      process.exit(0);
    }
  }

  const s = p.spinner();
  s.start("Generating project configuration...");

  try {
    const format = determineConfigFormat(fullPath);
    const snapshot = await buildRemoteCatalogSnapshot({
      apiKey,
      apiUrl: `${testUrl}/api/v1`,
      format,
      filters,
    });

    await writeFile(fullPath, snapshot.configContent, "utf8");

    s.stop(pc.green("Configuration created"));

    p.note(
      `${pc.dim("File:")} ${fullPath}\n${pc.dim("Format:")} ${format.toUpperCase()}\n${pc.dim("Plans:")} ${snapshot.plans.length} imported\n${pc.dim("Credit Systems:")} ${snapshot.creditSystems.length}\n${pc.dim("Credit Packs:")} ${snapshot.creditPacks.length}`,
      "✨ Project Initialized",
    );

    p.outro(
      pc.cyan(`Next step: Run ${pc.bold("owosk sync")} to apply your catalog.`),
    );
  } catch (e: any) {
    s.stop(pc.red("Initialization failed"));
    p.log.error(e.message);
    process.exit(1);
  }
}
