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
    Play,
    Copy,
  } from "lucide-svelte";
  import Logo from "$lib/components/ui/Logo.svelte";

  let activeTab = $state('billing.ts');
  let isExecuting = $state(false);
  let showResponse = $state(false);

  const sidebarNav = [
    { label: "infrastructure", icon: Layers, active: true },
    { label: "entitlements", icon: ShieldCheck },
    { label: "usage", icon: BarChart3 },
    { label: "payouts", icon: Building2 },
    { label: "webhooks", icon: Activity, badge: 1 },
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
  <title>Owostack - Subscriptions & Billing for African Startups</title>
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
        <button class="p-1 hover:text-text-primary transition-colors">
          <div class="w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_rgba(234,88,12,0.5)]"></div>
        </button>
      </nav>
    </div>
  </header>

  <!-- Hero Section -->
  <section class="pt-24 pb-16 px-6 max-w-7xl mx-auto">
    <div class="max-w-3xl">
      <h1 class="text-5xl md:text-7xl font-bold leading-[1.1] tracking-tight mb-8">
        Billing for <em class="font-serif-heading italic font-normal text-amber-500/80">African</em><br />
        <span class="text-accent">scale</span>
      </h1>
      <p class="text-lg md:text-xl text-text-secondary max-w-xl leading-relaxed">
        The "Autumn for Paystack". Implement subscriptions, usage-based billing, and feature gating without the complexity.
      </p>
    </div>
  </section>

  <!-- Dashboard Preview Container -->
  <section class="px-6 pb-24 max-w-7xl mx-auto">
    <div class="border border-border bg-bg-primary flex min-h-175 overflow-hidden rounded-sm shadow-2xl">
      <!-- Dashboard Sidebar -->
      <aside class="w-56 border-r border-border p-6 hidden lg:flex flex-col gap-8 bg-bg-secondary">
        <div>
          <div class="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-4">Core API</div>
          <nav class="space-y-4">
            {#each sidebarNav as item}
              <a href="#" class="flex items-center gap-3 {item.active ? 'text-text-primary' : 'text-text-secondary'} hover:text-text-primary transition-colors flex justify-between w-full group">
                <div class="flex items-center gap-3">
                  <item.icon size={16} class={item.active ? 'text-accent' : 'group-hover:text-text-primary'} />
                  <span class="text-xs font-medium uppercase tracking-wider">{item.label}</span>
                </div>
                {#if item.badge}
                  <span class="bg-accent text-white text-[9px] px-1.5 py-0.5 font-bold">1</span>
                {/if}
              </a>
            {/each}
          </nav>
        </div>
      </aside>

      <!-- Dashboard Main Content -->
      <main class="flex-1 flex flex-col">
        <!-- Dashboard Top Bar -->
        <div class="p-4 border-b border-border flex justify-end items-center gap-4 bg-bg-secondary">
          <div class="flex items-center gap-2 text-xs font-medium">
            <span class="text-text-dim uppercase tracking-widest text-[10px]">Filter</span>
            <button class="bg-bg-primary border border-border px-3 py-1.5 flex items-center gap-4 hover:border-text-dim transition-colors text-text-secondary">
              <span>last 90 days</span>
              <ChevronDown size={14} class="text-text-dim" />
            </button>
          </div>
        </div>

        <div class="p-8">
          <div class="flex justify-between items-start mb-8">
            <div>
              <h2 class="text-xl font-bold mb-1">SDK Integration</h2>
              <div class="text-[10px] font-bold text-text-dim uppercase tracking-widest">3 methods. zero webhooks.</div>
            </div>
            <div class="flex items-center gap-2">
              <button class="bg-bg-card border border-border text-text-secondary py-1.5 px-3 text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 hover:bg-bg-card-hover transition-colors">
                <Github size={14} />
                SDK Repository
              </button>
              <button class="btn btn-primary py-1.5 px-3 text-[10px] font-bold uppercase tracking-wider">
                View Docs
              </button>
            </div>
          </div>

          <!-- Stats Grid -->
          <!-- <div class="grid grid-cols-3 gap-4 mb-8">
            <div class="bg-bg-secondary border border-border p-4">
              <div class="text-[9px] font-bold text-text-dim uppercase tracking-widest mb-1">Active Customers</div>
              <div class="text-3xl font-bold">7</div>
            </div>
            <div class="bg-bg-secondary border border-border p-4">
              <div class="text-[9px] font-bold text-text-dim uppercase tracking-widest mb-1">Success Rate</div>
              <div class="text-3xl font-bold">100%</div>
            </div>
            <div class="bg-bg-secondary border border-border p-4">
              <div class="text-[9px] font-bold text-text-dim uppercase tracking-widest mb-1">Volume (NGN)</div>
              <div class="text-3xl font-bold">₦0</div>
            </div>
          </div> -->

          <div class="grid lg:grid-cols-5 gap-0 border border-border rounded-sm overflow-hidden shadow-2xl">
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
                  <pre class="text-text-secondary"><span class="text-orange-500 font-bold">import</span> &#123; paystack &#125; <span class="text-orange-500 font-bold">from</span> <span class="text-emerald-500">"@owostack/core"</span>;

<span class="text-text-dim italic">// 1. Initialize checkout</span>
<span class="text-orange-500 font-bold">const</span> &#123; url &#125; = <span class="text-orange-500 font-bold">await</span> paystack.<span class="text-amber-500">attach</span>(&#123;
  customer: <span class="text-emerald-500">"cus_123"</span>,
  product: <span class="text-emerald-500">"pro_plan"</span>
&#125;);

<span class="text-text-dim italic">// 2. Check entitlements</span>
<span class="text-orange-500 font-bold">const</span> access = <span class="text-orange-500 font-bold">await</span> paystack.<span class="text-amber-500">check</span>(&#123;
  customer: <span class="text-emerald-500">"cus_123"</span>,
  feature: <span class="text-emerald-500">"api_calls"</span>
&#125;);

<span class="text-text-dim italic">// 3. Meter usage</span>
<span class="text-orange-500 font-bold">await</span> paystack.<span class="text-amber-500">track</span>(&#123;
  customer: <span class="text-emerald-500">"cus_123"</span>,
  feature: <span class="text-emerald-500">"api_calls"</span>,
  amount: <span class="text-orange-500">1</span>
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
                  <button class="p-1.5 bg-bg-primary border border-border text-text-dim hover:text-text-primary rounded-sm transition-colors shadow-lg">
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
                        <span class="text-[10px] font-bold text-text-secondary uppercase">paystack.check()</span>
                        <span class="badge badge-success text-[9px] font-bold">ALLOWED</span>
                      </div>
                      <div class="bg-bg-secondary border border-border p-4 font-mono text-[11px] rounded-sm shadow-inner">
                        <div class="flex gap-2"><span class="text-text-dim">"status":</span> <span class="text-emerald-500">"active"</span></div>
                        <div class="flex gap-2"><span class="text-text-dim">"remaining":</span> <span class="text-orange-500">158</span></div>
                      </div>
                    </div>

                    <div>
                      <div class="text-[9px] font-bold text-text-dim uppercase tracking-widest mb-3 text-left">Usage Meter</div>
                      <div class="relative h-1.5 w-full bg-bg-secondary rounded-full overflow-hidden border border-border/50">
                        <div class="absolute top-0 left-0 h-full bg-accent transition-all duration-1000 shadow-[0_0_12px_rgba(234,88,12,0.4)]" style="width: 84.2%"></div>
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
                <div class="text-[9px] font-bold text-text-dim uppercase tracking-widest mb-4 text-left">Edge Gateway</div>
                <div class="space-y-2.5">
                  <div class="flex items-center justify-between p-3 bg-bg-secondary border border-border rounded-sm hover:border-text-dim transition-all group/gw">
                    <div class="flex items-center gap-3">
                      <Smartphone size={14} class="text-text-dim group-hover/gw:text-accent transition-colors" />
                      <span class="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Mobile Money</span>
                    </div>
                    <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)] animate-pulse"></div>
                  </div>
                  <div class="flex items-center justify-between p-3 bg-bg-secondary border border-border rounded-sm hover:border-text-dim transition-all group/gw">
                    <div class="flex items-center gap-3">
                      <Building2 size={14} class="text-text-dim group-hover/gw:text-accent transition-colors" />
                      <span class="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Bank Transfer</span>
                    </div>
                    <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)] animate-pulse"></div>
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
        <div class="bg-bg-primary border border-accent relative flex flex-col min-h-100 text-left shadow-[0_0_20px_rgba(234,88,12,0.1)]">
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
              Unlimited Customers
            </li>
            <li class="flex items-center gap-3 text-sm text-text-secondary">
              <span class="bg-accent/20 text-accent p-0.5"><Check size={14}/></span>
              Usage Analytics
            </li>
            <li class="flex items-center gap-3 text-sm text-text-secondary">
              <span class="bg-accent/20 text-accent p-0.5"><Check size={14}/></span>
              Virtual Bank Accounts
            </li>
          </ul>
          <div class="p-8 pt-0">
            <button class="btn btn-primary w-full mt-12 py-3 font-bold uppercase tracking-widest text-xs transition-all shadow-lg shadow-orange-900/20">Select Pro</button>
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
        <a href="#" class="hover:text-text-primary transition-colors">Documentation</a>
        <a href="#" class="hover:text-text-primary transition-colors">Privacy</a>
        <a href="#" class="hover:text-text-primary transition-colors">Terms</a>
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