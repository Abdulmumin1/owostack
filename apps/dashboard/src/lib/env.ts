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

export function getActiveEnvironment(): AppEnvironment {
  return _activeEnvironment;
}

export function setActiveEnvironment(env: AppEnvironment) {
  _activeEnvironment = env;
}

/** Returns the API base URL for the currently active environment. */
export function getApiUrl(): string {
  return API_URLS[_activeEnvironment];
}
