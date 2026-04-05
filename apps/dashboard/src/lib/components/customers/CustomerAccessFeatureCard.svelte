<script lang="ts">
  import { CheckCircle, Lightning } from "phosphor-svelte";

  let {
    item,
  }: {
    item: {
      featureId: string;
      featureName: string;
      featureType: string;
      unit?: string | null;
      planName?: string | null;
      planLimitValue?: number | null;
      planTrialLimitValue?: number | null;
      planResetInterval?: string | null;
      entitlementLimitValue?: number | null;
      entitlementResetInterval?: string | null;
      entitlementExpiresAt?: number | null;
      entitlementSource?: "plan" | "manual";
      grantedReason?: string | null;
      balance?: number | null;
      limit?: number | null;
      isTrialing?: boolean;
      isTrialLimit?: boolean;
      rolloverBalance?: number;
      addonBalance?: number | null;
    };
  } = $props();

  function formatNumber(value: number | null | undefined) {
    if (value == null) return "Unlimited";
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toLocaleString();
  }

  const isMetered = $derived(item.featureType === "metered");
  const isBoolean = $derived(item.featureType === "boolean");
  const showsProgress = $derived(
    isMetered &&
      item.limit !== null &&
      item.limit !== undefined &&
      item.balance !== null &&
      item.balance !== undefined,
  );
  
  // Calculate width based on balance / limit. 
  // If balance > limit, cap at 100%. If 0, cap at 0%.
  const progressPercent = $derived(
    showsProgress 
      ? Math.min(100, Math.max(0, ((item.limit || 0) - (item.balance || 0)) / (item.limit || 1) * 100)) 
      : 0
  );
</script>

<div class="flex flex-col gap-1.5 py-4 border-b border-border/40 last:border-0">
  <div class="flex items-center justify-between mb-1">
    <div class="flex items-center gap-2">
      <h3 class="text-sm font-bold text-text-primary">
        {item.featureName}
      </h3>
      {#if item.isTrialLimit}
        <span class="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500 text-[9px] font-bold uppercase tracking-widest">Trial</span>
      {/if}
    </div>

    <div class="flex items-center gap-1.5 text-text-primary">
      {#if isBoolean}
        <CheckCircle size={16} class="text-blue-500" weight="fill" />
        <span class="text-sm font-medium">Enabled</span>
      {:else}
        <Lightning size={16} class="text-accent" weight="fill" />
        <span class="text-sm font-medium">{formatNumber(item.balance)} <span class="text-sm font-normal text-text-primary">left</span></span>
      {/if}
    </div>
  </div>

  {#if showsProgress}
    <div class="flex flex-col gap-2">
      <div
        class="w-full bg-accent/20 rounded-full h-2 overflow-hidden"
      >
        <div
          class="bg-accent h-full rounded-full transition-all"
          style="width: {progressPercent}%"
        ></div>
      </div>
      <div class="text-[11px] text-text-dim text-right font-medium tracking-wide">
        {formatNumber(item.balance)} / {formatNumber(item.limit)}
      </div>
    </div>
  {/if}
</div>
