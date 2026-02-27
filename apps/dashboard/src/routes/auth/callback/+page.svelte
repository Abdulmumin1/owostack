<script lang="ts">
  import { goto } from "$app/navigation";
  import { authClient } from "$lib/auth-client";
  import { CircleNotch } from "phosphor-svelte";
  import { onMount } from "svelte";

  /**
   * OAuth Callback Handler
   * 
   * Better Auth automatically handles the OAuth callback and sets the session.
   * This page just reads the stored redirect URL and navigates there.
   */

  let status = $state<"processing" | "success" | "error">("processing");
  let errorMessage = $state("");

  onMount(() => {
    // Wait a moment for Better Auth to process the OAuth callback
    setTimeout(() => {
      // Get the stored redirect URL
      const redirectUrl = localStorage.getItem('auth_redirect_after_oauth');
      
      // Clear it from storage
      if (redirectUrl) {
        localStorage.removeItem('auth_redirect_after_oauth');
      }

      // Check if we're authenticated
      const session = authClient.getSession();
      
      if (!session) {
        status = "error";
        errorMessage = "Authentication failed. Please try again.";
        return;
      }

      // Redirect to the stored URL or home
      status = "success";
      const targetUrl = redirectUrl || "/";
      window.location.href = targetUrl;
    }, 500);
  });
</script>

<svelte:head>
  <title>Completing Sign In - Owostack</title>
</svelte:head>

<div class="min-h-screen bg-bg-primary flex items-center justify-center p-4">
  <div class="w-full max-w-md text-center">
    {#if status === "processing"}
      <div class="flex flex-col items-center gap-4 py-8">
        <CircleNotch size={48} class="animate-spin text-accent" />
        <h1 class="text-xl font-display font-bold text-text-primary">
          Completing sign in...
        </h1>
        <p class="text-sm text-text-muted">
          Please wait while we finish authenticating you.
        </p>
      </div>
    {:else if status === "error"}
      <div class="bg-bg-card border border-border rounded-lg p-8 shadow-sm">
        <div class="w-16 h-16 rounded-full bg-error-bg flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 class="text-xl font-display font-bold text-text-primary mb-2">
          Sign in failed
        </h1>
        <p class="text-sm text-text-muted mb-6">
          {errorMessage}
        </p>
        <a href="/login" class="btn btn-primary w-full">
          Try Again
        </a>
      </div>
    {/if}
  </div>
</div>
