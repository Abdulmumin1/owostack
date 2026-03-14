import { createAuthClient } from "better-auth/svelte";
import { organizationClient } from "better-auth/client/plugins";
import { getApiUrl } from "$lib/env";
import { sentinelClient } from "@better-auth/infra/client";

/**
 * Auth client with dynamic base URL resolution.
 * Both API workers share the same auth DB (DB_AUTH) and use
 * cross-subdomain cookies, so auth works on either endpoint.
 *
 * We use a custom fetch wrapper so the base URL is resolved on
 * every request (not frozen at module load time).
 */
export const authClient = createAuthClient({
  baseURL: getApiUrl(),
  fetchOptions: {
    customFetchImpl: async (url, init) => {
      // Replace the frozen baseURL prefix with the current one
      const currentBase = getApiUrl();
      let resolvedUrl = url;
      if (typeof url === "string" && url.includes("/api/auth")) {
        const path = url.replace(/^https?:\/\/[^/]+/, "");
        resolvedUrl = `${currentBase}${path}`;
      }
      return fetch(resolvedUrl, { ...init, credentials: "include" });
    },
  },
  plugins: [organizationClient()],
  emailAndPassword: {
    enabled: true,
  },
});

export const signIn = authClient.signIn;
export const signUp = authClient.signUp;
export const useSession = authClient.useSession;
export const organization = authClient.organization;
export const forgetPassword = (authClient as any).requestPasswordReset;
export const resetPassword = (authClient as any).resetPassword;

/**
 * Environment-aware fetch. Routes ALL calls to the test or live API
 * based on the active environment. Both workers share DB_AUTH so
 * auth, config, and business data all work on either endpoint.
 */
export async function apiFetch(path: string, options: RequestInit = {}) {
  const baseUrl = getApiUrl();
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    credentials: "include",
  });

  const data = await res.json();

  return {
    data: res.ok ? data : null,
    error: res.ok
      ? null
      : {
          message: data.error || data.message || "Request failed",
          status: res.status,
          data,
        },
  };
}
