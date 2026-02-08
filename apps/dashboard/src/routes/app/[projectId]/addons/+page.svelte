<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { fade } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import {
    Coins,
    Plus,
    MoreHorizontal,
    Trash2,
    Copy,
    Pencil,
    Package,
  } from "lucide-svelte";
  import CreateCreditPackModal from "$lib/components/addons/CreateCreditPackModal.svelte";

  let packs = $state<any[]>([]);
  let isLoading = $state(true);
  let error = $state("");
  let openMenuId = $state<string | null>(null);

  // Create panel
  let showCreatePanel = $state(false);

  // Edit form
  let editingId = $state<string | null>(null);
  let editForm = $state({ name: "", description: "", credits: 0, price: 0, currency: "NGN" });
  let isUpdating = $state(false);

  const organizationId = $derived(page.params.projectId ?? "");

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

  function startEdit(pack: any) {
    editingId = pack.id;
    editForm = {
      name: pack.name,
      description: pack.description || "",
      credits: pack.credits,
      price: pack.price,
      currency: pack.currency,
    };
    openMenuId = null;
  }

  async function savePack() {
    if (!editingId) return;
    isUpdating = true;
    try {
      const res = await apiFetch(`/api/dashboard/credit-packs/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(editForm),
      });
      if (res.data?.success) {
        packs = packs.map((p) => (p.id === editingId ? res.data.data : p));
        editingId = null;
      }
    } catch (e: any) {
      error = e.message;
    } finally {
      isUpdating = false;
    }
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

  function formatPrice(amount: number, currency: string) {
    const major = amount / 100;
    return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(major);
  }

  onMount(() => {
    loadPacks();
  });
</script>

<div class="space-y-8 max-w-6xl mx-auto">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div>
      <div class="flex items-center gap-2 mb-1">
        <Coins size={18} class="text-zinc-500" />
        <h1 class="text-lg font-bold text-white">Add-on Credit Packs</h1>
      </div>
      <p class="text-[11px] text-zinc-500">
        Credit packs let customers purchase extra credits on top of their plan's included balance.
      </p>
    </div>
    <button
      onclick={() => (showCreatePanel = true)}
      class="bg-accent hover:bg-accent-hover text-black text-[11px] font-bold px-4 py-2 rounded transition-all flex items-center gap-1.5"
    >
      <Plus size={14} />
      Create Pack
    </button>
  </div>

  {#if error}
    <div class="bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] px-4 py-3 rounded">
      {error}
      <button class="ml-2 underline" onclick={() => (error = "")}>dismiss</button>
    </div>
  {/if}

  <!-- Packs Table -->
  <div class="bg-bg-card border border-border/50 rounded-lg overflow-hidden">
    <table class="w-full text-left border-collapse">
      <thead>
        <tr class="border-b border-border/50">
          <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Name</th>
          <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Slug</th>
          <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Credits</th>
          <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Price</th>
          <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Scope</th>
          <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Status</th>
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
              <Package size={32} class="text-zinc-700 mx-auto mb-3" />
              <p class="text-zinc-500 text-sm mb-1">No credit packs yet</p>
              <p class="text-zinc-600 text-[11px]">
                Create a credit pack so customers can purchase extra credits via <code class="text-zinc-500">owostack.addon()</code>
              </p>
            </td>
          </tr>
        {:else}
          {#each packs as pack}
            <tr class="group hover:bg-white/[0.02] transition-colors">
              <td class="px-6 py-4">
                {#if editingId === pack.id}
                  <input
                    bind:value={editForm.name}
                    class="bg-bg-primary border border-border rounded px-2 py-1 text-sm text-white w-full focus:border-accent focus:outline-none"
                  />
                {:else}
                  <div class="text-sm font-medium text-white">{pack.name}</div>
                  {#if pack.description}
                    <div class="text-[10px] text-zinc-600 mt-0.5">{pack.description}</div>
                  {/if}
                {/if}
              </td>
              <td class="px-6 py-4">
                <div class="text-[11px] font-mono text-zinc-500">{pack.slug}</div>
              </td>
              <td class="px-6 py-4">
                {#if editingId === pack.id}
                  <input
                    type="number"
                    bind:value={editForm.credits}
                    min="1"
                    class="bg-bg-primary border border-border rounded px-2 py-1 text-sm text-white w-20 focus:border-accent focus:outline-none"
                  />
                {:else}
                  <div class="text-sm text-white font-mono">{pack.credits}</div>
                {/if}
              </td>
              <td class="px-6 py-4">
                {#if editingId === pack.id}
                  <input
                    type="number"
                    bind:value={editForm.price}
                    min="0"
                    class="bg-bg-primary border border-border rounded px-2 py-1 text-sm text-white w-24 focus:border-accent focus:outline-none"
                  />
                {:else}
                  <div class="text-sm text-zinc-300">{formatPrice(pack.price, pack.currency)}</div>
                {/if}
              </td>
              <td class="px-6 py-4">
                {#if pack.creditSystemId}
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-400">
                    {pack.creditSystem?.name || pack.creditSystemId}
                  </span>
                {:else}
                  <span class="text-[10px] font-medium text-zinc-600">Global</span>
                {/if}
              </td>
              <td class="px-6 py-4">
                <span
                  class="text-[10px] font-bold px-2 py-0.5 rounded {pack.isActive
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-zinc-500/10 text-zinc-500'}"
                >
                  {pack.isActive ? "Active" : "Inactive"}
                </span>
              </td>
              <td class="px-6 py-4 text-right">
                {#if editingId === pack.id}
                  <div class="flex items-center gap-2 justify-end">
                    <button
                      onclick={savePack}
                      disabled={isUpdating}
                      class="bg-accent text-black text-[10px] font-bold px-3 py-1 rounded"
                    >
                      {isUpdating ? "..." : "Save"}
                    </button>
                    <button
                      onclick={() => (editingId = null)}
                      class="text-zinc-500 text-[10px]"
                    >
                      Cancel
                    </button>
                  </div>
                {:else}
                  <div class="relative inline-block text-left">
                    <button
                      class="text-zinc-500 hover:text-white transition-opacity {openMenuId === pack.id
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100'}"
                      onclick={(e) => {
                        e.stopPropagation();
                        openMenuId = openMenuId === pack.id ? null : pack.id;
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    {#if openMenuId === pack.id}
                      <div
                        class="absolute right-0 mt-2 w-44 bg-[#141414] border border-border shadow-xl z-10 py-1"
                        transition:fade={{ duration: 100 }}
                      >
                        <button
                          class="w-full text-left px-4 py-2 text-[11px] text-zinc-300 hover:bg-white/5 flex items-center gap-2"
                          onclick={() => startEdit(pack)}
                        >
                          <Pencil size={12} /> Edit
                        </button>
                        <button
                          class="w-full text-left px-4 py-2 text-[11px] text-zinc-300 hover:bg-white/5 flex items-center gap-2"
                          onclick={() => copyText(pack.slug)}
                        >
                          <Copy size={12} /> Copy Slug
                        </button>
                        <button
                          class="w-full text-left px-4 py-2 text-[11px] text-zinc-300 hover:bg-white/5 flex items-center gap-2"
                          onclick={() => toggleActive(pack)}
                        >
                          {pack.isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          class="w-full text-left px-4 py-2 text-[11px] text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                          onclick={() => deletePack(pack.id)}
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    {/if}
                  </div>
                {/if}
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  <!-- SDK Usage Hint -->
  <div class="bg-bg-card border border-border/30 rounded-lg p-5">
    <h3 class="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">SDK Usage</h3>
    <pre class="text-[11px] text-zinc-400 font-mono bg-bg-primary rounded p-4 overflow-x-auto"><code>// Purchase add-on credits
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
