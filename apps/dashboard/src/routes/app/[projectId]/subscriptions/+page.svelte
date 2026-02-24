<script lang="ts">
  import { ArrowRight, ArrowsClockwise, ArrowsClockwiseIcon, CheckCircle, CircleNotch, Clock, CreditCard, Funnel, MagnifyingGlass, MagnifyingGlassIcon, WarningCircle } from "phosphor-svelte";
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
      case 'active': return 'text-success bg-success-bg border-success/20';
      case 'trialing': return 'text-info bg-info-bg border-info/20';
      case 'canceled': return 'text-text-dim bg-bg-secondary border-border';
      case 'expired': return 'text-warning bg-warning-bg border-warning/20';
      case 'past_due': return 'text-warning bg-warning-bg border-warning/20';
      case 'incomplete': return 'text-error bg-error-bg border-error/20';
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
      <ArrowsClockwiseIcon size={14} class={isLoading ? "animate-spin" : ""} weight="fill" />
      Refresh
    </button>
  </div>

  <!-- Toolbar -->
  <div class="flex items-center justify-between gap-4 mb-6">
    <div class="input-icon-wrapper max-w-sm">
      <MagnifyingGlassIcon
        size={14}
        class="input-icon-left text-text-dim"
        weight="fill" />
      <input
        type="text"
        placeholder="by customer or plan..."
        bind:value={searchQuery}
        class="input input-has-icon-left"
      />
    </div>
  </div>

  {#if isLoading && subscriptions.length === 0}
    <div class="bg-bg-card border border-border overflow-hidden">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-bg-secondary border-b border-border">
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
    <div class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center">
      <div class="w-12 h-12 bg-bg-secondary flex items-center justify-center mb-4">
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
    <div class="bg-bg-card border border-border overflow-hidden">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-bg-secondary border-b border-border">
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
              class="group hover:bg-bg-secondary transition-colors cursor-pointer {selectedSubId === sub.id ? 'bg-bg-secondary' : ''}"
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
                    <span class="text-info">Trial ends {new Date(sub.currentPeriodEnd).toLocaleDateString()}</span>
                  {:else if sub.status === 'expired'}
                    <span class="text-warning">Expired {new Date(sub.currentPeriodEnd).toLocaleDateString()}</span>
                  {:else}
                    {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                  {/if}
                </div>
              </td>
              <td class="px-6 py-4 text-right">
                <ArrowRight size={14} class="text-text-dim/20 group-hover:text-text-dim transition-colors" weight="fill" />
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
