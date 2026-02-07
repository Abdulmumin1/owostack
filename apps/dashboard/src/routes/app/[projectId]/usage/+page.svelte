<script lang="ts">
  import { BarChart3, Users, DollarSign, Activity, Layers, ArrowUpRight, ArrowDownRight, Loader2, ChevronDown } from "lucide-svelte";
  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import { onMount } from "svelte";
  import StatCard from "$lib/components/ui/StatCard.svelte";
  import BarChart from "$lib/components/ui/BarChart.svelte";
  import ProgressBar from "$lib/components/ui/ProgressBar.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  const ACTIVITY_PAGE_SIZE = 20;

  const organizationId = $derived(page.params.projectId);
  let isLoading = $state(true);
  let usage = $state<any>(null);

  // Lazy-loaded activity state
  let activityRecords = $state<any[]>([]);
  let activityTotal = $state(0);
  let activityLoading = $state(false);
  let activityLoaded = $state(false);
  let activityLoadingMore = $state(false);

  const activityHasMore = $derived(activityRecords.length < activityTotal);

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

  async function loadActivity(reset = true) {
    if (reset) {
      activityLoading = true;
      activityRecords = [];
    } else {
      activityLoadingMore = true;
    }

    try {
      const offset = reset ? 0 : activityRecords.length;
      const res = await apiFetch(
        `/api/dashboard/usage/activity?organizationId=${organizationId}&limit=${ACTIVITY_PAGE_SIZE}&offset=${offset}`,
      );
      if (res.data?.success) {
        if (reset) {
          activityRecords = res.data.data;
        } else {
          activityRecords = [...activityRecords, ...res.data.data];
        }
        activityTotal = res.data.total;
      }
    } catch (e) {
      console.error("Failed to load activity", e);
    } finally {
      activityLoading = false;
      activityLoadingMore = false;
      activityLoaded = true;
    }
  }

  onMount(() => {
    loadUsage();
  });

  function formatCurrency(amount: number, currency: string = "NGN") {
    const major = amount / 100;
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: 0 }).format(major);
  }

  function formatNumber(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  }

  function formatRelativeTime(timestamp: number) {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
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

  // Subscription status color map
  function statusBarColor(status: string) {
    if (status === "active") return "bg-emerald-500";
    if (status === "canceled") return "bg-red-400";
    if (status === "trialing") return "bg-blue-400";
    return "bg-zinc-500";
  }
</script>

<svelte:head>
  <title>Analytics - Owostack</title>
</svelte:head>

<div class="max-w-6xl">
  <div class="mb-8">
    <h1 class="text-xl font-bold text-white mb-2 uppercase tracking-wide">Analytics</h1>
    <p class="text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
      Customer insights, feature adoption & revenue
    </p>
  </div>

  {#if isLoading}
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {#each Array(4) as _}
        <div class="bg-bg-card border border-border p-5 shadow-md space-y-4">
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
      <div class="bg-bg-card border border-border p-5 shadow-md h-64">
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
      <div class="bg-bg-card border border-border p-5 shadow-md h-64">
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

    <div class="bg-bg-card border border-border shadow-md overflow-hidden">
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
      <StatCard label="Customers" value={formatNumber(usage.totalCustomers)} icon={Users} iconColor="text-blue-500 bg-blue-500/10">
        {#if growthPct !== null}
          <div class="flex items-center gap-1 mt-1.5">
            {#if growthPct >= 0}
              <ArrowUpRight size={12} class="text-emerald-500" />
              <span class="text-[10px] font-bold text-emerald-500">{growthPct}%</span>
            {:else}
              <ArrowDownRight size={12} class="text-red-400" />
              <span class="text-[10px] font-bold text-red-400">{growthPct}%</span>
            {/if}
            <span class="text-[10px] text-zinc-600">vs last week</span>
          </div>
        {/if}
      </StatCard>

      <StatCard label="Active Subs" value={formatNumber(usage.activeSubscriptions)} subtitle="Currently active" icon={Activity} iconColor="text-accent bg-accent/10" />
      <StatCard label="MRR" value={formatCurrency(usage.mrr)} subtitle="Monthly recurring" icon={DollarSign} iconColor="text-emerald-500 bg-emerald-500/10" />
      <StatCard label="Plans" value={usage.customersPerPlan?.length || 0} subtitle="With active customers" icon={Layers} iconColor="text-purple-500 bg-purple-500/10" />
    </div>

    <!-- Row 2: Growth + Plan Distribution -->
    <div class="grid lg:grid-cols-2 gap-4 mb-6">
      <!-- Customer Growth (Last 30 Days) -->
      <div class="bg-bg-card border border-border shadow-md">
        <div class="p-5 border-b border-border">
          <div class="flex items-center justify-between">
            <h3 class="text-[10px] font-bold text-white uppercase tracking-widest">Customer Growth</h3>
            <span class="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Last 30 days</span>
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
            <div class="flex items-center justify-center h-24 text-zinc-600 text-xs">
              No new customers in the last 30 days
            </div>
          {/if}
        </div>
      </div>

      <!-- Customers per Plan -->
      <div class="bg-bg-card border border-border shadow-md">
        <div class="p-5 border-b border-border">
          <h3 class="text-[10px] font-bold text-white uppercase tracking-widest">Customers by Plan</h3>
        </div>
        <div class="p-5">
          {#if usage.customersPerPlan?.length > 0}
            <div class="space-y-3">
              {#each usage.customersPerPlan as plan}
                <div>
                  <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                      <span class="text-xs text-white font-semibold">{plan.planName}</span>
                      <span class="text-[9px] text-zinc-600 font-mono">{formatCurrency(plan.price, plan.currency)}/{plan.interval}</span>
                    </div>
                    <span class="text-xs font-bold text-white">{plan.count}</span>
                  </div>
                  <ProgressBar value={plan.count} max={maxPlanCount} color="bg-accent" />
                </div>
              {/each}
            </div>
          {:else}
            <div class="flex items-center justify-center h-24 text-zinc-600 text-xs">
              No active subscriptions yet
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Row 3: Feature Consumption + Subscription Status -->
    <div class="grid lg:grid-cols-3 gap-4 mb-6">
      <!-- Feature Consumption (takes 2 cols) -->
      <div class="lg:col-span-3 bg-bg-card border border-border shadow-md overflow-hidden">
        <div class="p-5 border-b border-border">
          <div class="flex items-center justify-between">
            <h3 class="text-[10px] font-bold text-white uppercase tracking-widest">Feature Consumption</h3>
            <span class="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">This month</span>
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
              <tr class="bg-white/2">
                <th class="px-5 py-2.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-left">Feature</th>
                <th class="px-5 py-2.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-center">Consumers</th>
                <th class="px-5 py-2.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-center">Total Usage</th>
                <th class="px-5 py-2.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-left pl-6">Volume</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/30">
              {#each usage.featureConsumption as feat}
                <tr class="hover:bg-white/2 transition-colors">
                  <td class="px-5 py-3">
                    <div class="text-sm text-white font-medium truncate">{feat.featureName}</div>
                    <div class="text-[10px] text-zinc-600 font-mono truncate">{feat.featureSlug}</div>
                  </td>
                  <td class="px-5 py-3 text-center">
                    <span class="text-sm text-white font-bold">{feat.uniqueConsumers}</span>
                    <span class="text-[10px] text-zinc-600 ml-1">{feat.uniqueConsumers === 1 ? 'user' : 'users'}</span>
                  </td>
                  <td class="px-5 py-3 text-center">
                    <span class="text-sm text-white font-bold">{formatNumber(feat.totalUsage)}</span>
                    {#if feat.unit}
                      <span class="text-[10px] text-zinc-600 ml-1">{feat.unit}</span>
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
            <BarChart3 size={20} class="text-zinc-600 mb-3" />
            <p class="text-xs text-zinc-500">No feature usage recorded this month</p>
            <p class="text-[10px] text-zinc-600 mt-1">Usage will appear here once customers start consuming features via the API</p>
          </div>
        {/if}
      </div>

      <!-- Subscription Status Breakdown -->
      <!-- <div class="bg-bg-card border border-border shadow-md">
        <div class="p-5 border-b border-border">
          <h3 class="text-[10px] font-bold text-white uppercase tracking-widest">Subscription Status</h3>
        </div>
        <div class="p-5">
          {#if usage.subscriptionsByStatus?.length > 0}
            {@const total = usage.subscriptionsByStatus.reduce((s: number, r: any) => s + r.count, 0)}
            <div class="space-y-3">
              {#each usage.subscriptionsByStatus as row}
                {@const pct = total > 0 ? Math.round((row.count / total) * 100) : 0}
                <div>
                  <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                      <div class="w-2 h-2 rounded-full {statusBarColor(row.status)}"></div>
                      <span class="text-xs text-zinc-300 capitalize">{row.status}</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-bold text-white">{row.count}</span>
                      <span class="text-[10px] text-zinc-600">{pct}%</span>
                    </div>
                  </div>
                  <ProgressBar value={pct} max={100} color={statusBarColor(row.status)} height="h-1" />
                </div>
              {/each}
            </div>
          {:else}
            <div class="flex items-center justify-center h-24 text-zinc-600 text-xs">
              No subscriptions yet
            </div>
          {/if}
        </div>
      </div> -->
    </div>

    <!-- Recent Usage Activity (lazy-loaded) -->
    <!-- <div class="bg-bg-card border border-border shadow-md overflow-hidden">
      <div class="p-5 border-b border-border flex items-center justify-between">
        <h3 class="text-[10px] font-bold text-white uppercase tracking-widest">Recent Activity</h3>
        {#if activityLoaded && activityTotal > 0}
          <span class="text-[10px] text-zinc-600 font-bold">{activityRecords.length} of {activityTotal}</span>
        {/if}
      </div>

      {#if !activityLoaded && !activityLoading}
        <div class="p-5 flex justify-center">
          <button
            class="btn btn-secondary gap-2 text-xs uppercase tracking-wider font-bold"
            onclick={() => loadActivity(true)}
          >
            <Activity size={14} />
            Load Activity
          </button>
        </div>
      {:else if activityLoading && activityRecords.length === 0}
        <div class="p-5 space-y-3">
          {#each Array(5) as _}
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <Skeleton class="w-7 h-7 rounded" />
                <Skeleton class="h-4 w-64" />
              </div>
              <Skeleton class="h-3 w-16" />
            </div>
          {/each}
        </div>
      {:else if activityRecords.length > 0}
        <div class="divide-y divide-border/30">
          {#each activityRecords as record}
            <div class="px-5 py-3 flex items-center justify-between hover:bg-white/2 transition-colors">
              <div class="flex items-center gap-3">
                <div class="w-7 h-7 bg-white/5 rounded flex items-center justify-center text-zinc-500">
                  <Activity size={12} />
                </div>
                <div>
                  <div class="text-xs text-white">
                    <span class="font-medium">{record.customerName || record.customerEmail}</span>
                    <span class="text-zinc-500 mx-1.5">used</span>
                    <span class="font-semibold">{record.amount}</span>
                    {#if record.unit}
                      <span class="text-zinc-500">{record.unit}</span>
                    {/if}
                    <span class="text-zinc-500 mx-1.5">of</span>
                    <span class="font-medium text-accent">{record.featureName}</span>
                  </div>
                </div>
              </div>
              <span class="text-[10px] text-zinc-600 font-mono shrink-0 ml-4">{formatRelativeTime(record.createdAt)}</span>
            </div>
          {/each}
        </div>
        {#if activityHasMore}
          <div class="p-3 flex justify-center border-t border-border/30">
            <button
              class="btn btn-secondary gap-2 text-xs uppercase tracking-wider font-bold"
              disabled={activityLoadingMore}
              onclick={() => loadActivity(false)}
            >
              {#if activityLoadingMore}
                <Loader2 size={14} class="animate-spin" />
              {:else}
                <ChevronDown size={14} />
              {/if}
              Load more
            </button>
          </div>
        {/if}
      {:else if activityLoaded}
        <div class="p-8 text-center text-zinc-600 text-xs">
          No usage activity recorded yet
        </div>
      {/if}
    </div> -->
  {:else}
    <div class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center shadow-md">
      <div class="w-12 h-12 bg-white/5 flex items-center justify-center mb-4 rounded">
        <BarChart3 size={24} class="text-zinc-500" />
      </div>
      <h3 class="text-lg font-bold text-white mb-2">No Analytics Yet</h3>
      <p class="text-zinc-500 max-w-sm text-sm">
        Analytics will populate once customers subscribe to plans and start consuming features via the API.
      </p>
    </div>
  {/if}
</div>
