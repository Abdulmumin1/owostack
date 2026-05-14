import type { LayoutServerLoad } from "./$types";
import { error, redirect } from "@sveltejs/kit";
import {
  fetchDashboardData,
  fetchOrganizations,
  setActiveOrganization,
} from "$lib/server/dashboard-api";

/**
 * Server layout for project routes
 *
 * This runs server-side and:
 * 1. Validates the organization exists
 * 2. Sets the active organization for Better Auth
 * 3. Returns org data to the client
 */

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
  const cookieHeader = request.headers.get("cookie") || "";

  try {
    const organizations = await fetchOrganizations(cookieHeader);
    const organization = organizations.find(
      (org: any) => org.id === projectId || org.slug === projectId,
    );

    if (!organization) {
      console.error("[Layout Server] Organization not found:", projectId);
      throw error(404, "Organization not found");
    }

    const setActiveResponse = await setActiveOrganization(
      cookieHeader,
      url.origin,
      organization.id,
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

    const metadata =
      organization.metadata &&
      typeof organization.metadata === "object" &&
      !Array.isArray(organization.metadata)
        ? organization.metadata
        : {};
    const activeEnvironment =
      metadata.activeEnvironment === "live" ? "live" : "test";

    const [testAccountsResult, liveAccountsResult, currencyResult] =
      await Promise.allSettled([
        fetchDashboardData<{ data: any[] }>(
          "test",
          cookieHeader,
          `/api/dashboard/providers/accounts?organizationId=${organization.id}`,
        ),
        fetchDashboardData<{ data: any[] }>(
          "live",
          cookieHeader,
          `/api/dashboard/providers/accounts?organizationId=${organization.id}`,
        ),
        fetchDashboardData<{ data: { defaultCurrency?: string } }>(
          activeEnvironment,
          cookieHeader,
          `/api/dashboard/config/default-currency?organizationId=${organization.id}`,
        ),
      ]);

    const testAccounts =
      testAccountsResult.status === "fulfilled" ? testAccountsResult.value.data : [];
    const liveAccounts =
      liveAccountsResult.status === "fulfilled" ? liveAccountsResult.value.data : [];
    const defaultCurrency =
      currencyResult.status === "fulfilled"
        ? currencyResult.value.data?.defaultCurrency || null
        : null;

    return {
      organizations,
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo,
        metadata: organization.metadata,
      },
      activeEnvironment,
      environmentStatus: {
        testConnected: testAccounts.some((a: any) => a.environment === "test"),
        liveConnected: liveAccounts.some((a: any) => a.environment === "live"),
        defaultCurrency,
      },
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
