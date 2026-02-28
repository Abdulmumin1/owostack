<script lang="ts">
  import { ArrowRight, Buildings, Plus, CaretRight } from "phosphor-svelte";
  import { organization } from "$lib/auth-client";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import CreateOrganizationModal from "$lib/components/dashboard/CreateOrganizationModal.svelte";
  import { fade, fly } from "svelte/transition";

  let { data } = $props();
  let orgs = $derived(data.organizations || []);
  let showCreateModal = $state(false);
  let isLoading = $state(false);
</script>

<svelte:head>
  <title>Organizations - Owostack</title>
</svelte:head>

<div class="w-full max-w-3xl mx-auto px-6 pt-12">
  <!-- Minimal Header -->
  <header
    class="flex items-center justify-between mb-12"
    in:fade={{ duration: 400 }}
  >
    <div>
      <h1 class="text-sm font-bold text-text-primary uppercase tracking-widest">
        Organizations
      </h1>
    </div>

    <button
      class="btn btn-primary px-3 py-1.5 text-[11px] flex items-center gap-1.5 shadow-none hover:shadow-none"
      onclick={() => (showCreateModal = true)}
    >
      <Plus size={14} weight="bold" />
      <span>New</span>
    </button>
  </header>

  {#if isLoading}
    <div class="space-y-2">
      {#each Array(4) as _}
        <div
          class="h-16 border border-border bg-bg-card p-4 flex items-center gap-4"
        >
          <Skeleton class="w-8 h-8 rounded" />
          <div class="space-y-2 flex-1">
            <Skeleton class="h-3 w-32 rounded" />
            <Skeleton class="h-2 w-20 rounded" />
          </div>
        </div>
      {/each}
    </div>
  {:else if orgs.length > 0}
    <!-- Flat Linear List -->
    <div
      class="space-y-[1px] bg-border border border-border rounded-sm overflow-hidden"
      in:fade={{ duration: 400 }}
    >
      {#each orgs as org, i (org.id)}
        <a
          href="/{org.slug}/plans"
          class="group flex items-center justify-between p-5 bg-bg-card hover:bg-bg-card-hover transition-colors"
        >
          <div class="flex items-center gap-5">
            <div
              class="w-10 h-10 flex items-center justify-center bg-bg-secondary text-text-dim group-hover:bg-accent/10 group-hover:text-accent transition-colors"
            >
              <Buildings size={20} weight="duotone" />
            </div>
            <div>
              <h3
                class="text-sm font-bold text-text-primary group-hover:text-accent transition-colors"
              >
                {org.name}
              </h3>
              <p class="text-[10px] text-text-dim font-mono mt-0.5">
                {org.slug}
              </p>
            </div>
          </div>

          <div
            class="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-text-dim opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0"
          >
            <span>Open</span>
            <CaretRight size={12} weight="bold" />
          </div>
        </a>
      {/each}

      <button
        onclick={() => (showCreateModal = true)}
        class="w-full p-4 bg-bg-card hover:bg-bg-card-hover border-t border-border flex items-center justify-center gap-2 group transition-colors italic"
      >
        <Plus
          size={14}
          class="text-text-dim group-hover:text-accent transition-colors"
        />
        <span class="text-xs text-text-dim group-hover:text-accent"
          >Add another organization</span
        >
      </button>
    </div>
  {:else}
    <!-- Minimal Empty State -->
    <div
      class="py-20 flex flex-col items-center text-center border border-dashed border-border-strong rounded-sm"
      in:fade={{ duration: 600 }}
    >
      <div
        class="w-12 h-12 bg-bg-secondary flex items-center justify-center mb-6 text-text-dim"
      >
        <Buildings size={24} weight="duotone" />
      </div>

      <h2
        class="text-sm font-bold text-text-primary mb-2 uppercase tracking-tight"
      >
        No organizations found
      </h2>
      <p class="text-text-dim text-xs mb-8 max-w-xs leading-relaxed">
        Get started by creating your first workspace.
      </p>

      <button
        class="btn btn-primary px-6 py-2 text-xs shadow-none hover:shadow-none"
        onclick={() => (showCreateModal = true)}
      >
        <Plus size={16} weight="bold" />
        <span>Create your first organization</span>
      </button>
    </div>
  {/if}
</div>

<CreateOrganizationModal bind:open={showCreateModal} />
