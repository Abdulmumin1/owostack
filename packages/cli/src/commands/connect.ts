import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync } from "node:fs";
import {
  getApiUrl,
  getDashboardUrl,
  GLOBAL_CONFIG_PATH,
} from "../lib/config.js";
import { loadConfigSettings, resolveConfigPath } from "../lib/loader.js";
import { executeConnectFlow } from "../lib/connect.js";
import { printBrand } from "../lib/brand.js";

interface ConnectOptions {
  browser?: boolean;
}

export async function runConnect(options: ConnectOptions) {
  printBrand();
  p.intro(pc.bgYellow(pc.black(" connect ")));

  const configPath = "./owo.config.ts";
  let apiUrl = getApiUrl();
  let dashboardUrl = getDashboardUrl();
  let noBrowser = options.browser === false;

  if (existsSync(resolveConfigPath(configPath))) {
    const configSettings = await loadConfigSettings(configPath);
    if (configSettings.connect?.dashboardUrl) {
      dashboardUrl = getDashboardUrl(configSettings.connect.dashboardUrl);
    }
    if (configSettings.apiUrl) {
      apiUrl = getApiUrl(configSettings.apiUrl);
    }
  }

  const apiKey = await executeConnectFlow({
    apiUrl,
    dashboardUrl,
    noBrowser,
    timeout: 300,
  });

  if (apiKey) {
    p.note(
      `${pc.dim("API Key:")} owo_***\n${pc.dim("Config:")} ${GLOBAL_CONFIG_PATH}`,
      "Connected successfully!",
    );
    p.outro(pc.green("Authentication complete ✨"));
  } else {
    p.log.error(pc.red("Connection failed. Please try again."));
    process.exit(1);
  }
}
