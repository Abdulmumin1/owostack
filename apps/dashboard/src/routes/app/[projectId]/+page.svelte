<script lang="ts">
  import { page } from "$app/state";
  import { Copy, CheckCircle, Circle, ArrowRight, Loader2, Link2, ExternalLink } from "lucide-svelte";
  import { apiFetch } from "$lib/auth-client";
  import { onMount } from "svelte";

  const projectId = $derived(page.params.projectId);

  let isLoading = $state(true);
  let config = $state<any>(null);
  let plans = $state<any[]>([]);
  let features = $state<any[]>([]);

  async function loadStatus() {
    isLoading = true;
    try {
      const [configRes, plansRes, featuresRes] = await Promise.all([
        apiFetch(`/api/dashboard/config/paystack-config?organizationId=${projectId}`),
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
  const hasKeys = $derived(config?.connected || false);
  const hasIntegration = $derived(false); // We can't easily check this yet

  const activeStep = $derived(!hasKeys ? 1 : !hasFeatures ? 2 : !hasPlans ? 3 : 4);

  const steps = $derived([
    { num: 1, title: "Connect Paystack", desc: "Add your API keys", link: "settings", check: hasKeys },
    { num: 2, title: "Define Features", desc: "Create product features", link: "features", check: hasFeatures },
    { num: 3, title: "Create Plans", desc: "Set up pricing tiers", link: "plans", check: hasPlans },
    { num: 4, title: "Integrate SDK", desc: "Connect your app", link: null, check: hasIntegration }
  ]);

  function copyInstall() {
    navigator.clipboard.writeText("npm install @owostack/core");
  }
</script>

<svelte:head>
  <title>Overview - Owostack</title>
</svelte:head>

<div class="max-w-6xl mx-auto">
  <!-- Hero / Status -->
  <div class="mb-12">
    <div class="flex items-center justify-between mb-2">
      <h1 class="text-2xl font-bold text-white uppercase tracking-wide">Onboarding</h1>
      {#if isLoading}
        <Loader2 size={16} class="animate-spin text-zinc-500" />
      {/if}
    </div>
    <p class="text-zinc-500 font-mono text-xs">Project ID: {projectId}</p>
  </div>

  {#if !isLoading}
    <!-- Workflow Steps -->
    <div class="grid md:grid-cols-4 gap-4 mb-12">
      {#each steps as step}
        <div class="bg-bg-card border border-border p-5 shadow-md relative group transition-all {activeStep === step.num ? 'border-accent ring-1 ring-accent/20' : ''} {step.check ? 'bg-accent/5' : ''}">
          
          <div class="flex items-start justify-between mb-4">
            <div class="w-7 h-7 flex items-center justify-center border border-border bg-bg-secondary font-mono font-bold text-xs {activeStep === step.num ? 'text-accent border-accent' : 'text-zinc-500'}">
              {step.num}
            </div>
            {#if step.check}
              <CheckCircle size={18} class="text-green-500" />
            {:else if activeStep === step.num}
              <div class="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
            {:else}
              <Circle size={18} class="text-zinc-800" />
            {/if}
          </div>

          <h3 class="text-sm font-bold text-white mb-1">{step.title}</h3>
          <p class="text-[10px] text-zinc-500 mb-6 leading-relaxed">{step.desc}</p>

          {#if step.link}
            <a 
              href="/app/{projectId}/{step.link}" 
              class="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-accent hover:text-white transition-colors"
            >
              Configure <ArrowRight size={10} />
            </a>
          {:else if step.num === 4}
             <span class="text-[10px] font-bold uppercase tracking-wider text-zinc-600">Waiting for events</span>
          {/if}
        </div>
      {/each}
    </div>

    {#if !hasKeys}
      <!-- Empty State / Call to Action -->
      <div class="bg-accent/5 border border-accent/20 p-8 mb-12 flex flex-col items-center text-center">
        <Link2 size={40} class="text-accent mb-4" />
        <h2 class="text-xl font-bold text-white mb-2">Connect your Paystack account</h2>
        <p class="text-zinc-400 max-w-md mb-6 text-sm">
          To start using Owostack, you need to connect your Paystack account by providing your API keys. This allows us to sync plans and manage subscriptions.
        </p>
        <a href="/app/{projectId}/settings" class="btn btn-primary">
          Configure API Keys
        </a>
      </div>
    {/if}
  {/if}

  <!-- Quick Start Guide -->
  <div class="bg-bg-card border border-border p-8 shadow-md">
    <h2 class="text-lg font-bold text-white mb-6 uppercase tracking-wider">Quick Start</h2>
    
    <div class="space-y-8">
      <!-- Step 1 -->
      <div>
        <div class="flex items-center gap-3 mb-3">
          <span class="text-accent font-mono">01.</span>
          <h3 class="font-bold text-white text-sm">Install the SDK</h3>
        </div>
        <div class="bg-black border border-border p-4 flex items-center justify-between group">
          <code class="font-mono text-sm text-zinc-300">npm install @owostack/core</code>
          <button class="text-zinc-500 hover:text-white transition-colors" onclick={copyInstall}>
            <Copy size={16} />
          </button>
        </div>
      </div>

      <!-- Step 2 -->
      <div>
        <div class="flex items-center gap-3 mb-3">
          <span class="text-accent font-mono">02.</span>
          <h3 class="font-bold text-white text-sm">Initialize</h3>
        </div>
        <div class="bg-black border border-border p-4 overflow-x-auto">
          <pre class="font-mono text-sm text-zinc-300"><code>import &#123; Paystack &#125; from '@owostack/core';

const paystack = new Paystack(&#123; 
  secretKey: "owosk_..." 
&#125;);</code></pre>
        </div>
      </div>
    </div>
  </div>
</div>
