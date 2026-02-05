import { createAuthClient } from "better-auth/svelte";
import { organizationClient } from "better-auth/client/plugins";

export const API_URL = "http://localhost:8787";

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [organizationClient()],
});

export const { signIn, signUp, useSession, organization } = authClient;

export async function apiFetch(path: string, options: RequestInit = {}) {
  const url = path.startsWith("http") ? path : `${API_URL}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    credentials: "include", // This ensures cookies are sent
  });

  const data = await res.json();

  return {
    data: res.ok ? data : null,
    error: res.ok
      ? null
      : { message: data.error || data.message || "Request failed" },
  };
}
