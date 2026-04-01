<script lang="ts">
  import { CheckCircle, Lightning } from "phosphor-svelte";
  import ProgressBar from "$lib/components/ui/ProgressBar.svelte";

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
  const progressValue = $derived(
    showsProgress ? Math.max(0, item.balance || 0) : 0,
  );
  const progressMax = $derived(
    showsProgress ? Math.max(1, item.limit || 0) : 1,
  );
</script>

<div class="flex flex-col gap-3 py-3 border-b border-border/40 last:border-0">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <h3 class="text-[13px] font-medium text-text-primary">
        {item.featureName}
      </h3>
    </div>

    <div class="flex items-center gap-2 text-[13px] text-text-primary">
      {#if isBoolean}
        <CheckCircle size={14} class="text-success" weight="fill" />
        <span>Enabled</span>
      {:else}
        <Lightning size={14} class="text-accent" weight="fill" />
        <span class="font-medium">{formatNumber(item.balance)} left</span>
      {/if}
    </div>
  </div>

  {#if showsProgress}
    <div class="flex items-center gap-4">
      <div
        class="w-full bg-bg-secondary rounded-full h-2 overflow-hidden opacity-60"
      >
        <div
          class="bg-accent h-full rounded-full"
          style="width: {(progressValue / progressMax) * 100}%"
        ></div>
      </div>
      <div class="text-[10px] text-text-dim shrink-0 whitespace-nowrap">
        {formatNumber(item.balance)} / {formatNumber(item.limit)}
        {#if item.isTrialLimit}
          <span class="text-info ml-1">(trial)</span>
        {/if}
      </div>
    </div>
  {/if}
</div>
