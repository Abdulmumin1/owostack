<script lang="ts">
  import { Mail, ArrowRight, CheckCircle } from "lucide-svelte";
  import { forgetPassword } from "$lib/auth-client";
  import Logo from "$lib/components/ui/Logo.svelte";

  let email = $state("");
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let success = $state(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    isLoading = true;
    error = null;

    try {
      const { data, error: authError } = await forgetPassword({
        email,
        redirectTo: "/reset-password",
      });

      if (authError) {
        throw new Error(authError.message);
      }

      success = true;
    } catch (err: any) {
      error = err.message || "Something went wrong";
    } finally {
      isLoading = false;
    }
  }
</script>

<svelte:head>
  <title>Forgot Password - Owostack</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center p-6 bg-bg-primary">
  <div class="w-full max-w-md bg-bg-card border border-border p-8 shadow-lg">
    <!-- Header -->
    <div class="text-center mb-8">
      <a
        href="/"
        class="inline-flex items-center gap-2 text-2xl font-bold text-white mb-6"
      >
        <Logo size={32} class="text-accent" />
        <span>Owostack</span>
      </a>
      <h1 class="text-2xl font-bold mb-2">Forgot Password</h1>
      <p class="text-zinc-400">Enter your email to receive a password reset link</p>
    </div>

    {#if success}
      <div class="text-center py-8">
        <div class="w-16 h-16 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
          <CheckCircle size={32} />
        </div>
        <h2 class="text-xl font-bold text-white mb-2">Check your email</h2>
        <p class="text-zinc-400 mb-6">If an account exists for {email}, you'll receive a password reset link shortly.</p>
        <p class="text-xs text-zinc-500 italic mb-6">(Check your server console for the link during development)</p>
        <a href="/login" class="btn btn-secondary w-full">Back to Login</a>
      </div>
    {:else}
      {#if error}
        <div
          class="mb-4 p-3 bg-red-900/20 border border-red-500/50 text-red-400 text-sm shadow-sm"
        >
          {error}
        </div>
      {/if}

      <form class="flex flex-col gap-4" onsubmit={handleSubmit}>
        <div>
          <label for="email" class="block text-sm font-medium text-zinc-400 mb-2"
            >Email Address</label
          >
          <div class="input-icon-wrapper">
            <Mail
              size={18}
              class="input-icon-left"
            />
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

        <button
          type="submit"
          class="btn btn-primary w-full mt-2"
          disabled={isLoading}
        >
          {#if isLoading}
            Sending...
          {:else}
            Send Reset Link
            <ArrowRight size={18} />
          {/if}
        </button>
      </form>

      <p class="text-center mt-6 text-zinc-400 text-sm">
        Remember your password? <a
          href="/login"
          class="text-accent hover:text-accent-hover">Log in</a
        >
      </p>
    {/if}
  </div>
</div>
