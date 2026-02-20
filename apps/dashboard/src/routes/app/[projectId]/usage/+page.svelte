<script lang="ts">
  import { ArrowDownRight, ArrowUpRight, CaretDown, ChartBar, CircleNotch, CurrencyDollar, Pulse, Stack, Users } from "phosphor-svelte";
  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import { formatCurrency } from "$lib/utils/currency";
  import { onMount } from "svelte";
  import StatCard from "$lib/components/ui/StatCard.svelte";
  import BarChart from "$lib/components/ui/BarChart.svelte";
  import ProgressBar from "$lib/components/ui/ProgressBar.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  const organizationId = $derived(page.params.projectId);
  let isLoading = $state(true);
  let usage = $state<any>(null);

  async function loadUsage() {
    isLoading = true;
    try {
      const res = await apiFetch(`/api/dashboard/usage?organizationId=${organizationId}`);
      if (res.data) {
        usage = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load usage", e);
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    loadUsage();
  });


  function formatNumber(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  }

  // Fill in full 30-day range for growth chart (API only returns days with data)
  const growthChartData = $derived.by(() => {
    const map = new Map<string, number>();
    if (usage?.customerGrowth) {
      for (const d of usage.customerGrowth) {
        map.set(d.day, d.count);
      }
    }
    const days: { label: string; value: number }[] = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const key = date.toISOString().slice(0, 10);
      days.push({ label: key, value: map.get(key) || 0 });
    }
    return days;
  });

  // Compute max usage for bar scaling in feature consumption
  const maxFeatureUsage = $derived(
    usage?.featureConsumption?.length > 0
      ? Math.max(...usage.featureConsumption.map((f: any) => f.totalUsage))
      : 1
  );

  // Compute max plan count for bar scaling
  const maxPlanCount = $derived(
    usage?.customersPerPlan?.length > 0
      ? Math.max(...usage.customersPerPlan.map((p: any) => p.count))
      : 1
  );

  // Growth percentage (compare last 7 days vs previous 7 days)
  const growthPct = $derived.by(() => {
    const days = growthChartData;
    const recent = days.slice(-7).reduce((s, d) => s + d.value, 0);
    const previous = days.slice(-14, -7).reduce((s, d) => s + d.value, 0);
    if (recent === 0 && previous === 0) return null;
    if (previous === 0) return recent > 0 ? 100 : 0;
    return Math.round(((recent - previous) / previous) * 100);
  });

</script>

<svelte:head>
  <title>Analytics - Owostack</title>
</svelte:head>

<div class="max-w-6xl">
  <div class="mb-8">
    <h1 class="text-xl font-bold text-text-primary mb-2 uppercase tracking-wide">Analytics</h1>
    <p class="text-text-dim text-[10px] uppercase tracking-widest font-bold">
      Customer insights, feature adoption & revenue
    </p>
  </div>

  {#if isLoading}
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {#each Array(4) as _}
        <div class="bg-bg-card border border-border p-5 space-y-4 rounded-lg">
          <div class="flex items-center justify-between">
            <Skeleton class="h-3 w-20" />
            <Skeleton class="w-8 h-8 rounded" />
          </div>
          <Skeleton class="h-8 w-24" />
          <Skeleton class="h-3 w-32" />
        </div>
      {/each}
    </div>

    <div class="grid lg:grid-cols-2 gap-4 mb-6">
      <div class="bg-bg-card border border-border p-5 h-64 rounded-lg">
        <div class="flex items-center justify-between mb-6">
          <Skeleton class="h-3 w-32" />
          <Skeleton class="h-3 w-20" />
        </div>
        <div class="flex items-end justify-between h-32 gap-2">
          {#each Array(12) as _}
            <Skeleton class="w-full" style="height: {Math.random() * 100}%" />
          {/each}
        </div>
      </div>
      <div class="bg-bg-card border border-border p-5 h-64 rounded-lg">
        <Skeleton class="h-3 w-32 mb-6" />
        <div class="space-y-4">
          {#each Array(4) as _}
            <div class="space-y-2">
              <div class="flex justify-between">
                <Skeleton class="h-3 w-24" />
                <Skeleton class="h-3 w-8" />
              </div>
              <Skeleton class="h-2 w-full" />
            </div>
          {/each}
        </div>
      </div>
    </div>

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
    <!-- Summary Cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <StatCard label="Customers" value={formatNumber(usage.totalCustomers)} icon={Users} iconColor="text-info bg-info-bg">
        {#if growthPct !== null}
          <div class="flex items-center gap-1 mt-1.5">
            {#if growthPct >= 0}
              <ArrowUpRight size={12} class="text-success" />
              <span class="text-[10px] font-bold text-success">{growthPct}%</span>
            {:else}
              <ArrowDownRight size={12} class="text-error" />
              <span class="text-[10px] font-bold text-error">{growthPct}%</span>
            {/if}
            <span class="text-[10px] text-text-dim">vs last week</span>
          </div>
        {/if}
      </StatCard>

      <StatCard label="Active Subs" value={formatNumber(usage.activeSubscriptions)} subtitle="Currently active" icon={Pulse} iconColor="text-accent bg-accent-light" />
      <StatCard
        label="MRR"
        value={usage.mrrTotal ? formatCurrency(usage.mrrTotal.amount, usage.mrrTotal.currency) : formatCurrency(0)}
        subtitle={usage.mrr?.length > 1 ? usage.mrr.map((m: any) => formatCurrency(m.amount, m.currency)).join(' + ') : 'Monthly recurring'}
        icon={CurrencyDollar}
        iconColor="text-success bg-success-bg"
      >
        {#if usage.mrrTotal?.approximate}
          <span class="text-[9px] text-text-dim mt-0.5 block">≈ converted rate</span>
        {/if}
      </StatCard>
      <StatCard label="Plans" value={usage.customersPerPlan?.length || 0} subtitle="With active customers" icon={Stack} iconColor="text-tertiary bg-tertiary-light" />
    </div>

    <!-- Row 2: Growth + Plan Distribution -->
    <div class="grid lg:grid-cols-2 gap-4 mb-6">
      <!-- Customer Growth (Last 30 Days) -->
      <div class="bg-bg-card border border-border rounded-lg">
        <div class="p-5 border-b border-border">
          <div class="flex items-center justify-between">
            <h3 class="text-[10px] font-bold text-text-primary uppercase tracking-widest">Customer Growth</h3>
            <span class="text-[10px] text-text-dim font-bold uppercase tracking-widest">Last 30 days</span>
          </div>
        </div>
        <div class="p-5">
          {#if growthChartData.some(d => d.value > 0)}
            <BarChart
              data={growthChartData}
              labelStart={growthChartData[0]?.label}
              labelEnd={growthChartData[growthChartData.length - 1]?.label}
             />
          {:else}
            <div class="flex items-center justify-center h-24 text-text-dim text-xs">
              No new customers in the last 30 days
            </div>
          {/if}
        </div>
      </div>

      <!-- Customers per Plan -->
      <div class="bg-bg-card border border-border rounded-lg">
        <div class="p-5 border-b border-border">
          <h3 class="text-[10px] font-bold text-text-primary uppercase tracking-widest">Customers by Plan</h3>
        </div>
        <div class="p-5">
          {#if usage.customersPerPlan?.length > 0}
            <div class="space-y-3">
              {#each usage.customersPerPlan as plan}
                <div>
                  <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                      <span class="text-xs text-text-primary font-semibold">{plan.planName}</span>
                      <span class="text-[9px] text-text-dim font-mono">{formatCurrency(plan.price, plan.currency)}/{plan.interval}</span>
                    </div>
                    <span class="text-xs font-bold text-text-primary">{plan.count}</span>
                  </div>
                  <ProgressBar value={plan.count} max={maxPlanCount} color="bg-accent" />
                </div>
              {/each}
            </div>
          {:else}
            <div class="flex items-center justify-center h-24 text-text-dim text-xs">
              No active subscriptions yet
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Row 3: Feature Consumption + Subscription Status -->
    <div class="grid lg:grid-cols-3 gap-4 mb-6">
      <!-- Feature Consumption (takes 2 cols) -->
      <div class="lg:col-span-3 bg-bg-card border border-border overflow-hidden rounded-lg">
        <div class="p-5 border-b border-border">
          <div class="flex items-center justify-between">
            <h3 class="text-[10px] font-bold text-text-primary uppercase tracking-widest">Feature Consumption</h3>
            <span class="text-[10px] text-text-dim font-bold uppercase tracking-widest">This month</span>
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
                <th class="px-5 py-2.5 text-[10px] font-bold text-text-dim uppercase tracking-widest text-left">Feature</th>
                <th class="px-5 py-2.5 text-[10px] font-bold text-text-dim uppercase tracking-widest text-center">Consumers</th>
                <th class="px-5 py-2.5 text-[10px] font-bold text-text-dim uppercase tracking-widest text-center">Total Usage</th>
                <th class="px-5 py-2.5 text-[10px] font-bold text-text-dim uppercase tracking-widest text-left pl-6">Volume</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/30">
              {#each usage.featureConsumption as feat}
                <tr class="hover:bg-bg-secondary transition-colors">
                  <td class="px-5 py-3">
                    <div class="text-sm text-text-primary font-medium truncate">{feat.featureName}</div>
                    <div class="text-[10px] text-text-dim font-mono truncate">{feat.featureSlug}</div>
                  </td>
                  <td class="px-5 py-3 text-center">
                    <span class="text-sm text-text-primary font-bold">{feat.uniqueConsumers}</span>
                    <span class="text-[10px] text-text-dim ml-1">{feat.uniqueConsumers === 1 ? 'user' : 'users'}</span>
                  </td>
                  <td class="px-5 py-3 text-center">
                    <span class="text-sm text-text-primary font-bold">{formatNumber(feat.totalUsage)}</span>
                    {#if feat.unit}
                      <span class="text-[10px] text-text-dim ml-1">{feat.unit}</span>
                    {/if}
                  </td>
                  <td class="px-5 py-3 pl-6">
                    <ProgressBar value={feat.totalUsage} max={maxFeatureUsage} color="bg-accent/70" />
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <div class="p-10 flex flex-col items-center justify-center text-center">
            <ChartBar   size={20} class="text-text-dim mb-3"  />
            <p class="text-xs text-text-dim">No feature usage recorded this month</p>
            <p class="text-[10px] text-text-dim mt-1">Usage will appear here once customers start consuming features via the API</p>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center rounded-lg">
      <div class="w-12 h-12 bg-bg-secondary flex items-center justify-center mb-4 rounded">
        <ChartBar   size={24} class="text-text-dim"  />
      </div>
      <h3 class="text-lg font-bold text-text-primary mb-2">No Analytics Yet</h3>
      <p class="text-text-dim max-w-sm text-sm">
        Analytics will populate once customers subscribe to plans and start consuming features via the API.
      </p>
    </div>
  {/if}
</div>
