/**
 * Environment-aware API routing for test vs live mode.
 *
 * The dashboard talks to TWO separate API workers:
 *   - Test API  (sandbox data, test provider keys, own D1)
 *   - Live API  (production data, live provider keys, own D1)
 *
 * Both workers share a DB_AUTH binding (users, sessions, orgs, projects)
 * and use cross-subdomain cookies, so auth works on either endpoint.
 *
 * Configure via Vite env vars in .env (or Cloudflare Pages env):
 *   VITE_API_URL_TEST   – e.g. https://api-test.owostack.com
 *   VITE_API_URL_LIVE   – e.g. https://api.owostack.com
 */

export type AppEnvironment = "test" | "live";

const API_URLS: Record<AppEnvironment, string> = {
  test: import.meta.env.VITE_API_URL_TEST || "http://localhost:8787",
  live: import.meta.env.VITE_API_URL_LIVE || "http://localhost:8787",
};

// ---------------------------------------------------------------------------
// Module-level mutable state (readable from plain .ts files like auth-client)
// ---------------------------------------------------------------------------

let _activeEnvironment: AppEnvironment = "test";
let _projectId: string | null = null;

export function getActiveEnvironment(): AppEnvironment {
  return _activeEnvironment;
}

/** Bind the current project so API calls know which org to target. */
export function setProjectId(id: string) {
  _projectId = id;
}

/**
 * Switch the active environment — persists to the API.
 * Updates local state immediately, then fires the API call.
 * Throws if the API rejects the switch.
 */
export async function setActiveEnvironment(env: AppEnvironment) {
  const prev = _activeEnvironment;
  _activeEnvironment = env;

  if (!_projectId) return;

  try {
    const res = await fetch(`${API_URLS[prev]}/api/dashboard/switch-environment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ organizationId: _projectId, environment: env }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      // Rollback on failure
      _activeEnvironment = prev;
      throw new Error(data.error || "Failed to switch environment");
    }
  } catch (e) {
    _activeEnvironment = prev;
    throw e;
  }
}

/**
 * Load the active environment from the project config API.
 * Called on page load / project change.
 */
export async function loadActiveEnvironment(): Promise<AppEnvironment> {
  if (!_projectId) return _activeEnvironment;

  try {
    const res = await fetch(
      `${API_URLS[_activeEnvironment]}/api/dashboard/config/active-environment?organizationId=${_projectId}`,
      { credentials: "include" },
    );
    const data = await res.json();
    if (data?.data?.activeEnvironment) {
      _activeEnvironment = data.data.activeEnvironment;
    }
  } catch (e) {
    console.error("Failed to load active environment", e);
  }

  return _activeEnvironment;
}

/** Returns the API base URL for the currently active environment. */
export function getApiUrl(): string {
  return API_URLS[_activeEnvironment];
}

/** Returns the API base URL for a specific environment (used for cross-env operations like catalog copy). */
export function getApiUrlForEnv(env: AppEnvironment): string {
  return API_URLS[env];
}
