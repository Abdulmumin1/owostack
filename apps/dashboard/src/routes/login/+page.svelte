<script lang="ts">
  import { ArrowRight, Envelope, GithubLogo, Lock, Pulse, TrendUp } from "phosphor-svelte";
  import { signIn } from "$lib/auth-client";
  import { goto } from "$app/navigation";
  import Logo from "$lib/components/ui/Logo.svelte";
  import { onMount } from "svelte";

  let email = $state("");
  let password = $state("");
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let mounted = $state(false);

  onMount(() => {
    setTimeout(() => {
      mounted = true;
    }, 100);
  });

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

      await goto("/app");
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
  <div class="hidden lg:flex lg:w-1/2 bg-bg-secondary border-r border-border p-12 flex-col justify-between relative overflow-hidden">
    <!-- Grid Background -->
    <div class="absolute inset-0 opacity-[0.03]" 
      style="background-image: linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px); background-size: 40px 40px;">
    </div>

    <div class="relative z-10">
      <a href="/" class="inline-flex items-center gap-2 text-lg font-bold text-text-primary">
        <Logo size={24} class="text-accent"  weight="duotone" />
        <span>Owostack</span>
      </a>
    </div>

    <div class="flex-1 flex flex-col justify-center items-center relative z-10">
      <div class="w-full max-w-md">
        
        <!-- Dashboard Preview -->
        <div class="card bg-bg-card overflow-hidden mb-8 animate-slide-up {mounted ? 'animate-in' : ''}">
          <div class="p-4 border-b border-border bg-bg-secondary flex justify-between items-center">
            <div class="flex items-center gap-2">
              <Pulse   size={14} class="text-accent"  weight="duotone" />
              <span class="text-[10px] font-bold uppercase tracking-widest text-text-primary">Monthly Revenue</span>
            </div>
             <div class="flex items-center gap-1 text-[10px] font-bold text-success bg-success-bg px-2 py-0.5 rounded-sm">
               <TrendUp size={10} weight="duotone" />
               <span>+12.5%</span>
             </div>
          </div>
          
          <div class="p-6">
            <div class="text-3xl font-bold text-text-primary tracking-tight mb-1">$45,231.89</div>
            <div class="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-6">Current MRR</div>
            
            <!-- Faux Chart -->
            <div class="flex items-end gap-2 h-24 mt-4">
              {#each [35, 42, 38, 55, 48, 65, 58, 75, 68, 85, 80, 100] as height, i}
                <div class="flex-1 bg-accent-light hover:bg-accent transition-colors duration-300 relative group h-full">
                  <div class="absolute bottom-0 w-full bg-accent transition-all duration-1000 ease-out" style="height: {mounted ? height : 0}%"></div>
                </div>
              {/each}
            </div>
          </div>

          <div class="bg-bg-secondary p-4 border-t border-border">
            <div class="text-[9px] font-bold text-text-dim uppercase tracking-widest mb-4">Recent Transactions</div>
            <div class="space-y-3">
              <div class="flex justify-between items-center text-[10px]">
                <div class="flex items-center gap-2 w-24">
                  <div class="w-2 h-2 bg-accent/20 border border-accent flex items-center justify-center">
                     <div class="w-1 h-1 bg-accent"></div>
                  </div>
                  <span class="font-bold text-text-primary uppercase tracking-tight">Pro Plan</span>
                </div>
                <span class="font-mono text-text-secondary opacity-60 truncate w-20">ada@...</span>
                <span class="font-bold text-text-primary font-mono w-16 text-right">+$29.00</span>
              </div>
              <div class="flex justify-between items-center text-[10px]">
                <div class="flex items-center gap-2 w-24">
                  <div class="w-2 h-2 bg-accent/20 border border-accent flex items-center justify-center">
                     <div class="w-1 h-1 bg-accent"></div>
                  </div>
                  <span class="font-bold text-text-primary uppercase tracking-tight">Overage</span>
                </div>
                <span class="font-mono text-text-secondary opacity-60 truncate w-20">alan@...</span>
                <span class="font-bold text-text-primary font-mono w-16 text-right">+$4.20</span>
              </div>
              <div class="flex justify-between items-center text-[10px]">
                <div class="flex items-center gap-2 w-24">
                  <div class="w-2 h-2 bg-accent/20 border border-accent flex items-center justify-center">
                     <div class="w-1 h-1 bg-accent"></div>
                  </div>
                  <span class="font-bold text-text-primary uppercase tracking-tight">Enterprise</span>
                </div>
                <span class="font-mono text-text-secondary opacity-60 truncate w-20">grace@...</span>
                <span class="font-bold text-text-primary font-mono w-16 text-right">+$99.00</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Tagline -->
        <div class="text-center animate-slide-up delay-200 {mounted ? 'animate-in' : ''}">
          <p class="text-xl font-bold uppercase tracking-tight text-text-primary">Welcome back</p>
          <p class="text-sm text-text-secondary mt-1">Pick up right where you left off.</p>
        </div>

      </div>
    </div>

    <!-- <div class="text-[10px] font-bold text-text-dim relative z-10 flex items-center gap-2 uppercase tracking-widest">
      <Server size={12}  weight="duotone" />
      <span>US-East-1</span>
      <span class="mx-1 opacity-20">•</span>
      <span>v2.4.0</span>
    </div> -->
  </div>

  <!-- Right Side: Login Form -->
  <div class="flex-1 flex items-center justify-center p-6 lg:p-12 bg-bg-primary">
    <div class="w-full max-w-sm">
      <div class="lg:hidden text-center mb-8">
        <a
          href="/"
          class="inline-flex items-center gap-2 text-xl font-bold text-text-primary mb-4"
        >
          <Logo size={28} class="text-accent"  weight="duotone" />
          <span>Owostack</span>
        </a>
      </div>

      <div class="mb-8">
        <h1 class="text-2xl font-bold mb-2 uppercase tracking-tight text-text-primary">Sign in</h1>
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
          <label for="email" class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2"
            >Email</label
          >
          <div class="input-icon-wrapper">
            <Envelope  
              size={18}
              class="input-icon-left"
             weight="duotone" />
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
              class="block text-[10px] font-bold text-text-dim uppercase tracking-widest">Password</label
            >
            <a href="/forgot-password" class="text-[10px] font-bold text-accent uppercase tracking-widest hover:underline">Forgot?</a>
          </div>
          <div class="input-icon-wrapper">
            <Lock  
              size={18}
              class="input-icon-left"
             weight="duotone" />
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
          <ArrowRight   size={16}  weight="fill" />
          {/if}
        </button>
      </form>

      <div class="flex items-center my-6">
        <div class="flex-1 h-px bg-border"></div>
        <span class="px-4 text-text-dim text-[10px] font-bold uppercase tracking-widest"
          >or</span
        >
        <div class="flex-1 h-px bg-border"></div>
      </div>

      <button type="button" class="btn btn-secondary w-full py-4">
        <GithubLogo   size={16}  weight="duotone" />
        GitHub
      </button>

      <p class="text-center mt-6 text-text-dim text-[10px] font-bold uppercase tracking-tight">
        New here? <a
          href="/signup"
          class="text-accent hover:text-accent-hover underline underline-offset-4">Create account</a>
      </p>
    </div>
  </div>
</div>

<style>
  @keyframes slide-up {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
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
