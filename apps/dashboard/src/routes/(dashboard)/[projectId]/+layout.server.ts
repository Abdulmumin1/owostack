import type { LayoutServerLoad } from "./$types";
import { error, redirect } from "@sveltejs/kit";

/**
 * Server layout for project routes
 *
 * This runs server-side and:
 * 1. Validates the organization exists
 * 2. Sets the active organization for Better Auth
 * 3. Returns org data to the client
 */


import { PUBLIC_API_URL_LIVE, PUBLIC_API_URL_TEST } from '$env/static/public';


export const load: LayoutServerLoad = async ({
  params,
  locals,
  request,
  url,
}) => {
  const { projectId } = params;

  // User must be authenticated (handled by hooks.server.ts)
  if (!locals.user) {
    throw redirect(
      302,
      `/login?redirect=${encodeURIComponent(url.pathname + url.search)}`,
    );
  }

  // Get the API URL
  const apiUrl = PUBLIC_API_URL_TEST || PUBLIC_API_URL_LIVE || "http://localhost:8787";

  // Forward the original request cookies to Better Auth
  const cookieHeader = request.headers.get("cookie") || "";

  try {
    // Fetch user's organizations from Better Auth
    const orgsResponse = await fetch(`${apiUrl}/api/auth/organization/list`, {
      headers: {
        Cookie: cookieHeader,
      },
      credentials: "include",
    });

    if (!orgsResponse.ok) {
      console.error(
        "[Layout Server] Failed to fetch organizations: " + PUBLIC_API_URL_TEST + " " + PUBLIC_API_URL_LIVE,
        await orgsResponse.text(),
      );
      throw error(500, "Failed to fetch organizations");
    }

    const result = await orgsResponse.json();
    const organizations = Array.isArray(result) ? result : result.data || [];

    // Find the organization matching projectId (can be ID or slug)
    const organization = organizations.find(
      (org: any) => org.id === projectId || org.slug === projectId,
    );

    if (!organization) {
      console.error("[Layout Server] Organization not found:", projectId);
      throw error(404, "Organization not found");
    }

    // Set the active organization via Better Auth API
    const setActiveResponse = await fetch(
      `${apiUrl}/api/auth/organization/set-active`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        credentials: "include",
        body: JSON.stringify({
          organizationId: organization.id,
        }),
      },
    );

    if (!setActiveResponse.ok) {
      console.error(
        "[Layout Server] Failed to set active organization:",
        await setActiveResponse.text(),
      );
      // Don't throw error here, the org still exists and user has access
    } else {
      console.log(
        "[Layout Server] Active organization set to:",
        organization.name,
      );
    }

    // Return organization data to client
    const metadata =
      organization.metadata &&
      typeof organization.metadata === "object" &&
      !Array.isArray(organization.metadata)
        ? organization.metadata
        : {};
    const activeEnvironment =
      metadata.activeEnvironment === "live" ? "live" : "test";

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo,
        metadata: organization.metadata,
      },
      activeEnvironment,
      user: locals.user,
    };
  } catch (err: any) {
    console.error("[Layout Server] Error loading organization:", err);

    if (err.status === 302 || err.status === 404) {
      throw err;
    }

    throw error(500, "Failed to load organization");
  }
};
