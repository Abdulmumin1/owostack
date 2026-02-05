<script lang="ts">
  import {
    Mail,
    Lock,
    User,
    Building,
    ArrowRight,
    Github,
  } from "lucide-svelte";
  import { signUp } from "$lib/auth-client";
  import { goto } from "$app/navigation";
  import Logo from "$lib/components/ui/Logo.svelte";

  let name = $state("");
  let email = $state("");
  let password = $state("");
  let organization = $state("");
  let isLoading = $state(false);
  let error = $state<string | null>(null);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    isLoading = true;
    error = null;

    try {
      const { data, error: authError } = await signUp.email({
        email,
        password,
        name,
      });

      if (authError) {
        throw new Error(authError.message);
      }

      await goto("/app");
    } catch (err: any) {
      error = err.message || "Something went wrong";
    } finally {
      isLoading = false;
    }
  }
</script>

<svelte:head>
  <title>Sign Up - Owostack</title>
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
      <h1 class="text-2xl font-bold mb-2">Create your account</h1>
      <p class="text-zinc-400">Start building with Paystack in minutes</p>
    </div>

    {#if error}
      <div
        class="mb-4 p-3 bg-red-900/20 border border-red-500/50 text-red-400 text-sm shadow-sm"
      >
        {error}
      </div>
    {/if}

    <form class="flex flex-col gap-4" onsubmit={handleSubmit}>
      <div>
        <label for="name" class="block text-sm font-medium text-zinc-400 mb-2"
          >Full Name</label
        >
        <div class="relative">
          <User
            size={18}
            class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          />
          <input
            type="text"
            id="name"
            bind:value={name}
            placeholder="Ada Lovelace"
            required
            class="input pl-10"
          />
        </div>
      </div>

      <div>
        <label for="email" class="block text-sm font-medium text-zinc-400 mb-2"
          >Email</label
        >
        <div class="relative">
          <Mail
            size={18}
            class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          />
          <input
            type="email"
            id="email"
            bind:value={email}
            placeholder="you@example.com"
            required
            class="input pl-10"
          />
        </div>
      </div>

      <div>
        <label
          for="organization"
          class="block text-sm font-medium text-zinc-400 mb-2"
          >Organization <span class="text-zinc-500">(optional)</span></label
        >
        <div class="relative">
          <Building
            size={18}
            class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          />
          <input
            type="text"
            id="organization"
            bind:value={organization}
            placeholder="Acme Inc"
            class="input pl-10"
          />
        </div>
      </div>

      <div>
        <label
          for="password"
          class="block text-sm font-medium text-zinc-400 mb-2">Password</label
        >
        <div class="relative">
          <Lock
            size={18}
            class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          />
          <input
            type="password"
            id="password"
            bind:value={password}
            placeholder="••••••••"
            minlength="8"
            required
            class="input pl-10"
          />
        </div>
      </div>

      <button
        type="submit"
        class="btn btn-primary w-full mt-2"
        disabled={isLoading}
      >
        {#if isLoading}
          Creating account...
        {:else}
          Create Account
          <ArrowRight size={18} />
        {/if}
      </button>
    </form>

    <div class="flex items-center my-6">
      <div class="flex-1 h-px bg-border"></div>
      <span class="px-4 text-zinc-500 text-xs uppercase tracking-wide"
        >or continue with</span
      >
      <div class="flex-1 h-px bg-border"></div>
    </div>

    <button type="button" class="btn btn-secondary w-full">
      <Github size={18} />
      GitHub
    </button>

    <p class="text-center mt-6 text-zinc-400 text-sm">
      Already have an account? <a
        href="/login"
        class="text-fuchsia-400 hover:text-fuchsia-300">Sign in</a
      >
    </p>
  </div>
</div>
