import pc from "picocolors";

export interface FetchPlanOptions {
  apiKey: string;
  apiUrl: string;
  group?: string;
  interval?: string;
  currency?: string;
  includeInactive?: boolean;
}

export async function fetchPlans(options: FetchPlanOptions): Promise<any[]> {
  if (!options.apiKey) {
    console.error(
      `\n  ❌ Missing API key. Pass --key or set OWOSTACK_SECRET_KEY.\n`,
    );
    process.exit(1);
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
      console.error(`\n  ❌ Failed to fetch plans: ${message}\n`);
      process.exit(1);
    }

    return data?.plans || [];
  } catch (error: any) {
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
    } else {
      console.error(`\n  ❌ Unexpected error: ${error.message}\n`);
    }
    process.exit(1);
  }
}

export async function fetchCreditSystems(
  apiKey: string,
  apiUrl: string,
): Promise<any[]> {
  if (!apiKey) {
    return [];
  }

  try {
    const url = `${apiUrl}/credit-systems`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const data = await response.json();
    if (!response.ok || !data?.success) {
      return [];
    }

    return data?.creditSystems || [];
  } catch {
    return [];
  }
}

export async function fetchCreditPacks(
  apiKey: string,
  apiUrl: string,
): Promise<any[]> {
  if (!apiKey) {
    return [];
  }

  try {
    const url = `${apiUrl}/credit-packs`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const data = await response.json();
    if (!response.ok || !data?.success) {
      return [];
    }

    return data?.data || [];
  } catch {
    return [];
  }
}
