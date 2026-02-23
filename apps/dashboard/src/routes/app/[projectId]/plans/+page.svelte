<script lang="ts">
  import { ArrowSquareOut, Check, CircleNotch, Copy, DotsThree, Plus, Trash, X } from "phosphor-svelte";
  import { page } from "$app/state";
  import { fade, fly } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import { formatCurrency } from "$lib/utils/currency";
  import CreatePlanModal from "$lib/components/plans/CreatePlanModal.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

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
    return formatCurrency(amount, currency);
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.dropdown-container')) {
      openMenuId = null;
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<svelte:head>
  <title>Plans - Owostack</title>
</svelte:head>

<div class="max-w-5xl">
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1 class="text-xl font-bold text-text-primary mb-2">Plans</h1>
      <p class="text-text-dim text-xs uppercase tracking-widest font-semibold">
        Manage subscription tiers and features
      </p>
    </div>

    {#if plans.length > 0}
      <button class="btn btn-primary" onclick={() => (showCreateModal = true)}>
        <Plus   size={16}  weight="fill" />
        Create Plan
      </button>
    {/if}
  </div>

  {#if isLoading}
    <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each Array(3) as _}
        <div class="bg-bg-card border border-border p-6 flex flex-col h-full space-y-6 rounded-lg">
          <div class="space-y-3">
            <Skeleton class="h-6 w-3/4" />
            <Skeleton class="h-8 w-1/2" />
            <Skeleton class="h-4 w-full" />
          </div>
          <div class="flex gap-2">
            <Skeleton class="h-5 w-12" />
            <Skeleton class="h-5 w-16" />
          </div>
          <div class="flex-1 space-y-3">
            <Skeleton class="h-3 w-20" />
            <div class="space-y-2">
              <Skeleton class="h-4 w-full" />
              <Skeleton class="h-4 w-5/6" />
              <Skeleton class="h-4 w-4/6" />
            </div>
          </div>
          <div class="pt-4 border-t border-border flex justify-between">
            <Skeleton class="h-3 w-24" />
            <Skeleton class="h-5 w-12" />
          </div>
        </div>
      {/each}
    </div>
  {:else if plans.length === 0}
    <div
      class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center rounded-lg"
    >
      <div class="w-12 h-12 bg-bg-secondary flex items-center justify-center mb-4">
        <Plus   size={24} class="text-text-dim"  weight="fill" />
      </div>
      <h3 class="text-lg font-bold text-text-primary mb-2">No plans defined</h3>
      <p class="text-text-dim max-w-sm mb-6">
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
        <a
          href="/app/{organizationId}/plans/{plan.id}"
          class="bg-bg-card border border-border p-6 hover:border-text-dim transition-colors flex flex-col h-full relative group rounded-lg"
        >
          <!-- Actions Menu -->
          <div class="absolute top-4 right-4 dropdown-container">
            <button
              class="text-text-dim hover:text-text-primary transition-opacity {openMenuId === plan.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}"
              onclick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openMenuId = openMenuId === plan.id ? null : plan.id;
              }}
            >
              <DotsThree   size={20}  />
            </button>

            {#if openMenuId === plan.id}
              <div
                class="absolute right-0 mt-2 w-40 bg-bg-card border border-border z-[100] py-1 rounded shadow-sm"
                transition:fade={{ duration: 100 }}
                onclick={(e) => e.stopPropagation()}
              >
                <button 
                  class="w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-bg-secondary hover:text-text-primary flex items-center gap-2"
                  onclick={() => copyId(plan.slug)}
                >
                  <Copy size={14} weight="fill" />
                  Copy Slug
                </button>
                <button 
                  class="w-full text-left px-4 py-2 text-xs text-error hover:bg-error-bg flex items-center gap-2"
                  onclick={() => deletePlan(plan.id)}
                >
                  <Trash size={14} weight="fill" />
                  Delete Plan
                </button>
              </div>
            {/if}
          </div>

          <div class="mb-6">
            <h3 class="text-lg font-bold text-text-primary mb-1">{plan.name}</h3>
            <div class="flex items-baseline gap-1">
              <span class="text-2xl font-bold text-text-primary"
                >{formatMoney(plan.price, plan.currency)}</span
              >
              {#if plan.price > 0 && plan.interval}
                <span class="text-xs text-text-dim">/{plan.interval}</span>
              {/if}
            </div>
            {#if plan.description}
              <p class="text-xs text-text-dim mt-2">{plan.description}</p>
            {/if}

            <!-- Type badges -->
            <div class="flex gap-2 mt-3">
              {#if plan.type === "free"}
                <span
                  class="text-[10px] font-bold bg-accent-light text-accent px-2 py-0.5 rounded border border-accent"
                  >Free</span
                >
              {/if}
              {#if plan.billingType === "one_time"}
                <span
                  class="text-[10px] font-bold bg-bg-secondary text-text-secondary px-2 py-0.5 rounded border border-border"
                  >One-off</span
                >
              {/if}
              {#if plan.trialDays > 0}
                <span
                  class="text-[10px] font-bold bg-info-bg text-info px-2 py-0.5 rounded border border-info"
                  >{plan.trialDays}{plan.metadata?.trialUnit === 'minutes' ? 'm' : 'd'} Trial</span
                >
              {/if}
            </div>
          </div>

          <div class="flex-1 mb-8">
            <div
              class="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-3"
            >
              Features
            </div>
            {#if plan.planFeatures && plan.planFeatures.length > 0}
              <ul class="space-y-2">
                {#each plan.planFeatures as pf}
                  <li class="flex items-center gap-2 text-xs text-text-secondary">
                    <Check   size={12} class="text-accent"  weight="fill" />
                    <span>{pf.feature.name}</span>
                    {#if pf.limitValue !== null}
                      <span class="text-[10px] text-text-dim font-mono ml-auto">
                        {pf.limitValue} {pf.feature.unit || 'units'}
                      </span>
                    {:else}
                      <span class="text-[10px] text-text-dim font-mono ml-auto">Unlimited</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="text-xs text-text-dim italic">No features added yet</p>
            {/if}
          </div>

          <div
            class="pt-4 border-t border-border flex items-center justify-between"
          >
            <span class="text-[10px] text-text-dim font-mono"
              >ID: {plan.slug}</span
            >
            <span
              class="text-[10px] font-bold bg-bg-secondary text-text-dim px-2 py-1 rounded-sm"
            >
              Active
            </span>
          </div>
        </a>
      {/each}

      <!-- Add New Plan Card -->
      <button
        class="border border-border border-dashed p-6 flex flex-col items-center justify-center gap-4 text-text-dim hover:text-text-primary hover:border-text-dim hover:bg-bg-secondary transition-all min-h-[300px] rounded-lg"
        onclick={() => (showCreateModal = true)}
      >
        <div class="w-12 h-12 bg-bg-secondary flex items-center justify-center rounded">
          <Plus   size={24}  weight="fill" />
        </div>
        <div class="text-center">
          <h3 class="font-bold text-sm mb-1">Create New Plan</h3>
          <p class="text-xs text-text-dim">Add a new pricing tier</p>
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
