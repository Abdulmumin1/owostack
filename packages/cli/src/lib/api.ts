import pc from "picocolors";

class CliExitError extends Error {}

export interface FetchPlanOptions {
  apiKey: string;
  apiUrl: string;
  group?: string;
  interval?: string;
  currency?: string;
  includeInactive?: boolean;
}

function exitWithError(message: string): never {
  console.error(`\n  ❌ ${message}\n`);
  process.exit(1);
  throw new CliExitError(message);
}

export async function fetchPlans(options: FetchPlanOptions): Promise<any[]> {
  if (!options.apiKey) {
    exitWithError("Missing API key. Pass --key or set OWOSTACK_SECRET_KEY.");
  }

  const url = new URL(`${options.apiUrl}/plans`);
  if (options.group) url.searchParams.set("group", options.group);
  if (options.interval) url.searchParams.set("interval", options.interval);
  if (options.currency) url.searchParams.set("currency", options.currency);
  if (options.includeInactive) url.searchParams.set("includeInactive", "true");

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${options.apiKey}` },
    });

    const data = await response.json();
    if (!response.ok || !data?.success) {
      const message = data?.error || data?.message || "Request failed";
      exitWithError(`Failed to fetch plans: ${message}`);
    }

    return data?.plans || [];
  } catch (error: any) {
    if (error instanceof CliExitError) throw error;
    if (error.name === "TypeError" && error.message.includes("fetch failed")) {
      console.error(
        `\n  ❌ Connection failed: Could not reach the API at ${pc.cyan(options.apiUrl)}`,
      );
      console.error(
        `     Please check your internet connection or ensure the API is running.`,
      );
      console.error(
        `     You can override the API URL by setting the ${pc.bold("OWOSTACK_API_URL")} environment variable.\n`,
      );
      process.exit(1);
    } else {
      exitWithError(`Unexpected error: ${error.message}`);
    }
  }
}

export async function fetchCreditSystems(
  apiKey: string,
  apiUrl: string,
): Promise<any[]> {
  if (!apiKey) {
    exitWithError("Missing API key. Pass --key or set OWOSTACK_SECRET_KEY.");
  }

  try {
    const response = await fetch(`${apiUrl}/credit-systems`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const data = await response.json();
    if (!response.ok || !data?.success) {
      const message = data?.error || data?.message || `HTTP ${response.status}`;
      exitWithError(`Failed to fetch credit systems: ${message}`);
    }

    return data?.creditSystems || [];
  } catch (error: any) {
    if (error instanceof CliExitError) throw error;
    exitWithError(
      error?.message
        ? `Failed to fetch credit systems: ${error.message}`
        : "Failed to fetch credit systems",
    );
  }
}

export async function fetchCreditPacks(
  apiKey: string,
  apiUrl: string,
): Promise<any[]> {
  if (!apiKey) {
    exitWithError("Missing API key. Pass --key or set OWOSTACK_SECRET_KEY.");
  }

  try {
    const response = await fetch(`${apiUrl}/credit-packs`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const data = await response.json();
    if (!response.ok || !data?.success) {
      const message = data?.error || data?.message || `HTTP ${response.status}`;
      exitWithError(`Failed to fetch credit packs: ${message}`);
    }

    return data?.data || [];
  } catch (error: any) {
    if (error instanceof CliExitError) throw error;
    exitWithError(
      error?.message
        ? `Failed to fetch credit packs: ${error.message}`
        : "Failed to fetch credit packs",
    );
  }
}
