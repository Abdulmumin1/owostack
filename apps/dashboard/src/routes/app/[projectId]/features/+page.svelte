<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { fade } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import CreateFeatureModal from "$lib/components/features/CreateFeatureModal.svelte";
  import CreateCreditSystemModal from "$lib/components/features/CreateCreditSystemModal.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import { 
    ChevronRight, 
    Boxes, 
    Loader2, 
    Zap, 
    ToggleLeft, 
    Hash, 
    ArrowRight, 
    MoreHorizontal, 
    Trash2, 
    Copy,
    Coins,
    ExternalLink,
    Plus
  } from "lucide-svelte";

  let features = $state<any[]>([]);
  let creditSystems = $state<any[]>([]);
  let isLoading = $state(true);
  let showCreateModal = $state(false);
  let showCreateCSModal = $state(false);
  let error = $state("");
  let openMenuId = $state<string | null>(null);

  const organizationId = $derived(page.params.projectId);

  async function loadData() {
    isLoading = true;
    try {
      const [featuresRes, creditsRes] = await Promise.all([
        apiFetch(`/api/dashboard/features?organizationId=${organizationId}`),
        apiFetch(`/api/dashboard/credits?organizationId=${organizationId}`)
      ]);

      if (featuresRes.data?.success) features = featuresRes.data.data;
      if (creditsRes.data?.success) creditSystems = creditsRes.data.data;
    } catch (e: any) {
      error = e.message;
    } finally {
      isLoading = false;
    }
  }

  async function deleteFeature(id: string) {
    if (!confirm("Are you sure you want to delete this feature? Plans using this feature might break.")) return;
    
    try {
      const res = await apiFetch(`/api/dashboard/features/${id}`, {
        method: "DELETE"
      });
      if (res.data?.success) {
        features = features.filter(f => f.id !== id);
      }
    } catch (e) {
      console.error("Failed to delete feature", e);
    }
    openMenuId = null;
  }

  async function deleteCreditSystem(id: string) {
    if (!confirm("Are you sure you want to delete this credit system?")) return;
    
    try {
      const res = await apiFetch(`/api/dashboard/credits/${id}`, {
        method: "DELETE"
      });
      if (res.data?.success) {
        creditSystems = creditSystems.filter(cs => cs.id !== id);
      }
    } catch (e) {
      console.error("Failed to delete credit system", e);
    }
    openMenuId = null;
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    openMenuId = null;
  }

  function handleFeatureCreated() {
    loadData();
  }

  onMount(() => {
    loadData();
  });
</script>

<div class="space-y-12 max-w-6xl mx-auto">
 
  <!-- Features Section -->
  <section class="space-y-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Boxes size={18} class="text-zinc-500" />
        <h2 class="text-lg font-bold text-white">Features</h2>
      </div>
      <div class="flex items-center gap-2">
        <button
          onclick={() => (showCreateModal = true)}
          class="bg-accent hover:bg-accent-hover text-black text-[11px] font-bold px-4 py-2 rounded transition-all"
        >
          Create Feature
        </button>
        
        
      </div>
    </div>

    <div class="bg-bg-card border border-border/50 rounded-lg overflow-hidden">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="border-b border-border/50">
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Name</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">ID</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Type</th>
            <th class="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/30">
          {#if isLoading}
            {#each Array(3) as _}
              <tr>
                <td class="px-6 py-4">
                  <Skeleton class="h-4 w-32" />
                </td>
                <td class="px-6 py-4">
                  <Skeleton class="h-3 w-24" />
                </td>
                <td class="px-6 py-4">
                  <div class="flex items-center gap-2">
                    <Skeleton class="w-4 h-4 rounded" />
                    <Skeleton class="h-3 w-16" />
                  </div>
                </td>
                <td class="px-6 py-4"></td>
              </tr>
            {/each}
          {:else if features.length === 0}
            <tr>
              <td colspan="4" class="px-6 py-12 text-center text-zinc-600 text-sm italic">
                No features defined yet.
              </td>
            </tr>
          {:else}
            {#each features as feature}
              <tr class="group hover:bg-white/[0.02] transition-colors">
                <td class="px-6 py-4">
                  <div class="text-sm font-medium text-white">{feature.name}</div>
                </td>
                <td class="px-6 py-4">
                  <div class="text-[11px] font-mono text-zinc-500">{feature.slug}</div>
                </td>
                <td class="px-6 py-4">
                  <div class="flex items-center gap-2">
                    {#if feature.type === 'metered'}
                      <Zap size={14} class="text-amber-400" />
                      <span class="text-[11px] text-zinc-400 capitalize">{feature.meterType?.replace('_', ' ') || 'Consumable'}</span>
                    {:else if feature.type === 'boolean'}
                      <ToggleLeft size={14} class="text-blue-400" />
                      <span class="text-[11px] text-zinc-400">Boolean</span>
                    {:else}
                      <Hash size={14} class="text-emerald-400" />
                      <span class="text-[11px] text-zinc-400">Static</span>
                    {/if}
                  </div>
                </td>
                <td class="px-6 py-4 text-right">
                  <div class="relative inline-block text-left">
                    <button
                      class="text-zinc-500 hover:text-white transition-opacity {openMenuId === feature.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}"
                      onclick={(e) => {
                        e.stopPropagation();
                        openMenuId = openMenuId === feature.id ? null : feature.id;
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    {#if openMenuId === feature.id}
                      <div class="absolute right-0 mt-2 w-40 bg-[#141414] border border-border shadow-xl z-10 py-1" transition:fade={{ duration: 100 }}>
                        <button class="w-full text-left px-4 py-2 text-[11px] text-zinc-300 hover:bg-white/5 flex items-center gap-2" onclick={() => copyText(feature.slug)}>
                          <Copy size={12} /> Copy Slug
                        </button>
                        <button class="w-full text-left px-4 py-2 text-[11px] text-red-400 hover:bg-red-500/10 flex items-center gap-2" onclick={() => deleteFeature(feature.id)}>
                          <Trash2 size={12} /> Delete
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
  </section>

  <!-- Credit Systems Section -->
  <section class="space-y-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Coins size={18} class="text-zinc-500" />
        <h2 class="text-lg font-bold text-white">Credit Systems</h2>
      </div>
      <button
        onclick={() => (showCreateCSModal = true)}
        class="bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-bold text-white px-4 py-2 rounded transition-all"
      >
        Create Credit System
      </button>
    </div>

    <div class="bg-bg-card border border-border rounded-lg overflow-hidden">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="border-b border-border/50">
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Name</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">ID</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Features</th>
            <th class="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/30">
          {#if isLoading}
            {#each Array(2) as _}
              <tr>
                <td class="px-6 py-4">
                  <Skeleton class="h-4 w-32" />
                </td>
                <td class="px-6 py-4">
                  <Skeleton class="h-3 w-24" />
                </td>
                <td class="px-6 py-4">
                  <div class="flex gap-1">
                    <Skeleton class="h-4 w-12" />
                    <Skeleton class="h-4 w-12" />
                  </div>
                </td>
                <td class="px-6 py-4"></td>
              </tr>
            {/each}
          {:else if creditSystems.length === 0}
            <tr>
              <td colspan="4" class="px-6 py-10 text-center">
                <p class="text-zinc-500 text-[11px] mb-4">
                  Credit systems let you assign different credit costs to features, and draw usage from a common balance
                </p>
            
              </td>
            </tr>
          {:else}
            {#each creditSystems as system}
              <tr class="group hover:bg-white/[0.02] transition-colors">
                <td class="px-6 py-4">
                  <div class="text-sm font-medium text-white">{system.name}</div>
                </td>
                <td class="px-6 py-4">
                  <div class="text-[11px] font-mono text-zinc-500">{system.slug}</div>
                </td>
                <td class="px-6 py-4">
                  <div class="flex flex-wrap gap-1">
                    {#each system.features as f}
                      <span class="text-[9px] bg-white/5 border border-white/10 px-1.5 py-0.5 rounded text-zinc-400">
                        {f.feature.name} ({f.cost})
                      </span>
                    {/each}
                  </div>
                </td>
                <td class="px-6 py-4 text-right">
                  <div class="relative inline-block text-left">
                    <button
                      class="text-zinc-500 hover:text-white transition-opacity {openMenuId === system.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}"
                      onclick={(e) => {
                        e.stopPropagation();
                        openMenuId = openMenuId === system.id ? null : system.id;
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    {#if openMenuId === system.id}
                      <div class="absolute right-0 mt-2 w-40 bg-[#141414] border border-border shadow-xl z-10 py-1" transition:fade={{ duration: 100 }}>
                        <button class="w-full text-left px-4 py-2 text-[11px] text-zinc-300 hover:bg-white/5 flex items-center gap-2" onclick={() => copyText(system.slug)}>
                          <Copy size={12} /> Copy Slug
                        </button>
                        <button class="w-full text-left px-4 py-2 text-[11px] text-red-400 hover:bg-red-500/10 flex items-center gap-2" onclick={() => deleteCreditSystem(system.id)}>
                          <Trash2 size={12} /> Delete
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
  </section>
</div>

<CreateFeatureModal
  isOpen={showCreateModal}
  {organizationId}
  onclose={() => (showCreateModal = false)}
  onsuccess={handleFeatureCreated}
/>

<CreateCreditSystemModal
  isOpen={showCreateCSModal}
  {organizationId}
  onclose={() => (showCreateCSModal = false)}
  onsuccess={handleFeatureCreated}
/>
