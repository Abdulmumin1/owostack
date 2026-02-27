<script lang="ts">
  import { page } from "$app/state";
  import { authClient } from "$lib/auth-client";
  import { CircleNotch, CheckCircle, XCircle } from "phosphor-svelte";
  import { onMount } from "svelte";

  // Auth is now handled server-side in hooks.server.ts
  // This page only handles the invitation acceptance

  let invitationId = $derived(page.params.invitationId);
  let status = $state<"loading" | "success" | "error">("loading");
  let errorMessage = $state("");
  let organizationName = $state("");

  onMount(async () => {
    if (!invitationId) {
      status = "error";
      errorMessage = "Invalid invitation link";
      return;
    }

    try {
      const result = await authClient.organization.acceptInvitation({
        invitationId
      });

      if (result.error) {
        status = "error";
        errorMessage = result.error.message || "Failed to accept invitation";
      } else {
        status = "success";
        organizationName = result.data?.organization?.name || "the organization";
      }
    } catch (e: any) {
      status = "error";
      errorMessage = e.message || "An unexpected error occurred";
    }
  });

  function goToDashboard() {
    window.location.href = "/";
  }
</script>

<svelte:head>
  <title>Accept Invitation - Owostack</title>
</svelte:head>

<div class="min-h-screen bg-bg-primary flex items-center justify-center p-4">
  <div class="w-full max-w-md">
    <div class="text-center mb-8">
      <h1 class="text-2xl font-display font-bold text-text-primary mb-2">
        Team Invitation
      </h1>
      <p class="text-sm text-text-muted">
        Join your team on Owostack
      </p>
    </div>

    <div class="bg-bg-card border border-border rounded-lg p-8 shadow-sm">
      {#if status === "loading"}
        <div class="flex flex-col items-center gap-4 py-8">
          <CircleNotch size={48} class="animate-spin text-accent" />
          <p class="text-text-secondary">Accepting your invitation...</p>
        </div>
      {:else if status === "success"}
        <div class="flex flex-col items-center gap-4 py-4">
          <div class="w-16 h-16 rounded-full bg-success-bg flex items-center justify-center">
            <CheckCircle size={32} class="text-success" weight="fill" />
          </div>
          <div class="text-center">
            <h2 class="text-lg font-display font-semibold text-text-primary mb-1">
              Welcome aboard!
            </h2>
            <p class="text-sm text-text-muted">
              You've successfully joined {organizationName}
            </p>
          </div>
          <button 
            class="btn btn-primary w-full mt-4"
            onclick={goToDashboard}
          >
            Go to Dashboard
          </button>
        </div>
      {:else}
        <div class="flex flex-col items-center gap-4 py-4">
          <div class="w-16 h-16 rounded-full bg-error-bg flex items-center justify-center">
            <XCircle size={32} class="text-error" weight="fill" />
          </div>
          <div class="text-center">
            <h2 class="text-lg font-display font-semibold text-text-primary mb-1">
              Invitation failed
            </h2>
            <p class="text-sm text-text-muted">
              {errorMessage}
            </p>
          </div>
          <button 
            class="btn btn-secondary w-full mt-4"
            onclick={goToDashboard}
          >
            Back to Dashboard
          </button>
        </div>
      {/if}
    </div>

    <div class="text-center mt-6">
      <p class="text-xs text-text-dim">
        Need help? Contact your team administrator
      </p>
    </div>
  </div>
</div>
