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
  import { page } from "$app/state";
  import { fade, slide, fly } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import { goto } from "$app/navigation";

  const projectId = $derived(page.params.projectId);
  const planId = $derived(page.params.planId);

  let plan = $state<any>(null);
  let features = $state<any[]>([]);
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
      const [planRes, featuresRes] = await Promise.all([
        apiFetch(`/api/dashboard/plans/${planId}`),
        apiFetch(`/api/dashboard/features?organizationId=${projectId}`)
      ]);
      
      if (planRes.data) plan = planRes.data.data;
      if (featuresRes.data) features = featuresRes.data.data;
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
    <div class="flex flex-col items-center justify-center py-24 gap-4 text-text-dim">
      <Loader2 size={32} class="animate-spin" />
      <span class="text-[10px] font-bold uppercase tracking-widest">Loading plan structure...</span>
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
              <div class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Paystack Plan</div>
              {#if plan.paystackPlanId}
                <a 
                  href="https://dashboard.paystack.com/#/plans/{plan.paystackPlanId}" 
                  target="_blank"
                  class="flex items-center justify-between text-xs text-text-secondary bg-bg-primary px-3 py-2 border border-border hover:border-border-light transition-colors"
                >
                  <span class="font-mono">{plan.paystackPlanId}</span>
                  <ExternalLink size={12} class="text-text-dim" />
                </a>
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
                  {plan.trialDays > 0 ? `${plan.trialDays} days` : 'None'}
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

<!-- Attach Feature Side Panel (Autumn Style) -->
{#if showAttachModal}
  <div 
    class="fixed inset-0 bg-black/60 backdrop-blur-sm z-60"
    transition:fade={{ duration: 200 }}
  >
    <!-- Backdrop overlay to close -->
    <button 
      type="button"
      class="absolute inset-0 w-full h-full cursor-default"
      onclick={() => (showAttachModal = false)}
      aria-label="Close side panel"
    ></button>
  </div>
  <div 
    class="fixed top-0 right-0 bottom-0 w-full max-w-[400px] bg-bg-primary border-l border-border z-[70] shadow-2xl flex flex-col"
    transition:fly={{ x: 400, duration: 300, opacity: 1 }}
  >
    <div class="p-6 border-b border-border flex items-center justify-between bg-bg-card">
      <div>
        <h3 class="text-sm font-bold text-white uppercase tracking-widest">Select Feature</h3>
        <p class="text-[10px] text-text-secondary font-bold uppercase tracking-widest mt-1">Add feature to plan</p>
      </div>
      <button class="text-text-dim hover:text-white transition-colors" onclick={() => (showAttachModal = false)}>
        <X size={20} />
      </button>
    </div>

    <div class="p-6 flex-1 overflow-y-auto space-y-6 custom-scrollbar">
      <div class="space-y-4">
        <label for="featureSearch" class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Available Features</label>
        <div class="relative">
          <Search size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
          <input 
            id="featureSearch"
            type="text" 
            placeholder="SEARCH FEATURES..." 
            bind:value={featureSearchQuery}
            class="input pl-9 font-bold placeholder:text-text-dim text-xs"
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
{/if}

<!-- Configure Feature Side Panel -->
{#if showConfigModal && editingPlanFeature}
  <div 
    class="fixed inset-0 bg-black/60 backdrop-blur-sm z-60"
    transition:fade={{ duration: 200 }}
  >
    <!-- Backdrop overlay to close -->
    <button 
      type="button"
      class="absolute inset-0 w-full h-full cursor-default"
      onclick={() => (showConfigModal = false)}
      aria-label="Close configuration panel"
    ></button>
  </div>
  <div 
    class="fixed top-0 right-0 bottom-0 w-full max-w-[450px] bg-bg-primary border-l border-border z-[70] shadow-2xl flex flex-col"
    transition:fly={{ x: 450, duration: 300, opacity: 1 }}
  >
    <div class="p-6 border-b border-border flex items-center justify-between bg-bg-card">
      <div>
        <h3 class="text-sm font-bold text-white uppercase tracking-widest">Configure {editingPlanFeature.feature.name}</h3>
        <p class="text-[10px] text-text-secondary font-bold uppercase tracking-widest mt-1">Set usage limits for plan</p>
      </div>
      <div class="flex items-center gap-2">
        <button 
          class="btn btn-secondary h-8 px-3 text-[10px]! uppercase"
          onclick={() => goto(`/app/${projectId}/features`)}
        >
          <Edit3 size={12} />
          Edit Feature
        </button>
        <button class="text-text-dim hover:text-white transition-colors ml-2" onclick={() => (showConfigModal = false)}>
          <X size={20} />
        </button>
      </div>
    </div>

    <form 
      class="flex-1 flex flex-col overflow-hidden"
      onsubmit={(e) => {
        e.preventDefault();
        const data = {
          usageModel: 'included',
          limitValue: String(configLimitValue).trim() === '' ? null : Number(configLimitValue),
          resetInterval: configResetInterval,
        };
        handleUpdateFeatureConfig(data);
      }}
    >
      <div class="p-6 flex-1 overflow-y-auto space-y-8 custom-scrollbar">
        <!-- Feature Type -->
        <div class="space-y-4">
          <label class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Feature Type</label>
          <div class="space-y-3">
            <div class="relative p-4 bg-lime-600/5 border border-lime-600 flex gap-4 shadow-md">
              <div class="w-10 h-10 bg-bg-primary border border-border flex items-center justify-center flex-shrink-0">
                <Calendar size={18} class="text-lime-600" />
              </div>
              <div>
                <div class="text-xs font-bold text-white uppercase tracking-tight mb-0.5">Included</div>
                <p class="text-[10px] font-bold text-text-dim uppercase tracking-widest leading-relaxed">Included usage limit.</p>
              </div>
              <div class="absolute top-4 right-4 w-4 h-4 border-2 border-lime-600 flex items-center justify-center">
                <div class="w-2 h-2 bg-lime-600"></div>
              </div>
            </div>

            <div class="relative p-4 bg-bg-card border border-border flex gap-4 opacity-50 cursor-not-allowed grayscale">
              <div class="w-10 h-10 bg-bg-primary border border-border flex items-center justify-center flex-shrink-0">
                <Settings2 size={18} class="text-text-dim" />
              </div>
              <div>
                <div class="text-xs font-bold text-white uppercase tracking-tight mb-0.5">Priced</div>
                <p class="text-[10px] font-bold text-text-dim uppercase tracking-widest leading-relaxed">Charge for usage.</p>
              </div>
              <div class="absolute top-2 right-2">
                <span class="px-1.5 py-0.5 bg-bg-primary border border-border text-[8px] font-bold text-text-dim uppercase tracking-tighter">Soon</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Grant Amount -->
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <label for="limitValueConfig" class="text-[10px] font-bold text-text-dim uppercase tracking-widest">Grant Amount</label>
            <button 
              type="button"
              class="text-[10px] font-bold text-text-dim hover:text-lime-600 flex items-center gap-1.5 transition-colors uppercase tracking-widest"
              onclick={() => (configLimitValue = '')}
            >
              ∞ Unlimited
            </button>
          </div>
          
          <div class="relative">
            <input 
              id="limitValueConfig"
              name="limitValue"
              type="number"
              placeholder="EG. 100"
              class="input font-bold"
              bind:value={configLimitValue}
            />
            <div class="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-bold text-text-dim uppercase tracking-widest">
              {editingPlanFeature.feature.unit || 'units'}
            </div>
          </div>
        </div>

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

      <div class="p-6 border-t border-border bg-bg-card shadow-md">
        <button 
          type="submit" 
          class="btn btn-primary w-full"
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
{/if}

<!-- Edit Plan Side Panel -->
{#if showEditPlanModal && plan}
  <div 
    class="fixed inset-0 bg-black/60 backdrop-blur-sm z-60"
    transition:fade={{ duration: 200 }}
  >
    <!-- Backdrop overlay to close -->
    <button 
      type="button"
      class="absolute inset-0 w-full h-full cursor-default"
      onclick={() => (showEditPlanModal = false)}
      aria-label="Close edit panel"
    ></button>
  </div>
  <div 
    class="fixed top-0 right-0 bottom-0 w-full max-w-112.5 bg-bg-primary border-l border-border z-70 shadow-2xl flex flex-col"
    transition:fly={{ x: 450, duration: 300, opacity: 1 }}
  >
    <div class="p-6 border-b border-border flex items-center justify-between bg-bg-card">
      <div>
        <h3 class="text-sm font-bold text-white uppercase tracking-widest">Edit Plan</h3>
        <p class="text-[10px] text-text-secondary font-bold uppercase tracking-widest mt-1">Update basic information</p>
      </div>
      <button class="text-text-dim hover:text-white transition-colors" onclick={() => (showEditPlanModal = false)}>
        <X size={20} />
      </button>
    </div>

    <form
      onsubmit={(e) => {
        e.preventDefault();
        savePlanEdits();
      }}
      class="flex-1 flex flex-col overflow-hidden"
    >
      <div class="p-6 flex-1 overflow-y-auto space-y-5 custom-scrollbar">
        <div>
          <label for="editName" class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2">Name</label>
          <input id="editName" class="input font-bold" type="text" bind:value={editName} />
        </div>

        <div>
          <label for="editDescription" class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2">Description</label>
          <textarea id="editDescription" class="input font-bold min-h-22.5" bind:value={editDescription}></textarea>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="editType" class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2">Type</label>
            <select id="editType" class="input font-bold" bind:value={editType}>
              <option value="paid">Paid</option>
              <option value="free">Free</option>
            </select>
          </div>

          <div>
            <label for="editBillingType" class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2">Billing</label>
            <select id="editBillingType" class="input font-bold" bind:value={editBillingType}>
              <option value="recurring">Recurring</option>
              <option value="one_time">One-off</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="editPrice" class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2">Price</label>
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

          <div>
            <label for="editInterval" class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2">Interval</label>
            <select id="editInterval" class="input font-bold" bind:value={editInterval} disabled={editBillingType === 'one_time'}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="quarterly">Quarterly</option>
              <option value="weekly">Weekly</option>
              <option value="annually">Annually</option>
            </select>
          </div>
        </div>

        <div>
          <label for="editTrialDays" class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2">Trial Days</label>
          <input id="editTrialDays" class="input font-bold" type="number" min="0" bind:value={editTrialDays} />
        </div>
      </div>

      <div class="p-6 border-t border-border bg-bg-card flex justify-end gap-3 shadow-md">
        <button type="button" class="btn btn-secondary px-6" onclick={() => (showEditPlanModal = false)}>Cancel</button>
        <button type="submit" class="btn btn-primary px-8" disabled={isSaving || !editName.trim()}>
          {#if isSaving}
            <Loader2 size={16} class="animate-spin text-accent-contrast" />
            Saving...
          {:else}
            Save
          {/if}
        </button>
      </div>
    </form>
  </div>
{/if}

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
