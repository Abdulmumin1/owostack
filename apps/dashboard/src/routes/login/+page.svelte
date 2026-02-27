<script lang="ts">
  import {
    ArrowRight,
    CircleNotch,
    Envelope,
    Lock,
    Pulse,
    TrendUp,
  } from "phosphor-svelte";
  import { page } from "$app/state";
  import { signIn } from "$lib/auth-client";
  import { goto } from "$app/navigation";
  import Logo from "$lib/components/ui/Logo.svelte";
  import { onMount } from "svelte";

  let email = $state("");
  let password = $state("");
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let mounted = $state(false);
  let isOAuthLoading = $state<string | null>(null);

  // Get redirect URL from query params
  let redirectUrl = $derived(page.url.searchParams.get("redirect") || "/");

  onMount(() => {
    setTimeout(() => {
      mounted = true;
    }, 100);
  });

  async function handleSocialLogin(provider: "google" | "github") {
    isOAuthLoading = provider;
    error = null;

    try {
      // Store the redirect URL for after OAuth completes
      if (redirectUrl && redirectUrl !== "/") {
        localStorage.setItem("auth_redirect_after_oauth", redirectUrl);
      }

      await signIn.social({
        provider,
        callbackURL: "/auth/callback",
      });
    } catch (err: any) {
      error = err.message || `Failed to sign in with ${provider}`;
      isOAuthLoading = null;
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    isLoading = true;
    error = null;

    try {
      const { data, error: authError } = await signIn.email({
        email,
        password,
      });

      if (authError) {
        throw new Error(authError.message);
      }

      // Redirect to the original requested URL or home
      await goto(redirectUrl);
    } catch (err: any) {
      error = err.message || "Something went wrong";
    } finally {
      isLoading = false;
    }
  }
</script>

<svelte:head>
  <title>Login - Owostack</title>
</svelte:head>

<div class="min-h-screen flex bg-bg-primary">
  <!-- Left Side: Live Pulse Dashboard -->
  <div
    class="hidden lg:flex lg:w-1/2 bg-bg-secondary border-r border-border flex-col justify-between relative overflow-hidden"
  >
    <div class="flex-1 flex flex-col justify-center items-center relative z-10">
      <img
        src="https://mac-file.yaqeen.me/294121C8-Generated%20Image%20February%2026%2C%202026%20-%206_23PM.png"
        alt=""
      />
    </div>

    <!-- <div class="text-[10px] font-bold text-text-dim relative z-10 flex items-center gap-2 uppercase tracking-widest">
      <Server size={12}  weight="duotone" />
      <span>US-East-1</span>
      <span class="mx-1 opacity-20">•</span>
      <span>v2.4.0</span>
    </div> -->
  </div>

  <!-- Right Side: Login Form -->
  <div
    class="flex-1 flex items-center justify-center p-6 lg:p-12 bg-bg-primary"
  >
    <div class="w-full max-w-sm">
      <div class="lg:hidden text-center mb-8">
        <a
          href="/"
          class="inline-flex items-center gap-2 text-xl font-bold text-text-primary mb-4"
        >
          <Logo size={28} class="text-accent" weight="duotone" />
          <span>Owostack</span>
        </a>
      </div>

      <div class="mb-8">
        <h1
          class="text-2xl font-bold mb-2 uppercase tracking-tight text-text-primary"
        >
          Sign in
        </h1>
        <p class="text-text-secondary text-sm">Welcome back to Owostack</p>
      </div>

      {#if error}
        <div
          class="mb-4 p-3 bg-error-bg border border-error text-error text-[10px] font-bold uppercase tracking-wider"
        >
          {error}
        </div>
      {/if}

      <form class="flex flex-col gap-4" onsubmit={handleSubmit}>
        <div>
          <label
            for="email"
            class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2"
            >Email</label
          >
          <div class="input-icon-wrapper">
            <Envelope size={18} class="input-icon-left" weight="duotone" />
            <input
              type="email"
              id="email"
              bind:value={email}
              placeholder="you@example.com"
              required
              class="input input-has-icon-left"
            />
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <label
              for="password"
              class="block text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Password</label
            >
            <a
              href="/forgot-password"
              class="text-[10px] font-bold text-accent uppercase tracking-widest hover:underline"
              >Forgot?</a
            >
          </div>
          <div class="input-icon-wrapper">
            <Lock size={18} class="input-icon-left" weight="duotone" />
            <input
              type="password"
              id="password"
              bind:value={password}
              placeholder="••••••••"
              required
              class="input input-has-icon-left"
            />
          </div>
        </div>

        <button
          type="submit"
          class="btn btn-primary w-full mt-2 py-4"
          disabled={isLoading}
        >
          {#if isLoading}
            Signing in...
          {:else}
            Sign In
            <ArrowRight size={16} weight="fill" />
          {/if}
        </button>
      </form>

      <div class="flex items-center my-6">
        <div class="flex-1 h-px bg-border"></div>
        <span
          class="px-4 text-text-dim text-[10px] font-bold uppercase tracking-widest"
          >or</span
        >
        <div class="flex-1 h-px bg-border"></div>
      </div>

      {#if isOAuthLoading}
        <div class="flex items-center justify-center gap-2 py-4 text-text-dim">
          <CircleNotch size={16} class="animate-spin" />
          <span class="text-sm">Connecting to {isOAuthLoading}...</span>
        </div>
      {:else}
        <button
          type="button"
          class="btn btn-secondary w-full py-4"
          onclick={() => handleSocialLogin("google")}
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continue with Google
        </button>

        <button
          type="button"
          class="btn btn-secondary w-full py-4 mt-3"
          onclick={() => handleSocialLogin("github")}
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
            />
          </svg>
          Continue with GitHub
        </button>
      {/if}

      <p
        class="text-center mt-6 text-text-dim text-[10px] font-bold uppercase tracking-tight"
      >
        New here? <a
          href="/signup"
          class="text-accent hover:text-accent-hover underline underline-offset-4"
          >Create account</a
        >
      </p>
    </div>
  </div>
</div>

<style>
  @keyframes slide-up {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .animate-slide-up {
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .animate-slide-up.animate-in {
    opacity: 1;
    transform: translateY(0);
  }
</style>
