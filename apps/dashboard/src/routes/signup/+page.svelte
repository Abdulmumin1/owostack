<script lang="ts">
  import {
    ArrowRight,
    CircleNotch,
    Eye,
    EyeSlash,
    Lock,
    User,
    Envelope,
  } from "phosphor-svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { signIn, signUp } from "$lib/auth-client";
  import Logo from "$lib/components/ui/Logo.svelte";
  import AuthRocketEngine from "$lib/components/auth/AuthRocketEngine.svelte";

  let name = $state("");
  let email = $state("");
  let password = $state("");
  let showPassword = $state(false);
  let isLoading = $state(false);
  let isOAuthLoading = $state<string | null>(null);
  let error = $state<string | null>(null);

  let redirectUrl = $derived(page.url.searchParams.get("redirect") || "/");
  let loginUrl = $derived(
    redirectUrl && redirectUrl !== "/"
      ? `/login?redirect=${encodeURIComponent(redirectUrl)}`
      : "/login",
  );

  async function handleSocialSignup(provider: "google" | "github") {
    isOAuthLoading = provider;
    error = null;

    try {
      if (redirectUrl && redirectUrl !== "/") {
        localStorage.setItem("auth_redirect_after_oauth", redirectUrl);
      }

      await signIn.social({
        provider,
        callbackURL: `${page.url.origin}/auth/callback`,
      });
    } catch (err: any) {
      error = err.message || `Failed to continue with ${provider}`;
      isOAuthLoading = null;
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    isLoading = true;
    error = null;

    try {
      const { error: authError } = await signUp.email({
        name,
        email,
        password,
      });

      if (authError) {
        throw new Error(authError.message);
      }

      await goto(redirectUrl);
    } catch (err: any) {
      error = err.message || "Something went wrong";
    } finally {
      isLoading = false;
    }
  }
</script>

<svelte:head>
  <title>Create Account - Owostack</title>
</svelte:head>

<div
  class="min-h-screen bg-bg-primary text-text-primary lg:grid lg:grid-cols-2"
>
  <section
    class="relative hidden items-center justify-center overflow-hidden lg:flex bg-bg-secondary"
    aria-hidden="true"
  >
    <AuthRocketEngine />
  </section>

  <main class="flex min-h-screen items-center justify-center p-6">
    <div class="w-full max-w-[360px]">
      <a
        href="/"
        class="mb-8 inline-flex items-center gap-2 text-text-primary lg:hidden"
      >
        <Logo size={24} class="text-accent" weight="duotone" />
        <span class="font-display text-lg font-bold">Owostack</span>
      </a>

      <div class="mb-6 text-center">
        <h1
          class="font-display text-3xl font-bold tracking-tight text-text-primary"
        >
          Create an account
        </h1>
        <p class="mt-2 text-sm text-text-secondary">
          Start building with Owostack today.
        </p>
      </div>

      {#if error}
        <div
          class="mb-4 border border-error bg-error-bg px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-error"
        >
          {error}
        </div>
      {/if}

      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          class="btn btn-secondary bg-bg-card"
          disabled={isLoading || !!isOAuthLoading}
          onclick={() => handleSocialSignup("google")}
        >
          {#if isOAuthLoading === "google"}
            <CircleNotch size={14} class="animate-spin" />
          {:else}
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
          {/if}
          Google
        </button>

        <button
          type="button"
          class="btn btn-secondary bg-bg-card"
          disabled={isLoading || !!isOAuthLoading}
          onclick={() => handleSocialSignup("github")}
        >
          {#if isOAuthLoading === "github"}
            <CircleNotch size={14} class="animate-spin" />
          {:else}
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
              />
            </svg>
          {/if}
          GitHub
        </button>
      </div>

      <div class="my-6 flex items-center gap-3">
        <div class="h-px flex-1 bg-border"></div>
        <span
          class="text-[9px] font-bold uppercase tracking-widest text-text-dim"
          >or</span
        >
        <div class="h-px flex-1 bg-border"></div>
      </div>

      <form class="flex flex-col gap-3" onsubmit={handleSubmit}>
        <div class="input-icon-wrapper">
          <User size={16} class="input-icon-left" weight="duotone" />
          <input
            type="text"
            bind:value={name}
            placeholder="Name"
            autocomplete="name"
            required
            class="input input-has-icon-left bg-bg-card"
          />
        </div>

        <div class="input-icon-wrapper">
          <Envelope size={16} class="input-icon-left" weight="duotone" />
          <input
            type="email"
            bind:value={email}
            placeholder="Email"
            autocomplete="email"
            required
            class="input input-has-icon-left bg-bg-card"
          />
        </div>

        <div class="input-icon-wrapper">
          <Lock size={16} class="input-icon-left" weight="duotone" />
          <input
            type={showPassword ? "text" : "password"}
            bind:value={password}
            placeholder="Password"
            autocomplete="new-password"
            minlength="8"
            required
            class="input input-has-icon-left bg-bg-card pr-10"
          />
          <button
            type="button"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-dim transition-colors hover:text-text-primary"
            onclick={() => (showPassword = !showPassword)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {#if showPassword}
              <EyeSlash size={15} weight="duotone" />
            {:else}
              <Eye size={15} weight="duotone" />
            {/if}
          </button>
        </div>

        <button
          type="submit"
          class="btn btn-primary mt-1 w-full"
          disabled={isLoading || !!isOAuthLoading}
        >
          {#if isLoading}
            <CircleNotch size={14} class="animate-spin" />
            Creating account...
          {:else}
            Continue
            <ArrowRight size={14} weight="fill" />
          {/if}
        </button>
      </form>

      <p class="mt-6 text-center text-xs text-text-secondary">
        Already have an account?
        <a
          href={loginUrl}
          class="font-bold text-accent underline underline-offset-4 hover:text-accent-hover"
          >Sign in</a
        >
      </p>
    </div>
  </main>
</div>
