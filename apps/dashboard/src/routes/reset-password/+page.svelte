<script lang="ts">
  import { Lock, ArrowRight, CheckCircle, Eye, EyeOff } from "lucide-svelte";
  import { resetPassword } from "$lib/auth-client";
  import { page } from "$app/state";
  import Logo from "$lib/components/ui/Logo.svelte";

  let password = $state("");
  let confirmPassword = $state("");
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let success = $state(false);
  let showPassword = $state(false);

  const token = $derived(page.url.searchParams.get("token"));

  async function handleSubmit(e: Event) {
    e.preventDefault();
    
    if (!token) {
      error = "Missing reset token. Please request a new password reset link.";
      return;
    }

    if (password !== confirmPassword) {
      error = "Passwords do not match";
      return;
    }

    isLoading = true;
    error = null;

    try {
      const { data, error: authError } = await resetPassword({
        newPassword: password,
        token,
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
  <title>Reset Password - Owostack</title>
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
      <h1 class="text-2xl font-bold mb-2">Reset Password</h1>
      <p class="text-zinc-400">Enter your new password below</p>
    </div>

    {#if success}
      <div class="text-center py-8">
        <div class="w-16 h-16 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
          <CheckCircle size={32} />
        </div>
        <h2 class="text-xl font-bold text-white mb-2">Password reset successful</h2>
        <p class="text-zinc-400 mb-6">Your password has been reset successfully. You can now log in with your new password.</p>
        <a href="/login" class="btn btn-primary w-full">Go to Login</a>
      </div>
    {:else if !token}
      <div class="text-center py-8">
        <div class="mb-4 p-3 bg-red-900/20 border border-red-500/50 text-red-400 text-sm shadow-sm">
          Invalid or missing reset token.
        </div>
        <a href="/forgot-password" class="btn btn-secondary w-full">Request new link</a>
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
          <label for="password" class="block text-sm font-medium text-zinc-400 mb-2"
            >New Password</label
          >
          <div class="relative">
            <div class="input-icon-wrapper">
              <Lock
                size={18}
                class="input-icon-left"
              />
              <input
                type={showPassword ? "text" : "password"}
                id="password"
                bind:value={password}
                placeholder="••••••••"
                required
                class="input input-has-icon-left pr-10"
              />
            </div>
            <button
              type="button"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
              onclick={() => showPassword = !showPassword}
            >
              {#if showPassword} <EyeOff size={16} /> {:else} <Eye size={16} /> {/if}
            </button>
          </div>
        </div>

        <div>
          <label for="confirmPassword" class="block text-sm font-medium text-zinc-400 mb-2"
            >Confirm New Password</label
          >
          <div class="input-icon-wrapper">
            <Lock
              size={18}
              class="input-icon-left"
            />
            <input
              type={showPassword ? "text" : "password"}
              id="confirmPassword"
              bind:value={confirmPassword}
              placeholder="••••••••"
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
            Resetting...
          {:else}
            Reset Password
            <ArrowRight size={18} />
          {/if}
        </button>
      </form>
    {/if}
  </div>
</div>
