import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { fetchOrganizations } from "$lib/server/dashboard-api";

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
  const cookieHeader = request.headers.get("cookie") || "";

  try {
    const organizations = await fetchOrganizations(cookieHeader);

    // 3. If no organizations, redirect to onboarding
    if (organizations.length === 0) {
      throw redirect(302, "/onboarding");
    }

    // 4. Redirect to the last visited organization
    let targetOrg = null;

    const activeOrgId =
      locals.session?.activeOrganizationId || locals.session?.organizationId;
    if (activeOrgId) {
      targetOrg = organizations.find((org: any) => org.id === activeOrgId);
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
