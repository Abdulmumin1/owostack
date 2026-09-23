import { failure, usageError } from "./errors.js";

export interface FetchPlanOptions {
  apiKey: string;
  apiUrl: string;
  group?: string;
  interval?: string;
  currency?: string;
  includeInactive?: boolean;
}

function requireKey(apiKey: string): void {
  if (!apiKey) {
    throw usageError(
      "missing_api_key",
      "Missing API key. Pass --key or set OWOSTACK_SECRET_KEY.",
    );
  }
}

type ApiErrorBody = {
  success?: boolean;
  error?: string | { code?: string; message?: string };
  message?: string;
};

function extractApiMessage(body: ApiErrorBody | null, status: number): string {
  if (body?.error && typeof body.error === "object") {
    return body.error.message || body.error.code || `HTTP ${status}`;
  }
  if (typeof body?.error === "string") return body.error;
  if (body?.message) return body.message;
  return `HTTP ${status}`;
}

async function requestJson<T>(
  what: string,
  url: string,
  apiKey: string,
  pick: (body: any) => T,
): Promise<T> {
  requireKey(apiKey);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (error: any) {
    if (error?.name === "TypeError" && /fetch failed/i.test(error.message)) {
      throw failure(
        "network_error",
        `Could not reach the API at ${new URL(url).origin}`,
        "Check your connection, or override the host with OWOSTACK_API_URL.",
      );
    }
    throw failure(
      "network_error",
      `Failed to fetch ${what}: ${error?.message ?? String(error)}`,
    );
  }

  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  if (!response.ok || !body?.success) {
    const message = extractApiMessage(body, response.status);
    const isEnvMismatch =
      body?.error &&
      typeof body.error === "object" &&
      body.error.code === "environment_mismatch";
    throw failure(
      "api_error",
      `Failed to fetch ${what}: ${message}`,
      isEnvMismatch
        ? "Your key is scoped to the other environment. Run with the matching --mode or use a key for this one."
        : response.status === 401
          ? "Check the API key (--key / OWOSTACK_SECRET_KEY) and that it belongs to this environment."
          : undefined,
    );
  }

  return pick(body);
}

export async function fetchPlans(options: FetchPlanOptions): Promise<any[]> {
  const url = new URL(`${options.apiUrl}/plans`);
  if (options.group) url.searchParams.set("group", options.group);
  if (options.interval) url.searchParams.set("interval", options.interval);
  if (options.currency) url.searchParams.set("currency", options.currency);
  if (options.includeInactive) url.searchParams.set("includeInactive", "true");

  return requestJson(
    "plans",
    url.toString(),
    options.apiKey,
    (body) => body?.plans || [],
  );
}

export async function fetchCreditSystems(
  apiKey: string,
  apiUrl: string,
): Promise<any[]> {
  return requestJson(
    "credit systems",
    `${apiUrl}/credit-systems`,
    apiKey,
    (body) => body?.creditSystems || [],
  );
}

export async function fetchCreditPacks(
  apiKey: string,
  apiUrl: string,
): Promise<any[]> {
  return requestJson(
    "credit packs",
    `${apiUrl}/credit-packs`,
    apiKey,
    (body) => body?.data || [],
  );
}
