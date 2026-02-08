<script lang="ts">
  import {
    Zap,
    Check,
    Activity,
    ArrowRight,
    Github,
    MousePointer2,
    Filter,
    Plus,
    BarChart3,
    Users,
    Waves,
    Calendar,
    ChevronDown,
    Trash2,
    ArrowUp,
    ArrowDown,
    MessageSquare,
    Megaphone,
    LayoutGrid,
    ShieldCheck,
    Smartphone,
    CreditCard,
    Building2,
    Code2,
    Layers,
    Gauge,
    Terminal,
    X,
    Play,
    Copy,
  } from "lucide-svelte";
  import Logo from "$lib/components/ui/Logo.svelte";

  let activeTab = $state('billing.ts');
  let isExecuting = $state(false);
  let showResponse = $state(false);
  let selectedVSProvider = $state('stripe');

  const vsProviders = [
    { id: 'stripe', name: 'Stripe' },
    { id: 'paystack', name: 'Paystack' },
    { id: 'dodopayments', name: 'Dodo' },
    { id: 'polar', name: 'Polar' }
  ];

  function handleRun() {
    isExecuting = true;
    setTimeout(() => {
      isExecuting = false;
      showResponse = true;
    }, 800);
  }
</script>

<svelte:head>
  <title>Owostack - The Provider-Agnostic Billing Layer for Africa</title>
</svelte:head>

<div class="min-h-screen bg-bg-primary text-text-primary font-sans selection:bg-accent/30">
  <!-- Header -->
  <header class="px-6 py-6 border-b border-border">
    <div class="max-w-7xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-2 text-lg font-bold">
        <Logo size={35} class="text-accent" />
        <span class="tracking-tight">Owostack</span>
      </div>

      <nav class="hidden md:flex items-center gap-8 text-sm font-medium text-text-secondary">
        <a href="https://github.com/owostack" class="hover:text-text-primary transition-colors flex items-center gap-2">
          <Github size={16} />
          opensource
        </a>
        <a href="#pricing" class="hover:text-text-primary transition-colors">pricing</a>
        <a href="/login" class="hover:text-text-primary transition-colors">login</a>
        <a href="/signup" class="btn btn-primary py-1.5 px-4 rounded-sm text-xs font-bold uppercase tracking-wider transition-all">
          get started
        </a>
        <button class="p-1 hover:text-text-primary transition-colors" aria-label="Status Indicator">
          <div class="w-2 h-2 rounded-full bg-accent "></div>
        </button>
      </nav>
    </div>
  </header>

  <!-- Hero Section -->
  <section class="pt-32 pb-24 px-6 max-w-7xl mx-auto text-center">
    <div class="max-w-5xl mx-auto">
      <h1 class="text-6xl md:text-[140px] font-black leading-[0.75] tracking-tighter mb-12 uppercase text-white">
        Billing <br />
        <span class="text-accent italic font-serif-heading font-normal lowercase tracking-tight">shouldn't</span> <br />
        be hard
      </h1>
      <p class="text-xl md:text-2xl text-text-secondary max-w-2xl mx-auto leading-relaxed font-medium mt-8">
        Owostack is the infrastructure layer between your app and payment providers. Implement subscriptions once — swap providers whenever you want.
      </p>
    </div>
  </section>

  <!-- VS Comparison Section -->
  <section class="px-6 py-32 bg-linear-to-b from-bg-primary via-[#2d1b4d]/10 to-bg-primary border-y border-border overflow-hidden">
    <div class="max-w-7xl mx-auto relative">
      <!-- Subtle Gradient instead of glow -->
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-250 h-150 bg-accent/5 rounded-full blur-[160px] pointer-events-none opacity-30"></div>

      <div class="text-center mb-16 relative z-10">
        <div class="text-[10px] font-bold text-accent uppercase tracking-[0.3em] mb-6">Unified Infrastructure</div>
        <div class="flex flex-wrap justify-center gap-3 mb-8">
          {#each vsProviders as provider}
            <button 
              onclick={() => selectedVSProvider = provider.id}
              class="px-6 py-2 text-[10px] font-bold uppercase tracking-widest border transition-all {selectedVSProvider === provider.id ? 'bg-accent text-white border-accent' : 'bg-bg-secondary text-text-dim border-border hover:border-text-dim'}"
            >
              {provider.name}
            </button>
          {/each}
        </div>
      </div>

      <div class="grid lg:grid-cols-2 gap-12 md:gap-24 items-start relative z-10">
        <!-- Manual / Before -->
        <div class="space-y-8">
          <h3 class="text-center text-sm font-bold text-zinc-500 uppercase tracking-[0.3em]">{vsProviders.find(p => p.id === selectedVSProvider)?.name} without Owostack</h3>
          <div class="bg-[#0a0a0a] rounded-2xl border border-white/5 overflow-hidden">
            <div class="bg-white/5 px-5 py-4 border-b border-white/5 flex items-center justify-between">
              <span class="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">{selectedVSProvider}.ts</span>
            </div>
            <div class="p-8 font-mono text-[11px] leading-relaxed space-y-6 text-zinc-400 opacity-60">
              {#if selectedVSProvider === 'stripe'}
                <div class="space-y-4">
                  <div class="text-zinc-600 italic">// Manual Credit System Implementation</div>
                  <div class="text-[#87b9fe]">const customer = await stripe.customers.retrieve(id);</div>
                  <div class="text-[#87b9fe]">const currentCredits = customer.metadata.credits || 0;</div>
                  
                  <div class="text-[#87b9fe]">if (currentCredits &lt; required) &#123;</div>
                  <div class="pl-4 text-[#87b9fe]">const session = await stripe.checkout.sessions.create(&#123;</div>
                  <div class="pl-8">mode: <span class="text-[#a5d6ff]">"payment"</span>,</div>
                  <div class="pl-8">line_items: [&#123; price: <span class="text-[#a5d6ff]">"price_credits_100"</span>, quantity: 1 &#125;],</div>
                  <div class="pl-4 text-[#87b9fe]">&#125;);</div>
                  <div class="text-[#87b9fe]">&#125;</div>

                  <div class="text-zinc-600 italic">// Manual Usage Tracking</div>
                  <div class="text-[#87b9fe]">await db.customers.update(&#123;</div>
                  <div class="pl-4 text-zinc-300">where: &#123; id &#125;,</div>
                  <div class="pl-4 text-zinc-300">data: &#123; credits: currentCredits - 1 &#125;</div>
                  <div class="text-[#87b9fe]">&#125;);</div>
                </div>
              {:else if selectedVSProvider === 'paystack'}
                <div class="space-y-4">
                  <div class="text-zinc-600 italic">// Manual Subscription Management</div>
                  <div class="text-orange-400">const sub = await paystack.subscription.retrieve(code);</div>
                  
                  <div class="text-zinc-600 italic">// Complex upgrade/proration logic</div>
                  <div class="text-orange-400">const remainingDays = calcDays(sub.next_payment_date);</div>
                  <div class="text-orange-400">const unusedValue = (sub.amount / 30) * remainingDays;</div>
                  
                  <div class="text-orange-400">await paystack.transaction.initialize(&#123;</div>
                  <div class="pl-4">amount: newPrice - unusedValue,</div>
                  <div class="pl-4 text-zinc-300">plan: <span class="text-emerald-400">"PLN_new_pro"</span></div>
                  <div class="text-orange-400">&#125;);</div>
                </div>
              {:else}
                <div class="space-y-4">
                  <div class="text-zinc-600 italic">// Manual Implementation</div>
                  <div class="text-orange-400">await {selectedVSProvider}.subscriptions.create(&#123; ... &#125;);</div>
                  <div class="text-zinc-500">// Handle webhooks, proration, and gating yourself</div>
                  <div class="text-zinc-500">// Sync database, handle credit expires...</div>
                </div>
              {/if}
            </div>
          </div>
        </div>

        <!-- Owostack / After -->
        <div class="space-y-8">
          <h3 class="text-center text-sm font-bold text-accent uppercase tracking-[0.3em]">{vsProviders.find(p => p.id === selectedVSProvider)?.name} with Owostack</h3>
          <div class="bg-[#0a0a0a] rounded-2xl border border-accent/30 overflow-hidden relative group">
            <div class="bg-accent/10 px-5 py-4 border-b border-accent/20 flex items-center justify-between">
              <div class="flex gap-1.5">
                <div class="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                <div class="w-2.5 h-2.5 rounded-full bg-amber-500"></div>
                <div class="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
              </div>
              <span class="text-[10px] font-mono text-accent uppercase font-black tracking-widest">billing.ts</span>
            </div>
            <div class="p-10 font-mono text-xs md:text-sm  leading-relaxed relative z-10">
              <div class="text-zinc-500 italic mb-6">// Real Infrastructure APIs</div>
              <div class="space-y-8">
                <div>
                  <div class="text-zinc-600 italic mb-2">// 1. Universal checkout (New/Upgrade/Downgrade/Metering)</div>
                  <div class="text-orange-400 font-bold">await owostack.attach(&#123;</div>
                  <div class="pl-6 text-zinc-300">customer: <span class="text-emerald-400">"user@example.com"</span>,</div>
                  <div class="pl-6 text-zinc-300">product: <span class="text-emerald-400">"pro_plan"</span></div>
                  <div class="text-orange-400">&#125;);</div>
                </div>
                
                <div>
                  <div class="text-orange-400 font-bold">await owostack.track(&#123;</div>
                  <div class="pl-6 text-zinc-300">customer: <span class="text-emerald-400">"user@example.com"</span>,</div>
                  <div class="pl-6 text-zinc-300">feature: <span class="text-emerald-400">"api_calls"</span>,</div>
                  <div class="pl-6 text-zinc-300">value: <span class="text-orange-400">1</span></div>
                  <div class="text-orange-400">&#125;);</div>
                </div>

                <div>
                  <div class="text-orange-400 font-bold">const access = await owostack.check(&#123;</div>
                  <div class="pl-6 text-zinc-300">customer: <span class="text-emerald-400">"user@example.com"</span>,</div>
                  <div class="pl-6 text-zinc-300">feature: <span class="text-emerald-400">"advanced_analytics"</span></div>
                  <div class="text-orange-400">&#125;);</div>
                </div>
              </div>
            </div>
          </div>
          <div class="text-center px-4">
            <p class="text-xl text-text-primary font-bold leading-tight mb-2 uppercase tracking-wide">Unified Billing API</p>
            <p class="text-text-secondary leading-relaxed max-w-sm mx-auto font-medium">
              Swap providers, add credit-based billing, and enforce feature limits without touching your core logic.
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Feature Highlights -->
  <section class="px-6 py-12 max-w-7xl mx-auto grid md:grid-cols-3 gap-8">
    <div class="p-8 bg-bg-secondary border border-border group hover:border-accent transition-colors">
      <div class="w-12 h-12 bg-accent/10 flex items-center justify-center mb-6 group-hover:bg-accent/20 transition-colors">
        <ShieldCheck size={24} class="text-accent" />
      </div>
      <h2 class="text-lg font-bold mb-3 uppercase tracking-wider">Entitlements & Gating</h2>
      <p class="text-sm text-text-secondary leading-relaxed">
        Map features to plans in your product catalog. Owostack automatically provisions entitlements when customers subscribe, giving you instant, source-of-truth gating.
      </p>
    </div>
    <div class="p-8 bg-bg-secondary border border-border group hover:border-accent transition-colors">
      <div class="w-12 h-12 bg-emerald-500/10 flex items-center justify-center mb-6 group-hover:bg-emerald-500/20 transition-colors">
        <Gauge size={24} class="text-emerald-500" />
      </div>
      <h2 class="text-lg font-bold mb-3 uppercase tracking-wider">Atomic Usage Metering</h2>
      <p class="text-sm text-text-secondary leading-relaxed">
        Track metered features with real-time atomic balance tracking. Support credits, quotas, and rollover with automatic period resets and zero race conditions.
      </p>
    </div>
    <div class="p-8 bg-bg-secondary border border-border group hover:border-accent transition-colors">
      <div class="w-12 h-12 bg-blue-500/10 flex items-center justify-center mb-6 group-hover:bg-blue-500/20 transition-colors">
        <Layers size={24} class="text-blue-500" />
      </div>
      <h2 class="text-lg font-bold mb-3 uppercase tracking-wider">Automated Lifecycle</h2>
      <p class="text-sm text-text-secondary leading-relaxed">
        Upgrades, downgrades, and trials are handled at the infrastructure level. Proration and feature access are re-calculated automatically on every plan switch.
      </p>
    </div>
  </section>

  <!-- Entitlements Deep Dive -->
  <section class="px-6 py-24 max-w-7xl mx-auto border-t border-border">
    <div class="grid md:grid-cols-2 gap-16 items-center">
      <div>
        <div class="text-[10px] font-bold text-accent uppercase tracking-[0.2em] mb-4">Decoupled Gating</div>
        <h2 class="text-3xl md:text-5xl font-bold mb-6 leading-none">
          Your code shouldn't care 
          <span class="text-text-dim">about plans or providers.</span>
        </h2>
        <p class="text-lg text-text-secondary mb-8 leading-relaxed">
          Stop writing `if (user.plan === 'pro')`. Instead, ask Owostack if the customer has the <strong>entitlement</strong>. 
          When you change a feature's availability in the dashboard, every instance of your app updates instantly.
        </p>
        <ul class="space-y-4">
          <li class="flex items-start gap-3 text-sm text-text-secondary">
            <Check size={18} class="text-emerald-500 shrink-0 mt-0.5" />
            <span><strong>Centralized Catalog:</strong> Define features once, reuse across any plan.</span>
          </li>
          <li class="flex items-start gap-3 text-sm text-text-secondary">
            <Check size={18} class="text-emerald-500 shrink-0 mt-0.5" />
            <span><strong>Instant Provisioning:</strong> Entitlements are created/revoked automatically on sub events.</span>
          </li>
          <li class="flex items-start gap-3 text-sm text-text-secondary">
            <Check size={18} class="text-emerald-500 shrink-0 mt-0.5" />
            <span><strong>Metered Gating:</strong> Enforce limits on API calls, storage, or seats with one line of code.</span>
          </li>
        </ul>
      </div>
      <div class="bg-bg-secondary border border-border p-1 rounded-sm ">
        <div class="bg-bg-primary border border-border p-6 font-mono text-xs space-y-4">
          <div class="text-text-dim">// This stays the same even if you change the plan name or price</div>
          <div class="flex gap-2">
            <span class="text-orange-500 font-bold">const</span> &#123; allowed, code &#125; = <span class="text-orange-500 font-bold">await</span> owostack.<span class="text-amber-500">check</span>(&#123;
          </div>
          <div class="pl-4">
            customer: <span class="text-emerald-500">"user@example.com"</span>,
          </div>
          <div class="pl-4">
            feature: <span class="text-emerald-500">"advanced_analytics"</span>
          </div>
          <div class="flex gap-2">&#125;);</div>
          
          <div class="pt-4 border-t border-border/50">
            <div class="text-text-dim">// Result is resolved from the customer's active entitlements</div>
            <div class="text-emerald-500 mt-2 font-bold">Result: &#123; allowed: true, code: "access_granted" &#125;</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Usage Metering Section -->
  <section class="px-6 py-24 max-w-7xl mx-auto border-t border-border bg-bg-secondary/30">
    <div class="grid md:grid-cols-2 gap-16 items-center">
      <div class="order-2 md:order-1 bg-bg-primary border border-border p-8 rounded-sm  relative overflow-hidden">
        <div class="flex justify-between items-center mb-8">
          <div class="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Real-time Metering</div>
          <div class="flex gap-1">
            <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
            <div class="w-1.5 h-1.5 rounded-full bg-emerald-500/20"></div>
          </div>
        </div>
        
        <div class="space-y-8">
          <div>
            <div class="flex justify-between text-[10px] font-bold uppercase tracking-widest mb-3">
              <span class="text-text-secondary">API Requests</span>
              <span class="text-emerald-500 font-mono">8,421 / 10,000</span>
            </div>
            <div class="h-2 w-full bg-bg-secondary border border-border rounded-full overflow-hidden">
              <div class="h-full bg-emerald-500 " style="width: 84.2%"></div>
            </div>
          </div>

          <div class="p-4 bg-bg-secondary/50 border border-border font-mono text-[10px] space-y-2">
            <div class="text-text-dim">// Atomic decrement via UsageMeterDO</div>
            <div><span class="text-orange-500 font-bold">await</span> owostack.<span class="text-amber-500">track</span>(&#123;</div>
            <div class="pl-4">customer: <span class="text-emerald-500">"user@example.com"</span>,</div>
            <div class="pl-4">feature: <span class="text-emerald-500">"api_requests"</span>,</div>
            <div class="pl-4">value: <span class="text-orange-500">1</span></div>
            <div>&#125;);</div>
          </div>
        </div>
      </div>

      <div class="order-1 md:order-2">
        <div class="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.2em] mb-4">Precision Metering</div>
        <h2 class="text-3xl md:text-5xl font-bold mb-6 leading-tight">
          Meter usage with <br />
          <span class="text-text-dim">atomic precision.</span>
        </h2>
        <p class="text-lg text-text-secondary mb-8 leading-relaxed">
          Owostack uses Cloudflare Durable Objects to track usage in real-time. 
          No race conditions, no eventual consistency — just fast, reliable metering for metered billing and credit-based systems.
        </p>
        <ul class="space-y-4">
          <li class="flex items-start gap-3 text-sm text-text-secondary">
            <Check size={18} class="text-emerald-500 shrink-0 mt-0.5" />
            <span><strong>Atomic Resets:</strong> Quotas reset automatically at the start of every billing period.</span>
          </li>
          <li class="flex items-start gap-3 text-sm text-text-secondary">
            <Check size={18} class="text-emerald-500 shrink-0 mt-0.5" />
            <span><strong>Credit Multipliers:</strong> Assign different costs to different actions (e.g. 1 task = 5 credits).</span>
          </li>
          <li class="flex items-start gap-3 text-sm text-text-secondary">
            <Check size={18} class="text-emerald-500 shrink-0 mt-0.5" />
            <span><strong>Rollover Support:</strong> Carry over unused balance to the next period automatically.</span>
          </li>
        </ul>
      </div>
    </div>
  </section>

  <!-- Dashboard Preview Container -->
  <section class="px-6 pb-24 max-w-7xl mx-auto">
    <div class="border border-border bg-bg-primary overflow-hidden rounded-sm ">
      <!-- Dashboard Main Content -->
      <main class="flex-1 flex flex-col">
        <div class="p-8">
          <div class="flex flex-col md:flex-row justify-between items-start mb-8 gap-4">
            <div>
              <h2 class="text-xl font-bold mb-1">The Three API Calls</h2>
              <div class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Attach. Check. Track.</div>
            </div>
            <div class="flex items-center gap-2">
              <a href="https://github.com/owostack" class="bg-bg-card border border-border text-text-secondary py-1.5 px-3 text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 hover:bg-bg-card-hover transition-colors">
                <Github size={14} />
                SDK Repository
              </a>
              <a href="https://docs.owostack.com" class="btn btn-primary py-1.5 px-3 text-[10px] font-bold uppercase tracking-wider">
                View Docs
              </a>
            </div>
          </div>

          <!-- Stats Grid -->
          <div class="grid lg:grid-cols-5 gap-0 border border-border overflow-hidden ">
            <!-- IDE-like Code Implementation (3/5 columns) -->
            <div class="lg:col-span-3 bg-bg-secondary flex flex-col min-h-100">
              <div class="flex items-center bg-bg-primary border-b border-border">
                <button 
                  onclick={() => activeTab = 'billing.ts'}
                  class="px-4 py-2 text-[10px] font-bold uppercase tracking-widest border-r border-border transition-colors {activeTab === 'billing.ts' ? 'bg-bg-secondary text-accent' : 'text-text-dim hover:text-text-secondary'}"
                >
                  billing.ts
                </button>
                <button 
                  onclick={() => activeTab = 'config.json'}
                  class="px-4 py-2 text-[10px] font-bold uppercase tracking-widest border-r border-border transition-colors {activeTab === 'config.json' ? 'bg-bg-secondary text-accent' : 'text-text-dim hover:text-text-secondary'}"
                >
                  config.json
                </button>
                <div class="ml-auto flex items-center gap-3 px-4">
                  <button 
                    onclick={handleRun}
                    disabled={isExecuting}
                    class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-500 hover:text-emerald-400 transition-colors disabled:opacity-50"
                  >
                    {#if isExecuting}
                      <Activity size={12} class="animate-pulse" />
                      Running...
                    {:else}
                      <Play size={12} fill="currentColor" />
                      Execute
                    {/if}
                  </button>
                </div>
              </div>
              
              <div class="p-6 text-left font-mono text-sm overflow-x-auto flex-1 relative bg-bg-secondary/50">
                {#if activeTab === 'billing.ts'}
                  <pre class="text-text-secondary"><span class="text-orange-500 font-bold">import</span> &#123; owostack &#125; <span class="text-orange-500 font-bold">from</span> <span class="text-emerald-500">"@owostack/core"</span>;

<span class="text-text-dim italic">// 1. Attach: Subscribe customer to product</span>
<span class="text-orange-500 font-bold">const</span> &#123; checkoutUrl &#125; = <span class="text-orange-500 font-bold">await</span> owostack.<span class="text-amber-500">attach</span>(&#123;
  customer: <span class="text-emerald-500">"user@example.com"</span>,
  product: <span class="text-emerald-500">"pro_plan"</span>
&#125;);

<span class="text-text-dim italic">// 2. Check: Gate features & evaluate limits</span>
<span class="text-orange-500 font-bold">const</span> access = <span class="text-orange-500 font-bold">await</span> owostack.<span class="text-amber-500">check</span>(&#123;
  customer: <span class="text-emerald-500">"user@example.com"</span>,
  feature: <span class="text-emerald-500">"api_calls"</span>
&#125;);

<span class="text-text-dim italic">// 3. Track: Atomic usage metering</span>
<span class="text-orange-500 font-bold">await</span> owostack.<span class="text-amber-500">track</span>(&#123;
  customer: <span class="text-emerald-500">"user@example.com"</span>,
  feature: <span class="text-emerald-500">"api_calls"</span>,
  value: <span class="text-orange-500">1</span>
&#125;);</pre>
                {:else}
                  <pre class="text-text-secondary">&#123;
  <span class="text-emerald-500">"plans"</span>: &#123;
    <span class="text-emerald-500">"pro_plan"</span>: &#123;
      <span class="text-emerald-500">"name"</span>: <span class="text-amber-500">"Professional"</span>,
      <span class="text-emerald-500">"features"</span>: &#123;
        <span class="text-emerald-500">"api_calls"</span>: &#123; <span class="text-emerald-500">"limit"</span>: <span class="text-orange-500">10000</span> &#125;
      &#125;
    &#125;
  &#125;
&#125;</pre>
                {/if}

                <div class="absolute bottom-4 right-4 flex items-center gap-2">
                  <button class="p-1.5 bg-bg-primary border border-border text-text-dim hover:text-text-primary rounded-sm transition-colors ">
                    <Copy size={14} />
                  </button>
                </div>
              </div>
            </div>

            <!-- Enhanced Response/Visualization (2/5 columns) -->
            <div class="lg:col-span-2 bg-bg-primary border-l border-border p-8 flex flex-col gap-8 overflow-y-auto max-h-100">
              <div>
                <div class="flex justify-between items-center mb-6">
                  <h3 class="text-[10px] font-bold text-accent uppercase tracking-[0.2em]">Live Output</h3>
                  <div class="flex gap-1.5">
                    <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                    <div class="w-1.5 h-1.5 rounded-full bg-emerald-500/20"></div>
                    <div class="w-1.5 h-1.5 rounded-full bg-emerald-500/20"></div>
                  </div>
                </div>
                
                {#if showResponse}
                  <div class="space-y-6 animate-in">
                    <div>
                      <div class="flex justify-between items-end mb-3">
                        <span class="text-[10px] font-bold text-text-secondary uppercase">owostack.check()</span>
                        <span class="badge badge-success text-[9px] font-bold">ALLOWED</span>
                      </div>
                      <div class="bg-bg-secondary border border-border p-4 font-mono text-[11px] rounded-sm ">
                        <div class="flex gap-2"><span class="text-text-dim">"allowed":</span> <span class="text-emerald-500">true</span></div>
                        <div class="flex gap-2"><span class="text-text-dim">"code":</span> <span class="text-emerald-500">"access_granted"</span></div>
                        <div class="flex gap-2"><span class="text-text-dim">"balance":</span> <span class="text-orange-500">958</span></div>
                        <div class="flex gap-2"><span class="text-text-dim">"plan":</span> <span class="text-amber-500">"Pro"</span></div>
                      </div>
                    </div>

                    <div>
                      <div class="text-[9px] font-bold text-text-dim uppercase tracking-widest mb-3 text-left">Usage Meter</div>
                      <div class="relative h-1.5 w-full bg-bg-secondary rounded-full overflow-hidden border border-border/50">
                        <div class="absolute top-0 left-0 h-full bg-accent transition-all duration-1000 " style="width: 84.2%"></div>
                      </div>
                      <div class="flex justify-between mt-2 font-mono text-[9px] text-text-dim uppercase font-bold">
                        <span class="text-accent">84.2% used</span>
                        <span>10k Limit</span>
                      </div>
                    </div>
                  </div>
                {:else}
                  <button 
                    type="button"
                    class="h-full w-full flex flex-col items-center justify-center text-center py-12 opacity-30 group/play cursor-pointer hover:opacity-100 transition-opacity" 
                    onclick={handleRun}
                    aria-label="Execute SDK to see live response"
                  >
                    <Terminal size={32} class="mb-4 text-text-dim group-hover/play:text-accent transition-colors" />
                    <p class="text-[10px] font-bold uppercase tracking-widest text-text-dim group-hover/play:text-text-secondary transition-colors">Execute SDK to see live response</p>
                  </button>
                {/if}
              </div>

              <div class="mt-auto pt-6 border-t border-border">
                <div class="text-[9px] font-bold text-text-dim uppercase tracking-widest mb-4 text-left">Multi-Provider Routing</div>
                <div class="space-y-2.5">
                  <div class="flex items-center justify-between p-3 bg-bg-secondary border border-border rounded-sm hover:border-text-dim transition-all group/gw">
                    <div class="flex items-center gap-3">
                      <CreditCard size={14} class="text-text-dim group-hover/gw:text-accent transition-colors" />
                      <span class="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Paystack (NG/GH/KE)</span>
                    </div>
                    <div class="w-1.5 h-1.5 rounded-full bg-emerald-500  animate-pulse"></div>
                  </div>
                  <div class="flex items-center justify-between p-3 bg-bg-secondary border border-border rounded-sm hover:border-text-dim transition-all group/gw">
                    <div class="flex items-center gap-3">
                      <Layers size={14} class="text-text-dim group-hover/gw:text-accent transition-colors" />
                      <span class="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Stripe (US/EU)</span>
                    </div>
                    <div class="w-1.5 h-1.5 rounded-full bg-emerald-500  animate-pulse"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  </section>

  <!-- Pricing Section -->
  <section id="pricing" class="py-24 px-6 border-t border-border bg-bg-primary">
    <div class="max-w-7xl mx-auto grid md:grid-cols-12 gap-12 items-start">
      <div class="md:col-span-4 text-left">
        <h2 class="text-4xl font-bold mb-4">Pricing</h2>
        <p class="text-text-secondary max-w-xs">For African startups scaling fast.</p>
      </div>

      <div class="md:col-span-8 grid sm:grid-cols-2 gap-6">
        <!-- Basic Plan -->
        <div class="bg-bg-primary border border-border p-8 flex flex-col min-h-100 text-left">
          <div class="flex justify-between items-start mb-12">
            <h3 class="text-2xl font-bold">Starter</h3>
            <div class="text-3xl font-bold">Free</div>
          </div>
          <ul class="space-y-4 mb-auto">
            <li class="flex items-center gap-3 text-sm text-text-secondary">
              <span class="bg-accent/20 text-accent p-0.5"><Check size={14}/></span>
              50 Active Customers
            </li>
            <li class="flex items-center gap-3 text-sm text-text-secondary">
              <span class="bg-accent/20 text-accent p-0.5"><Check size={14}/></span>
              3 Core Methods
            </li>
            <li class="flex items-center gap-3 text-sm text-text-secondary">
              <span class="bg-accent/20 text-accent p-0.5"><Check size={14}/></span>
              Mobile Money / USSD
            </li>
          </ul>
          <button class="bg-bg-card border border-border text-text-primary w-full mt-12 py-3 font-bold uppercase tracking-widest text-xs hover:bg-bg-card-hover transition-all">Start Free</button>
        </div>

        <!-- Pro Plan -->
        <div class="bg-bg-primary border border-accent relative flex flex-col min-h-100 text-left ">
          <div class="absolute -top-3 right-6 bg-accent text-white text-[9px] font-bold px-3 py-1 uppercase tracking-widest rounded-sm">
            Recommended
          </div>
          <div class="flex justify-between items-start mb-12 p-8 pb-0">
            <h3 class="text-2xl font-bold">Pro</h3>
            <div class="text-right">
              <div class="text-3xl font-bold">₦15,000</div>
              <div class="text-[10px] text-text-dim font-bold uppercase tracking-wider">/month</div>
            </div>
          </div>
          <ul class="space-y-4 mb-auto px-8">
            <li class="flex items-center gap-3 text-sm text-text-secondary">
              <span class="bg-accent/20 text-accent p-0.5"><Check size={14}/></span>
              Multi-Provider Support
            </li>
            <li class="flex items-center gap-3 text-sm text-text-secondary">
              <span class="bg-accent/20 text-accent p-0.5"><Check size={14}/></span>
              Usage-Based Billing
            </li>
            <li class="flex items-center gap-3 text-sm text-text-secondary">
              <span class="bg-accent/20 text-accent p-0.5"><Check size={14}/></span>
              Instant Feature Gating
            </li>
          </ul>
          <div class="p-8 pt-0">
            <button class="btn btn-primary w-full mt-12 py-3 font-bold uppercase tracking-widest text-xs transition-all"  >Select Pro</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Self-Hostable Banner -->
    <div class="max-w-7xl mx-auto mt-6">
      <div class="grid md:grid-cols-12 gap-12">
        <div class="md:col-start-5 md:col-span-8">
          <div class="bg-bg-secondary border border-border p-6 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div class="text-left">
              <h4 class="text-lg font-bold mb-1">Self-Host on Cloudflare</h4>
              <p class="text-xs text-text-dim">Deploy on your own infrastructure with Workers & D1.</p>
            </div>
            <a href="https://github.com/owostack" class="bg-bg-card border border-border text-text-primary py-2 px-6 text-xs font-bold whitespace-nowrap hover:bg-bg-card-hover transition-all">
              View GitHub
            </a>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="px-6 py-12 border-t border-border bg-bg-primary">
    <div class="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
      <div class="text-[10px] font-bold text-text-dim uppercase tracking-[0.2em]">
        a product of <span class="text-text-secondary">Owostack Labs</span>
      </div>
      
      <div class="flex items-center gap-8 text-[11px] font-bold text-text-dim uppercase tracking-widest">
        <a href="https://docs.owostack.com" class="hover:text-text-primary transition-colors">Documentation</a>
        <a href="/privacy" class="hover:text-text-primary transition-colors">Privacy</a>
        <a href="/terms" class="hover:text-text-primary transition-colors">Terms</a>
      </div>
    </div>
  </footer>
</div>

<style>
  :global(.font-serif-heading) {
    font-family: var(--font-serif);
  }

  /* Custom animation for the live output */
  @keyframes fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .animate-in {
    animation: fade-in 0.5s ease-out forwards;
  }
</style>