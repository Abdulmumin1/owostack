<script lang="ts">
  import { Mail, Lock, ArrowRight, Github, Zap, Activity, CheckCircle2, Server } from "lucide-svelte";
  import { signIn } from "$lib/auth-client";
  import { goto } from "$app/navigation";
  import Logo from "$lib/components/ui/Logo.svelte";
  import { onMount } from "svelte";
  import { fade, slide } from 'svelte/transition';

  let email = $state("");
  let password = $state("");
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let mounted = $state(false);
  
  // Logs for the terminal animation
  let logs = $state<{id: number, time: string, action: string, status: string, color: string}[]>([]);
  let logId = 0;

  const possibleLogs = [
    { action: "GET /v1/access", status: "ALLOWED", color: "text-accent" },
    { action: "POST /v1/usage", status: "RECORDED", color: "text-text-primary" },
    { action: "WEBHOOK sub.created", status: "SYNCED", color: "text-accent" },
    { action: "GET /v1/invoice", status: "GENERATED", color: "text-text-secondary" },
  ];

  onMount(() => {
    mounted = true;
    
    // Initial logs
    addLog();
    addLog();
    
    // Add new logs periodically
    const interval = setInterval(() => {
      addLog();
    }, 2500);

    return () => clearInterval(interval);
  });

  function addLog() {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    const template = possibleLogs[Math.floor(Math.random() * possibleLogs.length)];
    
    logs = [{ id: logId++, time, ...template }, ...logs].slice(0, 5);
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
  <!-- Left Side: Live Activity Dashboard -->
  <div class="hidden lg:flex lg:w-1/2 bg-bg-secondary border-r border-border p-12 flex-col justify-between relative overflow-hidden">
    <!-- Grid Background -->
    <div class="absolute inset-0 opacity-[0.03]" 
      style="background-image: linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px); background-size: 40px 40px;">
    </div>

    <div class="relative z-10">
      <a href="/" class="inline-flex items-center gap-2 text-lg font-bold text-text-primary">
        <Logo size={24} class="text-accent" />
        <span>Owostack</span>
      </a>
    </div>

    <div class="flex-1 flex flex-col justify-center items-center relative z-10">
      <div class="w-full max-w-md">
        
        <!-- Live Status Card -->
        <div class="bg-bg-card border border-border overflow-hidden mb-8 animate-slide-up {mounted ? 'animate-in' : ''} shadow-[4px_4px_0px_0px_var(--color-border)]">
          <!-- Header -->
          <div class="bg-bg-primary border-b border-border p-3 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="flex gap-1">
                <div class="w-2 h-2 bg-border"></div>
                <div class="w-2 h-2 bg-accent"></div>
              </div>
              <span class="ml-2 text-[10px] font-bold font-mono text-text-dim uppercase tracking-widest">Your billig</span>
            </div>
           
          </div>

          <!-- Live Logs Terminal -->
          <div class="bg-bg-secondary p-4 font-mono text-[11px] h-48 overflow-hidden relative border-b border-border">
            {#each logs as log (log.id)}
              <div class="flex gap-3 mb-2" in:slide={{ duration: 300 }}>
                <span class="text-text-dim opacity-40 shrink-0">{log.time}</span>
                <span class="text-text-primary shrink-0 uppercase font-bold tracking-tight">{log.action}</span>
                <span class="ml-auto {log.color} font-bold uppercase tracking-widest">{log.status}</span>
              </div>
            {/each}
          </div>

          <!-- Footer / Stats -->
          <div class="bg-bg-card p-4 grid grid-cols-3 gap-px bg-border">
            <div class="bg-bg-card p-2 text-center">
              <div class="text-[9px] uppercase text-text-dim font-bold tracking-widest mb-1">Uptime</div>
              <div class="font-bold text-text-primary tracking-tight">99.99%</div>
            </div>
            <div class="bg-bg-card p-2 text-center border-l border-border">
              <div class="text-[9px] uppercase text-text-dim font-bold tracking-widest mb-1">Latency</div>
              <div class="font-bold text-accent tracking-tight">24ms</div>
            </div>
            <div class="bg-bg-card p-2 text-center border-l border-border">
              <div class="text-[9px] uppercase text-text-dim font-bold tracking-widest mb-1">Requests</div>
              <div class="font-bold text-text-primary tracking-tight">2.4M</div>
            </div>
          </div>
        </div>

        <!-- Tagline -->
        <div class="text-center animate-slide-up delay-200 {mounted ? 'animate-in' : ''}">
          <p class="text-xl font-bold uppercase tracking-tight text-text-primary">Billing running.</p>
          <p class="text-sm text-text-secondary mt-1">Focus on your product. We handle the rest.</p>
        </div>

      </div>
    </div>

    <!-- <div class="text-[10px] font-bold text-text-dim relative z-10 flex items-center gap-2 uppercase tracking-widest">
      <Server size={12} />
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
          <Logo size={28} class="text-accent" />
          <span>Owostack</span>
        </a>
      </div>

      <div class="mb-8">
        <h1 class="text-2xl font-bold mb-2 uppercase tracking-tight text-text-primary">Sign in</h1>
        <p class="text-text-secondary text-sm">Welcome back to Owostack</p>
      </div>

      {#if error}
        <div
          class="mb-4 p-3 bg-red-900/10 border border-red-500/50 text-red-600 text-[10px] font-bold uppercase tracking-wider"
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
            />
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
          <ArrowRight size={16} />
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
        <Github size={16} />
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

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
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

  .animate-pulse-dot {
    animation: pulse-dot 1.5s ease-in-out infinite;
  }

  .delay-200 {
    transition-delay: 200ms;
  }

  :global(*) {
    border-radius: 0 !important;
  }
</style>
