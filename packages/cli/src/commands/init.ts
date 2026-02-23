import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import {
  getApiKey,
  getApiUrl,
  getTestApiUrl,
  getDashboardUrl,
} from "../lib/config.js";
import { resolveConfigPath } from "../lib/loader.js";
import { fetchPlans, fetchCreditSystems } from "../lib/api.js";
import { generateConfig } from "../lib/generate.js";
import { executeConnectFlow } from "../lib/connect.js";
import { printBrand } from "../lib/brand.js";

interface InitOptions {
  config: string;
  key?: string;
  force?: boolean;
}

export async function runInit(options: InitOptions) {
  p.intro(pc.bgYellow(pc.black(" init ")));

  const fullPath = resolveConfigPath(options.config);
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
    const plans = await fetchPlans({ apiKey, apiUrl: `${getApiUrl()}/api/v1` });
    const creditSystems = await fetchCreditSystems(
      apiKey,
      `${getApiUrl()}/api/v1`,
    );
    const configContent = generateConfig(plans, creditSystems);
    await writeFile(fullPath, configContent, "utf8");

    s.stop(pc.green("Configuration created"));

    p.note(
      `${pc.dim("File:")} ${fullPath}\n${pc.dim("Plans:")} ${plans.length} imported\n${pc.dim("Credit Systems:")} ${creditSystems.length}`,
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
