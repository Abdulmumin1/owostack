<script lang="ts">
  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import {
    CircleNotch,
    CheckCircle,
    XCircle,
    ArrowRight,
    Lock,
    User,
  } from "phosphor-svelte";
  import { onMount } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { getApiUrl } from "$lib/env";
  import Logo from "$lib/components/ui/Logo.svelte";
  import { goto } from "$app/navigation";

  let token = $derived(page.params.token);
  let status = $state<"loading" | "form" | "success" | "error">("loading");
  let errorMessage = $state("");
  let organizationName = $state("");
  let invitationData = $state<any>(null);

  // Form state
  let name = $state("");
  let password = $state("");
  let isSubmitting = $state(false);

  onMount(async () => {
    if (!token) {
      status = "error";
      errorMessage = "Invalid invitation link";
      return;
    }

    try {
      // Use direct fetch with redirect: 'manual' to handle Better Auth redirects
      const url = `${getApiUrl()}/api/auth/dash/accept-invitation?token=${token}`;

      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        credentials: "include",
        redirect: "manual",
      });

      // Status 0 or 302 often indicates a successful redirect in 'manual' mode
      if (
        res.status === 0 ||
        res.status === 302 ||
        res.type === "opaqueredirect"
      ) {
        status = "success";
        setTimeout(() => {
          window.location.href = "/";
        }, 1500);
        return;
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        status = "error";
        errorMessage =
          errorData.message || errorData.error || "Failed to accept invitation";
        return;
      }

      const resultData = await res.json();
      invitationData = resultData;
      organizationName = resultData?.organization?.name || "your team";

      if (resultData?.needsOnboarding || !resultData?.user?.hasPassword) {
        status = "form";
      } else {
        status = "success";
        setTimeout(() => {
          window.location.href = resultData.redirectUrl || "/";
        }, 1500);
      }
    } catch (e: any) {
      status = "error";
      errorMessage = e.message || "An unexpected error occurred";
    }
  });

  async function handleComplete(e: Event) {
    e.preventDefault();
    isSubmitting = true;
    errorMessage = "";

    try {
      const result = await apiFetch("/api/auth/dash/complete-invitation", {
        method: "POST",
        body: JSON.stringify({
          token,
          password,
          name: name || undefined,
        }),
      });

      if (result.error) {
        errorMessage = result.error.message || "Failed to complete invitation";
      } else {
        status = "success";
        // Optionally redirect automatically
        setTimeout(() => {
          window.location.href = result.data?.redirectUrl || "/";
        }, 1500);
      }
    } catch (e: any) {
      errorMessage = e.message || "An unexpected error occurred";
    } finally {
      isSubmitting = false;
    }
  }

  function goToDashboard() {
    window.location.href = "/";
  }
</script>

<svelte:head>
  <title>Join Team - Owostack</title>
</svelte:head>

<div class="min-h-screen flex bg-bg-primary">
  <!-- Left Side: Interactive Feature Showcase (Same as Signup) -->
  <div
    class="hidden lg:flex lg:w-1/2 bg-bg-secondary border-r border-border relative overflow-hidden"
  >
    <div class="absolute inset-0">
      <img
        src="https://mac-file.yaqeen.me/87C9A6BB-3D4410F0-72E6-46B0-9B54-142A675819EE_1_201_a.jpeg"
        alt=""
        class="w-full h-full object-cover"
      />
    </div>
  </div>

  <!-- Right Side: Content -->
  <div
    class="flex-1 flex items-center justify-center p-6 lg:p-12 bg-bg-primary"
  >
    <div class="w-full max-w-sm">
      <div class="lg:hidden text-center mb-8">
        <Logo size={32} class="text-accent mx-auto mb-4" />
        <h1
          class="text-xl font-bold text-text-primary uppercase tracking-tight"
        >
          Owostack
        </h1>
      </div>

      {#if status === "loading"}
        <div class="flex flex-col items-center gap-4 py-8">
          <CircleNotch size={48} class="animate-spin text-accent" />
          <p
            class="text-[10px] font-bold uppercase tracking-widest text-text-secondary"
          >
            Validating invitation...
          </p>
        </div>
      {:else if status === "form"}
        <div class="mb-8" in:fade>
          <h1
            class="text-2xl font-bold mb-2 uppercase tracking-tight text-text-primary"
          >
            Complete your profile
          </h1>
          <p class="text-text-secondary text-sm">
            Set up your account to get started on <strong>Owostack</strong>
          </p>
        </div>

        {#if errorMessage}
          <div
            class="mb-4 p-3 bg-error-bg border border-error text-error text-[10px] font-bold uppercase tracking-wider"
          >
            {errorMessage}
          </div>
        {/if}

        <form class="flex flex-col gap-4" onsubmit={handleComplete}>
          <div>
            <label
              for="name"
              class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2"
              >Full Name</label
            >
            <div class="input-icon-wrapper">
              <User size={18} class="input-icon-left" weight="duotone" />
              <input
                type="text"
                id="name"
                bind:value={name}
                placeholder="Ada Lovelace"
                class="input input-has-icon-left"
              />
            </div>
          </div>

          <div>
            <label
              for="password"
              class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2"
              >Create Password</label
            >
            <div class="input-icon-wrapper">
              <Lock size={18} class="input-icon-left" weight="duotone" />
              <input
                type="password"
                id="password"
                bind:value={password}
                placeholder="••••••••"
                minlength="8"
                required
                class="input input-has-icon-left"
              />
            </div>
          </div>

          <button
            type="submit"
            class="btn btn-primary w-full mt-2 py-4"
            disabled={isSubmitting}
          >
            {#if isSubmitting}
              Processing...
            {:else}
              Join Platform
              <ArrowRight size={16} weight="fill" />
            {/if}
          </button>
        </form>
      {:else if status === "success"}
        <div
          class="flex flex-col items-center text-center py-8"
          in:fly={{ y: 20 }}
        >
          <div
            class="w-20 h-20 rounded-full bg-success-bg flex items-center justify-center mb-6 border border-success/20"
          >
            <CheckCircle size={40} class="text-success" weight="fill" />
          </div>
          <h2
            class="text-2xl font-bold text-text-primary uppercase tracking-tight mb-2"
          >
            Welcome aboard!
          </h2>
          <p class="text-text-secondary text-sm mb-8">
            You've successfully joined <strong>Owostack</strong>. Redirecting
            you to the dashboard...
          </p>
          <button class="btn btn-secondary w-full py-4" onclick={goToDashboard}>
            Go to Dashboard
          </button>
        </div>
      {:else}
        <div class="flex flex-col items-center text-center py-8" in:fade>
          <div
            class="w-20 h-20 rounded-full bg-error-bg flex items-center justify-center mb-6 border border-error/20"
          >
            <XCircle size={40} class="text-error" weight="fill" />
          </div>
          <h2
            class="text-2xl font-bold text-text-primary uppercase tracking-tight mb-2"
          >
            Invitation Error
          </h2>
          <p class="text-text-secondary text-sm mb-8">
            {errorMessage || "This invitation link is invalid or has expired."}
          </p>
          <a href="/login" class="btn btn-primary w-full py-4">
            Back to Login
          </a>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  @keyframes pulse-subtle {
    0%,
    100% {
      opacity: 0.1;
      transform: scale(1);
    }
    50% {
      opacity: 0.2;
      transform: scale(1.05);
    }
  }
  .animate-pulse-subtle {
    animation: pulse-subtle 4s ease-in-out infinite;
  }
</style>
