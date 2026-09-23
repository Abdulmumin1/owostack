<script lang="ts">
  import { SvelteDate, SvelteMap, SvelteSet } from "svelte/reactivity";

  let {
    data,
    features,
    days,
    dates,
  }: {
    data: Array<{ date: string; featureId: string; totalUsage: number }>;
    features: Array<{ id: string; name: string; slug: string }>;
    days: number;
    /** Explicit x-axis dates (e.g. API-returned buckets). Overrides the computed rolling range. */
    dates?: string[];
  } = $props();

  // Distinct hues. Assigned per feature id (not per position) so a feature
  // keeps the same colour as filters and rankings change.
  const PALETTE = [
    "#e8a855", // amber (accent)
    "#2db57d", // teal
    "#5b8bd6", // blue
    "#b072d6", // violet
    "#e06666", // red
    "#4bb3c4", // cyan
    "#d68a5b", // clay
    "#8aa84b", // olive
    "#d65b8a", // pink
    "#6d8bd6", // indigo
    "#3fa9a0", // sea
    "#c9992e", // gold
  ];

  // FNV-1a hash → stable palette slot for a given feature id.
  function colorFor(id: string) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return PALETTE[(h >>> 0) % PALETTE.length];
  }

  function toISODate(d: Date) {
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  // Full, stable date range for the X axis (oldest → newest). When explicit
  // dates are provided (e.g. API-returned buckets) they are used as-is.
  const dateLabels = $derived.by(() => {
    if (dates && dates.length > 0) {
      return [...dates].sort();
    }
    const out: string[] = [];
    const now = new SvelteDate();
    now.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new SvelteDate(now);
      d.setDate(d.getDate() - i);
      out.push(toISODate(d));
    }
    return out;
  });

  const totalDays = $derived(dateLabels.length);
  const hasExplicitDates = $derived(!!dates && dates.length > 0);

  const featureMeta = $derived(new SvelteMap(features.map((f) => [f.id, f])));

  type Series = { id: string; name: string; color: string; total: number };

  // Series ordered by name (stable stacking) with a stable, per-feature colour.
  // If a hash collision would give two features the same colour, the later one
  // is nudged to the next free palette slot so every feature stays distinct.
  const series = $derived.by<Series[]>(() => {
    const totals = new SvelteMap<string, number>();
    for (const row of data) {
      totals.set(
        row.featureId,
        (totals.get(row.featureId) || 0) + row.totalUsage,
      );
    }
    const used = new SvelteSet<string>();
    return [...totals.entries()]
      .map(([id, total]) => ({
        id,
        name: featureMeta.get(id)?.name || "Total Usage",
        total,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => {
        let color = colorFor(s.id);
        if (used.has(color)) {
          const start = PALETTE.indexOf(color);
          for (let k = 1; k <= PALETTE.length; k++) {
            const candidate = PALETTE[(start + k) % PALETTE.length];
            if (!used.has(candidate)) {
              color = candidate;
              break;
            }
          }
        }
        used.add(color);
        return { ...s, color };
      });
  });

  const isSingleSeries = $derived(series.length <= 1);

  type Segment = {
    id: string;
    name: string;
    color: string;
    value: number;
    offset: number;
  };
  type Day = { date: string; total: number; segments: Segment[] };

  const dayData = $derived.by<Day[]>(() => {
    const byDay = new SvelteMap<string, SvelteMap<string, number>>();
    for (const row of data) {
      const key = row.date.slice(0, 10);
      let inner = byDay.get(key);
      if (!inner) {
        inner = new SvelteMap();
        byDay.set(key, inner);
      }
      inner.set(row.featureId, (inner.get(row.featureId) || 0) + row.totalUsage);
    }

    return dateLabels.map((date) => {
      const inner = byDay.get(date);
      let offset = 0;
      const segments: Segment[] = series
        .map((s) => {
          const value = inner?.get(s.id) || 0;
          const seg: Segment = {
            id: s.id,
            name: s.name,
            color: s.color,
            value,
            offset,
          };
          offset += value;
          return seg;
        })
        .filter((s) => s.value > 0);
      return { date, total: offset, segments };
    });
  });

  const maxTotal = $derived(Math.max(1, ...dayData.map((d) => d.total)));

  function niceCeil(v: number) {
    if (v <= 0) return 1;
    const base = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / base;
    const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return nice * base;
  }

  const axisMax = $derived(niceCeil(maxTotal));

  // Top (0%) → bottom (100%), with the value drawn on the label.
  const ticks = $derived(
    [1, 0.75, 0.5, 0.25, 0].map((f) => ({
      pct: (1 - f) * 100,
      value: axisMax * f,
    })),
  );

  const gapClass = $derived(totalDays > 31 ? "gap-0.5" : "gap-1");
  const labelStep = $derived(totalDays <= 10 ? 1 : Math.ceil(totalDays / 10));
  const hasData = $derived(dayData.some((d) => d.total > 0));

  function formatNumber(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return Math.round(n).toString();
  }

  function dateLabel(date: string, index: number) {
    const d = new Date(date + "T12:00:00Z");
    if (!hasExplicitDates && days <= 7) {
      return d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
    }
    if (index % labelStep !== 0 && index !== dateLabels.length - 1) return "";
    return d
      .toLocaleDateString("en-US", { month: "short", day: "numeric" })
      .toUpperCase();
  }

  function tooltipDate(date: string) {
    const d = new Date(date + "T12:00:00Z");
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
</script>

<div class="w-full">
  {#if isSingleSeries && series[0]}
    <div class="mb-4 flex items-center gap-2">
      <span
        class="h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style="background: {series[0].color}"
      ></span>
      <span class="text-xs font-medium text-text-secondary"
        >{series[0].name}</span
      >
    </div>
  {/if}

  <div class="flex gap-3">
    <!-- Y axis -->
    <div class="relative h-64 w-10 shrink-0">
      {#each ticks as t, i (i)}
        <span
          class="absolute right-0 -translate-y-1/2 font-mono text-[10px] leading-none text-text-dim"
          style="top: {t.pct}%">{formatNumber(t.value)}</span
        >
      {/each}
    </div>

    <!-- Plot -->
    <div
      class="relative h-64 flex-1 overflow-x-clip"
      role="img"
      aria-label="Usage over the last {totalDays} days"
    >
      <!-- Gridlines -->
      <div class="absolute inset-0">
        {#each ticks as t, i (i)}
          <div
            class="absolute inset-x-0 h-px bg-border/50"
            style="top: {t.pct}%"
          ></div>
        {/each}
      </div>

      <!-- Bars -->
      <div class="absolute inset-0 flex items-end {gapClass}">
        {#each dayData as day, i (day.date)}
          {@const isLatest = i === dayData.length - 1}
          {@const tooltipAlign =
            i < Math.ceil(dayData.length * 0.15)
              ? "left"
              : i >= Math.floor(dayData.length * 0.85)
                ? "right"
                : "center"}
          <div class="group relative h-full flex-1">
            <!-- Hover hit area -->
            <div
              class="pointer-events-none absolute inset-0 rounded-sm transition-colors group-hover:bg-text-primary/[0.03]"
            ></div>

            {#each day.segments as s, si (s.id)}
              <div
                class="absolute inset-x-0 {si === day.segments.length - 1
                  ? 'rounded-t-[3px]'
                  : ''}"
                style="bottom: {(s.offset / axisMax) *
                  100}%; height: {(s.value / axisMax) *
                  100}%; background: {s.color}"
              ></div>
            {/each}
            {#if isSingleSeries && day.total > 0}
              <div
                class="dither absolute inset-x-0 bottom-0 h-[35%]"
                style="--dither-color: var(--color-bg-card)"
              ></div>
            {/if}
            {#if isLatest && day.total > 0}
              <div
                class="absolute inset-x-0 h-0.5 bg-accent"
                style="bottom: {(day.total / axisMax) * 100}%"
              ></div>
            {/if}

            <!-- Tooltip -->
            {#if day.total > 0}
              <div
                class="pointer-events-none absolute bottom-full z-20 mb-2 hidden group-hover:block {tooltipAlign ===
                'left'
                  ? 'left-0'
                  : tooltipAlign === 'right'
                    ? 'right-0'
                    : 'left-1/2 -translate-x-1/2'}"
              >
                <div
                  class="min-w-[9rem] max-w-[14rem] rounded-md border border-border bg-bg-card px-2.5 py-2 shadow-lg"
                >
                  <div
                    class="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-dim"
                  >
                    {tooltipDate(day.date)}
                  </div>
                  {#if isSingleSeries}
                    <div
                      class="flex items-center justify-between gap-4 text-[11px]"
                    >
                      <span class="text-text-secondary">Total</span>
                      <span class="font-mono font-medium text-text-primary"
                        >{formatNumber(day.total)}</span
                      >
                    </div>
                  {:else}
                    <div class="space-y-1">
                      {#each day.segments as s (s.id)}
                        <div
                          class="flex items-center justify-between gap-4 text-[11px]"
                        >
                          <span
                            class="flex items-center gap-1.5 text-text-secondary"
                          >
                            <span
                              class="h-2 w-2 shrink-0 rounded-[2px]"
                              style="background: {s.color}"
                            ></span>
                            <span class="max-w-[7rem] truncate">{s.name}</span>
                          </span>
                          <span class="font-mono text-text-primary"
                            >{formatNumber(s.value)}</span
                          >
                        </div>
                      {/each}
                    </div>
                    <div
                      class="mt-1.5 flex items-center justify-between gap-4 border-t border-border pt-1.5 text-[11px]"
                    >
                      <span class="text-text-dim">Total</span>
                      <span class="font-mono font-medium text-text-primary"
                        >{formatNumber(day.total)}</span
                      >
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- X axis labels -->
  <div class="mt-2 flex gap-3">
    <div class="w-10 shrink-0"></div>
    <div class="flex flex-1 {gapClass}">
      {#each dayData as day, i (day.date)}
        <div
          class="flex-1 text-center font-mono text-[10px] uppercase leading-none tracking-[0.06em] {i ===
          dayData.length - 1
            ? 'text-accent'
            : 'text-text-dim'}"
        >
          {dateLabel(day.date, i)}
        </div>
      {/each}
    </div>
  </div>

  <!-- Legend -->
  {#if !isSingleSeries}
    <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 pl-[3.25rem]">
      {#each series as s (s.id)}
        <span class="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <span
            class="h-2.5 w-2.5 shrink-0 rounded-[2px]"
            style="background: {s.color}"
          ></span>
          <span class="max-w-[12rem] truncate">{s.name}</span>
        </span>
      {/each}
    </div>
  {/if}

  {#if !hasData}
    <p class="mt-3 text-center text-[10px] text-text-dim">
      No usage recorded in this range
    </p>
  {/if}
</div>
