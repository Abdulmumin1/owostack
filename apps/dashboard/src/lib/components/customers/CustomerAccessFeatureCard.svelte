<script lang="ts">
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
      planBalance?: number | null;
      limit?: number | null;
      manualBonusLimit?: number | null;
      manualBonusBalance?: number | null;
      totalBalance?: number | null;
      totalLimit?: number | null;
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
  const displayBalance = $derived(item.totalBalance ?? item.balance ?? null);
  const displayLimit = $derived(item.totalLimit ?? item.limit ?? null);
  const showsProgress = $derived(
    isMetered &&
      displayLimit !== null &&
      displayLimit !== undefined &&
      displayBalance !== null &&
      displayBalance !== undefined,
  );

  // Calculate width based on balance / limit.
  // If balance > limit, cap at 100%. If 0, cap at 0%.
  const progressPercent = $derived(
    showsProgress
      ? Math.min(
          100,
          Math.max(0, ((displayBalance || 0) / (displayLimit || 1)) * 100),
        )
      : 0,
  );
</script>

<div class="py-3 border-b border-border/40 last:border-0">
  <div class="flex items-center justify-between mb-2">
    <div class="flex items-center gap-2">
      <h3 class="text-sm font-normal text-text-primary items-center">
        {item.featureName}
        <span class="text-xs text-text-muted"> / {item.planResetInterval}</span>
      </h3>
    </div>
  </div>

  {#if showsProgress}
    <div class="flex gap-2 items-center">
      <div class="w-full flex-1 bg-accent/20 rounded-full h-2 overflow-hidden">
        <div
          class="bg-accent h-full rounded-full transition-all"
          style="width: {progressPercent}%"
        ></div>
      </div>
      <div
        class="text-[11px] text-text-dim text-right font-medium tracking-wide"
      >
        {formatNumber(displayBalance)} / {formatNumber(displayLimit)}
      </div>
      {#if item.isTrialLimit}
        <span
          class="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500 text-[9px] font-bold uppercase tracking-widest"
          >Trial</span
        >
      {/if}
    </div>
  {/if}

  {#if isMetered && ((item.manualBonusBalance ?? 0) > 0 || (item.addonBalance ?? 0) > 0)}
    <div class="mt-2 flex flex-wrap gap-2 text-[10px] text-text-dim">
      <span class="rounded-full bg-bg-secondary px-2 py-1">
        Plan {formatNumber(item.planBalance ?? item.balance)} / {formatNumber(item.limit)}
      </span>
      {#if (item.manualBonusBalance ?? 0) > 0}
        <span class="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-500">
          Bonus {formatNumber(item.manualBonusBalance)}
        </span>
      {/if}
      {#if (item.addonBalance ?? 0) > 0}
        <span class="rounded-full bg-accent/10 px-2 py-1 text-accent">
          Add-on {formatNumber(item.addonBalance)}
        </span>
      {/if}
    </div>
  {/if}
</div>
