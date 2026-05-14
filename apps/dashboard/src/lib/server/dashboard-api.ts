import { PUBLIC_API_URL_LIVE, PUBLIC_API_URL_TEST } from "$env/static/public";

export type DashboardEnvironment = "test" | "live";

type OrganizationRecord = {
  id: string;
  name: string;
  slug?: string | null;
  logo?: string | null;
  metadata?: Record<string, unknown> | null;
};

const API_URLS: Record<DashboardEnvironment, string> = {
  test: PUBLIC_API_URL_TEST || "http://localhost:8787",
  live: PUBLIC_API_URL_LIVE || PUBLIC_API_URL_TEST || "http://localhost:8787",
};

async function readJson(response: Response) {
  return response.json().catch(() => null);
}

export async function fetchOrganizations(cookieHeader: string) {
  const response = await fetch(`${API_URLS.test}/api/auth/organization/list`, {
    headers: {
      Cookie: cookieHeader,
    },
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch organizations");
  }

  const result = await readJson(response);
  const organizations = Array.isArray(result) ? result : result?.data || [];

  return organizations as OrganizationRecord[];
}

export async function setActiveOrganization(
  cookieHeader: string,
  origin: string,
  organizationId: string,
) {
  return fetch(`${API_URLS.test}/api/auth/organization/set-active`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      Origin: origin,
    },
    credentials: "include",
    body: JSON.stringify({ organizationId }),
  });
}

export async function fetchDashboardData<T>(
  env: DashboardEnvironment,
  cookieHeader: string,
  path: string,
) {
  const response = await fetch(`${API_URLS[env]}${path}`, {
    headers: {
      Cookie: cookieHeader,
    },
    credentials: "include",
  });
  const data = await readJson(response);

  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || data?.message || "Request failed");
  }

  return data as T;
}
