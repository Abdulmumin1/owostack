<script lang="ts">
  import { Check, Sparkle, ArrowRight, ArrowLeft } from "phosphor-svelte";
  import { cn } from "$lib/utils";

  let { data } = $props();
  let user = $derived(data.user);
  let plans = $derived(data.plans || []);
  
  let isLoading = $state<string | null>(null);

  async function handleSelect(slug: string) {
    if (!user) {
      window.location.href = '/login';
      return;
    }

    isLoading = slug;
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: slug })
      });
      const attachRes = await res.json();
      
      if (attachRes.url) {
        window.location.href = attachRes.url;
      } else if (attachRes.checkoutUrl) {
        window.location.href = attachRes.checkoutUrl;
      } else {
        window.location.href = '/';
      }
    } catch (err) {
      console.error('Checkout failed', err);
      isLoading = null;
    }
  }
</script>

<div class="min-h-screen bg-bg-primary text-text-primary flex flex-col items-center p-6 sm:p-12 relative overflow-hidden">
  
  <!-- Back button -->
  <a href="/" class="absolute top-8 left-8 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-text-muted hover:text-text-primary transition-colors">
    <ArrowLeft size={16} weight="bold" /> Back to App
  </a>

  <!-- Header -->
  <div class="max-w-3xl text-center mt-12 mb-16 animate-in slide-in-from-bottom-4 duration-500">
    <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border border-accent/20 bg-accent/10 text-[10px] font-bold uppercase tracking-widest text-accent mb-6 shadow-[0_2px_0_0_var(--color-accent-border)]">
      <Sparkle size={14} weight="fill" /> Owostack Demo Pricing
    </div>
    <h1 class="text-4xl md:text-5xl font-display font-bold tracking-tight mb-4 uppercase">Simple, transparent pricing</h1>
    <p class="text-text-muted max-w-xl mx-auto text-sm">Start building your AI application today. Only pay for what you use, or subscribe for unlimited access.</p>
  </div>

  <!-- Plans Grid -->
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8 w-full max-w-4xl z-10 animate-in fade-in duration-700 delay-150 fill-mode-both">
    {#each plans.length > 0 ? plans : [{slug: 'starter', name: 'Starter', price: 0, currency: 'NGN', description: 'Perfect for testing and small personal projects.'}, {slug: 'pro', name: 'Pro', price: 15000, currency: 'NGN', popular: true, description: 'For power users needing premium LLM models.'}] as plan}
      {@const isPopular = (plan as any).popular || plan.slug === 'pro'}
      <div class={cn(
        "relative p-8 rounded-sm border flex flex-col transition-all shadow-[8px_8px_0_0_var(--color-border)] hover:-translate-y-1 hover:-translate-x-1 hover:shadow-[12px_12px_0_0_var(--color-border)]", 
        isPopular ? "bg-bg-secondary/20 border-accent shadow-[8px_8px_0_0_var(--color-accent-border)] hover:shadow-[12px_12px_0_0_var(--color-accent-border)]" : "bg-bg-card border-white/10"
      )}>
        {#if isPopular}
          <div class="absolute -top-3 right-8 bg-accent text-accent-contrast px-3 py-1 rounded-sm text-[9px] font-bold uppercase tracking-widest shadow-sm">
            Most Popular
          </div>
        {/if}

        <div class="mb-8">
          <h3 class="text-lg font-display font-bold uppercase tracking-wider mb-2">{plan.name}</h3>
          <p class="text-text-muted text-xs leading-relaxed h-10">{(plan as any).description || 'Scale your application with Owostack.'}</p>
        </div>

        <div class="mb-8 flex items-baseline gap-2">
          <span class="text-4xl font-mono font-bold">{(plan.currency || 'USD')}{(Number(plan.price) || 0) / 100}</span>
          <span class="text-[10px] font-bold text-text-muted uppercase tracking-widest">/ month</span>
        </div>

        <button 
          onclick={() => handleSelect(plan.slug)} 
          disabled={isLoading === plan.slug}
          class={cn(
            "w-full h-12 flex items-center justify-center gap-2 uppercase tracking-widest text-[11px] font-bold transition-all disabled:opacity-50", 
            isPopular ? "btn btn-primary" : "btn border border-white/20 hover:bg-white/5"
          )}
        >
          {isLoading === plan.slug ? 'Processing...' : user ? `Upgrade to ${plan.name}` : 'Get Started'}
          {#if !isLoading}
            <ArrowRight size={14} weight="bold" />
          {/if}
        </button>

        <div class="mt-10 space-y-4 flex-1">
          <p class="text-[10px] font-bold text-text-muted uppercase tracking-widest border-b border-white/5 pb-2">What's included</p>
          <ul class="space-y-3">
            {#if plan.slug === 'starter'}
              <li class="flex items-start gap-3 text-sm text-text-secondary">
                <Check size={16} weight="bold" class="text-accent shrink-0 mt-0.5" />
                <span>50 AI Generation Credits / month</span>
              </li>
              <li class="flex items-start gap-3 text-sm text-text-secondary">
                <Check size={16} weight="bold" class="text-accent shrink-0 mt-0.5" />
                <span>Basic Models (Gemini Flash)</span>
              </li>
              <li class="flex items-start gap-3 text-sm text-text-secondary">
                <Check size={16} weight="bold" class="text-accent shrink-0 mt-0.5" />
                <span>Standard Support</span>
              </li>
            {:else}
              <li class="flex items-start gap-3 text-sm text-text-secondary">
                <Check size={16} weight="bold" class="text-accent shrink-0 mt-0.5" />
                <span>5,000 AI Generation Credits / month</span>
              </li>
              <li class="flex items-start gap-3 text-sm text-text-secondary">
                <Check size={16} weight="bold" class="text-accent shrink-0 mt-0.5" />
                <span class="font-bold text-text-primary">Premium Models (Pro & Ultra)</span>
              </li>
              <li class="flex items-start gap-3 text-sm text-text-secondary">
                <Check size={16} weight="bold" class="text-accent shrink-0 mt-0.5" />
                <span>Priority Support</span>
              </li>
            {/if}
          </ul>
        </div>
      </div>
    {/each}
  </div>

  <!-- Footer -->
  <div class="mt-20 text-center space-y-2">
    <p class="text-[10px] font-bold text-text-muted uppercase tracking-widest">Powered by</p>
    <div class="flex items-center justify-center gap-2 opacity-50">
      <div class="size-5 bg-text-muted rounded-sm flex items-center justify-center">
        <Sparkle weight="fill" class="text-bg-primary size-3" />
      </div>
      <span class="font-display font-bold text-xs uppercase tracking-widest text-text-muted">Owostack</span>
    </div>
  </div>
</div>