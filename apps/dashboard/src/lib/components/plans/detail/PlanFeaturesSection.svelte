<script lang="ts">
  import {
    CaretDown,
    BatteryHigh,
    PackageIcon,
    PlusIcon,
    Sliders,
    Trash,
    Circle,
    CheckCircle,
    Infinity as InfinityIcon,
    Clock,
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

  function getPricingData(planFeature: any) {
    const currencyCode = plan?.currency || $defaultCurrency;
    const ratingModel = planFeature.ratingModel || "package";
    const billingUnits = planFeature.billingUnits || 1;
    const unitPrice =
      planFeature.usageModel === "usage_based"
        ? planFeature.pricePerUnit
        : (planFeature.overagePrice ?? planFeature.pricePerUnit);

    const unitLabel = (planFeature.feature?.unit || "unit").toUpperCase();
    const interval =
      planFeature.resetInterval && planFeature.resetInterval !== "none"
        ? planFeature.resetInterval.replace("ly", "").toUpperCase()
        : null;

    const trialLimitValue =
      planFeature.trialLimitValue ?? planFeature.trial_limit_value;

    if (planFeature.feature?.type === 'boolean') {
      return {
        value: "",
        suffix: "INCLUDED",
        details: "",
        interval,
        trial: null,
        color: "text-blue-500 bg-blue-500/5 border-blue-500/10",
        numColor: "text-blue-500"
      };
    }

    if (planFeature.usageModel === "usage_based") {
      return {
        value: "PRICED",
        suffix: "",
        details: unitPrice != null ? `${formatCurrency(unitPrice, currencyCode)} / ${billingUnits} ${unitLabel}` : ratingModel.toUpperCase(),
        interval,
        trial: null,
        color: "text-purple-500 bg-purple-500/5 border-purple-500/10",
        numColor: "text-purple-500"
      };
    }

    if (planFeature.overage === "charge" && unitPrice != null) {
      const limit = planFeature.limitValue ?? 0;
      return {
        value: limit.toString(),
        suffix: `INCLUDED + OVERAGE`,
        details: `${formatCurrency(unitPrice, currencyCode)} / ${billingUnits} ${unitLabel}`,
        interval,
        trial: trialLimitValue != null ? trialLimitValue.toString() : null,
        color: "text-pink-500 bg-pink-500/5 border-pink-500/10",
        numColor: "text-pink-500"
      };
    }

    if (planFeature.limitValue === null) {
      return {
        value: "UNLIMITED",
        suffix: `INCLUDED`,
        details: "",
        interval,
        trial: trialLimitValue != null ? trialLimitValue.toString() : null,
        color: "text-cyan-500 bg-cyan-500/5 border-cyan-500/10",
        numColor: "text-cyan-500"
      };
    }

    return {
      value: planFeature.limitValue.toString(),
      suffix: `${unitLabel} INCLUDED`,
      details: "",
      interval,
      trial: trialLimitValue != null ? trialLimitValue.toString() : null,
      color: "text-indigo-500 bg-indigo-500/5 border-indigo-500/10",
      numColor: "text-indigo-500"
    };
  }
</script>

<section class="space-y-3">
  <div class="flex items-center justify-between px-1">
    <h2
      class="text-[11px] font-bold text-text-dim uppercase tracking-wider flex items-center gap-2"
    >
      <PackageIcon class="text-text-dim" size={14} weight="bold" /> Attached Features
    </h2>

    <button class="btn btn-primary btn-sm gap-1.5" onclick={onAddFeature}>
      <PlusIcon size={14} weight="bold" /> Add Feature
    </button>
  </div>

  <div
    class="bg-bg-card border border-border divide-y divide-border/40 rounded-xl overflow-hidden"
  >
    {#if plan.planFeatures && plan.planFeatures.length > 0}
      {#each plan.planFeatures as planFeature}
        {@const creditSystem = creditSystems.find(
          (system: any) => system.id === planFeature.featureId,
        )}
        {#if creditSystem}
          <div class="group transition-all duration-200">
            <div class="px-3 py-2.5 flex items-center justify-between">
              <button
                class="flex items-center gap-3 flex-1 text-left min-w-0"
                onclick={() => onToggleCreditSystem(creditSystem.id)}
              >
                <div
                  class="w-7 h-7 bg-warning/5 border border-warning/10 flex items-center justify-center rounded-lg text-warning shrink-0"
                >
                  <PackageIcon size={14} weight="fill" />
                </div>

                <div class="flex flex-col min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-bold text-text-primary truncate">
                      {creditSystem.name}
                    </span>
                    <div
                      class="px-1.5 py-0.5 rounded-full bg-warning/10 border border-warning/20 text-[9px] font-bold text-warning uppercase tracking-tight"
                    >
                      Credit Pool
                    </div>
                  </div>
                  <div
                    class="flex items-center gap-1.5 mt-0.5 text-[10px] text-text-muted font-medium"
                  >
                    {#if planFeature.limitValue === null}
                      <InfinityIcon size={10} /> Unlimited Pool
                    {:else}
                      {planFeature.limitValue} units included
                    {/if}
                    <CaretDown
                      size={10}
                      class="transition-transform duration-200 {expandedCreditSystems.includes(
                        creditSystem.id,
                      )
                        ? 'rotate-180'
                        : ''}"
                    />
                  </div>
                </div>
              </button>

              <div
                class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0"
              >
                <button
                  class="p-1.5 text-text-dim hover:text-text-primary hover:bg-bg-secondary rounded-md transition-colors"
                  onclick={() => onOpenConfig(planFeature)}
                  title="Configure"
                >
                  <Sliders size={14} weight="duotone" />
                </button>
                <button
                  class="p-1.5 text-text-dim hover:text-error hover:bg-error-bg/10 rounded-md transition-colors"
                  onclick={() => onDetachFeature(planFeature.id)}
                  title="Remove"
                >
                  <Trash size={14} weight="bold" />
                </button>
              </div>
            </div>

            {#if expandedCreditSystems.includes(creditSystem.id)}
              <div
                class="px-3 pb-3 ml-10 flex flex-col gap-1"
                transition:slide={{ duration: 200 }}
              >
                {#if creditSystem.features && creditSystem.features.length > 0}
                  <div
                    class="bg-bg-secondary/50 rounded-lg border border-border/40 p-2 space-y-1"
                  >
                    {#each creditSystem.features as linkedFeature}
                      <div
                        class="flex items-center justify-between py-1 px-2 rounded-md hover:bg-bg-secondary transition-colors"
                      >
                        <div class="flex items-center gap-2 min-w-0">
                          <Circle
                            size={6}
                            weight="fill"
                            class="text-warning/60 shrink-0"
                          />
                          <span
                            class="text-[11px] text-text-secondary truncate"
                          >
                            {linkedFeature.feature?.name ||
                              linkedFeature.featureId}
                          </span>
                        </div>
                        <span
                          class="text-[10px] font-bold text-text-dim shrink-0"
                        >
                          {linkedFeature.cost} units
                        </span>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <div class="text-[10px] text-text-dim italic px-2">
                    No connected features
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {:else}
          {@const pricing = getPricingData(planFeature)}
          <div
            class="group px-3 py-2 flex items-center justify-between hover:bg-bg-card-hover/30 transition-all duration-200"
          >
            <div class="flex items-center gap-3 min-w-0 flex-1">
              <div class="w-7 h-7 flex items-center justify-center rounded-lg border transition-all shrink-0
                {planFeature.feature?.type === 'boolean' ? 'bg-blue-500/5 border-blue-500/10 text-blue-500' : 'bg-purple-500/5 border-purple-500/10 text-purple-500'}">
                {#if planFeature.feature?.type === "boolean"}
                  <CheckCircle size={14} weight="duotone" />
                {:else}
                  <BatteryHigh size={14} weight="duotone" />
                {/if}
              </div>

              <div class="flex flex-col min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs font-bold text-text-primary truncate">
                    {planFeature.feature?.name}
                  </span>

                  <div class="flex items-center gap-1 uppercase tracking-tight">
                    <div class="px-1.5 py-0.5 rounded-full {pricing.color} border text-[9px] font-bold flex items-center gap-1.5">
                      {#if pricing.value}
                        <span class={pricing.numColor}>{pricing.value}</span>
                      {/if}
                      <span>{pricing.suffix}</span>
                      
                      {#if pricing.interval}
                        <div class="flex items-center gap-1 pl-1.5 border-l border-current/20">
                          <Clock size={10} weight="bold" class="opacity-70" />
                          <span>{pricing.interval}</span>
                        </div>
                      {/if}
                    </div>

                    {#if pricing.trial}
                      <div class="px-1.5 py-0.5 rounded-full bg-rose-500/5 border border-rose-500/10 text-[9px] font-bold text-rose-500 flex items-center gap-1.5">
                        <span class="text-rose-600">{pricing.trial}</span>
                        <span>TRIAL GRANT</span>
                      </div>
                    {/if}
                    
                    {#if pricing.details}
                      <div class="px-1.5 py-0.5 rounded-full bg-bg-secondary border border-border text-[9px] font-bold text-text-dim">
                        {pricing.details}
                      </div>
                    {/if}
                  </div>
                </div>
              </div>
            </div>

            <div
              class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0"
            >
              <button
                class="p-1.5 text-text-dim hover:text-text-primary hover:bg-bg-secondary rounded-md transition-colors"
                onclick={() => onOpenConfig(planFeature)}
                title="Configure"
              >
                <Sliders size={14} weight="duotone" />
              </button>
              <button
                class="p-1.5 text-text-dim hover:text-error hover:bg-error-bg/10 rounded-md transition-colors"
                onclick={() => onDetachFeature(planFeature.id)}
                title="Remove"
              >
                <Trash size={14} weight="bold" />
              </button>
            </div>
          </div>
        {/if}
      {/each}
    {:else}
      <div class="py-8 px-4 text-center">
        <div
          class="w-10 h-10 bg-bg-secondary rounded-full flex items-center justify-center mx-auto mb-3"
        >
          <PackageIcon size={20} class="text-text-dim" />
        </div>
        <p class="text-[11px] font-bold text-text-dim uppercase tracking-wider">
          No features attached
        </p>
        <p class="text-[10px] text-text-muted mt-1">
          Add features to this plan to define its capabilities.
        </p>
      </div>
    {/if}
  </div>
</section>