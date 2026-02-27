import type { Handle } from "@sveltejs/kit";
import { authClient } from "$lib/auth-client";

/**
 * Server-side authentication hook
 *
 * This hook runs on every request and validates the session using Better Auth.
 * Protected routes are defined in the PROTECTED_ROUTES array.
 *
 * For Better Auth integration:
 * - We use auth.api.getSession() to properly validate the session
 * - If not authenticated on a protected route, redirect to login with return URL
 * - Public routes (login, signup, etc.) are accessible without auth
 */

// Routes that require authentication
const PROTECTED_ROUTES = [
  "/",
  "/plans",
  "/features",
  "/addons",
  "/subscriptions",
  "/customers",
  "/transactions",
  "/usage",
  "/events",
  "/accept-invitation",
];

// Routes that are only for non-authenticated users (login, signup, etc.)
const PUBLIC_ONLY_ROUTES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth/callback",
];

// Check if a path matches any of the protected route patterns
function isProtectedRoute(path: string): boolean {
  return PROTECTED_ROUTES.some((route) => {
    if (route === "/") {
      return path === "/";
    }
    return path === route || path.startsWith(`${route}/`);
  });
}

// Check if a path is a public-only route (like login)
function isPublicOnlyRoute(path: string): boolean {
  return PUBLIC_ONLY_ROUTES.some(
    (route) => path === route || path.startsWith(`${route}/`),
  );
}

export const handle: Handle = async ({ event, resolve }) => {
  const { url, locals, request } = event;
  const path = url.pathname;

  // Fetch current session from Better Auth
  const session = await authClient.getSession({
    fetchOptions: {
      headers: request.headers,
    },
  });

  // Check if user is authenticated
  const isAuthenticated = !!session.data;

  // Store auth state and user in locals for use in load functions
  locals.user = isAuthenticated ? session.data?.user : null;
  locals.session = isAuthenticated ? session.data?.session : null;

  // Handle protected routes
  if (isProtectedRoute(path) && !isAuthenticated) {
    // Store the full URL (including query params) for redirect after login

    const returnUrl = encodeURIComponent(url.pathname + url.search);

    if (path !== "/") {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/login?redirect=${returnUrl}`,
        },
      });
    } else {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/login`,
        },
      });
    }
  }

  // Handle public-only routes (redirect to home if already logged in)
  if (isPublicOnlyRoute(path) && isAuthenticated) {
    // Check if there's a redirect parameter
    const redirectUrl = url.searchParams.get("redirect");
    if (redirectUrl) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: redirectUrl,
        },
      });
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
      },
    });
  }

  // Continue to resolve the request
  const response = await resolve(event);
  return response;
};

// Extend the Locals interface for TypeScript
declare global {
  namespace App {
    interface Locals {
      user: any | null;
      session: any | null;
    }
  }
}
