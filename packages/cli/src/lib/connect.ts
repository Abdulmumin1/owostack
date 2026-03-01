import * as p from "@clack/prompts";
import pc from "picocolors";
import { saveGlobalConfig } from "./config.js";

export interface ConnectOptions {
  apiUrl: string;
  dashboardUrl: string;
  noBrowser: boolean;
  timeout: number;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  expiresIn: number;
}

export interface TokenResult {
  success: boolean;
  apiKey?: string;
  organizationId?: string;
}

export async function initiateDeviceFlow(
  options: ConnectOptions,
): Promise<DeviceCode> {
  const url = `${options.apiUrl}/api/auth/cli/device`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const data = await response.json();
    if (!response.ok || !data?.success) {
      const message =
        data?.error || data?.message || "Failed to initiate device flow";
      throw new Error(message);
    }

    return {
      deviceCode: data.deviceCode,
      userCode: data.userCode,
      expiresIn: data.expiresIn || 300,
    };
  } catch (error: any) {
    if (error.name === "TypeError" && error.message.includes("fetch failed")) {
      throw new Error(
        `Could not reach the API at ${options.apiUrl}. Please check your internet connection or ensure the API is running.`,
      );
    }
    throw error;
  }
}

export async function pollForToken(
  deviceCode: string,
  options: ConnectOptions,
  s: any,
): Promise<TokenResult> {
  const startTime = Date.now();
  const timeoutMs = options.timeout * 1000;
  const pollInterval = 3000;

  while (Date.now() - startTime < timeoutMs) {
    const url = `${options.apiUrl}/api/auth/cli/token?deviceCode=${deviceCode}`;
    try {
      const response = await fetch(url, { method: "GET" });
      const data = await response.json();

      if (data?.success && data?.apiKey) {
        return {
          success: true,
          apiKey: data.apiKey,
          organizationId: data.organizationId,
        };
      }

      if (data?.error === "expired") {
        throw new Error("Device code expired. Please try again.");
      }
      if (data?.error === "denied") {
        throw new Error("Connection was denied by user.");
      }
    } catch (error: any) {
      if (
        error.name === "TypeError" &&
        error.message.includes("fetch failed")
      ) {
        // Silently continue polling if it's a transient network error,
        // or throw if it persists? For polling, it's safer to just let it retry
        // unless we want to inform the user.
      } else {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error("Connection timed out. Please try again.");
}

export async function executeConnectFlow(
  options: ConnectOptions,
): Promise<string | null> {
  try {
    const deviceCode = await initiateDeviceFlow(options);
    const authUrl = `${options.dashboardUrl}/cli/connect?code=${deviceCode.userCode}`;

    p.log.step(pc.bold("Connect to your dashboard:"));
    p.log.message(`${pc.cyan(pc.underline(authUrl))}\n`);

    const shouldOpen = !options.noBrowser;

    if (shouldOpen) {
      try {
        const { exec } = await import("node:child_process");
        const platform = process.platform;
        const cmd =
          platform === "darwin"
            ? "open"
            : platform === "win32"
              ? "start"
              : "xdg-open";
        exec(`${cmd} "${authUrl}"`);
      } catch {}
    }

    const s = p.spinner();
    s.start(
      `Waiting for you to approve in the dashboard (Code: ${pc.bold(pc.yellow(deviceCode.userCode))})`,
    );

    const result = await pollForToken(deviceCode.deviceCode, options, s);
    s.stop(pc.green("Authorization granted"));

    if (result.success && result.apiKey) {
      await saveGlobalConfig({
        apiKey: result.apiKey,
        organizationId: result.organizationId,
      });
      return result.apiKey;
    }
  } catch (e: any) {
    p.log.error(pc.red(`✗ ${e.message}`));
  }
  return null;
}
