<script lang="ts">
  import {
    BatteryMedium,
    Cube,
    Database,
    MagnifyingGlass,
    Plus,
    ToggleLeft,
  } from "phosphor-svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";

  let {
    open = false,
    features = [],
    planFeatureIds = [],
    isSaving = false,
    onClose = () => {},
    onAttachFeature = (_featureId: string) => {},
    onCreateFeature = () => {},
  }: {
    open?: boolean;
    features?: any[];
    planFeatureIds?: string[];
    isSaving?: boolean;
    onClose?: () => void;
    onAttachFeature?: (featureId: string) => void;
    onCreateFeature?: () => void;
  } = $props();

  let searchQuery = $state("");

  $effect(() => {
    if (!open) {
      searchQuery = "";
    }
  });

  function getFeatureIconComponent(type: string) {
    switch (type) {
      case "boolean":
        return ToggleLeft;
      case "metered":
        return BatteryMedium;
      case "static":
      default:
        return Database;
    }
  }

  function getAttachableFeatures() {
    const attachedIds = new Set(planFeatureIds);
    const query = searchQuery.toLowerCase();

    return features.filter((feature: any) => {
      const alreadyAttached = attachedIds.has(feature.id);
      const matchesQuery =
        feature.name.toLowerCase().includes(query) ||
        feature.slug.toLowerCase().includes(query);

      return !alreadyAttached && matchesQuery;
    });
  }

  function handleClose() {
    searchQuery = "";
    onClose();
  }
</script>

<SidePanel
  open={open}
  title="Add Feature"
  onclose={handleClose}
  width="max-w-sm"
>
  <div class="flex flex-col h-full">
    <div class="p-3 border-b border-border bg-bg-secondary/30 shrink-0">
      <div class="relative">
        <MagnifyingGlass
          size={14}
          class="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
        />
        <input
          type="text"
          placeholder="Search features..."
          bind:value={searchQuery}
          class="w-full bg-bg-card border border-border rounded-lg pl-9 pr-3 py-2 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent transition-colors"
        />
      </div>
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      {#if getAttachableFeatures().length === 0}
        <div class="p-8 flex flex-col items-center justify-center text-center">
          <div class="w-10 h-10 bg-bg-secondary rounded-xl flex items-center justify-center mb-3">
            <Cube size={20} class="text-text-dim" weight="duotone" />
          </div>
          <p class="text-xs font-medium text-text-primary mb-1">
            No features available
          </p>
          <p class="text-[10px] text-text-dim">
            All features are already attached
          </p>
        </div>
      {:else}
        {#each getAttachableFeatures() as feature (feature.id)}
          {@const IconComponent = getFeatureIconComponent(feature.type)}
          <button
            class="group flex items-center gap-2.5 px-3 py-2.5 hover:bg-bg-secondary/50 transition-all text-left w-full disabled:opacity-50"
            onclick={() => onAttachFeature(feature.id)}
            disabled={isSaving}
          >
            <div
              class="w-7 h-7 rounded-lg bg-bg-secondary border border-border flex items-center justify-center shrink-0 transition-all group-hover:border-accent/30 group-hover:bg-bg-tertiary"
            >
              <IconComponent
                size={13}
                class="text-text-secondary group-hover:text-accent transition-colors"
                weight="fill"
              />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium text-text-primary truncate group-hover:text-accent transition-colors">
                {feature.name}
              </div>
              <div class="text-[10px] text-text-dim font-mono truncate capitalize">
                {feature.type} &middot; {feature.slug}
              </div>
            </div>
            <div class="w-5 h-5 rounded-full border border-border shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Plus size={10} class="text-text-dim" weight="bold" />
            </div>
          </button>
        {/each}
      {/if}
    </div>

    <div class="p-3 border-t border-border bg-bg-secondary/30 shrink-0">
      <button
        class="w-full flex items-center gap-2.5 px-3 py-2.5 bg-bg-card border border-border border-dashed rounded-lg text-text-muted hover:text-text-primary hover:border-text-dim hover:bg-bg-secondary/50 transition-all text-left group"
        onclick={onCreateFeature}
      >
        <div class="w-7 h-7 rounded-lg bg-bg-secondary border border-border flex items-center justify-center shrink-0 group-hover:border-text-dim transition-colors">
          <Plus size={13} weight="bold" class="text-text-dim group-hover:text-text-primary" />
        </div>
        <span class="text-xs font-medium">Create new feature</span>
      </button>
    </div>
  </div>
</SidePanel>
