import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { PUBLIC_API_URL_TEST, PUBLIC_API_URL_LIVE } from "$env/static/public";

/**
 * Root dashboard page load function
 *
 * Sets up the initial redirect if the user has no organizations.
 */
export const load: PageServerLoad = async ({ locals, request }) => {
  // 1. Ensure user is authenticated (handled by hooks but double check)
  if (!locals.user) {
    throw redirect(302, "/login");
  }

  // 2. Fetch user's organizations
  const apiUrl =
    PUBLIC_API_URL_TEST || PUBLIC_API_URL_LIVE || "http://localhost:8787";
  const cookieHeader = request.headers.get("cookie") || "";

  try {
    const orgsResponse = await fetch(`${apiUrl}/api/auth/organization/list`, {
      headers: {
        Cookie: cookieHeader,
      },
      credentials: "include",
    });

    if (!orgsResponse.ok) {
      // Fallback to empty if error
      return { organizations: [], user: locals.user };
    }

    const result = await orgsResponse.json();
    const organizations = Array.isArray(result) ? result : result.data || [];

    // 3. If no organizations, redirect to onboarding
    if (organizations.length === 0) {
      throw redirect(302, "/onboarding");
    }

    return {
      organizations,
      user: locals.user,
    };
  } catch (err: any) {
    if (err.status === 302) throw err;
    console.error("[Dashboard Load] Error:", err);
    return { organizations: [], user: locals.user };
  }
};
