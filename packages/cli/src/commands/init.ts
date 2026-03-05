import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve, isAbsolute, extname } from "node:path";
import { getApiKey, getApiUrl, getDashboardUrl } from "../lib/config.js";
import { resolveConfigPath } from "../lib/loader.js";
import { fetchPlans, fetchCreditSystems } from "../lib/api.js";
import { generateConfig, ConfigFormat } from "../lib/generate.js";
import { executeConnectFlow } from "../lib/connect.js";

interface InitOptions {
  config?: string;
  key?: string;
  force?: boolean;
}

function getProjectInfo() {
  const cwd = process.cwd();
  const isTs = existsSync(join(cwd, "tsconfig.json"));
  let isEsm = false;
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    isEsm = pkg.type === "module";
  } catch {}
  return { isTs, isEsm };
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

  let apiKey = getApiKey(options.key);

  if (!apiKey) {
    p.log.warn(
      pc.yellow("No API key found. Let's connect your account first."),
    );

    apiKey =
      (await executeConnectFlow({
        apiUrl: getApiUrl(),
        dashboardUrl: getDashboardUrl(),
        noBrowser: false,
        timeout: 300,
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
    const apiUrl = `${getApiUrl()}/api/v1`;
    const plans = await fetchPlans({ apiKey, apiUrl: apiUrl });
    const creditSystems = await fetchCreditSystems(apiKey, apiUrl);

    // Determine format
    const ext = extname(fullPath);
    const { isEsm } = getProjectInfo();
    let format: ConfigFormat = "ts";

    if (ext === ".ts" || ext === ".mts" || ext === ".cts") {
      format = "ts";
    } else if (ext === ".mjs") {
      format = "esm";
    } else if (ext === ".cjs") {
      format = "cjs";
    } else if (ext === ".js") {
      format = isEsm ? "esm" : "cjs";
    }

    const configContent = generateConfig(
      plans,
      creditSystems,
      undefined,
      format,
    );
    await writeFile(fullPath, configContent, "utf8");

    s.stop(pc.green("Configuration created"));

    p.note(
      `${pc.dim("File:")} ${fullPath}\n${pc.dim("Format:")} ${format.toUpperCase()}\n${pc.dim("Plans:")} ${plans.length} imported\n${pc.dim("Credit Systems:")} ${creditSystems.length}`,
      "✨ Project Initialized",
    );

    p.outro(
      pc.cyan(
        `Next step: Run ${pc.bold("owostack sync")} to apply your catalog.`,
      ),
    );
  } catch (e: any) {
    s.stop(pc.red("Initialization failed"));
    p.log.error(e.message);
    process.exit(1);
  }
}
