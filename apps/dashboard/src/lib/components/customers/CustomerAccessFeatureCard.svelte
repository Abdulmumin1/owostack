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
      ? Math.min(
          100,
          Math.max(0, ((item.balance || 0) / (item.limit || 1)) * 100),
        )
      : 0,
  );
</script>

<div class="flex gap-2 py-2 border-b border-border/40 last:border-0">
  <div class="flex items-center justify-between mb-1">
    <div class="flex items-center gap-2">
      <h3 class="text-sm font-normal text-text-primary items-center">
        {item.featureName}
        <span class="text-xs text-text-muted"> / {item.planResetInterval}</span>
      </h3>
    </div>
  </div>

  {#if showsProgress}
    <div class="flex gap-2 flex-1 items-center">
      <div class="w-full flex-1 bg-accent/20 rounded-full h-2 overflow-hidden">
        <div
          class="bg-accent h-full rounded-full transition-all"
          style="width: {progressPercent}%"
        ></div>
      </div>
      <div
        class="text-[11px] text-text-dim text-right font-medium tracking-wide"
      >
        {formatNumber(item.balance)} / {formatNumber(item.limit)}
      </div>
      {#if item.isTrialLimit}
        <span
          class="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500 text-[9px] font-bold uppercase tracking-widest"
          >Trial</span
        >
      {/if}
    </div>
  {/if}
</div>
