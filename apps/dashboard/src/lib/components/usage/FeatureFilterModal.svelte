<script lang="ts">
  import { MagnifyingGlass, Check, Cube, Lightning } from "phosphor-svelte";
  import Modal from "$lib/components/ui/Modal.svelte";

  let {
    open = $bindable(false),
    features = [],
    selectedId = $bindable(""),
    onSelect,
  }: {
    open: boolean;
    features: Array<{ id: string; name: string; type?: string }>;
    selectedId: string;
    onSelect?: (id: string, name: string) => void;
  } = $props();

  let searchQuery = $state("");
  let wasOpen = $state(false);

  $effect(() => {
    if (open && !wasOpen) {
      searchQuery = "";
    }
    wasOpen = open;
  });

  const filteredFeatures = $derived(
    features.filter((f) => {
      const q = searchQuery.toLowerCase();
      return f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q);
    })
  );

  function selectFeature(feature: { id: string; name: string } | null) {
    if (feature) {
      selectedId = feature.id;
      if (onSelect) onSelect(feature.id, feature.name);
    } else {
      selectedId = "";
      if (onSelect) onSelect("", "All Features");
    }
    open = false;
  }

  function getFeatureIcon(type?: string) {
    return type === "metered" ? Lightning : Cube;
  }
</script>

<Modal
  bind:open
  title="Select Feature"
  width="max-w-sm"
  onclose={() => (open = false)}
>
  <div class="p-3 border-b border-border bg-bg-secondary/30">
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

  <div class="flex flex-col max-h-[60vh] overflow-y-auto">
    <!-- All Features Option -->
    <button
      class="group flex items-center gap-2.5 px-3 py-2.5 hover:bg-bg-secondary/50 transition-all text-left border-b border-border/50 {selectedId ===
      ''
        ? 'bg-accent/5'
        : ''}"
      onclick={() => selectFeature(null)}
    >
      <div
        class="w-7 h-7 rounded-lg bg-bg-tertiary border border-border flex items-center justify-center shrink-0 transition-colors group-hover:border-accent/30"
      >
        <Cube size={14} class="text-text-dim" weight="duotone" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-xs font-semibold text-text-primary">All Features</div>
        <div class="text-[10px] text-text-dim">Aggregate view</div>
      </div>
      {#if selectedId === ""}
        <div
          class="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0"
        >
          <Check size={10} class="text-accent-contrast" weight="bold" />
        </div>
      {/if}
    </button>

    {#if filteredFeatures.length === 0}
      <div class="p-8 flex flex-col items-center justify-center text-center">
        <div
          class="w-10 h-10 bg-bg-secondary rounded-xl flex items-center justify-center mb-3"
        >
          <Cube size={20} class="text-text-dim" weight="duotone" />
        </div>
        <p class="text-xs font-medium text-text-primary mb-1">
          No features found
        </p>
        <p class="text-[10px] text-text-dim">
          {searchQuery ? "Try a different search" : "No features available"}
        </p>
      </div>
    {:else}
      <div class="py-1">
        {#each filteredFeatures as feat, i (feat.id)}
          {@const Icon = getFeatureIcon(feat.type)}
          <button
            class="group flex items-center gap-2.5 px-3 py-2 hover:bg-bg-secondary/50 transition-all text-left w-full {selectedId ===
            feat.id
              ? 'bg-accent/5'
              : ''}"
            onclick={() => selectFeature(feat)}
          >
            <div
              class="w-7 h-7 rounded-lg bg-bg-secondary border border-border flex items-center justify-center shrink-0 transition-all group-hover:border-accent/30 group-hover:bg-bg-tertiary"
            >
              <Icon
                size={13}
                class={selectedId === feat.id
                  ? "text-accent"
                  : "text-text-secondary"}
                weight="fill"
              />
            </div>
            <div class="flex-1 min-w-0">
              <div
                class="text-xs font-medium text-text-primary truncate group-hover:text-accent transition-colors"
              >
                {feat.name}
              </div>
              <div class="text-[10px] text-text-dim font-mono truncate">
                {feat.id}
              </div>
            </div>
            {#if selectedId === feat.id}
              <div
                class="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0"
              >
                <Check size={10} class="text-accent-contrast" weight="bold" />
              </div>
            {:else}
              <div
                class="w-5 h-5 rounded-full border border-border shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              ></div>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Quick Stats Footer -->
  <div class="px-3 py-2 border-t border-border bg-bg-secondary/30">
    <div class="flex items-center justify-between text-[10px] text-text-dim">
      <span>{filteredFeatures.length} feature{filteredFeatures.length !== 1 ? 's' : ''}</span>
      <span class="font-mono">{selectedId ? '1 selected' : 'All selected'}</span>
    </div>
  </div>
</Modal>
