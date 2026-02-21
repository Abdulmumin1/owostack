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
