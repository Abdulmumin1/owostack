<script lang="ts">
  import { Barbell, CalendarDots, ChartBar, ClockCounterClockwise } from "phosphor-svelte";
  import type { UsageHistoryResult } from "owostack";

  type UsageHistorySeriesPoint = UsageHistoryResult["series"][number];
  type UsageHistoryBreakdown = UsageHistoryResult["breakdown"][number];

  let {
    usageHistory,
  }: {
    usageHistory: UsageHistoryResult | null;
  } = $props();

  function formatBucketLabel(bucket: string) {
    if (/^\d{4}-\d{2}$/.test(bucket)) {
      return new Date(`${bucket}-01T00:00:00.000Z`).toLocaleDateString(
        "en-US",
        {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        },
      );
    }

    return new Date(`${bucket}T00:00:00.000Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  const series = $derived(
    (Array.isArray(usageHistory?.series) ? usageHistory.series : []) as UsageHistorySeriesPoint[],
  );
  const breakdown = $derived(
    (Array.isArray(usageHistory?.breakdown)
      ? usageHistory.breakdown
      : []) as UsageHistoryBreakdown[],
  );
  const maxSeriesValue = $derived(
    series.length > 0
      ? Math.max(...series.map((point) => Number(point.value || 0)), 0)
      : 0,
  );
  const featureMax = $derived(
    breakdown.length > 0
      ? Math.max(
          ...breakdown.map((entry) => Number(entry.totals?.usage || 0)),
          0,
        )
      : 0,
  );
  const activeDays = $derived(
    series.filter((point) => Number(point.value || 0) > 0).length,
  );
  const activeFeatures = $derived(
    breakdown.filter((entry) => Number(entry.totals?.usage || 0) > 0).length,
  );
</script>

{#if usageHistory}
  <div class="space-y-8">
    <section class="grid grid-cols-1 md:grid-cols-4 gap-5">
      <div class="card border-white/5 space-y-2 bg-[linear-gradient(135deg,rgba(240,184,96,0.12),rgba(30,30,30,0.95))]">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">Total Usage</span>
          <ChartBar size={16} class="text-accent" />
        </div>
        <div class="text-2xl font-mono font-bold text-text-primary">
          {usageHistory.totals.usage.toLocaleString()}
        </div>
        <p class="text-[10px] text-text-muted uppercase tracking-widest">
          Last {series.length} buckets
        </p>
      </div>

      <div class="card border-white/5 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">Usage Records</span>
          <ClockCounterClockwise size={16} class="text-tertiary" />
        </div>
        <div class="text-2xl font-mono font-bold text-text-primary">
          {usageHistory.totals.records.toLocaleString()}
        </div>
        <p class="text-[10px] text-text-muted uppercase tracking-widest">
          Metered events
        </p>
      </div>

      <div class="card border-white/5 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">Active Days</span>
          <CalendarDots size={16} class="text-secondary" />
        </div>
        <div class="text-2xl font-mono font-bold text-text-primary">
          {activeDays}
        </div>
        <p class="text-[10px] text-text-muted uppercase tracking-widest">
          Days with usage
        </p>
      </div>

      <div class="card border-white/5 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">Tracked Features</span>
          <Barbell size={16} class="text-warning" />
        </div>
        <div class="text-2xl font-mono font-bold text-text-primary">
          {activeFeatures}
        </div>
        <p class="text-[10px] text-text-muted uppercase tracking-widest">
          {usageHistory.query.timezone}
        </p>
      </div>
    </section>

    <section class="card border-white/5 overflow-hidden">
      <div class="p-6 border-b border-white/5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 class="text-base font-semibold text-text-primary">Usage Timeline</h2>
          <p class="text-xs text-text-muted mt-1">
            {usageHistory.query.range.from} to {usageHistory.query.range.to} grouped by {usageHistory.query.granularity}.
          </p>
        </div>
        <div class="text-[10px] font-bold uppercase tracking-widest text-text-muted">
          groupBy: {usageHistory.query.groupBy}
        </div>
      </div>

      <div class="p-6 bg-white/[0.01]">
        {#if series.length > 0}
          <div class="relative h-72 border-l border-b border-white/10 pl-5 pb-8">
            <div class="absolute left-5 right-0 top-0 bottom-8 flex items-end gap-2">
              {#each series as point, index}
                <div class="flex-1 min-w-0 h-full flex flex-col items-center justify-end gap-2">
                  <div
                    class="w-full max-w-7 rounded-t-sm bg-[linear-gradient(180deg,var(--color-accent),rgba(240,184,96,0.25))] border border-accent/20 border-b-0 transition-all duration-300"
                    style={`height: ${
                      Number(point.value || 0) > 0 && maxSeriesValue > 0
                        ? Math.max(8, (Number(point.value || 0) / maxSeriesValue) * 100)
                        : 0
                    }%`}
                    title={`${point.value} units on ${formatBucketLabel(point.bucket)}`}
                  ></div>
                  <span
                    class={`text-[9px] font-mono text-text-dim ${
                      index === series.length - 1 ? "text-text-primary" : ""
                    }`}
                  >
                    {formatBucketLabel(point.bucket)}
                  </span>
                </div>
              {/each}
            </div>
          </div>
        {:else}
          <div class="py-16 text-center text-text-muted text-sm">
            No usage history available for this period.
          </div>
        {/if}
      </div>
    </section>

    <section class="card border-white/5 overflow-hidden">
      <div class="p-6 border-b border-white/5">
        <h2 class="text-base font-semibold text-text-primary">Feature Breakdown</h2>
        <p class="text-xs text-text-muted mt-1">
          Usage grouped by tracked feature for the selected history window.
        </p>
      </div>

      <div class="divide-y divide-white/5 bg-white/[0.01]">
        {#if breakdown.length > 0}
          {#each breakdown as feature}
            <div class="p-5 grid grid-cols-1 md:grid-cols-[1.4fr_0.8fr_0.8fr] gap-4 items-center">
              <div class="space-y-2 min-w-0">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <h3 class="text-sm font-semibold text-text-primary truncate">
                      {feature.feature.name}
                    </h3>
                    <p class="text-[10px] font-mono uppercase tracking-widest text-text-muted truncate">
                      {feature.feature.slug || feature.feature.id}
                    </p>
                  </div>
                  <div class="text-right shrink-0">
                    <div class="text-sm font-mono font-bold text-text-primary">
                      {feature.totals.usage.toLocaleString()}
                    </div>
                    <div class="text-[10px] uppercase tracking-widest text-text-muted">
                      {feature.feature.unit || "units"}
                    </div>
                  </div>
                </div>

                <div class="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full bg-[linear-gradient(90deg,var(--color-secondary),var(--color-tertiary))]"
                    style={`width: ${
                      Number(feature.totals.usage || 0) > 0 && featureMax > 0
                        ? Math.max(
                            4,
                            (Number(feature.totals.usage || 0) / featureMax) * 100,
                          )
                        : 0
                    }%`}
                  ></div>
                </div>
              </div>

              <div class="text-sm text-text-secondary">
                <div class="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1">
                  Records
                </div>
                <div class="font-mono">{feature.totals.records.toLocaleString()}</div>
              </div>

              <div class="flex items-end gap-1 h-14">
                {#each feature.series.slice(-10) as point}
                  <div
                    class="flex-1 min-w-0 rounded-t-sm bg-tertiary/70"
                    style={`height: ${
                      Number(point.value || 0) > 0 && feature.totals.usage > 0
                        ? Math.max(
                            10,
                            (Number(point.value || 0) / feature.totals.usage) * 100,
                          )
                        : 0
                    }%`}
                    title={`${point.value} on ${formatBucketLabel(point.bucket)}`}
                  ></div>
                {/each}
              </div>
            </div>
          {/each}
        {:else}
          <div class="p-10 text-center text-text-muted text-sm">
            No feature breakdown available yet.
          </div>
        {/if}
      </div>
    </section>
  </div>
{:else}
  <div class="card border-white/5 p-10 text-center text-text-muted">
    Usage history is not available for this customer yet.
  </div>
{/if}
