import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync } from "node:fs";
import {
  getDashboardUrl,
  GLOBAL_CONFIG_PATH,
  loadGlobalConfig,
} from "../lib/config.js";
import { loadConfigSettings, resolveConfigPath } from "../lib/loader.js";
import { executeConnectFlow } from "../lib/connect.js";
import { resolveApiHost } from "../lib/environment.js";
import { failure } from "../lib/errors.js";
import type { Reporter } from "../lib/output.js";

interface ConnectOptions {
  browser?: boolean;
}

export async function runConnect(options: ConnectOptions, reporter: Reporter) {
  reporter.intro("connect");

  const fullPath = resolveConfigPath();
  let dashboardUrl: string = getDashboardUrl();
  let noBrowser = options.browser === false;
  let configEnvironments: { test?: string; live?: string } | undefined;

  if (fullPath && existsSync(fullPath)) {
    const configSettings = await loadConfigSettings(fullPath);
    if (configSettings.connect?.dashboardUrl) {
      dashboardUrl = getDashboardUrl(configSettings.connect.dashboardUrl);
    }
    configEnvironments = configSettings.environments;
  }

  // Device auth lives on the shared auth DB, so the sandbox host serves it and
  // issues keys for both environments in one approval.
  const apiUrl = resolveApiHost({
    mode: "sandbox",
    envApiUrl: process.env.OWOSTACK_API_URL,
    envTestUrl: process.env.OWOSTACK_API_TEST_URL,
    configEnvironments,
  });

  const apiKey = await executeConnectFlow({
    apiUrl,
    dashboardUrl,
    noBrowser,
    timeout: 300,
  });

  if (!apiKey) {
    throw failure("api_error", "Connection failed. Please try again.");
  }

  const stored = loadGlobalConfig();
  const lines = [
    `${pc.dim("Sandbox key:")} ${stored.keys?.sandbox ? "owo_sk_test_***" : pc.yellow("not issued")}`,
    `${pc.dim("Live key:")}    ${stored.keys?.live ? "owo_sk_live_***" : pc.yellow("not issued (API predates scoped keys)")}`,
    `${pc.dim("Config:")}      ${GLOBAL_CONFIG_PATH}`,
  ];
  p.note(lines.join("\n"), "Connected successfully!");
  p.log.info(
    pc.dim(
      "Commands pick the key for the selected --mode automatically (sandbox or live).",
    ),
  );
  p.outro(pc.green("Authentication complete ✨"));
}
