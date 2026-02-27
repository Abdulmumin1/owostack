import type { ClientInit } from "@sveltejs/kit";

/**
 * Client-side initialization hook
 *
 * This runs when the app starts on the client.
 * Used to handle OAuth redirects and other client-side auth logic.
 */

export const init: ClientInit = async () => {
  // Check if we're returning from OAuth
  const storedRedirect = localStorage.getItem("auth_redirect_after_oauth");

  if (storedRedirect && window.location.pathname === "/auth/callback") {
    // Wait a moment for Better Auth to process the session
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Clear the stored redirect
    localStorage.removeItem("auth_redirect_after_oauth");

    // The auth callback page will handle the actual redirect
  }
};
