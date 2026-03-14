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

    // 4. Redirect to the last visited organization
    let targetOrg = null;

    // Fetch the currently active organization from Better Auth
    try {
      const activeOrgResponse = await fetch(
        `${apiUrl}/api/auth/organization/get-full-organization`,
        {
          headers: { Cookie: cookieHeader },
          credentials: "include",
        },
      );

      if (activeOrgResponse.ok) {
        const activeOrgResult = await activeOrgResponse.json();
        // The API returns the org object directly or in a `data` field depending on Better Auth version
        const activeOrg = activeOrgResult?.id
          ? activeOrgResult
          : activeOrgResult?.data;
        if (activeOrg && activeOrg.id) {
          targetOrg = organizations.find((org: any) => org.id === activeOrg.id);
        }
      }
    } catch (e) {
      console.error("[Dashboard Load] Failed to fetch active organization", e);
    }

    // Check if there's an active organization in the session from Better Auth (fallback)
    if (!targetOrg) {
      const activeOrgId =
        locals.session?.activeOrganizationId || locals.session?.organizationId;
      if (activeOrgId) {
        targetOrg = organizations.find((org: any) => org.id === activeOrgId);
      }
    }

    // Fallback to the first organization if none matches or no active org is set
    if (!targetOrg && organizations.length > 0) {
      targetOrg = organizations[0];
    }

    if (targetOrg) {
      const targetIdentifier = targetOrg.slug || targetOrg.id;
      // Default to the usage/overview page instead of plans
      throw redirect(302, `/${targetIdentifier}/usage`);
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
