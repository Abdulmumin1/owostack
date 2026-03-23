<script lang="ts">
  import {
    ArrowSquareOut,
    Check,
    CircleNotch,
    Copy,
    DotsThree,
    Plus,
    Trash,
    X,
    SquaresFour,
    ListDashes,
    Package,
    CreditCardIcon,
    Storefront,
  } from "phosphor-svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { fade, fly } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import { formatCurrency } from "$lib/utils/currency";
  import { getActiveEnvironment } from "$lib/env";
  import { copyItemToProd } from "$lib/utils/catalog";
  import CreatePlanModal from "$lib/components/plans/CreatePlanModal.svelte";
  import CopyToProdModal from "$lib/components/catalog/CopyToProdModal.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  // URL param is the organization ID from Better Auth
  const organizationId = $derived(page.params.projectId as string);
  let plans = $state<any[]>([]);
  let showCreateModal = $state(false);
  let isLoading = $state(true);
  let openMenuId = $state<string | null>(null);
  let viewMode = $state<"grid" | "list">("list");
  
  // Copy to Prod state
  let showCopyModal = $state(false);
  let itemToCopy = $state<{ id: string; name: string } | null>(null);
  
  const isTestEnvironment = $derived(getActiveEnvironment() === "test");

  function openCopyModal(plan: any) {
    itemToCopy = { id: plan.id, name: plan.name };
    showCopyModal = true;
    openMenuId = null;
  }

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
    if (
      !confirm(
        "Are you sure you want to delete this plan? This action cannot be undone.",
      )
    )
      return;

    try {
      const res = await apiFetch(`/api/dashboard/plans/${id}`, {
        method: "DELETE",
      });
      if (res.data?.success) {
        plans = plans.filter((p) => p.id !== id);
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
    if (!target.closest(".dropdown-container")) {
      openMenuId = null;
    }
  }

  function getCustomerCount(plan: any) {
    if (typeof plan.customerCount === "number") {
      return plan.customerCount;
    }

    if (!plan.subscriptions || plan.subscriptions.length === 0) return 0;

    if (plan.billingType === "one_time") {
      return new Set(plan.subscriptions.map((s: any) => s.customerId)).size;
    }

    // For subscriptions, only count unique active customers
    const activeStatuses = [
      "active",
      "trialing",
      "past_due",
      "pending_cancel",
      "non_renewing",
    ];
    const activeSubs = plan.subscriptions.filter((s: any) =>
      activeStatuses.includes(s.status),
    );
    return new Set(activeSubs.map((s: any) => s.customerId)).size;
  }
</script>

<svelte:window onclick={handleClickOutside} />

<svelte:head>
  <title>Plans - Owostack</title>
</svelte:head>

<div class="max-w-6xl">
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1 class="text-xl font-bold text-text-primary mb-2">Plans</h1>
      <p class="text-text-dim text-xs uppercase tracking-widest font-semibold">
        Manage subscription tiers and features
      </p>
    </div>

    {#if plans.length > 0}
      <div class="flex items-center gap-3">
        <div
          class="flex items-center gap-1 bg-bg-secondary rounded border border-border"
        >
          <button
            class="p-1 rounded-sm transition-all {viewMode === 'list'
              ? 'bg-bg-card border border-border-strong text-text-primary'
              : 'text-text-dim hover:text-text-primary border border-transparent'}"
            onclick={() => (viewMode = "list")}
            title="List View"
          >
            <ListDashes
              size={16}
              weight={viewMode === "list" ? "fill" : "duotone"}
            />
          </button>
          <button
            class="p-1 rounded-sm transition-all {viewMode === 'grid'
              ? 'bg-bg-card border border-border-strong text-text-primary'
              : 'text-text-dim hover:text-text-primary border border-transparent'}"
            onclick={() => (viewMode = "grid")}
            title="Grid View"
          >
            <SquaresFour
              size={16}
              weight={viewMode === "grid" ? "fill" : "duotone"}
            />
          </button>
        </div>
        <button
          class="btn btn-primary"
          onclick={() => (showCreateModal = true)}
        >
          <Plus size={14} />
          Create Plan
        </button>
      </div>
    {/if}
  </div>

  {#if isLoading}
    <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each Array(3) as _}
        <div
          class="bg-bg-card border border-border p-6 flex flex-col h-full space-y-6 rounded-lg"
        >
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
      <div
        class="w-12 h-12 bg-bg-secondary flex items-center justify-center mb-4"
      >
        <Plus size={24} class="text-text-dim" weight="fill" />
      </div>
      <h3 class="text-lg font-bold text-text-primary mb-2">No plans defined</h3>
      <p class="text-text-dim max-w-sm mb-6">
        Create your first subscription plan to start charging customers.
      </p>
      <button class="btn btn-primary" onclick={() => (showCreateModal = true)}>
        Create Plan
      </button>
    </div>
  {:else if viewMode === "grid"}
    <!-- Plans Grid -->
    <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each plans as plan}
        <a
          href="/{organizationId}/plans/{plan.id}"
          class="bg-bg-card border border-border hover:border-text-dim transition-colors relative group rounded-lg p-6 flex flex-col h-full"
        >
          <!-- Actions Menu -->
          <div class="absolute top-4 right-4 dropdown-container">
            <button
              class="text-text-dim hover:text-text-primary transition-opacity {openMenuId ===
              plan.id
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100'}"
              onclick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openMenuId = openMenuId === plan.id ? null : plan.id;
              }}
            >
              <DotsThree size={20} />
            </button>

            {#if openMenuId === plan.id}
              <div
                class="absolute right-0 mt-2 w-40 bg-bg-card border border-border z-[100] py-1 rounded shadow-sm"
                transition:fade={{ duration: 100 }}
                onclick={(e) => e.stopPropagation()}
              >
                <button
                  class="w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-bg-secondary hover:text-text-primary flex items-center gap-2"
                  onclick={(e) => {
                    e.preventDefault();
                    copyId(plan.slug);
                  }}
                >
                  <Copy size={14} weight="fill" />
                  Copy Slug
                </button>
                {#if isTestEnvironment}
                  <button
                    class="w-full text-left px-4 py-2 text-xs text-info hover:bg-info-bg flex items-center gap-2"
                    onclick={(e) => {
                      e.preventDefault();
                      openCopyModal(plan);
                    }}
                  >
                    <Storefront size={14} weight="duotone" />
                    Copy to Prod
                  </button>
                {/if}
                <button
                  class="w-full text-left px-4 py-2 text-xs text-error hover:bg-error-bg flex items-center gap-2"
                  onclick={(e) => {
                    e.preventDefault();
                    deletePlan(plan.id);
                  }}
                >
                  <Trash size={14} weight="fill" />
                  Delete Plan
                </button>
              </div>
            {/if}
          </div>

          <div class="mb-6">
            <h3 class="text-lg font-bold text-text-primary mb-1">
              {plan.name}
            </h3>
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
            <div class="flex gap-2 mt-3 flex-wrap">
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
                  >{plan.trialDays}{plan.metadata?.trialUnit === "minutes"
                    ? "m"
                    : "d"} Trial</span
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
                  <li
                    class="flex items-center gap-2 text-xs text-text-secondary"
                  >
                    <Check size={12} class="text-accent" weight="fill" />
                    <span class="truncate">{pf.feature.name}</span>
                    {#if pf.limitValue !== null}
                      <span
                        class="text-[10px] text-text-dim font-mono ml-auto flex-shrink-0"
                      >
                        {pf.limitValue}
                        {pf.feature.unit || "units"}
                      </span>
                    {:else}
                      <span class="text-[10px] text-text-dim font-mono ml-auto"
                        >Unlimited</span
                      >
                    {/if}
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="text-xs text-text-dim italic">No features added yet</p>
            {/if}
          </div>

          <div
            class="pt-4 border-t border-border flex items-center justify-between mt-auto"
          >
            <span class="text-[10px] text-text-dim font-mono"
              >ID: {plan.slug}</span
            >
            <span
              class="text-[10px] font-bold bg-bg-secondary text-text-dim px-2 py-1 rounded-sm"
              >Active</span
            >
          </div>
        </a>
      {/each}

      <!-- Add New Plan Card -->
      <button
        class="border border-border border-dashed p-6 flex flex-col items-center justify-center gap-4 text-text-dim hover:text-text-primary hover:border-text-dim hover:bg-bg-secondary transition-all min-h-[300px] rounded-lg"
        onclick={() => (showCreateModal = true)}
      >
        <div
          class="w-12 h-12 bg-bg-secondary flex items-center justify-center rounded"
        >
          <Plus size={24} weight="fill" />
        </div>
        <div class="text-center">
          <h3 class="font-bold text-sm mb-1">Create New Plan</h3>
          <p class="text-xs text-text-dim">Add a new pricing tier</p>
        </div>
      </button>
    </div>
  {:else}
    <!-- Plans List View -->
    {@const subscriptions = plans.filter((p) => p.billingType !== "one_time")}
    {@const oneOffs = plans.filter((p) => p.billingType === "one_time")}

    <div class="flex flex-col gap-8">
      {#if subscriptions.length > 0}
        <div>
          <div
            class="inline-flex text-[11px] font-medium text-text-secondary px-3 py-1 bg-bg-secondary border border-border rounded-full mb-3"
          >
            Subscriptions
          </div>
          <div class="table-container !overflow-visible">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>ID</th>
                  <th>Customers</th>
                  <th>Price</th>
                  <th class="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {#each subscriptions as plan}
                  <tr
                    class="group cursor-pointer hover:bg-bg-card-hover"
                    onclick={() => goto(`/${organizationId}/plans/${plan.id}`)}
                  >
                    <td class="py-3">
                      <div class="flex items-center gap-2">
                        <CreditCardIcon
                          size={18}
                          weight="duotone"
                          class="text-text-dim"
                        />
                        <span class="font-medium text-text-primary text-[13px]"
                          >{plan.name}</span
                        >
                      </div>
                    </td>
                    <td class="text-[9px] text-text-muted">{plan.slug}</td>
                    <td class="text-[9px] text-text-muted"
                      >{getCustomerCount(plan)}</td
                    >
                    <td class="text-xs text-text-primary font-medium">
                      {formatMoney(plan.price, plan.currency)}
                      {#if plan.price > 0 && plan.interval}
                        <span class="text-[10px] text-text-dim font-normal"
                          >/{plan.interval}</span
                        >
                      {/if}
                    </td>
                    <td class="text-right">
                      <div
                        class="relative dropdown-container inline-block"
                        onclick={(e) => e.stopPropagation()}
                      >
                        <button
                          class="text-text-dim hover:text-text-primary transition-opacity opacity-0 group-hover:opacity-100"
                          onclick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openMenuId =
                              openMenuId === plan.id ? null : plan.id;
                          }}
                        >
                          <DotsThree size={16} />
                        </button>
                        {#if openMenuId === plan.id}
                          <div
                            class="absolute right-0 mt-2 w-40 bg-bg-card border border-border z-[100] py-1 rounded shadow-sm text-left"
                            transition:fade={{ duration: 100 }}
                          >
                            <button
                              class="w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-bg-secondary flex items-center gap-2"
                              onclick={(e) => {
                                e.preventDefault();
                                copyId(plan.slug);
                              }}
                            >
                              <Copy size={14} weight="fill" /> Copy Slug
                            </button>
                            {#if isTestEnvironment}
                              <button
                                class="w-full text-left px-4 py-2 text-xs text-info hover:bg-info-bg flex items-center gap-2"
                                onclick={(e) => {
                                  e.preventDefault();
                                  openCopyModal(plan);
                                }}
                              >
                                <Storefront size={14} weight="duotone" />
                                Copy to Prod
                              </button>
                            {/if}
                            <button
                              class="w-full text-left px-4 py-2 text-xs text-error hover:bg-error-bg flex items-center gap-2"
                              onclick={(e) => {
                                e.preventDefault();
                                deletePlan(plan.id);
                              }}
                            >
                              <Trash size={14} weight="fill" /> Delete Plan
                            </button>
                          </div>
                        {/if}
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}

      <div>
        <div
          class="inline-flex text-[11px] font-medium text-text-secondary px-3 py-1 bg-bg-secondary border border-border rounded-full mb-3"
        >
          One-off purchases
        </div>
        {#if oneOffs.length > 0}
          <div class="table-container !overflow-visible">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>ID</th>
                  <th>Customers</th>
                  <th>Price</th>
                  <th class="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {#each oneOffs as plan}
                  <tr
                    class="group cursor-pointer hover:bg-bg-card-hover"
                    onclick={() => goto(`/${organizationId}/plans/${plan.id}`)}
                  >
                    <td class="py-3">
                      <div class="flex items-center gap-2">
                        <Package
                          size={18}
                          weight="duotone"
                          class="text-text-dim"
                        />
                        <span class="font-medium text-text-primary text-[13px]"
                          >{plan.name}</span
                        >
                      </div>
                    </td>
                    <td class="text-[11px] text-text-muted">{plan.slug}</td>
                    <td class="text-[11px] text-text-muted"
                      >{getCustomerCount(plan)}</td
                    >
                    <td class="text-xs text-text-primary font-medium">
                      {formatMoney(plan.price, plan.currency)}
                    </td>
                    <td class="text-right">
                      <div
                        class="relative dropdown-container inline-block"
                        onclick={(e) => e.stopPropagation()}
                      >
                        <button
                          class="text-text-dim hover:text-text-primary transition-opacity opacity-0 group-hover:opacity-100"
                          onclick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openMenuId =
                              openMenuId === plan.id ? null : plan.id;
                          }}
                        >
                          <DotsThree size={16} />
                        </button>
                        {#if openMenuId === plan.id}
                          <div
                            class="absolute right-0 mt-2 w-40 bg-bg-card border border-border z-[100] py-1 rounded shadow-sm text-left"
                            transition:fade={{ duration: 100 }}
                          >
                            <button
                              class="w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-bg-secondary flex items-center gap-2"
                              onclick={(e) => {
                                e.preventDefault();
                                copyId(plan.slug);
                              }}
                            >
                              <Copy size={14} weight="fill" /> Copy Slug
                            </button>
                            {#if isTestEnvironment}
                              <button
                                class="w-full text-left px-4 py-2 text-xs text-info hover:bg-info-bg flex items-center gap-2"
                                onclick={(e) => {
                                  e.preventDefault();
                                  openCopyModal(plan);
                                }}
                              >
                                <Storefront size={14} weight="duotone" />
                                Copy to Prod
                              </button>
                            {/if}
                            <button
                              class="w-full text-left px-4 py-2 text-xs text-error hover:bg-error-bg flex items-center gap-2"
                              onclick={(e) => {
                                e.preventDefault();
                                deletePlan(plan.id);
                              }}
                            >
                              <Trash size={14} weight="fill" /> Delete Plan
                            </button>
                          </div>
                        {/if}
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <div
            class="rounded-lg border border-border bg-transparent border-dashed p-8 flex items-center justify-center text-xs text-text-dim"
          >
            One-time prices for top-ups or lifetime purchases
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<CreatePlanModal
  {organizationId}
  bind:isOpen={showCreateModal}
  onsuccess={handlePlanCreated}
/>

{#if itemToCopy}
<CopyToProdModal
  bind:open={showCopyModal}
  {organizationId}
  itemType="plan"
  itemId={itemToCopy.id}
  itemName={itemToCopy.name}
/>
{/if}
