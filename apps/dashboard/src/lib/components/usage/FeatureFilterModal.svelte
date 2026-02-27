<script lang="ts">
  import { MagnifyingGlass, Check, CaretDown, Cube } from "phosphor-svelte";
  import Modal from "$lib/components/ui/Modal.svelte";

  let {
    open = $bindable(false),
    features = [],
    selectedId = $bindable(""),
    onSelect,
  } = $props<{
    open: boolean;
    features: Array<{ id: string; name: string }>;
    selectedId: string;
    onSelect?: (id: string) => void;
  }>();

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
    }),
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
</script>

<Modal
  bind:open
  title="Select Feature"
  width="max-w-md"
  onclose={() => (open = false)}
>
  <div class="px-5 py-3 border-b border-border bg-bg-card sticky top-0 z-10">
    <div class="input-icon-wrapper w-full">
      <MagnifyingGlass size={14} class="input-icon-left text-text-dim" />
      <input
        type="text"
        placeholder="Filter features..."
        bind:value={searchQuery}
        class="input input-has-icon-left"
      />
    </div>
  </div>

  <div class="flex flex-col min-h-[360px] max-h-[50vh] overflow-y-auto">
    <!-- All Features -->
    <button
      class="w-full flex items-center gap-3 px-5 py-3 border-b border-border border-b-2 hover:bg-bg-secondary transition-colors text-left {selectedId ===
      ''
        ? 'bg-bg-secondary sticky top-0 z-20 shadow-sm'
        : ''}"
      onclick={() => selectFeature(null)}
    >
      <div
        class="w-8 h-8 rounded-md bg-bg-tertiary flex items-center justify-center border border-border"
      >
        <Cube size={16} class="text-text-dim" weight="duotone" />
      </div>
      <div class="flex-1">
        <div class="text-sm font-bold text-text-primary">All Features</div>
        <div
          class="text-[10px] text-text-dim font-mono uppercase tracking-widest"
        >
          Aggregate usage
        </div>
      </div>
      {#if selectedId === ""}
        <Check size={16} class="text-accent" weight="bold" />
      {/if}
    </button>

    {#if filteredFeatures.length === 0}
      <div
        class="p-12 flex flex-col items-center justify-center text-center flex-1"
      >
        <div
          class="w-12 h-12 bg-bg-secondary flex items-center justify-center mb-4 rounded-md"
        >
          <Cube size={24} class="text-text-dim" weight="duotone" />
        </div>
        <h3
          class="text-xs font-bold text-text-primary uppercase tracking-widest mb-1"
        >
          No matching features
        </h3>
        <p class="text-[10px] text-text-dim uppercase tracking-widest max-w-sm">
          Try a different search term
        </p>
      </div>
    {:else}
      <div class="flex-1">
        {#each filteredFeatures as feat}
          <button
            class="w-full flex items-center gap-3 px-5 py-3 border-b border-border hover:bg-bg-card-hover transition-colors text-left {selectedId ===
            feat.id
              ? 'bg-bg-card-hover'
              : ''}"
            onclick={() => selectFeature(feat)}
          >
            <!-- Custom feature icon or just cube -->
            <div
              class="w-8 h-8 rounded-md bg-bg-secondary flex items-center justify-center border border-border shrink-0"
            >
              <Cube size={14} class="text-text-secondary" weight="fill" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-bold text-text-primary truncate">
                {feat.name}
              </div>
              <div class="text-[10px] text-text-dim font-mono truncate">
                {feat.id}
              </div>
            </div>
            {#if selectedId === feat.id}
              <Check size={16} class="text-accent shrink-0" weight="bold" />
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</Modal>
