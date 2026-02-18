<script lang="ts">
  import { Search, Filter, RefreshCw, ArrowRight, CreditCard, Loader2, CheckCircle, AlertCircle, Clock } from "lucide-svelte";
  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import { formatCurrency } from "$lib/utils/currency";
  import { onMount } from "svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import SubscriptionDetail from "$lib/components/subscriptions/SubscriptionDetail.svelte";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  const organizationId = $derived(page.params.projectId);
  let subscriptions = $state<any[]>([]);
  let isLoading = $state(true);
  let searchQuery = $state("");
  let selectedSubId = $state<string | null>(null);
 
  const selectedSub = $derived(
    subscriptions.find(s => s.id === selectedSubId)
  );

  async function loadSubscriptions() {
    isLoading = true;
    try {
      // Assuming we'll add a dashboard subscriptions endpoint
      const res = await apiFetch(`/api/dashboard/subscriptions?organizationId=${organizationId}`);
      if (res.data) {
        subscriptions = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load subscriptions", e);
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    loadSubscriptions();
  });

  const filteredSubs = $derived(
    subscriptions.filter(s => 
      s.customer?.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.plan?.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  function getStatusColor(status: string) {
    switch (status.toLowerCase()) {
      case 'active': return 'text-emerald-600 dark:text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
      case 'trialing': return 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20';
      case 'canceled': return 'text-text-dim bg-bg-secondary border-border';
      case 'expired': return 'text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/20';
      case 'past_due': return 'text-amber-600 dark:text-amber-500 bg-amber-500/10 border-amber-500/20';
      case 'incomplete': return 'text-red-600 dark:text-red-500 bg-red-500/10 border-red-500/20';
      default: return 'text-text-dim bg-bg-secondary border-border';
    }
  }

  function formatMoney(amount: number, currency: string) {
    return formatCurrency(amount, currency);
  }
</script>

<svelte:head>
  <title>Subscriptions - Owostack</title>
</svelte:head>

<div class="max-w-6xl">
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1 class="text-xl font-bold text-text-primary mb-2 uppercase tracking-wide">Subscriptions</h1>
      <p class="text-text-dim text-[10px] uppercase tracking-widest font-bold">
        Manage customer recurring payments
      </p>
    </div>

    <button
      class="btn btn-secondary gap-2 text-xs uppercase tracking-wider font-bold"
      onclick={loadSubscriptions}
    >
      <RefreshCw size={14} class={isLoading ? "animate-spin" : ""} />
      Refresh
    </button>
  </div>

  <!-- Toolbar -->
  <div class="flex items-center justify-between gap-4 mb-6">
    <div class="input-icon-wrapper max-w-sm">
      <Search
        size={14}
        class="input-icon-left text-text-dim"
      />
      <input
        type="text"
        placeholder="Search by customer or plan..."
        bind:value={searchQuery}
        class="input input-has-icon-left"
      />
    </div>
  </div>

  {#if isLoading && subscriptions.length === 0}
    <div class="bg-bg-card border border-border overflow-hidden shadow-md">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-black/5 dark:bg-white/5 border-b border-border">
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Customer</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Plan</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Provider</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Status</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Next Billing</th>
            <th class="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/50">
          {#each Array(5) as _}
            <tr>
              <td class="px-6 py-4">
                <div class="space-y-2">
                  <Skeleton class="h-4 w-32" />
                  <Skeleton class="h-3 w-20" />
                </div>
              </td>
              <td class="px-6 py-4">
                <div class="space-y-2">
                  <Skeleton class="h-4 w-24" />
                  <Skeleton class="h-3 w-16" />
                </div>
              </td>
              <td class="px-6 py-4">
                <Skeleton class="h-4 w-20" />
              </td>
              <td class="px-6 py-4">
                <Skeleton class="h-5 w-16" />
              </td>
              <td class="px-6 py-4">
                <Skeleton class="h-4 w-24" />
              </td>
              <td class="px-6 py-4 text-right">
                <Skeleton class="h-4 w-4 ml-auto" />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if filteredSubs.length === 0}
    <div class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center shadow-md">
      <div class="w-12 h-12 bg-black/5 dark:bg-white/5 flex items-center justify-center mb-4">
        <CreditCard size={24} class="text-text-dim" />
      </div>
      <h3 class="text-lg font-bold text-text-primary mb-2">
        {searchQuery ? "No matching subscriptions" : "No active subscriptions"}
      </h3>
      <p class="text-text-dim max-w-sm text-sm">
        {searchQuery ? "Try a different search term." : "Subscriptions will appear here when customers subscribe to your plans."}
      </p>
    </div>
  {:else}
    <!-- Subscriptions Table -->
    <div class="bg-bg-card border border-border overflow-hidden shadow-md">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-black/5 dark:bg-white/5 border-b border-border">
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Customer</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Plan</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Provider</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Status</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Next Billing</th>
            <th class="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/50">
          {#each filteredSubs as sub}
            <tr
              class="group hover:bg-black/2 dark:hover:bg-white/2 transition-colors cursor-pointer {selectedSubId === sub.id ? 'bg-black/5 dark:bg-white/5' : ''}"
              onclick={() => selectedSubId = sub.id}
            >
              <td class="px-6 py-4">
                <div class="flex flex-col">
                  <span class="text-sm font-bold text-text-primary">{sub.customer?.email}</span>
                  <span class="text-[9px] text-text-dim font-mono">ID: {sub.id.split('-')[0]}</span>
                </div>
              </td>
              <td class="px-6 py-4">
                <div class="flex flex-col">
                  <span class="text-sm text-text-secondary font-medium">{sub.plan?.name}</span>
                  <span class="text-[10px] text-text-dim">
                    {formatMoney(sub.plan?.price, sub.plan?.currency)} / {sub.plan?.interval}
                  </span>
                </div>
              </td>
              <td class="px-6 py-4">
                <ProviderBadge providerId={sub.providerId} />
              </td>
              <td class="px-6 py-4">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border {getStatusColor(sub.status)}">
                  {sub.status}
                </span>
              </td>
              <td class="px-6 py-4">
                <div class="flex items-center gap-2 text-xs text-text-dim">
                  <Clock size={12} />
                  {#if sub.status === 'trialing'}
                    <span class="text-blue-600 dark:text-blue-400">Trial ends {new Date(sub.currentPeriodEnd).toLocaleDateString()}</span>
                  {:else if sub.status === 'expired'}
                    <span class="text-orange-600 dark:text-orange-400">Expired {new Date(sub.currentPeriodEnd).toLocaleDateString()}</span>
                  {:else}
                    {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                  {/if}
                </div>
              </td>
              <td class="px-6 py-4 text-right">
                <ArrowRight size={14} class="text-text-dim/20 group-hover:text-text-dim transition-colors" />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- Subscription Detail Sidebar -->
<SidePanel
  open={!!selectedSubId}
  title={selectedSub?.plan?.name || "Subscription"}
  onclose={() => { selectedSubId = null; }}
>
  {#if selectedSubId}
    <SubscriptionDetail
      subscriptionId={selectedSubId}
      onupdate={loadSubscriptions}
    />
  {/if}
</SidePanel>
