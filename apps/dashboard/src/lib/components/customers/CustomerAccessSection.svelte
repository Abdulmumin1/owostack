<script lang="ts">
  import { ShieldCheck, Folder } from "phosphor-svelte";
  import CustomerAccessFeatureCard from "./CustomerAccessFeatureCard.svelte";
  import CustomerEntitlementsSection from "./CustomerEntitlementsSection.svelte";

  let {
    customerId,
    items = [],
    allowedFeatureIds = null,
  }: {
    customerId: string;
    items?: any[];
    allowedFeatureIds?: string[] | null;
  } = $props();

  const allowedFeatureIdSet = $derived(
    allowedFeatureIds ? new Set(allowedFeatureIds) : null,
  );
  const visibleItems = $derived.by(() => {
    if (!allowedFeatureIdSet) return items;
    return items.filter((item) => allowedFeatureIdSet.has(item.featureId));
  });
</script>

<section class="space-y-4 pt-4">
  <div class="flex items-center gap-2">
    <Folder size={20} class="text-text-dim" weight="fill" />
    <h2 class="text-lg font-semibold text-text-primary">Entitlements</h2>
  </div>

  {#if visibleItems.length > 0}
    <div class="border border-border rounded-xl px-5 bg-bg-card shadow-none">
      {#each visibleItems as item}
        <CustomerAccessFeatureCard {item} />
      {/each}
    </div>
  {:else}
    <div
      class="rounded-lg border border-dashed border-border/50 bg-transparent px-5 py-10 text-center"
    >
      <p class="text-xs font-medium text-text-primary">
        No active entitlements to show.
      </p>
      <p class="mt-1 text-xs text-text-dim">
        This section only shows access the customer currently has, plus any live
        overrides.
      </p>
    </div>
  {/if}

  <div class="pt-6">
    <CustomerEntitlementsSection {customerId} {allowedFeatureIds} />
  </div>
</section>
