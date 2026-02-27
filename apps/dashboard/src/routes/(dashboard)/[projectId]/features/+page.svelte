<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { fade } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import CreateFeatureModal from "$lib/components/features/CreateFeatureModal.svelte";
  import EditFeatureModal from "$lib/components/features/EditFeatureModal.svelte";
  import CreateCreditSystemModal from "$lib/components/features/CreateCreditSystemModal.svelte";
  import EditCreditSystemModal from "$lib/components/features/EditCreditSystemModal.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import {
    ArrowRight,
    ArrowSquareOut,
    CaretRight,
    CircleNotch,
    Coins,
    Copy,
    Cube,
    DotsThree,
    Hash,
    Lightning,
    Pencil,
    Plus,
    ToggleLeft,
    Trash,
  } from "phosphor-svelte";

  let features = $state<any[]>([]);
  let creditSystems = $state<any[]>([]);
  let isLoading = $state(true);
  let showCreateModal = $state(false);
  let showEditFeatureModal = $state(false);
  let editingFeature = $state<any>(null);
  let showCreateCSModal = $state(false);
  let showEditCSModal = $state(false);
  let editingCreditSystemId = $state<string>("");
  let error = $state("");
  let openFeatureMenuId = $state<string | null>(null);
  let openCreditSystemMenuId = $state<string | null>(null);

  const organizationId = $derived(page.params.projectId);

  async function loadData() {
    isLoading = true;
    try {
      const [featuresRes, creditsRes] = await Promise.all([
        apiFetch(`/api/dashboard/features?organizationId=${organizationId}`),
        apiFetch(`/api/dashboard/credits?organizationId=${organizationId}`),
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
    if (
      !confirm(
        "Are you sure you want to delete this feature? Plans using this feature might break.",
      )
    )
      return;

    try {
      const res = await apiFetch(`/api/dashboard/features/${id}`, {
        method: "DELETE",
      });
      if (res.data?.success) {
        features = features.filter((f) => f.id !== id);
      }
    } catch (e) {
      console.error("Failed to delete feature", e);
    }
    openFeatureMenuId = null;
  }

  async function deleteCreditSystem(id: string) {
    if (!confirm("Are you sure you want to delete this credit system?")) return;

    try {
      const res = await apiFetch(`/api/dashboard/credits/${id}`, {
        method: "DELETE",
      });
      if (res.data?.success) {
        creditSystems = creditSystems.filter((cs) => cs.id !== id);
      }
    } catch (e) {
      console.error("Failed to delete credit system", e);
    }
    openCreditSystemMenuId = null;
  }

  function copyFeatureText(text: string) {
    navigator.clipboard.writeText(text);
    openFeatureMenuId = null;
  }

  function copyCreditSystemText(text: string) {
    navigator.clipboard.writeText(text);
    openCreditSystemMenuId = null;
  }

  function handleFeatureCreated() {
    loadData();
  }

  function handleFeatureUpdated(updated: any) {
    features = features.map(f => f.id === updated.id ? updated : f);
  }

  function startEditFeature(feature: any) {
    editingFeature = feature;
    showEditFeatureModal = true;
    openFeatureMenuId = null;
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest(".dropdown-container")) {
      openFeatureMenuId = null;
      openCreditSystemMenuId = null;
    }
  }

  onMount(() => {
    loadData();
    document.addEventListener("click", handleClickOutside);
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  });
</script>

<div class="space-y-12 max-w-6xl mx-auto">
  <!-- Features Section -->
  <section class="space-y-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Cube size={18} class="text-text-dim" weight="duotone" />
        <h2 class="text-lg font-bold text-text-primary">Features</h2>
      </div>
      <div class="flex items-center gap-2">
        <button
          onclick={() => (showCreateModal = true)}
          class="btn btn-primary"
        >
          Create Feature
        </button>
      </div>
    </div>

    <div class="table-container !overflow-visible">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr>
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Name</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >ID</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Type</th
            >
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
              <td
                colspan="4"
                class="px-6 py-12 text-center text-text-dim text-sm italic"
              >
                No features defined yet.
              </td>
            </tr>
          {:else}
            {#each features as feature}
              <tr
                class="group hover:bg-bg-secondary transition-colors {openFeatureMenuId ===
                feature.id
                  ? 'relative z-20'
                  : ''}"
              >
                <td class="px-6 py-4">
                  <div class="text-sm font-medium text-text-primary">
                    {feature.name}
                  </div>
                </td>
                <td class="px-6 py-4">
                  <div class="text-[11px] font-mono text-text-dim">
                    {feature.slug}
                  </div>
                </td>
                <td class="px-6 py-4">
                  <div class="flex items-center gap-2">
                    {#if feature.type === "metered"}
                      <Lightning
                        size={14}
                        class="text-warning"
                        weight="duotone"
                      />
                      <span class="text-[11px] text-text-secondary capitalize"
                        >{feature.meterType?.replace("_", " ") ||
                          "Consumable"}</span
                      >
                    {:else if feature.type === "boolean"}
                      <ToggleLeft
                        size={14}
                        class="text-info"
                        weight="duotone"
                      />
                      <span class="text-[11px] text-text-secondary"
                        >Boolean</span
                      >
                    {:else}
                      <Hash size={14} class="text-success" weight="duotone" />
                      <span class="text-[11px] text-text-secondary">Static</span
                      >
                    {/if}
                  </div>
                </td>
                <td class="px-6 py-4 text-right">
                  <div
                    class="relative inline-block text-left dropdown-container"
                  >
                    <button
                      class="text-text-dim hover:text-text-primary transition-all p-1 rounded hover:bg-bg-secondary"
                      onclick={(e) => {
                        e.stopPropagation();
                        openFeatureMenuId =
                          openFeatureMenuId === feature.id ? null : feature.id;
                        openCreditSystemMenuId = null;
                      }}
                    >
                      <DotsThree size={16} weight="duotone" />
                    </button>
                    {#if openFeatureMenuId === feature.id}
                      <div
                        class="absolute right-0 mt-2 w-40 bg-bg-card border border-border z-[100] py-1 rounded shadow-sm"
                        transition:fade={{ duration: 100 }}
                        onclick={(e) => e.stopPropagation()}
                      >
                        <button
                          class="w-full text-left px-4 py-2 text-[11px] text-text-secondary hover:bg-bg-secondary flex items-center gap-2"
                          onclick={() => startEditFeature(feature)}
                        >
                          <Pencil size={12} weight="duotone" /> Edit
                        </button>
                        <button
                          class="w-full text-left px-4 py-2 text-[11px] text-text-secondary hover:bg-bg-secondary flex items-center gap-2"
                          onclick={() => copyFeatureText(feature.slug)}
                        >
                          <Copy size={12} weight="fill" /> Copy Slug
                        </button>
                        <button
                          class="w-full text-left px-4 py-2 text-[11px] text-error hover:bg-error-bg flex items-center gap-2"
                          onclick={() => deleteFeature(feature.id)}
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
  </section>

  <!-- Credit Systems Section -->
  <section class="space-y-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Coins size={18} class="text-text-dim" weight="duotone" />
        <h2 class="text-lg font-bold text-text-primary">Credit Systems</h2>
      </div>
      <button
        onclick={() => (showCreateCSModal = true)}
        class="btn btn-secondary"
      >
        Create Credit System
      </button>
    </div>

    <div class="table-container !overflow-visible">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr>
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Name</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >ID</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Features</th
            >
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
                <p class="text-text-dim text-[11px] mb-4">
                  Credit systems let you assign different credit costs to
                  features, and draw usage from a common balance
                </p>
              </td>
            </tr>
          {:else}
            {#each creditSystems as system}
              <tr
                class="group hover:bg-bg-secondary transition-colors {openCreditSystemMenuId ===
                system.id
                  ? 'relative z-20'
                  : ''}"
              >
                <td class="px-6 py-4">
                  <div class="text-sm font-medium text-text-primary">
                    {system.name}
                  </div>
                </td>
                <td class="px-6 py-4">
                  <div class="text-[11px] font-mono text-text-dim">
                    {system.slug}
                  </div>
                </td>
                <td class="px-6 py-4">
                  <div class="flex flex-wrap gap-1">
                    {#each system.features as f}
                      <span
                        class="text-[9px] bg-bg-secondary border border-border px-1.5 py-0.5 rounded text-text-secondary"
                      >
                        {f.feature.name} ({f.cost})
                      </span>
                    {/each}
                  </div>
                </td>
                <td class="px-6 py-4 text-right">
                  <div
                    class="relative inline-block text-left dropdown-container"
                  >
                    <button
                      class="text-text-dim hover:text-text-primary transition-all p-1 rounded hover:bg-bg-secondary"
                      onclick={(e) => {
                        e.stopPropagation();
                        openCreditSystemMenuId =
                          openCreditSystemMenuId === system.id
                            ? null
                            : system.id;
                        openFeatureMenuId = null;
                      }}
                    >
                      <DotsThree size={16} weight="duotone" />
                    </button>
                    {#if openCreditSystemMenuId === system.id}
                      <div
                        class="absolute right-0 mt-2 w-40 bg-bg-card border border-border z-[100] py-1 rounded shadow-sm"
                        transition:fade={{ duration: 100 }}
                        onclick={(e) => e.stopPropagation()}
                      >
                        <button
                          class="w-full text-left px-4 py-2 text-[11px] text-text-secondary hover:bg-bg-secondary flex items-center gap-2"
                          onclick={() => {
                            editingCreditSystemId = system.id;
                            showEditCSModal = true;
                            openCreditSystemMenuId = null;
                          }}
                        >
                          <Pencil size={12} weight="duotone" /> Edit
                        </button>
                        <button
                          class="w-full text-left px-4 py-2 text-[11px] text-text-secondary hover:bg-bg-secondary flex items-center gap-2"
                          onclick={() => copyCreditSystemText(system.slug)}
                        >
                          <Copy size={12} weight="fill" /> Copy Slug
                        </button>
                        <button
                          class="w-full text-left px-4 py-2 text-[11px] text-error hover:bg-error-bg flex items-center gap-2"
                          onclick={() => deleteCreditSystem(system.id)}
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
  </section>
</div>

<CreateFeatureModal
  isOpen={showCreateModal}
  {organizationId}
  onclose={() => (showCreateModal = false)}
onsuccess={handleFeatureCreated}
/>

<EditFeatureModal
  bind:isOpen={showEditFeatureModal}
  bind:feature={editingFeature}
  onclose={() => {
    showEditFeatureModal = false;
    editingFeature = null;
  }}
  onsuccess={handleFeatureUpdated}
/>


<EditCreditSystemModal
  isOpen={showEditCSModal}
  bind:creditSystemId={editingCreditSystemId}
  {organizationId}
  onclose={() => {
    showEditCSModal = false;
    editingCreditSystemId = "";
  }}
  onsuccess={handleFeatureCreated}
/>

<CreateCreditSystemModal
  bind:isOpen={showCreateCSModal}
  {organizationId}
  onclose={() => {
    showCreateCSModal = false;
  }}
  onsuccess={handleFeatureCreated}
/>
