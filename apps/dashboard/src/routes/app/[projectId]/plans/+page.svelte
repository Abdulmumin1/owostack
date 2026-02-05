<script lang="ts">
  import { Check, Plus, MoreHorizontal, X, Loader2, Trash2, Copy, ExternalLink } from "lucide-svelte";
  import { page } from "$app/state";
  import { fade, fly } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import CreatePlanModal from "$lib/components/plans/CreatePlanModal.svelte";

  // URL param is the organization ID from Better Auth
  const organizationId = $derived(page.params.projectId);
  let plans = $state<any[]>([]);
  let showCreateModal = $state(false);
  let isLoading = $state(true);
  let openMenuId = $state<string | null>(null);

  async function loadPlans() {
    isLoading = true;
    try {
      const res = await apiFetch(
        `/api/dashboard/plans?organizationId=${organizationId}`,
      );
      if (res.data) {
        plans = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load plans", e);
    } finally {
      isLoading = false;
    }
  }

  async function deletePlan(id: string) {
    if (!confirm("Are you sure you want to delete this plan? This action cannot be undone.")) return;
    
    try {
      const res = await apiFetch(`/api/dashboard/plans/${id}`, {
        method: "DELETE"
      });
      if (res.data?.success) {
        plans = plans.filter(p => p.id !== id);
      }
    } catch (e) {
      console.error("Failed to delete plan", e);
    }
    openMenuId = null;
  }

  function copyId(slug: string) {
    navigator.clipboard.writeText(slug);
    openMenuId = null;
  }

  $effect(() => {
    if (organizationId) {
      loadPlans();
    }
  });

  function handlePlanCreated() {
    // Refresh list
    loadPlans();
  }

  function formatMoney(amount: number, currency: string) {
    if (amount === 0) return "Free";
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: currency,
    }).format(amount / 100);
  }
</script>

<svelte:head>
  <title>Plans - Owostack</title>
</svelte:head>

<div class="max-w-5xl">
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1 class="text-xl font-bold text-white mb-2">Plans</h1>
      <p class="text-zinc-500 text-xs uppercase tracking-widest font-semibold">
        Manage subscription tiers and features
      </p>
    </div>

    {#if plans.length > 0}
      <button class="btn btn-primary" onclick={() => (showCreateModal = true)}>
        <Plus size={16} />
        Create Plan
      </button>
    {/if}
  </div>

  {#if isLoading}
    <div class="flex items-center gap-2 text-zinc-500">
      <Loader2 size={16} class="animate-spin" />
      <span>Loading plans...</span>
    </div>
  {:else if plans.length === 0}
    <div
      class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center shadow-md"
    >
      <div class="w-12 h-12 bg-white/5 flex items-center justify-center mb-4">
        <Plus size={24} class="text-zinc-500" />
      </div>
      <h3 class="text-lg font-bold text-white mb-2">No plans defined</h3>
      <p class="text-zinc-500 max-w-sm mb-6">
        Create your first subscription plan to start charging customers.
      </p>
      <button class="btn btn-primary" onclick={() => (showCreateModal = true)}>
        Create Plan
      </button>
    </div>
  {:else}
    <!-- Plans Grid -->
    <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each plans as plan}
        <div
          class="bg-bg-card border border-border p-6 shadow-sm hover:border-zinc-500 transition-colors flex flex-col h-full relative group"
        >
          <!-- Actions Menu -->
          <div class="absolute top-4 right-4">
            <button
              class="text-zinc-500 hover:text-white transition-opacity {openMenuId === plan.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}"
              onclick={(e) => {
                e.stopPropagation();
                openMenuId = openMenuId === plan.id ? null : plan.id;
              }}
            >
              <MoreHorizontal size={20} />
            </button>

            {#if openMenuId === plan.id}
              <div 
                class="absolute right-0 mt-2 w-40 bg-bg-card border border-border shadow-xl z-10 py-1"
                transition:fade={{ duration: 100 }}
              >
                <button 
                  class="w-full text-left px-4 py-2 text-xs text-zinc-300 hover:bg-white/5 hover:text-white flex items-center gap-2"
                  onclick={() => copyId(plan.slug)}
                >
                  <Copy size={14} />
                  Copy Slug
                </button>
                <button 
                  class="w-full text-left px-4 py-2 text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                  onclick={() => deletePlan(plan.id)}
                >
                  <Trash2 size={14} />
                  Delete Plan
                </button>
              </div>
            {/if}
          </div>

          <div class="mb-6">
            <h3 class="text-lg font-bold text-white mb-1">{plan.name}</h3>
            <div class="flex items-baseline gap-1">
              <span class="text-2xl font-bold text-white"
                >{formatMoney(plan.price, plan.currency)}</span
              >
              {#if plan.price > 0 && plan.interval}
                <span class="text-xs text-zinc-500">/{plan.interval}</span>
              {/if}
            </div>
            {#if plan.description}
              <p class="text-xs text-zinc-500 mt-2">{plan.description}</p>
            {/if}

            <!-- Type badges -->
            <div class="flex gap-2 mt-3">
              {#if plan.type === "free"}
                <span
                  class="text-[10px] font-bold bg-accent/10 text-accent px-2 py-0.5 rounded border border-accent/20"
                  >Free</span
                >
              {/if}
              {#if plan.billingType === "one_time"}
                <span
                  class="text-[10px] font-bold bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded border border-zinc-700"
                  >One-off</span
                >
              {/if}
              {#if plan.trialDays > 0}
                <span
                  class="text-[10px] font-bold bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded border border-blue-800/50"
                  >{plan.trialDays}d Trial</span
                >
              {/if}
            </div>
          </div>

          <div class="flex-1 mb-8">
            <div
              class="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3"
            >
              Features
            </div>
            {#if plan.planFeatures && plan.planFeatures.length > 0}
              <ul class="space-y-2">
                {#each plan.planFeatures as pf}
                  <li class="flex items-center gap-2 text-xs text-zinc-300">
                    <Check size={12} class="text-accent" />
                    <span>{pf.feature.name}</span>
                    {#if pf.limitValue !== null}
                      <span class="text-[10px] text-zinc-500 font-mono ml-auto">
                        {pf.limitValue} {pf.feature.unit || 'units'}
                      </span>
                    {:else}
                      <span class="text-[10px] text-zinc-500 font-mono ml-auto">Unlimited</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="text-xs text-zinc-600 italic">No features added yet</p>
            {/if}
          </div>

          <div
            class="pt-4 border-t border-border flex items-center justify-between"
          >
            <span class="text-[10px] text-zinc-600 font-mono"
              >ID: {plan.slug}</span
            >
            <span
              class="text-[10px] font-bold bg-white/5 text-zinc-400 px-2 py-1"
            >
              Active
            </span>
          </div>
        </div>
      {/each}

      <!-- Add New Plan Card -->
      <button
        class="border border-border border-dashed p-6 flex flex-col items-center justify-center gap-4 text-zinc-500 hover:text-white hover:border-zinc-500 hover:bg-white/5 transition-all min-h-[300px]"
        onclick={() => (showCreateModal = true)}
      >
        <div class="w-12 h-12 bg-white/5 flex items-center justify-center">
          <Plus size={24} />
        </div>
        <div class="text-center">
          <h3 class="font-bold text-sm mb-1">Create New Plan</h3>
          <p class="text-xs text-zinc-500">Add a new pricing tier</p>
        </div>
      </button>
    </div>
  {/if}
</div>

<CreatePlanModal
  {organizationId}
  bind:isOpen={showCreateModal}
  onsuccess={handlePlanCreated}
/>
