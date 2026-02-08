<script lang="ts">
  import { 
    ChevronLeft, 
    Plus, 
    Settings2, 
    Trash2, 
    Zap, 
    Info, 
    Loader2, 
    X,
    ChevronRight,
    ZapOff,
    Edit3,
    Search,
    ExternalLink,
    Calendar,
    Box,
    Copy
  } from "lucide-svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import { fade, slide, fly } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";

  const projectId = $derived(page.params.projectId);
  const planId = $derived(page.params.planId);

  let plan = $state<any>(null);
  let features = $state<any[]>([]);
  let creditSystems = $state<any[]>([]);
  let isLoading = $state(true);
  let isSaving = $state(false);

  // Modals state
  let showAttachModal = $state(false);
  let showConfigModal = $state(false);
  let showEditPlanModal = $state(false);
  let selectedFeature = $state<any>(null);
  let editingPlanFeature = $state<any>(null);

  let configLimitValue = $state<string>("");
  let configResetInterval = $state<string>("monthly");
  let configUsageModel = $state<"included" | "usage_based">("included");
  let configPricePerUnit = $state<string>("");
  let configBillingUnits = $state<string>("1");
  let configOverage = $state<"block" | "charge">("block");

  let featureSearchQuery = $state<string>("");

  $effect(() => {
    if (showConfigModal && editingPlanFeature) {
      configLimitValue =
        editingPlanFeature.limitValue === null || editingPlanFeature.limitValue === undefined
          ? ""
          : String(editingPlanFeature.limitValue);
      const rawInterval = editingPlanFeature.resetInterval || "monthly";
      const intervalAliases: Record<string, string> = { month: 'monthly', week: 'weekly', day: 'daily', year: 'yearly' };
      configResetInterval = intervalAliases[rawInterval] || rawInterval;
      configUsageModel = editingPlanFeature.usageModel || "included";
      configPricePerUnit = editingPlanFeature.pricePerUnit ? String(editingPlanFeature.pricePerUnit / 100) : "";
      configBillingUnits = String(editingPlanFeature.billingUnits || 1);
      configOverage = editingPlanFeature.overage || "block";
    }
  });

  let editName = $state<string>("");
  let editDescription = $state<string>("");
  let editType = $state<"free" | "paid">("paid");
  let editBillingType = $state<"recurring" | "one_time">("recurring");
  let editInterval = $state<string>("monthly");
  let editCurrency = $state<string>("NGN");
  let editPrice = $state<string>("");
  let editTrialDays = $state<string>("0");
  let editTrialUnit = $state<string>("days");

  $effect(() => {
    if (showEditPlanModal && plan) {
      editName = plan.name || "";
      editDescription = plan.description || "";
      editType = plan.type || "paid";
      editBillingType = plan.billingType || "recurring";
      editInterval = plan.interval || "monthly";
      editCurrency = plan.currency || "NGN";
      editPrice = typeof plan.price === "number" ? String(plan.price / 100) : "";
      editTrialDays = String(plan.trialDays || 0);
      editTrialUnit = (plan.metadata as any)?.trialUnit === "minutes" ? "minutes" : "days";
    }
  });

  async function savePlanEdits() {
    if (!editName.trim()) return;

    isSaving = true;
    try {
      const payload: any = {
        name: editName.trim(),
        description: editDescription.trim() ? editDescription.trim() : null,
        type: editType,
        billingType: editBillingType,
        interval: editBillingType === "one_time" ? "monthly" : editInterval,
        currency: editCurrency,
        trialDays: Math.max(0, Number(editTrialDays || 0)),
        trialUnit: editTrialUnit,
      };

      if (editType === "free") {
        payload.price = 0;
      } else {
        const parsed = Number(editPrice);
        payload.price = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
      }

      console.log("Saving plan edits:", { planId, payload });

      const res = await apiFetch(`/api/dashboard/plans/${planId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      console.log("Save plan response:", res);

      if (res.error) {
        throw new Error(res.error.message || "Failed to update plan");
      }

      showEditPlanModal = false;
      await loadData();
    } catch (e: any) {
      console.error("Failed to update plan", e);
      alert(e.message || "An error occurred while saving changes");
    } finally {
      isSaving = false;
    }
  }

  async function loadData() {
    isLoading = true;
    try {
      const [planRes, featuresRes, creditsRes] = await Promise.all([
        apiFetch(`/api/dashboard/plans/${planId}`),
        apiFetch(`/api/dashboard/features?organizationId=${projectId}`),
        apiFetch(`/api/dashboard/credits?organizationId=${projectId}`),
      ]);
      
      if (planRes.data) plan = planRes.data.data;
      if (featuresRes.data) features = featuresRes.data.data;
      if (creditsRes.data) creditSystems = creditsRes.data.data || [];
    } catch (e) {
      console.error("Failed to load data", e);
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    if (planId) loadData();
  });

  async function detachFeature(planFeatureId: string) {
    if (!confirm("Are you sure you want to remove this feature from the plan?")) return;
    try {
      await apiFetch(`/api/dashboard/plans/features/${planFeatureId}`, { method: "DELETE" });
      await loadData();
    } catch (e) {
      console.error("Failed to detach feature", e);
    }
  }

  async function handleAttachFeature(featureId: string) {
    isSaving = true;
    try {
      await apiFetch(`/api/dashboard/plans/${planId}/features`, {
        method: "POST",
        body: JSON.stringify({ featureId })
      });
      showAttachModal = false;
      await loadData();
    } catch (e) {
      console.error("Failed to attach feature", e);
    } finally {
      isSaving = false;
    }
  }

  async function handleUpdateFeatureConfig(config: any) {
    isSaving = true;
    try {
      await apiFetch(`/api/dashboard/plans/features/${editingPlanFeature.id}`, {
        method: "PATCH",
        body: JSON.stringify(config)
      });
      showConfigModal = false;
      editingPlanFeature = null;
      await loadData();
    } catch (e) {
      console.error("Failed to update config", e);
    } finally {
      isSaving = false;
    }
  }

  function formatMoney(amount: number, currency: string) {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: currency,
    }).format(amount / 100);
  }
</script>

<svelte:head>
  <title>{plan ? plan.name : 'Plan Details'} - Owostack</title>
</svelte:head>

<div class="max-w-6xl space-y-10">
  <!-- Top Navigation & Title -->
  <div class="space-y-6">
    <a 
      href="/app/{projectId}/plans" 
      class="inline-flex items-center gap-2 text-text-secondary hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest"
    >
      <ChevronLeft size={14} />
      Back to Plans
    </a>

    {#if plan}
      <div class="flex items-end justify-between border-b border-border pb-8">
        <div class="space-y-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 bg-bg-card border border-border flex items-center justify-center shadow-md">
              <Box size={24} class="text-text-secondary" />
            </div>
            <div>
              <h1 class="text-2xl font-bold text-white tracking-tight uppercase italic">{plan.name}</h1>
              <div class="flex items-center gap-2 mt-1">
                <span class="px-2 py-0.5 bg-accent text-accent-contrast text-[10px] font-bold uppercase tracking-widest">
                  {plan.type}
                </span>
                {#if plan.billingType === 'one_time'}
                  <span class="px-2 py-0.5 bg-bg-secondary text-text-secondary border border-border text-[10px] font-bold rounded uppercase tracking-widest">
                    One-off
                  </span>
                {/if}
              </div>
            </div>
          </div>
          <p class="text-text-secondary text-xs max-w-2xl leading-relaxed">
            {plan.description || 'No description provided.'}
          </p>
        </div>
        
        <div class="flex flex-col items-end gap-1">
          <div class="text-3xl font-bold text-white tracking-tighter">
            {formatMoney(plan.price, plan.currency)}
          </div>
          <div class="text-[10px] font-bold text-text-dim uppercase tracking-widest">
            Billed {plan.interval}
          </div>
        </div>
      </div>
    {/if}
  </div>

  {#if isLoading}
    <div class="space-y-10">
      <div class="flex items-end justify-between border-b border-border pb-8">
        <div class="space-y-4">
          <div class="flex items-center gap-3">
            <Skeleton class="w-12 h-12" />
            <div class="space-y-2">
              <Skeleton class="h-8 w-48" />
              <Skeleton class="h-4 w-32" />
            </div>
          </div>
          <Skeleton class="h-4 w-2/3" />
        </div>
        <div class="flex flex-col items-end gap-2">
          <Skeleton class="h-10 w-32" />
          <Skeleton class="h-3 w-20" />
        </div>
      </div>

      <div class="grid lg:grid-cols-12 gap-12">
        <div class="lg:col-span-8 space-y-6">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <Skeleton class="w-8 h-8 rounded" />
              <Skeleton class="h-4 w-48" />
            </div>
            <Skeleton class="h-9 w-32" />
          </div>
          <div class="bg-bg-card border border-border divide-y divide-border/50">
            {#each Array(3) as _}
              <div class="p-6 flex items-center justify-between">
                <div class="flex items-center gap-5">
                  <Skeleton class="w-10 h-10 rounded" />
                  <div class="space-y-2">
                    <Skeleton class="h-4 w-32" />
                    <Skeleton class="h-3 w-48" />
                  </div>
                </div>
                <Skeleton class="h-8 w-8 rounded" />
              </div>
            {/each}
          </div>
        </div>
        <div class="lg:col-span-4 space-y-8">
          <div class="bg-bg-card border border-border p-6 space-y-6">
            <Skeleton class="h-4 w-32" />
            <div class="space-y-4">
              <div class="space-y-2">
                <Skeleton class="h-3 w-24" />
                <Skeleton class="h-8 w-full" />
              </div>
              <div class="space-y-2">
                <Skeleton class="h-3 w-24" />
                <Skeleton class="h-8 w-full" />
              </div>
              <div class="grid grid-cols-2 gap-4">
                <Skeleton class="h-12 w-full" />
                <Skeleton class="h-12 w-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  {:else if plan}
    <div class="grid lg:grid-cols-12 gap-12">
      <!-- Main Content Area -->
      <div class="lg:col-span-8 space-y-12">
        
        <!-- Features Section -->
        <section class="space-y-6">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 bg-bg-card border border-border flex items-center justify-center shadow-md">
                <Zap size={16} class="text-accent" />
              </div>
              <h2 class="text-xs font-bold text-white uppercase tracking-widest">Features & Entitlements</h2>
            </div>
            <button 
              class="btn btn-primary"
              onclick={() => (showAttachModal = true)}
            >
              <Plus size={14} />
              Add Feature
            </button>
          </div>

          <div class="bg-bg-card border border-border divide-y divide-border/50 shadow-md">
            {#if plan.planFeatures && plan.planFeatures.length > 0}
              {#each plan.planFeatures as pf}
                {@const cs = creditSystems.find((s: any) => s.id === pf.featureId)}
                {#if cs}
                  <!-- Credit System Feature -->
                  <div class="group hover:bg-bg-card-hover transition-colors">
                    <div class="p-6 flex items-center justify-between">
                      <div class="flex items-center gap-5">
                        <div class="w-10 h-10 bg-amber-900/20 border border-amber-800/40 flex items-center justify-center group-hover:border-amber-600 transition-colors">
                          <span class="text-amber-500 text-lg">&#9733;</span>
                        </div>
                        <div class="space-y-1">
                          <h4 class="text-sm font-bold text-white uppercase tracking-tight">{cs.name}</h4>
                          <div class="flex items-center gap-2">
                            <span class="text-[9px] font-bold text-amber-500 bg-amber-900/20 border border-amber-800/40 px-1.5 py-0.5 uppercase tracking-tighter">
                              Credit System
                            </span>
                            <div class="h-1 w-1 bg-text-dim"></div>
                            {#if pf.limitValue === null}
                              <span class="text-[10px] font-bold text-accent uppercase tracking-tighter">Unlimited credits</span>
                            {:else}
                              <span class="text-[10px] font-bold text-white uppercase tracking-tighter">Pool: {pf.limitValue} credits</span>
                            {/if}
                            {#if pf.resetInterval !== 'none'}
                              <div class="h-1 w-1 bg-text-dim"></div>
                              <span class="text-[10px] font-bold text-text-secondary uppercase tracking-tighter">Resets {pf.resetInterval}</span>
                            {/if}
                          </div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                        <button 
                          class="p-2 text-text-secondary hover:text-white transition-colors"
                          title="Configure credit pool"
                          onclick={() => {
                            editingPlanFeature = pf;
                            showConfigModal = true;
                          }}
                        >
                          <Settings2 size={16} />
                        </button>
                        <button 
                          class="p-2 text-text-secondary hover:text-red-500 transition-colors"
                          title="Remove credit system"
                          onclick={() => detachFeature(pf.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <!-- Child features -->
                    {#if cs.features && cs.features.length > 0}
                      <div class="mx-6 mb-4 border border-border/50 divide-y divide-border/30 bg-bg-primary/50">
                        {#each cs.features as csf}
                          <div class="px-4 py-3 flex items-center justify-between">
                            <div class="flex items-center gap-3">
                              <div class="w-1.5 h-1.5 bg-amber-500/60"></div>
                              <span class="text-xs font-bold text-text-secondary uppercase tracking-tight">{csf.feature?.name || csf.featureId}</span>
                            </div>
                            <span class="text-[10px] font-bold text-amber-500 uppercase tracking-widest">{csf.cost} credits/use</span>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {:else}
                  <!-- Regular Feature -->
                  <div class="p-6 flex items-center justify-between group hover:bg-bg-card-hover transition-colors">
                    <div class="flex items-center gap-5">
                      <div class="w-10 h-10 bg-bg-primary border border-border flex items-center justify-center group-hover:border-border-light transition-colors">
                        <Zap size={18} class="text-text-dim group-hover:text-accent transition-colors" />
                      </div>
                      <div class="space-y-1">
                        <h4 class="text-sm font-bold text-white uppercase tracking-tight">{pf.feature.name}</h4>
                        <div class="flex items-center gap-2">
                          <span class="text-[9px] font-bold text-text-dim bg-bg-primary border border-border px-1.5 py-0.5 uppercase tracking-tighter">
                            {pf.feature.type}
                          </span>
                          
                          {#if pf.feature.type === 'metered'}
                            <div class="h-1 w-1 bg-text-dim"></div>
                            {#if pf.limitValue === null}
                              <span class="text-[10px] font-bold text-accent uppercase tracking-tighter">
                                Unlimited access
                              </span>
                            {:else}
                              <span class="text-[10px] font-bold text-white uppercase tracking-tighter">
                                Included: {pf.limitValue} {pf.feature.unit || 'units'}
                              </span>
                            {/if}

                            {#if pf.resetInterval !== 'none'}
                              <div class="h-1 w-1 bg-text-dim"></div>
                              <span class="text-[10px] font-bold text-text-secondary uppercase tracking-tighter">
                                Resets {pf.resetInterval}
                              </span>
                            {/if}
                          {/if}
                        </div>
                      </div>
                    </div>

                    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                      {#if pf.feature.type === 'metered'}
                        <button 
                          class="p-2 text-text-secondary hover:text-white transition-colors"
                          title="Configure limits"
                          onclick={() => {
                            editingPlanFeature = pf;
                            showConfigModal = true;
                          }}
                        >
                          <Settings2 size={16} />
                        </button>
                      {/if}
                      <button 
                        class="p-2 text-text-secondary hover:text-red-500 transition-colors"
                        title="Remove feature"
                        onclick={() => detachFeature(pf.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                {/if}
              {/each}
            {:else}
              <div class="p-16 text-center space-y-4">
                <div class="w-16 h-16 bg-bg-primary border border-border flex items-center justify-center mx-auto shadow-md">
                  <ZapOff size={28} class="text-text-dim" />
                </div>
                <div class="space-y-1">
                  <h4 class="text-white font-bold uppercase italic">No features yet</h4>
                  <p class="text-[10px] font-bold text-text-dim uppercase tracking-widest max-w-60 mx-auto leading-relaxed">Add features to this plan to define entitlements.</p>
                </div>
                <button 
                  class="btn btn-secondary mx-auto"
                  onclick={() => (showAttachModal = true)}
                >
                  Attach First Feature
                </button>
              </div>
            {/if}
          </div>
        </section>

      </div>

      <!-- Right Sidebar Area -->
      <aside class="lg:col-span-4 space-y-8">
        <section class="bg-bg-card border border-border p-6 space-y-6 shadow-md">
          <div class="flex items-center gap-2 border-b border-border pb-4">
            <Info size={14} class="text-text-dim" />
            <h2 class="text-[10px] font-bold text-white uppercase tracking-widest">Plan Details</h2>
          </div>
          
          <div class="space-y-5">
            <div class="space-y-2">
              <div class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Slug / Identifier</div>
              <div class="group relative">
                <code class="text-xs text-text-secondary bg-bg-primary px-3 py-2 border border-border block w-full font-mono group-hover:border-border-light transition-colors">
                  {plan.slug}
                </code>
                <button 
                  class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-dim hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                  onclick={() => navigator.clipboard.writeText(plan.slug)}
                >
                  <Copy size={12} />
                </button>
              </div>
            </div>

            <div class="space-y-2">
              <div class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Provider Plan</div>
              {#if plan.providerPlanId || plan.paystackPlanId}
                {@const planCode = plan.providerPlanId || plan.paystackPlanId}
                {@const providerDashUrl = plan.providerId === 'paystack' || (!plan.providerId && plan.paystackPlanId)
                  ? `https://dashboard.paystack.com/#/plans/${planCode}`
                  : null}
                {#if providerDashUrl}
                  <a 
                    href={providerDashUrl}
                    target="_blank"
                    class="flex items-center justify-between text-xs text-text-secondary bg-bg-primary px-3 py-2 border border-border hover:border-border-light transition-colors"
                  >
                    <span class="font-mono">{planCode}</span>
                    <ExternalLink size={12} class="text-text-dim" />
                  </a>
                {:else}
                  <div class="flex items-center justify-between text-xs text-text-secondary bg-bg-primary px-3 py-2 border border-border">
                    <span class="font-mono">{planCode}</span>
                    {#if plan.providerId}
                      <span class="text-[9px] text-text-dim uppercase tracking-widest">{plan.providerId}</span>
                    {/if}
                  </div>
                {/if}
              {:else}
                <div class="text-xs text-text-dim italic bg-bg-primary px-3 py-2 border border-border border-dashed font-bold uppercase tracking-widest">
                  Not synced
                </div>
              {/if}
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-1.5">
                <div class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Trial</div>
                <div class="text-sm font-bold text-white uppercase tracking-tight">
                  {plan.trialDays > 0 ? `${plan.trialDays} ${(plan.metadata as any)?.trialUnit === 'minutes' ? 'minutes' : 'days'}` : 'None'}
                </div>
              </div>
              <div class="space-y-1.5">
                <div class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Billing</div>
                <div class="text-sm font-bold text-white uppercase tracking-tight capitalize">
                  {plan.billingType.replace('_', '-')}
                </div>
              </div>
            </div>
          </div>

          <div class="pt-4">
             <button 
              class="btn btn-secondary w-full"
              onclick={() => (showEditPlanModal = true)}
            >
               <Edit3 size={14} />
               Edit Metadata
             </button>
          </div>
        </section>

        <!-- Usage Statistics (Placeholder) -->
        <section class="p-6 border border-border border-dashed flex flex-col items-center justify-center text-center space-y-3 opacity-60 hover:opacity-100 transition-opacity">
          <Loader2 size={20} class="text-text-dim" />
          <div>
            <h4 class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Usage Insights</h4>
            <p class="text-[10px] text-text-dim mt-1 uppercase font-bold tracking-widest">Coming Soon</p>
          </div>
        </section>
      </aside>
    </div>
  {/if}
</div>

<!-- Attach Feature Side Panel -->
<SidePanel open={showAttachModal} title="Select Feature" onclose={() => (showAttachModal = false)} width="max-w-[400px]">
  <div class="text-sm">
    <div class="p-6 space-y-6">
      <div class="space-y-4">
        <label for="featureSearch" class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Available Features</label>
        <div class="input-icon-wrapper">
          <Search size={14} class="input-icon-left" />
          <input 
            id="featureSearch"
            type="text" 
            placeholder="SEARCH FEATURES..." 
            bind:value={featureSearchQuery}
            class="input input-has-icon-left font-bold placeholder:text-text-dim text-xs"
          />
        </div>

        <div class="space-y-2 mt-2">
          {#each features.filter(f => !plan.planFeatures.some((pf: any) => pf.featureId === f.id) && (f.name.toLowerCase().includes(featureSearchQuery.toLowerCase()) || f.slug.toLowerCase().includes(featureSearchQuery.toLowerCase()))) as feature}
            <button 
              class="w-full p-4 flex items-center gap-4 bg-bg-card border border-border hover:border-border-light transition-all text-left group"
              onclick={() => handleAttachFeature(feature.id)}
              disabled={isSaving}
            >
              <div class="w-10 h-10 bg-bg-primary border border-border flex items-center justify-center group-hover:border-lime-600 transition-colors">
                <Zap size={16} class="text-text-dim group-hover:text-lime-600 transition-colors" />
              </div>
              <div>
                <div class="text-xs font-bold text-white uppercase tracking-tight group-hover:text-lime-600 transition-colors">{feature.name}</div>
                <div class="text-[9px] text-text-dim font-bold uppercase tracking-widest mt-0.5">{feature.type} • {feature.slug}</div>
              </div>
            </button>
          {/each}
          
          <button 
            class="w-full p-4 flex items-center gap-4 bg-bg-primary border border-border border-dashed text-text-dim hover:text-white transition-all text-left group mt-2"
            onclick={() => goto(`/app/${projectId}/features`)}
          >
            <div class="w-10 h-10 bg-bg-card border border-border flex items-center justify-center">
              <Plus size={16} />
            </div>
            <span class="text-xs font-bold uppercase tracking-widest">Create new feature</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</SidePanel>

<!-- Configure Feature Side Panel -->
<SidePanel open={showConfigModal && !!editingPlanFeature} title={`Configure ${editingPlanFeature?.feature?.name}`} onclose={() => (showConfigModal = false)} width="max-w-[450px]">
  <div class="text-sm">
    <form 
      class="flex flex-col"
      onsubmit={(e) => {
        e.preventDefault();
        const data = {
          usageModel: configUsageModel,
          limitValue: String(configLimitValue).trim() === '' ? null : Number(configLimitValue),
          resetInterval: configResetInterval,
          pricePerUnit: String(configPricePerUnit).trim() === '' ? null : Math.round(Number(configPricePerUnit) * 100),
          billingUnits: Number(configBillingUnits) || 1,
          overage: configOverage,
        };
        handleUpdateFeatureConfig(data);
      }}
    >
      <div class="p-6 space-y-8">
        <!-- Feature Type -->
        <div class="space-y-4">
          <label class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Feature Type</label>
          <div class="space-y-3">
            <button
              type="button"
              class="relative w-full p-4 text-left flex gap-4 shadow-md transition-all {configUsageModel === 'included' ? 'bg-lime-600/5 border border-lime-600' : 'bg-bg-card border border-border hover:border-border-light'}"
              onclick={() => (configUsageModel = 'included')}
            >
              <div class="w-10 h-10 bg-bg-primary border border-border flex items-center justify-center flex-shrink-0">
                <Calendar size={18} class={configUsageModel === 'included' ? 'text-lime-600' : 'text-text-dim'} />
              </div>
              <div>
                <div class="text-xs font-bold text-white uppercase tracking-tight mb-0.5">Included</div>
                <p class="text-[10px] font-bold text-text-dim uppercase tracking-widest leading-relaxed">Included usage limit.</p>
              </div>
              {#if configUsageModel === 'included'}
                <div class="absolute top-4 right-4 w-4 h-4 border-2 border-lime-600 flex items-center justify-center">
                  <div class="w-2 h-2 bg-lime-600"></div>
                </div>
              {/if}
            </button>

            <button
              type="button"
              class="relative w-full p-4 text-left flex gap-4 transition-all {configUsageModel === 'usage_based' ? 'bg-lime-600/5 border border-lime-600' : 'bg-bg-card border border-border hover:border-border-light'}"
              onclick={() => (configUsageModel = 'usage_based')}
            >
              <div class="w-10 h-10 bg-bg-primary border border-border flex items-center justify-center flex-shrink-0">
                <Settings2 size={18} class={configUsageModel === 'usage_based' ? 'text-lime-600' : 'text-text-dim'} />
              </div>
              <div>
                <div class="text-xs font-bold text-white uppercase tracking-tight mb-0.5">Priced</div>
                <p class="text-[10px] font-bold text-text-dim uppercase tracking-widest leading-relaxed">Charge for usage.</p>
              </div>
              {#if configUsageModel === 'usage_based'}
                <div class="absolute top-4 right-4 w-4 h-4 border-2 border-lime-600 flex items-center justify-center">
                  <div class="w-2 h-2 bg-lime-600"></div>
                </div>
              {/if}
            </button>
          </div>
        </div>

        <!-- Pricing Config (shown when Priced is selected) -->
        {#if configUsageModel === 'usage_based'}
          <div class="space-y-4 p-4 bg-amber-900/10 border border-amber-800/50">
            <div class="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Pricing Configuration</div>
            
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-2">
                <label for="pricePerUnit" class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Price per Unit</label>
                <div class="input-icon-wrapper">
                  <input 
                    id="pricePerUnit"
                    type="number"
                    step="0.01"
                    placeholder="5.00"
                    class="input font-bold pl-12"
                    bind:value={configPricePerUnit}
                  />
                  <div class="absolute left-4 top-1/2 -translate-y-1/2 text-[9px] font-bold text-text-dim uppercase">
                    ₦
                  </div>
                </div>
              </div>
              
              <div class="space-y-2">
                <label for="billingUnits" class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Per X Units</label>
                <input 
                  id="billingUnits"
                  type="number"
                  placeholder="1000"
                  class="input font-bold"
                  bind:value={configBillingUnits}
                />
              </div>
            </div>
            
            <p class="text-[9px] text-text-dim">
              {#if configPricePerUnit && configBillingUnits}
                Charging ₦{configPricePerUnit} per {configBillingUnits} {editingPlanFeature.feature.unit || 'units'}
              {:else}
                Set price and units to configure billing
              {/if}
            </p>
          </div>
        {/if}

        <!-- Grant Amount (Included limit for both models) -->
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <label for="limitValueConfig" class="text-[10px] font-bold text-text-dim uppercase tracking-widest">
              {configUsageModel === 'usage_based' ? 'Included Free' : 'Grant Amount'}
            </label>
            <button 
              type="button"
              class="text-[10px] font-bold text-text-dim hover:text-lime-600 flex items-center gap-1.5 transition-colors uppercase tracking-widest"
              onclick={() => (configLimitValue = '')}
            >
              {configUsageModel === 'usage_based' ? '0 Free' : '∞ Unlimited'}
            </button>
          </div>
          
          <div class="input-icon-wrapper">
            <input 
              id="limitValueConfig"
              name="limitValue"
              type="number"
              placeholder={configUsageModel === 'usage_based' ? '0' : 'EG. 100'}
              class="input font-bold"
              bind:value={configLimitValue}
            />
            <div class="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-bold text-text-dim uppercase tracking-widest">
              {editingPlanFeature.feature.unit || 'units'}
            </div>
          </div>
          
          {#if configUsageModel === 'usage_based' && configLimitValue}
            <p class="text-[9px] text-text-dim">
              First {configLimitValue} {editingPlanFeature.feature.unit || 'units'} are free, then billing starts.
            </p>
          {/if}
        </div>

        <!-- Overage Behavior (shown when Included is selected) -->
        {#if configUsageModel === 'included'}
          <div class="space-y-4">
            <div class="text-[10px] font-bold text-text-dim uppercase tracking-widest">When Limit Exceeded</div>
            <div class="grid grid-cols-2 gap-2">
              {#each [
                { value: 'block', label: 'Block' },
                { value: 'charge', label: 'Charge' },
                
              ] as opt}
                <button 
                  type="button"
                  class="py-2.5 text-[10px] font-bold uppercase tracking-widest border transition-all {configOverage === opt.value ? 'bg-lime-600 text-lime-600-contrast border-lime-600' : 'bg-bg-card text-text-dim border-border hover:border-border-light hover:text-white'}"
                  onclick={() => (configOverage = opt.value as typeof configOverage)}
                >
                  {opt.label}
                </button>
              {/each}
            </div>
            
            {#if configOverage === 'charge'}
              <div class="grid grid-cols-2 gap-4 p-4 bg-amber-900/10 border border-amber-800/50">
                <div class="space-y-2">
                  <label for="overagePricePerUnit" class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Overage Price</label>
                  <div class="input-icon-wrapper">
                    <input 
                      id="overagePricePerUnit"
                      type="number"
                      step="0.01"
                      placeholder="5.00"
                      class="input font-bold pl-12"
                      bind:value={configPricePerUnit}
                    />
                    <div class="absolute left-4 top-1/2 -translate-y-1/2 text-[9px] font-bold text-text-dim uppercase">
                      ₦
                    </div>
                  </div>
                </div>
                
                <div class="space-y-2">
                  <label for="overageBillingUnits" class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Per X Units</label>
                  <input 
                    id="overageBillingUnits"
                    type="number"
                    placeholder="1000"
                    class="input font-bold"
                    bind:value={configBillingUnits}
                  />
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Interval -->
        <div class="space-y-4">
          <div class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Interval</div>
          <div class="grid grid-cols-4 gap-2">
            {#each [
              { value: '5min', label: '5 Min' },
              { value: '15min', label: '15 Min' },
              { value: '30min', label: '30 Min' },
              { value: 'hourly', label: 'Hourly' },
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
              { value: 'quarter', label: 'Quarterly' },
              { value: 'yearly', label: 'Yearly' },
              { value: 'none', label: 'One-off' },
            ] as int}
              <button 
                type="button"
                class="py-2.5 text-[10px] font-bold uppercase tracking-widest border transition-all {configResetInterval === int.value ? 'bg-lime-600 text-lime-600-contrast border-lime-600' : 'bg-bg-card text-text-dim border-border hover:border-border-light hover:text-white'}"
                onclick={() => (configResetInterval = int.value)}
              >
                {int.label}
              </button>
            {/each}
          </div>
        </div>
      </div>

      <div class="p-6 border-t border-border bg-bg-card sticky bottom-0">
        <button 
          type="submit" 
          class="btn btn-primary w-full py-2.5 uppercase tracking-widest font-bold"
          disabled={isSaving}
        >
          {#if isSaving}
            <Loader2 size={16} class="animate-spin" />
            Saving...
          {:else}
            Save Configuration
          {/if}
        </button>
      </div>
    </form>
  </div>
</SidePanel>

<!-- Edit Plan Side Panel -->
<SidePanel open={showEditPlanModal && !!plan} title="Edit Plan" onclose={() => (showEditPlanModal = false)} width="max-w-[450px]">
  <div class="text-sm">
    <form
      onsubmit={(e) => {
        e.preventDefault();
        savePlanEdits();
      }}
      class="flex flex-col"
    >
      <div class="p-6 space-y-5">
        <div>
          <label for="editName" class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2">Name</label>
          <div class="input-icon-wrapper">
            <input id="editName" class="input font-bold" type="text" bind:value={editName} />
          </div>
        </div>

        <div>
          <label for="editDescription" class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2">Description</label>
          <div class="input-icon-wrapper">
            <textarea id="editDescription" class="input font-bold min-h-22.5" bind:value={editDescription}></textarea>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="editType" class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2">Type</label>
            <div class="input-icon-wrapper">
              <select id="editType" class="input font-bold" bind:value={editType}>
                <option value="paid">Paid</option>
                <option value="free">Free</option>
              </select>
            </div>
          </div>

          <div>
            <label for="editBillingType" class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2">Billing</label>
            <div class="input-icon-wrapper">
              <select id="editBillingType" class="input font-bold" bind:value={editBillingType}>
                <option value="recurring">Recurring</option>
                <option value="one_time">One-off</option>
              </select>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="editPrice" class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2">Price</label>
            <div class="input-icon-wrapper">
              <input
                id="editPrice"
                class="input font-bold"
                type="number"
                step="0.01"
                min="0"
                bind:value={editPrice}
                disabled={editType === 'free'}
              />
            </div>
          </div>

          <div>
            <label for="editInterval" class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2">Interval</label>
            <div class="input-icon-wrapper">
              <select id="editInterval" class="input font-bold" bind:value={editInterval} disabled={editBillingType === 'one_time'}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="quarterly">Quarterly</option>
                <option value="weekly">Weekly</option>
                <option value="annually">Annually</option>
              </select>
            </div>
          </div>
        </div>

        <div>
          <label for="editTrialDays" class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2">Trial Duration</label>
          <div class="flex gap-2">
            <div class="input-icon-wrapper flex-1">
              <input id="editTrialDays" class="input font-bold" type="number" min="0" bind:value={editTrialDays} />
            </div>
            <select class="input font-bold w-28" bind:value={editTrialUnit}>
              <option value="minutes">minutes</option>
              <option value="days">days</option>
            </select>
          </div>
        </div>
      </div>

      <div class="p-6 border-t border-border bg-bg-card flex justify-end gap-3 sticky bottom-0">
        <button type="button" class="px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white transition-colors uppercase tracking-widest" onclick={() => (showEditPlanModal = false)}>Cancel</button>
        <button type="submit" class="btn btn-primary px-8" disabled={isSaving || !editName.trim()}>
          {#if isSaving}
            <Loader2 size={16} class="animate-spin text-accent-contrast" />
            Saving...
          {:else}
            Save Changes
          {/if}
        </button>
      </div>
    </form>
  </div>
</SidePanel>

<style lang="postcss">
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background-color: #333;
  }
</style>
