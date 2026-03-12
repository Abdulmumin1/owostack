<script lang="ts">
  import {
    CaretDown,
    Lightning,
    PackageIcon,
    PlusIcon,
    Sliders,
    Trash,
  } from "phosphor-svelte";
  import { defaultCurrency } from "$lib/stores/currency";
  import { formatCurrency } from "$lib/utils/currency";
  import { slide } from "svelte/transition";

  let {
    plan,
    creditSystems = [],
    expandedCreditSystems = [],
    onToggleCreditSystem = (_id: string) => {},
    onAddFeature = () => {},
    onOpenConfig = (_feature: any) => {},
    onDetachFeature = (_planFeatureId: string) => {},
  }: {
    plan: any;
    creditSystems?: any[];
    expandedCreditSystems?: string[];
    onToggleCreditSystem?: (id: string) => void;
    onAddFeature?: () => void;
    onOpenConfig?: (feature: any) => void;
    onDetachFeature?: (planFeatureId: string) => void;
  } = $props();

  function describeFeaturePricing(planFeature: any) {
    const currencyCode = plan?.currency || $defaultCurrency;
    const ratingModel = planFeature.ratingModel || "package";
    const billingUnits = planFeature.billingUnits || 1;
    const unitPrice =
      planFeature.usageModel === "usage_based"
        ? planFeature.pricePerUnit
        : (planFeature.overagePrice ?? planFeature.pricePerUnit);

    if (planFeature.usageModel === "usage_based") {
      if (ratingModel === "package" && unitPrice != null) {
        return `Priced · ${formatCurrency(unitPrice, currencyCode)} / ${billingUnits} ${planFeature.feature.unit || "units"}`;
      }
      return `Priced · ${ratingModel}`;
    }

    if (planFeature.overage === "charge" && unitPrice != null) {
      if (ratingModel === "package") {
        return `Included + overage · ${formatCurrency(unitPrice, currencyCode)} / ${billingUnits} ${planFeature.feature.unit || "units"}`;
      }
      return `Included + overage · ${ratingModel}`;
    }

    return `Included · ${planFeature.limitValue === null ? "Unlimited" : planFeature.limitValue} ${planFeature.feature.unit || "units"}`;
  }
</script>

<section class="space-y-4">
  <div class="flex items-center justify-between px-1 pb-2">
    <h2 class="text-sm font-semibold text-text-secondary flex items-center gap-2">
      <PackageIcon class="text-secondary" size={18} weight="fill" /> Features
    </h2>

    <button class="btn btn-primary btn-sm gap-1.5" onclick={onAddFeature}>
      <PlusIcon size={14} weight="bold" /> Add Feature
    </button>
  </div>

  <div
    class="bg-bg-card border border-border divide-y divide-border/50 rounded-lg overflow-hidden"
  >
    {#if plan.planFeatures && plan.planFeatures.length > 0}
      {#each plan.planFeatures as planFeature}
        {@const creditSystem = creditSystems.find(
          (system: any) => system.id === planFeature.featureId,
        )}
        {#if creditSystem}
          <div
            class="group hover:bg-bg-card-hover/40 transition-colors border-l-4 border-warning/50"
          >
            <div class="px-4 py-3 flex items-center justify-between">
              <button
                class="flex items-center gap-4 flex-1 text-left"
                onclick={() => onToggleCreditSystem(creditSystem.id)}
              >
                <div
                  class="w-8 h-8 bg-warning-bg border border-warning/30 flex items-center justify-center rounded-md text-warning shrink-0"
                >
                  <span class="text-base leading-none">&#9733;</span>
                </div>
                <div class="flex flex-col">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-text-primary">
                      {creditSystem.name}
                    </span>
                    <CaretDown
                      size={14}
                      class="text-text-muted transition-transform {expandedCreditSystems.includes(
                        creditSystem.id,
                      )
                        ? 'rotate-180'
                        : ''}"
                    />
                  </div>
                  <span class="text-xs text-text-muted mt-0.5">
                    Credit Pool &middot; {planFeature.limitValue === null
                      ? "Unlimited"
                      : planFeature.limitValue}
                  </span>
                </div>
              </button>
              <div
                class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <button
                  class="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors"
                  onclick={() => onOpenConfig(planFeature)}
                >
                  <Sliders size={16} weight="duotone" />
                </button>
                <button
                  class="p-2 text-text-muted hover:text-red-500 hover:bg-error-bg rounded transition-colors"
                  onclick={() => onDetachFeature(planFeature.id)}
                >
                  <Trash size={16} weight="fill" />
                </button>
              </div>
            </div>

            {#if expandedCreditSystems.includes(creditSystem.id)}
              <div class="px-4 pb-4 pl-16 flex flex-col gap-2" transition:slide>
                {#if creditSystem.features && creditSystem.features.length > 0}
                  {#each creditSystem.features as linkedFeature}
                    <div
                      class="flex items-center justify-between py-1.5 border-b border-border-light last:border-0"
                    >
                      <div class="flex items-center gap-3">
                        <div class="w-1.5 h-1.5 rounded-full bg-warning/60"></div>
                        <span class="text-sm text-text-secondary">
                          {linkedFeature.feature?.name || linkedFeature.featureId}
                        </span>
                      </div>
                      <span class="text-xs font-mono text-text-muted">
                        {linkedFeature.cost} units
                      </span>
                    </div>
                  {/each}
                {:else}
                  <span class="text-sm text-text-muted italic">
                    No connected features
                  </span>
                {/if}
              </div>
            {/if}
          </div>
        {:else}
          <div
            class="px-4 py-3 flex items-center justify-between group hover:bg-bg-card-hover transition-colors"
          >
            <div class="flex items-center gap-4">
              <div
                class="w-8 h-8 bg-bg-secondary border border-border flex items-center justify-center rounded-md text-text-muted group-hover:text-accent transition-colors shrink-0"
              >
                <Lightning size={16} weight="duotone" />
              </div>
              <div class="flex flex-col">
                <span class="text-sm font-semibold text-text-primary">
                  {planFeature.feature.name}
                </span>
                <span class="text-xs text-text-muted capitalize mt-0.5">
                  {planFeature.feature.type}
                  {#if planFeature.feature.type === "metered"}
                    &middot; {describeFeaturePricing(planFeature)}
                  {/if}
                </span>
              </div>
            </div>
            <div
              class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              {#if planFeature.feature.type === "metered"}
                <button
                  class="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors"
                  onclick={() => onOpenConfig(planFeature)}
                >
                  <Sliders size={16} weight="duotone" />
                </button>
              {/if}
              <button
                class="p-2 text-text-muted hover:text-red-500 hover:bg-error-bg rounded transition-colors"
                onclick={() => onDetachFeature(planFeature.id)}
              >
                <Trash size={16} weight="fill" />
              </button>
            </div>
          </div>
        {/if}
      {/each}
    {:else}
      <div class="p-8 text-center">
        <span class="text-sm text-text-muted">No features attached.</span>
      </div>
    {/if}
  </div>
</section>
