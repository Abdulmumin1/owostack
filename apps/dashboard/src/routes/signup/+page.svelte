<script lang="ts">
  import { ArrowRight, ChartBar, Check, CreditCard, Envelope, GithubLogo, Globe, Lock, ShieldCheck, Sparkle, User, Users } from "phosphor-svelte";
  import { signUp } from "$lib/auth-client";
  import { goto } from "$app/navigation";
  import Logo from "$lib/components/ui/Logo.svelte";
  import { onMount } from "svelte";
  import { fade, fly } from 'svelte/transition';

  let name = $state("");
  let email = $state("");
  let password = $state("");
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let mounted = $state(false);
  let activeFeature = $state(0);

  const features = [
    { 
      id: "subs",
      text: "Subscriptions & one-time payments", 
      icon: CreditCard,
      preview: {
        type: "plan",
        title: "Pro Plan",
        price: "$29",
        period: "/month",
        detail: "Recurring billing"
      }
    },
    { 
      id: "gate",
      text: "Feature gating & entitlements", 
      icon: ShieldCheck,
      preview: {
        type: "gate",
        feature: "GPU Inference",
        status: "Access Granted",
        color: "text-accent"
      }
    },
    { 
      id: "meter",
      text: "Usage metering & overages", 
      icon: ChartBar,
      preview: {
        type: "meter",
        metric: "Token Usage",
        current: 8450,
        limit: 10000,
        cost: "$0.002 / unit"
      }
    },
    { 
      id: "team",
      text: "Team seats & billing", 
      icon: Users,
      preview: {
        type: "team",
        members: 4,
        pricePerSeat: "$20",
        total: "$80/mo"
      }
    },
    { 
      id: "global",
      text: "Multiple payment providers", 
      icon: Globe,
      preview: {
        type: "providers",
        list: ["Paystack", "Stripe", "Dodo"]
      }
    },
  ];

  onMount(() => {
    mounted = true;
    const interval = setInterval(() => {
      activeFeature = (activeFeature + 1) % features.length;
    }, 4000);
    return () => clearInterval(interval);
  });

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

<div class="min-h-screen flex bg-bg-primary">
  <!-- Left Side: Interactive Feature Showcase -->
  <div class="hidden lg:flex lg:w-1/2 bg-bg-secondary border-r border-border p-12 flex-col justify-between relative overflow-hidden">
    <!-- Animated Background Elements -->
    <div class="absolute inset-0 pointer-events-none">
      <div class="absolute top-16 right-16 w-64 h-64 border border-border/10 animate-pulse-subtle"></div>
      <div class="absolute bottom-32 left-10 w-32 h-32 bg-accent/5 blur-3xl"></div>
    </div>

    <div class="relative z-10">
      <a href="/" class="inline-flex items-center gap-2 text-lg font-bold text-text-primary">
        <Logo size={24} class="text-accent"  weight="duotone" />
        <span>Owostack</span>
      </a>
    </div>

    <div class="flex-1 flex flex-col justify-center relative z-10 max-w-md w-full mx-auto">
      <div class="mb-10 animate-slide-up {mounted ? 'animate-in' : ''}">
        <div class="flex items-center gap-2 mb-3">
          <Sparkle   size={20} class="text-accent animate-pulse-dot"  weight="duotone" />
          <span class="text-xs font-bold text-accent uppercase tracking-wider">Quick setup</span>
        </div>
        <h2 class="text-3xl font-bold mb-3 tracking-tight text-text-primary uppercase">Build billing in minutes</h2>
        <p class="text-text-secondary leading-relaxed">Everything you need to monetize your AI SaaS product, from first dollar to IPO.</p>
      </div>

      <!-- Dynamic Feature List -->
      <div class="space-y-px relative bg-bg-card-hover border border-border">
        {#each features as feature, i (feature.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div 
            class="flex items-center gap-4 p-4 transition-all duration-300 cursor-pointer animate-slide-up"
            class:animate-in={mounted}
            class:bg-bg-card-hover={activeFeature === i}
            class:bg-bg-secondary={activeFeature !== i}
            class:opacity-50={activeFeature !== i}
            class:hover:opacity-100={activeFeature !== i}
            style="transition-delay: {i * 100}ms"
            onclick={() => activeFeature = i}
            role="button"
            tabindex="0"
          >
            <div 
              class="w-8 h-8 flex items-center justify-center transition-colors duration-300 border border-border"
              class:bg-accent={activeFeature === i}
              class:text-accent-contrast={activeFeature === i}
              class:bg-bg-primary={activeFeature !== i}
              class:text-text-dim={activeFeature !== i}
            >
              <feature.icon size={14} />
            </div>
            <span class="text-xs font-bold uppercase tracking-tight text-text-primary">{feature.text}</span>
            
            {#if activeFeature === i}
              <div class="ml-auto" transition:fade>
                <div class="w-1.5 h-1.5 bg-accent animate-pulse"></div>
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Live Preview Area -->
      <div class="mt-8 h-44 relative">
        {#key activeFeature}
          {#if features[activeFeature]}
            <div 
              in:fly={{ y: 10, duration: 400, delay: 100 }} 
              out:fade={{ duration: 200 }}
              class="absolute inset-0"
            >
              <div class="bg-bg-card-hover border border-border p-6 h-full flex flex-col justify-center">
                <!-- Header -->
                <div class="flex justify-between items-start mb-4 pb-4 border-b border-border">
                  <span class="text-[10px] font-bold text-text-dim uppercase tracking-widest">{features[activeFeature].text}</span>
                  <div class="flex gap-1">
                    <div class="w-2 h-2 bg-border"></div>
                    <div class="w-2 h-2 bg-accent"></div>
                  </div>
                </div>

                <!-- Content based on type -->
                {#if features[activeFeature].preview.type === 'plan'}
                  <div class="flex items-baseline justify-between">
                    <div>
                      <h4 class="text-lg font-bold text-text-primary uppercase tracking-tight">{features[activeFeature].preview.title}</h4>
                      <p class="text-xs text-text-secondary">{features[activeFeature].preview.detail}</p>
                    </div>
                    <div class="text-right">
                      <span class="text-2xl font-bold text-accent">{features[activeFeature].preview.price}</span>
                      <span class="text-[10px] font-bold text-text-dim uppercase">{features[activeFeature].preview.period}</span>
                    </div>
                  </div>

                {:else if features[activeFeature].preview.type === 'gate'}
                  <div class="flex items-center justify-between bg-bg-secondary p-3 border border-border">
                    <span class="text-xs font-bold text-text-primary uppercase tracking-tight">{features[activeFeature].preview.feature}</span>
                    <div class="flex items-center gap-2">
                      <div class="w-2 h-2 bg-accent animate-pulse-dot"></div>
                      <span class="text-[10px] font-bold text-accent uppercase tracking-widest">{features[activeFeature].preview.status}</span>
                    </div>
                  </div>

                {:else if features[activeFeature].preview.type === 'meter'}
                  <div class="space-y-2">
                    <div class="flex justify-between text-[10px] font-bold uppercase tracking-wider">
                      <span class="text-text-secondary">{features[activeFeature].preview.metric}</span>
                      <span class="text-text-primary">{features[activeFeature].preview.current?.toLocaleString()} / {features[activeFeature].preview.limit?.toLocaleString()}</span>
                    </div>
                    <div class="h-2 bg-bg-secondary border border-border overflow-hidden">
                      <div class="h-full bg-accent w-[84.5%] animate-grow"></div>
                    </div>
                    <div class="text-[9px] font-bold text-text-dim text-right uppercase tracking-tighter">Overage: {features[activeFeature].preview.cost}</div>
                  </div>

                {:else if features[activeFeature].preview.type === 'team'}
                  <div class="flex items-center justify-between">
                    <div class="flex">
                      {#each Array(4) as _, idx (idx)}
                        <div class="w-8 h-8 -mr-2 bg-bg-secondary border border-border flex items-center justify-center text-[10px] font-bold text-text-dim">
                          <Users   size={12}  weight="duotone" />
                        </div>
                      {/each}
                      <div class="w-8 h-8 bg-accent text-accent-contrast flex items-center justify-center text-[10px] font-bold">+</div>
                    </div>
                    <div class="text-right">
                      <div class="text-xl font-bold text-text-primary uppercase tracking-tight">{features[activeFeature].preview.total}</div>
                      <div class="text-[10px] font-bold text-text-dim uppercase tracking-tighter">{features[activeFeature].preview.pricePerSeat} / seat</div>
                    </div>
                  </div>

                {:else if features[activeFeature].preview.type === 'providers'}
                  <div class="flex items-center justify-around gap-4">
                    {#each features[activeFeature].preview.list || [] as provider (provider)}
                      <div class="text-[10px] font-bold text-text-secondary uppercase tracking-widest border border-border px-3 py-1 bg-bg-secondary">
                        {provider}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        {/key}
      </div>
    </div>

  </div>

  <!-- Right Side: Form -->
  <div class="flex-1 flex items-center justify-center p-6 lg:p-12 overflow-y-auto bg-bg-primary">
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
        <h1 class="text-2xl font-bold mb-2 uppercase tracking-tight text-text-primary">Create account</h1>
        <p class="text-text-secondary text-sm">Start building billing in minutes</p>
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
          <label for="name" class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2"
            >Full Name</label
          >
          <div class="input-icon-wrapper">
            <User  
              size={18}
              class="input-icon-left"
             weight="duotone" />
            <input
              type="text"
              id="name"
              bind:value={name}
              placeholder="Ada Lovelace"
              required
              class="input input-has-icon-left"
            />
          </div>
        </div>

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
          <label
            for="password"
            class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2">Password</label
          >
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
              minlength="8"
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
            Creating...
          {:else}
          Create Account
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
        Already have an account? <a
          href="/login"
          class="text-accent hover:text-accent-hover underline underline-offset-4">Sign in</a
        >
      </p>
    </div>
  </div>
</div>

<style>
  @keyframes grow {
    from { width: 0%; }
    to { width: 84.5%; }
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  @keyframes slide-up {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .animate-grow {
    animation: grow 1s ease-out forwards;
  }

  .animate-pulse-dot {
    animation: pulse-dot 1.5s ease-in-out infinite;
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
