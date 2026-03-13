<script lang="ts">
  import {
    ChartBar,
    CircleNotch,
    CurrencyDollar,
    Lightning,
    Pulse,
    TrendUp,
    CaretDown,
  } from "phosphor-svelte";

  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import { formatCurrency } from "$lib/utils/currency";
  import { onMount } from "svelte";

  import ProgressBar from "$lib/components/ui/ProgressBar.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import UsageChart from "$lib/components/ui/UsageChart.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import CustomerFilterModal from "$lib/components/usage/CustomerFilterModal.svelte";
  import FeatureFilterModal from "$lib/components/usage/FeatureFilterModal.svelte";

  const organizationId = $derived(page.params.projectId);
  let isLoading = $state(true);
  let usage = $state<any>(null);

  // Timeseries state
  let timeseriesDays = $state(30);
  let timeseriesFeatureId = $state("");
  let timeseriesFeatureName = $state("All Features");
  let timeseriesCustomerId = $state("");
  let timeseriesCustomerName = $state("All Customers");
  let timeseriesData = $state<
    Array<{ date: string; featureId: string; totalUsage: number }>
  >([]);
  let timeseriesFeatures = $state<
    Array<{ id: string; name: string; slug: string }>
  >([]);
  let isLoadingTimeseries = $state(true);

  // Filter state
  let isCustomerModalOpen = $state(false);
  let isFeatureModalOpen = $state(false);
  let featureOptions = $state<
    Array<{ id: string; name: string; slug: string }>
  >([]);

  async function loadUsage(days?: number) {
    isLoading = true;
    try {
      const params = new URLSearchParams();
      params.set("organizationId", organizationId ?? "");
      if (days) params.set("days", String(days));
      const res = await apiFetch(`/api/dashboard/usage?${params.toString()}`);
      if (res.data) {
        usage = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load usage", e);
    } finally {
      isLoading = false;
    }
  }

  async function loadTimeseries() {
    isLoadingTimeseries = true;
    try {
      const params = new URLSearchParams();
      params.set("organizationId", organizationId ?? "");
      params.set("days", String(timeseriesDays));
      if (timeseriesFeatureId) params.set("featureId", timeseriesFeatureId);
      if (timeseriesCustomerId) params.set("customerId", timeseriesCustomerId);

      const res = await apiFetch(`/api/dashboard/usage/timeseries?${params}`);
      if (res.data?.success) {
        timeseriesData = res.data.data;
        timeseriesFeatures = res.data.features;
      }
    } catch (e) {
      console.error("Failed to load timeseries", e);
    } finally {
      isLoadingTimeseries = false;
    }
  }

  async function loadFilterOptions() {
    try {
      const featRes = await apiFetch(
        `/api/dashboard/features?organizationId=${organizationId}&excludeBoolean=true`,
      );
      if (featRes.data?.data) {
        featureOptions = featRes.data.data.map((f: any) => ({
          id: f.id,
          name: f.name,
          slug: f.slug,
        }));
      }
    } catch (e) {
      console.error(e);
    }
  }

  const timeOptions = [
    { id: 7, label: "Last 7 days" },
    { id: 30, label: "Last 30 days" },
    { id: 90, label: "Last 90 days" },
  ];

  let hasMounted = $state(false);
  let lastLoadedUsageDays = $state(30);
  let lastLoadedTimeseriesKey = $state("30::");

  onMount(() => {
    loadUsage(timeseriesDays);
    loadTimeseries();
    loadFilterOptions();
    hasMounted = true;
  });

  // Reload timeseries when filters change (skip initial mount)
  $effect(() => {
    const currentDays = timeseriesDays;
    const currentFeatureId = timeseriesFeatureId;
    const currentCustomerId = timeseriesCustomerId;
    const currentTimeseriesKey = `${currentDays}:${currentFeatureId}:${currentCustomerId}`;

    if (!hasMounted) {
      return;
    }

    if (currentDays !== lastLoadedUsageDays) {
      lastLoadedUsageDays = currentDays;
      loadUsage(currentDays);
    }

    if (currentTimeseriesKey !== lastLoadedTimeseriesKey) {
      lastLoadedTimeseriesKey = currentTimeseriesKey;
      loadTimeseries();
    }
  });

  function handleCustomerSelect(id: string, name: string) {
    timeseriesCustomerId = id;
    timeseriesCustomerName = name;
  }

  function handleFeatureSelect(id: string, name: string) {
    timeseriesFeatureId = id;
    timeseriesFeatureName = name;
  }

  function formatNumber(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  }

  // Compute max usage for bar scaling in feature consumption
  const maxFeatureUsage = $derived(
    usage?.featureConsumption?.length > 0
      ? Math.max(...usage.featureConsumption.map((f: any) => f.totalUsage))
      : 1,
  );

  // Total timeseries usage
  const totalTimeseriesUsage = $derived(
    timeseriesData.reduce((sum, d) => sum + d.totalUsage, 0),
  );

  // Avg daily usage
  const avgDailyUsage = $derived(
    timeseriesDays > 0 ? Math.round(totalTimeseriesUsage / timeseriesDays) : 0,
  );

  // Peak day usage
  const peakDayUsage = $derived.by(() => {
    if (timeseriesData.length === 0) return { date: "", value: 0 };
    const byDay = new Map<string, number>();
    for (const row of timeseriesData) {
      byDay.set(row.date, (byDay.get(row.date) || 0) + row.totalUsage);
    }
    let peak = { date: "", value: 0 };
    for (const [date, value] of byDay) {
      if (value > peak.value) peak = { date, value };
    }
    return peak;
  });

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }
</script>

<svelte:head>
  <title>Analytics - Owostack</title>
</svelte:head>

<div class="max-w-6xl">
  <!-- Header -->
  <div class="mb-8">
    <h1
      class="text-xl font-bold text-text-primary mb-2 uppercase tracking-wide"
    >
      Analytics
    </h1>
    <p class="text-text-dim text-[10px] uppercase tracking-widest font-bold">
      Feature adoption & revenue
    </p>
  </div>

  <!-- ================================================================= -->
  <!-- Filters row (outside the card)                                      -->
  <!-- ================================================================= -->
  <div class="flex items-end justify-between gap-4 mb-4">
    <div>
      <h3
        class="text-[10px] font-bold text-text-primary uppercase tracking-widest mb-4"
      >
        <!-- Feature Usage Over Time -->
      </h3>
      {#if !isLoadingTimeseries && timeseriesData.length > 0}
        <div class="flex items-center gap-4 mt-2 flex-wrap">
          <div class="flex items-center gap-1.5">
            <TrendUp size={12} class="text-accent" weight="duotone" />
            <span class="text-xs text-text-secondary font-semibold"
              >{formatNumber(totalTimeseriesUsage)}</span
            >
            <span class="text-[10px] text-text-dim">total</span>
          </div>
          <div class="flex items-center gap-1.5">
            <Pulse size={12} class="text-secondary" weight="duotone" />
            <span class="text-xs text-text-secondary font-semibold"
              >{formatNumber(avgDailyUsage)}</span
            >
            <span class="text-[10px] text-text-dim">avg/day</span>
          </div>
          {#if peakDayUsage.value > 0}
            <div class="flex items-center gap-1.5">
              <Lightning size={12} class="text-warning" weight="duotone" />
              <span class="text-xs text-text-secondary font-semibold"
                >{formatNumber(peakDayUsage.value)}</span
              >
              <span class="text-[10px] text-text-dim"
                >peak · {formatDate(peakDayUsage.date)}</span
              >
            </div>
          {/if}
          {#if !isLoading && usage?.mrrTotal}
            <div class="flex items-center gap-1.5">
              <CurrencyDollar size={12} class="text-success" weight="duotone" />
              <span class="text-xs text-text-secondary font-semibold"
                >{formatCurrency(
                  usage.mrrTotal.amount,
                  usage.mrrTotal.currency,
                )}</span
              >
              <span class="text-[10px] text-text-dim">MRR</span>
            </div>
          {/if}
        </div>
      {:else if !isLoadingTimeseries && !isLoading && usage?.mrrTotal}
        <div class="flex items-center gap-4 mt-2">
          <div class="flex items-center gap-1.5">
            <CurrencyDollar size={12} class="text-success" weight="fill" />
            <span class="text-xs text-text-secondary font-semibold"
              >{formatCurrency(
                usage.mrrTotal.amount,
                usage.mrrTotal.currency,
              )}</span
            >
            <span class="text-[10px] text-text-dim">MRR</span>
          </div>
        </div>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      <Select
        bind:value={timeseriesDays}
        options={timeOptions}
        class="w-auto shrink-0"
      />

      <button
        class="flex items-center justify-between gap-3 w-auto min-w-[140px] max-w-[200px] px-3 py-1.5 bg-bg-card border border-border rounded-lg text-xs font-medium text-text-primary hover:bg-bg-secondary transition-colors"
        onclick={() => (isFeatureModalOpen = true)}
      >
        <span class="truncate">{timeseriesFeatureName}</span>
        <CaretDown size={14} class="text-text-dim shrink-0" />
      </button>

      <button
        class="flex items-center justify-between gap-3 w-auto min-w-[140px] max-w-[200px] px-3 py-1.5 bg-bg-card border border-border rounded-lg text-xs font-medium text-text-primary hover:bg-bg-secondary transition-colors"
        onclick={() => (isCustomerModalOpen = true)}
      >
        <span class="truncate">{timeseriesCustomerName}</span>
        <CaretDown size={14} class="text-text-dim shrink-0" />
      </button>
    </div>
  </div>

  <CustomerFilterModal
    bind:open={isCustomerModalOpen}
    {organizationId}
    bind:selectedId={timeseriesCustomerId}
    onSelect={handleCustomerSelect}
  />

  <FeatureFilterModal
    bind:open={isFeatureModalOpen}
    features={featureOptions}
    bind:selectedId={timeseriesFeatureId}
    onSelect={handleFeatureSelect}
  />

  <!-- ================================================================= -->
  <!-- Bar Chart Card                                                      -->
  <!-- ================================================================= -->
  <div class="bg-bg-card border border-border rounded-lg mb-6">
    <div class="p-5">
      {#if isLoadingTimeseries}
        <div class="h-72 flex items-center justify-center">
          <CircleNotch size={20} class="animate-spin text-text-dim" />
        </div>
      {:else if timeseriesData.length > 0}
        <UsageChart
          data={timeseriesData}
          features={timeseriesFeatures}
          days={timeseriesDays}
        />
      {:else}
        <div class="h-72 flex flex-col items-center justify-center text-center">
          <div
            class="w-12 h-12 bg-bg-secondary flex items-center justify-center rounded-lg mb-4"
          >
            <ChartBar size={22} class="text-text-dim" weight="duotone" />
          </div>
          <p class="text-sm font-semibold text-text-secondary mb-1">
            No usage data yet
          </p>
          <p class="text-[10px] text-text-dim max-w-xs">
            Usage will appear here once customers start consuming features via
            the API. Try changing the time range or filters above.
          </p>
        </div>
      {/if}
    </div>
  </div>

  <!-- ================================================================= -->
  <!-- Feature Consumption                                                 -->
  <!-- ================================================================= -->
  {#if isLoading}
    <div class="bg-bg-card border border-border overflow-hidden rounded-lg">
      <div class="p-5 border-b border-border">
        <Skeleton class="h-3 w-32" />
      </div>
      <div class="p-5 space-y-4">
        {#each Array(5) as _}
          <div class="flex items-center justify-between py-2">
            <div class="space-y-2">
              <Skeleton class="h-4 w-32" />
              <Skeleton class="h-3 w-48" />
            </div>
            <Skeleton class="h-4 w-12" />
            <Skeleton class="h-4 w-16" />
            <Skeleton class="h-2 w-32" />
          </div>
        {/each}
      </div>
    </div>
  {:else if usage}
    <!-- ================================================================= -->
    <!-- Feature Consumption Table                                          -->
    <!-- ================================================================= -->
    <div
      class="bg-bg-card border border-border overflow-hidden rounded-lg mb-6"
    >
      <div class="p-5 border-b border-border">
        <div class="flex items-center justify-between">
          <h3
            class="text-[10px] font-bold text-text-primary uppercase tracking-widest"
          >
            Feature Consumption
          </h3>
          <span
            class="text-[10px] text-text-dim font-bold uppercase tracking-widest"
            >{timeseriesDays
              ? `Last ${timeseriesDays} days`
              : "This month"}</span
          >
        </div>
      </div>
      {#if usage.featureConsumption?.length > 0}
        <table class="w-full table-fixed">
          <colgroup>
            <col class="w-[30%]" />
            <col class="w-[20%]" />
            <col class="w-[20%]" />
            <col class="w-[30%]" />
          </colgroup>
          <thead>
            <tr class="bg-bg-secondary">
              <th
                class="px-5 py-2.5 text-[10px] font-bold text-text-dim uppercase tracking-widest text-left"
                >Feature</th
              >
              <th
                class="px-5 py-2.5 text-[10px] font-bold text-text-dim uppercase tracking-widest text-right"
                >Consumers</th
              >
              <th
                class="px-5 py-2.5 text-[10px] font-bold text-text-dim uppercase tracking-widest text-right"
                >Total Usage</th
              >
              <th
                class="px-5 py-2.5 text-[10px] font-bold text-text-dim uppercase tracking-widest text-left pl-6"
                >Volume</th
              >
            </tr>
          </thead>
          <tbody class="divide-y divide-border/30">
            {#each usage.featureConsumption as feat}
              <tr class="hover:bg-bg-secondary transition-colors">
                <td class="px-5 py-3">
                  <div class="text-sm text-text-primary font-medium truncate">
                    {feat.featureName}
                  </div>
                  {#if feat.featureSlug && feat.featureSlug.toLowerCase() !== feat.featureName.toLowerCase()}
                    <div class="text-[10px] text-text-dim font-mono truncate">
                      {feat.featureSlug}
                    </div>
                  {/if}
                </td>
                <td class="px-5 py-3">
                  <div class="flex items-center justify-end">
                    <span class="text-sm text-text-primary font-bold text-right"
                      >{formatNumber(feat.uniqueConsumers)}</span
                    >
                    <span class="text-[10px] text-text-dim ml-1.5 w-8 text-left"
                      >{feat.uniqueConsumers === 1 ? "user" : "users"}</span
                    >
                  </div>
                </td>
                <td class="px-5 py-3">
                  <div class="flex items-center justify-end">
                    <span class="text-sm text-text-primary font-bold text-right"
                      >{formatNumber(feat.totalUsage)}</span
                    >
                    {#if feat.unit}
                      <span
                        class="text-[10px] text-text-dim ml-1.5 w-10 text-left line-clamp-1 truncate"
                        title={feat.unit}>{feat.unit}</span
                      >
                    {:else}
                      <span class="w-10 ml-1.5 block"></span>
                    {/if}
                  </div>
                </td>
                <td class="px-5 py-3 pl-6">
                  <ProgressBar
                    value={feat.totalUsage}
                    max={maxFeatureUsage}
                    color="bg-accent/70"
                  />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <div class="p-10 flex flex-col items-center justify-center text-center">
          <ChartBar size={20} class="text-text-dim mb-3" />
          <p class="text-xs text-text-dim">
            No feature usage recorded this month
          </p>
          <p class="text-[10px] text-text-dim mt-1">
            Usage will appear here once customers start consuming features via
            the API
          </p>
        </div>
      {/if}
    </div>
  {:else}
    <!-- Global empty state -->
    <div
      class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center rounded-lg"
    >
      <div
        class="w-14 h-14 bg-bg-secondary flex items-center justify-center mb-5 rounded-lg"
      >
        <ChartBar size={28} class="text-text-dim" weight="duotone" />
      </div>
      <h3 class="text-lg font-bold text-text-primary mb-2">No Analytics Yet</h3>
      <p class="text-text-dim max-w-sm text-sm mb-6">
        Analytics will populate once customers subscribe to plans and start
        consuming features via the API.
      </p>
      <a href="/{organizationId}/features" class="btn btn-primary">
        Create Your First Feature
      </a>
    </div>
  {/if}
</div>
