<script lang="ts">
  import { page } from "$app/state";
  import { ArrowRight, ArrowSquareOut, CheckCircle, Circle, CircleNotch, Copy, Link } from "phosphor-svelte";
  import { apiFetch } from "$lib/auth-client";
  import { onMount } from "svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  const projectId = $derived(page.params.projectId);

  let isLoading = $state(true);
  let config = $state<any>(null);
  let plans = $state<any[]>([]);
  let features = $state<any[]>([]);

  async function loadStatus() {
    isLoading = true;
    try {
      const [configRes, plansRes, featuresRes] = await Promise.all([
        apiFetch(`/api/dashboard/providers/accounts?organizationId=${projectId}`),
        apiFetch(`/api/dashboard/plans?organizationId=${projectId}`),
        apiFetch(`/api/dashboard/features?organizationId=${projectId}`)
      ]);

      if (configRes.data) config = configRes.data.data;
      if (plansRes.data) plans = plansRes.data.data;
      if (featuresRes.data) features = featuresRes.data.data;
    } catch (e) {
      console.error("Failed to load status", e);
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    loadStatus();
  });

  const hasPlans = $derived(plans.length > 0);
  const hasFeatures = $derived(features.length > 0);
  const hasKeys = $derived(Array.isArray(config) ? config.length > 0 : config?.connected || false);
  const hasIntegration = $derived(false); 

  const activeStep = $derived(!hasKeys ? 1 : !hasFeatures ? 2 : !hasPlans ? 3 : 4);

  const steps = $derived([
    { num: 1, title: "Connect Provider", desc: "Add payment provider keys", link: "settings", check: hasKeys },
    { num: 2, title: "Define Features", desc: "Create product features", link: "features", check: hasFeatures },
    { num: 3, title: "Create Plans", desc: "Set up pricing tiers", link: "plans", check: hasPlans },
    { num: 4, title: "Integrate SDK", desc: "Connect your app", link: null, check: hasIntegration }
  ]);

  function copyInstall() {
    navigator.clipboard.writeText("npm install owostack");
  }
</script>

<svelte:head>
  <title>Overview - Owostack</title>
</svelte:head>

<div class="max-w-6xl mx-auto">
  <!-- Hero / Status -->
  <div class="mb-12">
    <div class="flex items-center justify-between mb-2">
      <h1 class="text-2xl font-bold text-text-primary uppercase tracking-wide">Onboarding</h1>
    </div>
    <p class="text-text-dim font-mono text-xs">Project ID: {projectId}</p>
  </div>

  {#if isLoading}
    <div class="grid md:grid-cols-4 gap-4 mb-12">
      {#each Array(4) as _}
        <div class="bg-bg-card border border-border p-5 flex flex-col space-y-6 rounded-lg">
          <div class="flex items-start justify-between">
            <Skeleton class="w-7 h-7" />
            <Skeleton class="w-5 h-5 rounded-full" />
          </div>
          <div class="space-y-2">
            <Skeleton class="h-4 w-3/4" />
            <Skeleton class="h-3 w-full" />
          </div>
          <Skeleton class="h-3 w-20" />
        </div>
      {/each}
    </div>
    <div class="bg-bg-card border border-border p-8 rounded-lg">
      <Skeleton class="h-6 w-32 mb-6" />
      <div class="space-y-8">
        <div class="space-y-3">
          <Skeleton class="h-4 w-48" />
          <Skeleton class="h-12 w-full" />
        </div>
        <div class="space-y-3">
          <Skeleton class="h-4 w-48" />
          <Skeleton class="h-24 w-full" />
        </div>
      </div>
    </div>
  {:else}
    <!-- Workflow Steps -->
    <div class="grid md:grid-cols-4 gap-4 mb-12">
      {#each steps as step}
        <div class="bg-bg-card border border-border p-5 relative group transition-all rounded-lg {activeStep === step.num ? 'border-accent ring-1 ring-accent/20' : ''} {step.check ? 'bg-accent-light' : ''}">
          
          <div class="flex items-start justify-between mb-4">
            <div class="w-7 h-7 flex items-center justify-center border border-border bg-bg-secondary font-mono font-bold text-xs {activeStep === step.num ? 'text-accent border-accent' : 'text-text-dim'}">
              {step.num}
            </div>
            {#if step.check}
              <CheckCircle size={18} class="text-success" weight="fill" />
            {:else if activeStep === step.num}
              <div class="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
            {:else}
              <Circle size={18} class="text-border" weight="duotone" />
            {/if}
          </div>

          <h3 class="text-sm font-bold text-text-primary mb-1">{step.title}</h3>
          <p class="text-[10px] text-text-dim mb-6 leading-relaxed">{step.desc}</p>

          {#if step.link}
            <a 
              href="/{projectId}/{step.link}" 
              class="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-accent hover:text-text-primary transition-colors"
            >
              Configure <ArrowRight   size={10}  weight="fill" />
            </a>
          {:else if step.num === 4}
             <span class="text-[10px] font-bold uppercase tracking-wider text-text-dim/60">Waiting for events</span>
          {/if}
        </div>
      {/each}
    </div>

    {#if !hasKeys}
      <!-- Empty State / Call to Action -->
      <div class="bg-accent-light border border-accent p-8 mb-12 flex flex-col items-center text-center rounded-lg">
        <Link   size={40} class="text-accent mb-4"  weight="duotone" />
        <h2 class="text-xl font-bold text-text-primary mb-2">Connect a payment provider</h2>
        <p class="text-text-dim max-w-md mb-6 text-sm">
          To start using Owostack, connect a payment provider (Paystack, Stripe, etc.) by providing your API keys. This allows us to sync plans and manage subscriptions.
        </p>
        <a href="/{projectId}/settings" class="btn btn-primary">
          Configure API Keys
        </a>
      </div>
    {/if}
  {/if}

  <!-- Quick Start Guide -->
  <div class="bg-bg-card border border-border p-8 rounded-lg">
    <h2 class="text-lg font-bold text-text-primary mb-6 uppercase tracking-wider">Quick Start</h2>
    
    <div class="space-y-8">
      <!-- Step 1 -->
      <div>
        <div class="flex items-center gap-3 mb-3">
          <span class="text-accent font-mono text-xs font-bold">01.</span>
          <h3 class="font-bold text-text-primary text-sm uppercase tracking-tight">Install the SDK</h3>
        </div>
        <div class="bg-[var(--color-bg-code)] border border-border p-4 flex items-center justify-between group">
          <code class="font-mono text-sm text-[var(--color-text-code)]">npm install owostack</code>
          <button class="text-text-dim hover:text-text-primary transition-colors" onclick={copyInstall}>
            <Copy   size={16}  weight="fill" />
          </button>
        </div>
      </div>

      <!-- Step 2 -->
      <div>
        <div class="flex items-center gap-3 mb-3">
          <span class="text-accent font-mono text-xs font-bold">02.</span>
          <h3 class="font-bold text-text-primary text-sm uppercase tracking-tight">Initialize</h3>
        </div>
        <div class="bg-[var(--color-bg-code)] border border-border p-4 overflow-x-auto">
          <pre class="font-mono text-sm text-[var(--color-text-code)]"><code>import &#123; Owostack &#125; from 'owostack';

const client = new Owostack(&#123; 
  secretKey: "owosk_..." 
&#125;);</code></pre>
        </div>
      </div>
    </div>
  </div>
</div>
