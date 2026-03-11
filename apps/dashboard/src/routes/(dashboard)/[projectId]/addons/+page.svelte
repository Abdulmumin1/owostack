<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { fade } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import { Coins, Copy, DotsThree, FloppyDisk, Package, Pencil, Plus, Trash, Storefront, CircleNotch } from "phosphor-svelte";
  import CreateCreditPackModal from "$lib/components/addons/CreateCreditPackModal.svelte";
  import EditCreditPackModal from "$lib/components/addons/EditCreditPackModal.svelte";
  import CopyToProdModal from "$lib/components/catalog/CopyToProdModal.svelte";
  import { defaultCurrency } from "$lib/stores/currency";
  import { formatCurrency, COMMON_CURRENCIES } from "$lib/utils/currency";
  import { getActiveEnvironment } from "$lib/env";
  import { copyItemToProd } from "$lib/utils/catalog";

  let packs = $state<any[]>([]);
  let isLoading = $state(true);
  let error = $state("");
  let openMenuId = $state<string | null>(null);

  // Copy to prod state
  let showCopyModal = $state(false);
  let itemToCopy = $state<{ id: string; name: string } | null>(null);

  const isTestEnvironment = $derived(getActiveEnvironment() === "test");

  // Create panel
  let showCreatePanel = $state(false);

  // Edit panel
  let showEditPanel = $state(false);
  let selectedPack = $state<any>(null);

  const organizationId = $derived(page.params.projectId as string);

  async function loadPacks() {
    isLoading = true;
    try {
      const res = await apiFetch(`/api/dashboard/credit-packs?organizationId=${organizationId}`);
      if (res.data?.success) packs = res.data.data;
    } catch (e: any) {
      error = e.message;
    } finally {
      isLoading = false;
    }
  }

  function onPackCreated(pack: any) {
    if (pack) packs = [...packs, pack];
  }

  function onPackUpdated(updatedPack: any) {
    if (updatedPack) {
      packs = packs.map((p) => (p.id === updatedPack.id ? updatedPack : p));
    }
  }

  function startEdit(pack: any) {
    selectedPack = pack;
    showEditPanel = true;
    openMenuId = null;
  }

  async function deletePack(id: string) {
    if (!confirm("Are you sure you want to delete this credit pack?")) return;
    try {
      const res = await apiFetch(`/api/dashboard/credit-packs/${id}`, { method: "DELETE" });
      if (res.data?.success) {
        packs = packs.filter((p) => p.id !== id);
      }
    } catch (e) {
      console.error("Failed to delete credit pack", e);
    }
    openMenuId = null;
  }

  async function toggleActive(pack: any) {
    try {
      const res = await apiFetch(`/api/dashboard/credit-packs/${pack.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !pack.isActive }),
      });
      if (res.data?.success) {
        packs = packs.map((p) => (p.id === pack.id ? res.data.data : p));
      }
    } catch (e) {
      console.error("Failed to toggle pack", e);
    }
    openMenuId = null;
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    openMenuId = null;
  }

  function openCopyModal(pack: any) {
    itemToCopy = { id: pack.id, name: pack.name };
    showCopyModal = true;
    openMenuId = null;
  }

  function formatPrice(amount: number, currency: string) {
    return formatCurrency(amount, currency);
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.dropdown-container')) {
      openMenuId = null;
    }
  }

  onMount(() => {
    loadPacks();
    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  });
</script>

<div class="space-y-8 max-w-6xl mx-auto">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div>
      <div class="flex items-center gap-2 mb-1">
        <Coins   size={18} class="text-text-dim"  weight="duotone" />
        <h1 class="text-lg font-bold text-text-primary">Add-on Credit Packs</h1>
      </div>
      <p class="text-[11px] text-text-dim">
        Credit packs let customers purchase extra credits on top of their plan's included balance.
      </p>
    </div>
    <button
      onclick={() => (showCreatePanel = true)}
      class="btn btn-primary"
    >
      <Plus size={14} />
      Create Pack
    </button>
  </div>

  {#if error}
    <div class="bg-error-bg border border-error text-error text-[11px] px-4 py-3 rounded">
      {error}
      <button class="ml-2 underline" onclick={() => (error = "")}>dismiss</button>
    </div>
  {/if}

  <!-- Packs Table -->
  <div class="table-container !overflow-visible">
    <table class="w-full text-left border-collapse">
      <thead>
        <tr>
          <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Name</th>
          <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Slug</th>
          <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Credits</th>
          <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Price</th>
          <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Scope</th>
          <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Status</th>
          <th class="px-6 py-4"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-border/30">
        {#if isLoading}
          {#each Array(3) as _}
            <tr>
              <td class="px-6 py-4"><Skeleton class="h-4 w-32" /></td>
              <td class="px-6 py-4"><Skeleton class="h-3 w-24" /></td>
              <td class="px-6 py-4"><Skeleton class="h-3 w-12" /></td>
              <td class="px-6 py-4"><Skeleton class="h-3 w-16" /></td>
              <td class="px-6 py-4"><Skeleton class="h-3 w-16" /></td>
              <td class="px-6 py-4"><Skeleton class="h-3 w-12" /></td>
              <td class="px-6 py-4"></td>
            </tr>
          {/each}
        {:else if packs.length === 0}
          <tr>
            <td colspan="7" class="px-6 py-16 text-center">
              <Package   size={32} class="text-text-dim/20 mx-auto mb-3"  weight="duotone" />
              <p class="text-text-dim text-sm mb-1">No credit packs yet</p>
              <p class="text-text-dim/60 text-[11px]">
                Create a credit pack so customers can purchase extra credits via <code class="text-text-dim">owostack.addon()</code>
              </p>
            </td>
          </tr>
        {:else}
          {#each packs as pack}
            <tr
              class="group hover:bg-bg-tertiary transition-colors {openMenuId ===
              pack.id
                ? 'relative z-20'
                : ''}"
            >
              <td class="px-6 py-4">
                <div class="text-sm font-medium text-text-primary">{pack.name}</div>
                {#if pack.description}
                  <div class="text-[10px] text-text-dim mt-0.5">{pack.description}</div>
                {/if}
              </td>
              <td class="px-6 py-4">
                <div class="text-[11px] font-mono text-text-dim">{pack.slug}</div>
              </td>
              <td class="px-6 py-4">
                <div class="text-sm text-text-primary font-mono">{pack.credits}</div>
              </td>
              <td class="px-6 py-4">
                <div class="text-sm text-text-secondary">{formatPrice(pack.price, pack.currency)}</div>
              </td>
              <td class="px-6 py-4">
                {#if pack.creditSystemId}
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-warning-bg text-warning">
                    {pack.creditSystem?.name || pack.creditSystemId}
                  </span>
                {:else}
                  <span class="text-[10px] font-medium text-text-dim">Global</span>
                {/if}
              </td>
              <td class="px-6 py-4">
                <span
                  class="text-[10px] font-bold px-2 py-0.5 rounded {pack.isActive
                    ? 'bg-success-bg text-success'
                    : 'bg-bg-secondary text-text-dim'}"
                >
                  {pack.isActive ? "Active" : "Inactive"}
                </span>
              </td>
              <td class="px-6 py-4 text-right">
                <div class="relative inline-block text-left dropdown-container">
                  <button
                    class="text-text-dim hover:text-text-primary transition-opacity {openMenuId === pack.id
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100'}"
                    onclick={(e) => {
                      e.stopPropagation();
                      openMenuId = openMenuId === pack.id ? null : pack.id;
                    }}
                  >
                    <DotsThree   size={16}  weight="duotone" />
                  </button>
                  {#if openMenuId === pack.id}
                    <div
                      class="absolute right-0 mt-2 w-44 bg-bg-card border border-border z-[100] py-1 rounded shadow-sm"
                      transition:fade={{ duration: 100 }}
                      onclick={(e) => e.stopPropagation()}
                    >
                      <button
                        class="w-full text-left px-4 py-2 text-[11px] text-text-secondary hover:bg-bg-secondary flex items-center gap-2"
                        onclick={() => startEdit(pack)}
                      >
                        <Pencil size={12} weight="duotone" /> Edit
                      </button>
                      <button
                        class="w-full text-left px-4 py-2 text-[11px] text-text-secondary hover:bg-bg-secondary flex items-center gap-2"
                        onclick={() => copyText(pack.slug)}
                      >
                        <Copy size={12} weight="fill" /> Copy Slug
                      </button>
                      {#if isTestEnvironment}
                        <button
                          class="w-full text-left px-4 py-2 text-[11px] text-info hover:bg-info-bg flex items-center gap-2"
                          onclick={(e) => {
                            e.preventDefault();
                            openCopyModal(pack);
                          }}
                        >
                          <Storefront size={12} weight="duotone" />
                          Copy to Prod
                        </button>
                      {/if}
                      <button
                        class="w-full text-left px-4 py-2 text-[11px] text-text-secondary hover:bg-bg-secondary flex items-center gap-2"
                        onclick={() => toggleActive(pack)}
                      >
                        {pack.isActive ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        class="w-full text-left px-4 py-2 text-[11px] text-error hover:bg-error-bg flex items-center gap-2"
                        onclick={() => deletePack(pack.id)}
                      >
                        <Trash size={12} weight="fill" /> Delete
                      </button>
                    </div>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  <!-- SDK Usage Hint -->
  <div class="bg-bg-card border border-border/30 rounded-lg p-5">
    <h3 class="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-3">SDK Usage</h3>
    <pre class="text-[11px] text-text-secondary font-mono bg-bg-primary rounded p-4 overflow-x-auto"><code>// Purchase add-on credits
const result = await owostack.addon(&#123;
  customer: "user@example.com",
  pack: "{packs[0]?.slug || 'credit-pack-slug'}",
  quantity: 1 // optional, buy multiple packs at once
&#125;);

// Credits are automatically consumed when plan credits run out
// Check balance via /check response: planCredits + addonCredits</code></pre>
  </div>
</div>

<CreateCreditPackModal
  bind:isOpen={showCreatePanel}
  {organizationId}
  onclose={() => (showCreatePanel = false)}
  onsuccess={onPackCreated}
/>

<EditCreditPackModal
  bind:isOpen={showEditPanel}
  bind:pack={selectedPack}
  onclose={() => (showEditPanel = false)}
  onsuccess={onPackUpdated}
/>

{#if itemToCopy}
<CopyToProdModal
  bind:open={showCopyModal}
  {organizationId}
  itemType="creditPack"
  itemId={itemToCopy.id}
  itemName={itemToCopy.name}
/>
{/if}
