<script lang="ts">
  import { Search, RefreshCw, ArrowRight, Receipt, Loader2, Clock, CreditCard, Gift, ShoppingBag, CheckCircle } from "lucide-svelte";
  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import { onMount } from "svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import TransactionDetail from "$lib/components/transactions/TransactionDetail.svelte";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";

  const organizationId = $derived(page.params.projectId);
  let transactions = $state<any[]>([]);
  let isLoading = $state(true);
  let searchQuery = $state("");
  let filterType = $state<string>("all");
  let selectedTxId = $state<string | null>(null);

  const selectedTx = $derived(
    transactions.find(t => t.id === selectedTxId)
  );

  async function loadTransactions() {
    isLoading = true;
    try {
      const res = await apiFetch(`/api/dashboard/transactions?organizationId=${organizationId}`);
      if (res.data) {
        transactions = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load transactions", e);
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    loadTransactions();
  });

  const filteredTx = $derived(
    transactions.filter(t => {
      const matchesSearch = 
        t.customer?.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.plan?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.typeLabel?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter = filterType === "all" || t.type === filterType;
      return matchesSearch && matchesFilter;
    })
  );

  function typeColor(type: string) {
    switch (type) {
      case "subscription": return "text-blue-400 bg-blue-500/10 border-blue-500/20";
      case "one_time": return "text-purple-400 bg-purple-500/10 border-purple-500/20";
      case "trial": return "text-cyan-400 bg-cyan-500/10 border-cyan-500/20";
      case "free": return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
      default: return "text-zinc-500 bg-zinc-500/10 border-zinc-500/20";
    }
  }

  function statusColor(status: string) {
    switch (status.toLowerCase()) {
      case 'active': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
      case 'canceled': return 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20';
      case 'past_due': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      default: return 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20';
    }
  }

  function typeIcon(type: string) {
    switch (type) {
      case "subscription": return CreditCard;
      case "one_time": return ShoppingBag;
      case "trial": return Gift;
      case "free": return CheckCircle;
      default: return Receipt;
    }
  }

  function formatMoney(amount: number, currency: string) {
    if (!amount) return "Free";
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: currency || "NGN",
    }).format(amount / 100);
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  }

  const typeCounts = $derived({
    all: transactions.length,
    subscription: transactions.filter(t => t.type === "subscription").length,
    one_time: transactions.filter(t => t.type === "one_time").length,
    trial: transactions.filter(t => t.type === "trial").length,
    free: transactions.filter(t => t.type === "free").length,
  });
</script>

<svelte:head>
  <title>Transactions - Owostack</title>
</svelte:head>

<div class="max-w-6xl">
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1 class="text-xl font-bold text-white mb-2 uppercase tracking-wide">Transactions</h1>
      <p class="text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
        All billing activity across subscriptions, purchases, and trials
      </p>
    </div>

    <button
      class="btn btn-secondary gap-2 text-xs uppercase tracking-wider font-bold"
      onclick={loadTransactions}
    >
      <RefreshCw size={14} class={isLoading ? "animate-spin" : ""} />
      Refresh
    </button>
  </div>

  <!-- Type Filter Tabs -->
  <div class="flex items-center gap-2 mb-6">
    {#each [
      { value: "all", label: "All" },
      { value: "subscription", label: "Subscriptions" },
      { value: "one_time", label: "One-time" },
      { value: "trial", label: "Trials" },
      { value: "free", label: "Free" },
    ] as tab}
      <button
        class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-colors {filterType === tab.value
          ? 'bg-white/10 text-white border-zinc-500'
          : 'bg-transparent text-zinc-500 border-border hover:text-zinc-300 hover:border-zinc-600'}"
        onclick={() => filterType = tab.value}
      >
        {tab.label}
        <span class="ml-1 text-zinc-600">{typeCounts[tab.value as keyof typeof typeCounts] || 0}</span>
      </button>
    {/each}
  </div>

  <!-- Search -->
  <div class="flex items-center justify-between gap-4 mb-6">
    <div class="relative flex-1 max-w-sm">
      <Search
        size={14}
        class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
      />
      <input
        type="text"
        placeholder="Search by customer, plan, or type..."
        bind:value={searchQuery}
        class="input pl-9"
      />
    </div>
  </div>

  {#if isLoading && transactions.length === 0}
    <div class="flex items-center gap-2 text-zinc-500 p-12 justify-center">
      <Loader2 size={16} class="animate-spin" />
      <span>Loading transactions...</span>
    </div>
  {:else if filteredTx.length === 0}
    <div class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center shadow-md">
      <div class="w-12 h-12 bg-white/5 flex items-center justify-center mb-4">
        <Receipt size={24} class="text-zinc-500" />
      </div>
      <h3 class="text-lg font-bold text-white mb-2">
        {searchQuery || filterType !== "all" ? "No matching transactions" : "No transactions yet"}
      </h3>
      <p class="text-zinc-500 max-w-sm text-sm">
        {searchQuery || filterType !== "all"
          ? "Try a different search or filter."
          : "Transactions will appear here when customers subscribe to plans, make purchases, or start trials."}
      </p>
    </div>
  {:else}
    <!-- Transactions Table -->
    <div class="bg-bg-card border border-border overflow-hidden shadow-md">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-white/5 border-b border-border">
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Type</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Customer</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Plan</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Amount</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Provider</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Status</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Date</th>
            <th class="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/50">
          {#each filteredTx as tx}
            <tr
              class="group hover:bg-white/2 transition-colors cursor-pointer {selectedTxId === tx.id ? 'bg-white/5' : ''}"
              onclick={() => selectedTxId = tx.id}
            >
              <td class="px-6 py-4">
                <div class="flex items-center gap-2">
                  <div class="w-7 h-7 rounded {typeColor(tx.type)} border flex items-center justify-center">
                    <svelte:component this={typeIcon(tx.type)} size={12} />
                  </div>
                  <span class="text-[10px] font-bold uppercase tracking-wider {typeColor(tx.type).split(' ')[0]}">
                    {tx.typeLabel}
                  </span>
                </div>
              </td>
              <td class="px-6 py-4">
                <div class="flex flex-col">
                  <span class="text-sm font-bold text-white">{tx.customer?.email}</span>
                  <span class="text-[9px] text-zinc-600 font-mono">ID: {tx.id.split('-')[0]}</span>
                </div>
              </td>
              <td class="px-6 py-4">
                <span class="text-sm text-zinc-300 font-medium">{tx.plan?.name}</span>
              </td>
              <td class="px-6 py-4">
                <span class="text-sm font-semibold text-white">
                  {formatMoney(tx.amount, tx.currency)}
                </span>
              </td>
              <td class="px-6 py-4">
                <ProviderBadge providerId={tx.providerId} />
              </td>
              <td class="px-6 py-4">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border {statusColor(tx.status)}">
                  {tx.status}
                </span>
              </td>
              <td class="px-6 py-4">
                <div class="flex items-center gap-2 text-xs text-zinc-500">
                  <Clock size={12} />
                  {formatDate(tx.createdAt)}
                </div>
              </td>
              <td class="px-6 py-4 text-right">
                <ArrowRight size={14} class="text-zinc-800 group-hover:text-zinc-500 transition-colors" />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- Transaction Detail Sidebar -->
<SidePanel
  open={!!selectedTxId}
  title={selectedTx?.typeLabel || "Transaction"}
  onclose={() => { selectedTxId = null; }}
>
  {#if selectedTxId}
    <TransactionDetail transactionId={selectedTxId} />
  {/if}
</SidePanel>
