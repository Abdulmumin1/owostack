import { getApiUrl, getDashboardUrl } from "./config";

export interface SyncArgs {
  configPath: string;
  dryRun: boolean;
  apiKey: string;
  apiUrl: string;
  prod: boolean;
}

export interface PullArgs {
  configPath: string;
  apiKey: string;
  force: boolean;
  dryRun: boolean;
  prod: boolean;
}

export interface DiffArgs {
  configPath: string;
  apiKey: string;
  prod: boolean;
}

export interface ValidateArgs {
  configPath: string;
  prod: boolean;
}

export interface ConnectArgs {
  apiUrl: string;
  dashboardUrl: string;
  noBrowser: boolean;
  timeout: number;
}

export function parseSyncArgs(args: string[]): SyncArgs {
  let configPath = "./owo.config.ts";
  let dryRun = false;
  let apiKey = "";
  let apiUrl = "";
  let prod = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--config":
        configPath = args[++i];
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--key":
        apiKey = args[++i];
        break;
      case "--prod":
        prod = true;
        break;
    }
  }

  return { configPath, dryRun, apiKey, apiUrl, prod };
}

export function parsePullArgs(args: string[]): PullArgs {
  let configPath = "./owo.config.ts";
  let apiKey = "";
  let force = false;
  let dryRun = false;
  let prod = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--config":
        configPath = args[++i];
        break;
      case "--key":
        apiKey = args[++i];
        break;
      case "--force":
      case "-f":
        force = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--prod":
        prod = true;
        break;
    }
  }

  return { configPath, apiKey, force, dryRun, prod };
}

export function parseDiffArgs(args: string[]): DiffArgs {
  let configPath = "./owo.config.ts";
  let apiKey = "";
  let prod = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--config":
        configPath = args[++i];
        break;
      case "--key":
        apiKey = args[++i];
        break;
      case "--prod":
        prod = true;
        break;
    }
  }

  return { configPath, apiKey, prod };
}

export function parseValidateArgs(args: string[]): ValidateArgs {
  let configPath = "./owo.config.ts";
  let prod = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--config":
        configPath = args[++i];
        break;
      case "--prod":
        prod = true;
        break;
    }
  }

  return { configPath, prod };
}

export function parseConnectArgs(args: string[]): ConnectArgs {
  let noBrowser = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--no-browser":
        noBrowser = true;
        break;
    }
  }

  return {
    apiUrl: getApiUrl(),
    dashboardUrl: getDashboardUrl(),
    noBrowser,
    timeout: 300,
  };
}
