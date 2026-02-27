<script lang="ts">
  import { ArrowRight, ArrowsClockwise, CaretLeft, CaretRight, CheckCircle, CircleNotch, Clock, CreditCard, Gift, MagnifyingGlass, Receipt, ShoppingBag } from "phosphor-svelte";
  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import { formatCurrency } from "$lib/utils/currency";
  import { onMount } from "svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import TransactionDetail from "$lib/components/transactions/TransactionDetail.svelte";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  // Pagination options
  const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

  const organizationId = $derived(page.params.projectId);
  let transactions = $state<any[]>([]);
  let totalCount = $state(0);
  let currentPage = $state(1);
  let pageSize = $state(20);
  let isLoading = $state(true);
  let searchQuery = $state("");
  let filterType = $state<string>("all");
  let selectedTxId = $state<string | null>(null);

  // Computed values
  const totalPages = $derived(Math.ceil(totalCount / pageSize) || 1);
  const startItem = $derived((currentPage - 1) * pageSize + 1);
  const endItem = $derived(Math.min(currentPage * pageSize, totalCount));
  const hasPrevious = $derived(currentPage > 1);
  const hasNext = $derived(currentPage < totalPages);

  const selectedTx = $derived(
    transactions.find(t => t.id === selectedTxId)
  );

  async function loadTransactions() {
    if (!organizationId) return;
    
    isLoading = true;

    try {
      const offset = (currentPage - 1) * pageSize;
      const params = new URLSearchParams();
      params.set("organizationId", organizationId ?? "");
      params.set("limit", String(pageSize));
      params.set("offset", String(offset));
      
      const res = await apiFetch(`/api/dashboard/transactions?${params}`);
      if (res.data?.success) {
        transactions = res.data.data;
        totalCount = Number(res.data.total) || 0;
      }
    } catch (e) {
      console.error("Failed to load transactions", e);
    } finally {
      isLoading = false;
    }
  }

  function goToPage(pageNum: number) {
    if (pageNum < 1 || pageNum > totalPages) return;
    currentPage = pageNum;
    loadTransactions();
  }

  function changePageSize(newSize: number) {
    pageSize = newSize;
    currentPage = 1;
    loadTransactions();
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
      case "subscription": return "text-info bg-info-bg border-info/20";
      case "one_time": return "text-tertiary bg-tertiary-light border-tertiary/20";
      case "trial": return "text-tertiary bg-tertiary-light border-tertiary/20";
      case "free": return "text-success bg-success-bg border-success/20";
      default: return "text-text-dim bg-bg-secondary border-border";
    }
  }

  function statusColor(status: string) {
    switch (status.toLowerCase()) {
      case 'active': return 'text-success bg-success-bg border-success/20';
      case 'canceled': return 'text-text-dim bg-bg-secondary border-border';
      case 'past_due': return 'text-warning bg-warning-bg border-warning/20';
      default: return 'text-text-dim bg-bg-secondary border-border';
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
    return formatCurrency(amount, currency);
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  }

  const typeCounts = $derived({
    all: totalCount,
    subscription: transactions.filter(t => t.type === "subscription").length,
    one_time: transactions.filter(t => t.type === "one_time").length,
    trial: transactions.filter(t => t.type === "trial").length,
    free: transactions.filter(t => t.type === "free").length,
  });

  // Generate page numbers to display
  function getPageNumbers(current: number, total: number): (number | string)[] {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    
    if (current <= 3) {
      return [1, 2, 3, 4, '...', total];
    }
    
    if (current >= total - 2) {
      return [1, '...', total - 3, total - 2, total - 1, total];
    }
    
    return [1, '...', current - 1, current, current + 1, '...', total];
  }
</script>

<svelte:head>
  <title>Transactions - Owostack</title>
</svelte:head>

<div class="max-w-6xl">
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1 class="text-xl font-bold text-text-primary mb-2 uppercase tracking-wide">Transactions</h1>
      <p class="text-text-dim text-[10px] uppercase tracking-widest font-bold">
        All billing activity across subscriptions, purchases, and trials
      </p>
    </div>

    <button
      class="btn btn-secondary gap-2 text-xs uppercase tracking-wider font-bold"
      onclick={() => loadTransactions()}
    >
      <ArrowsClockwise weight="duotone" size={14} class={isLoading ? "animate-spin" : ""} />
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
          ? 'bg-bg-secondary text-text-primary border-text-dim'
          : 'bg-transparent text-text-dim border-border hover:text-text-secondary hover:border-text-dim'}"
        onclick={() => filterType = tab.value}
      >
        {tab.label}
        <span class="ml-1 text-text-dim/60">{typeCounts[tab.value as keyof typeof typeCounts] || 0}</span>
      </button>
    {/each}
  </div>

  <!-- Toolbar with search and rows per page -->
  <div class="flex items-center justify-between gap-4 mb-6">
    <div class="input-icon-wrapper max-w-sm">
      <MagnifyingGlass weight="duotone" size={14} class="input-icon-left text-text-dim" />
      <input
        type="text"
        placeholder="Search by customer, plan, or type..."
        bind:value={searchQuery}
        class="input input-has-icon-left"
      />
    </div>

    <div class="flex items-center gap-3">
      <!-- Rows per page selector -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-text-dim">Rows:</span>
        <select
          class="input input-sm !py-1 !px-2 !w-auto text-xs"
          value={pageSize}
          onchange={(e) => changePageSize(Number(e.currentTarget.value))}
        >
          {#each PAGE_SIZE_OPTIONS as size}
            <option value={size}>{size}</option>
          {/each}
        </select>
      </div>
    </div>
  </div>

  {#if isLoading && transactions.length === 0}
    <div class="bg-bg-card border border-border overflow-hidden">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-bg-tertiary border-b border-border">
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Type</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Customer</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Plan</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Amount</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Provider</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Status</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Date</th>
            <th class="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/50">
          {#each Array(5) as _}
            <tr>
              <td class="px-6 py-4">
                <div class="flex items-center gap-2">
                  <Skeleton class="w-7 h-7 rounded" />
                  <Skeleton class="h-3 w-16" />
                </div>
              </td>
              <td class="px-6 py-4">
                <div class="space-y-2">
                  <Skeleton class="h-4 w-32" />
                  <Skeleton class="h-3 w-20" />
                </div>
              </td>
              <td class="px-6 py-4">
                <Skeleton class="h-4 w-24" />
              </td>
              <td class="px-6 py-4">
                <Skeleton class="h-4 w-16" />
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
  {:else if filteredTx.length === 0}
    <div class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center">
      <div class="w-12 h-12 bg-bg-tertiary flex items-center justify-center mb-4">
        <Receipt weight="duotone" size={24} class="text-text-dim" />
      </div>
      <h3 class="text-lg font-bold text-text-primary mb-2">
        {searchQuery || filterType !== "all" ? "No matching transactions" : "No transactions yet"}
      </h3>
      <p class="text-text-dim max-w-sm text-sm">
        {searchQuery || filterType !== "all"
          ? "Try a different search or filter."
          : "Transactions will appear here when customers subscribe to plans, make purchases, or start trials."}
      </p>
    </div>
  {:else}
    <!-- Transactions Table -->
    <div class="bg-bg-card border border-border overflow-hidden">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-bg-tertiary border-b border-border">
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Type</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Customer</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Plan</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Amount</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Provider</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Status</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Date</th>
            <th class="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/50">
          {#each filteredTx as tx}
            <tr
              class="group hover:bg-bg-tertiary transition-colors cursor-pointer {selectedTxId === tx.id ? 'bg-bg-tertiary' : ''}"
              onclick={() => selectedTxId = tx.id}
            >
              <td class="px-6 py-4">
                <div class="flex items-center gap-2">
                  <div class="w-7 h-7 rounded {typeColor(tx.type)} border flex items-center justify-center">
                    <svelte:component this={typeIcon(tx.type)} weight="duotone" />
                  </div>
                  <span class="text-[10px] font-bold uppercase tracking-wider {typeColor(tx.type).split(' ')[0]}">
                    {tx.typeLabel}
                  </span>
                </div>
              </td>
              <td class="px-6 py-4">
                <div class="flex flex-col">
                  <span class="text-sm font-bold text-text-primary">{tx.customer?.email}</span>
                  <span class="text-[9px] text-text-dim font-mono">ID: {tx.id.split('-')[0]}</span>
                </div>
              </td>
              <td class="px-6 py-4">
                <span class="text-sm text-text-secondary font-medium">{tx.plan?.name}</span>
              </td>
              <td class="px-6 py-4">
                <span class="text-sm font-semibold text-text-primary">
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
                <div class="flex items-center gap-2 text-xs text-text-dim">
                  <Clock weight="duotone" size={12} />
                  {formatDate(tx.createdAt)}
                </div>
              </td>
              <td class="px-6 py-4 text-right">
                <ArrowRight weight="duotone" size={14} class="text-text-dim/20 group-hover:text-text-dim transition-colors" />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="flex items-center justify-between px-4 py-4 ">
      <!-- Left: Results info -->
      <div class="text-xs text-text-dim">
        {#if totalCount > 0}
          Showing {startItem} to {endItem} of {totalCount} results
        {:else}
          No results
        {/if}
      </div>

      <!-- Right: Page navigation -->
      <div class="flex items-center gap-1">
        <!-- Previous button -->
        <button
          class="btn btn-secondary btn-sm !px-2 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!hasPrevious}
          onclick={() => goToPage(currentPage - 1)}
        >
          <CaretLeft size={14} weight="duotone" />
        </button>

        <!-- Page numbers -->
        <div class="flex items-center gap-1">
          {#each getPageNumbers(currentPage, totalPages) as pageNum}
            {#if pageNum === '...'}
              <span class="text-xs text-text-dim px-2">...</span>
            {:else}
              <button
                class="btn btn-sm !px-3 !py-1 text-xs {currentPage === pageNum ? 'btn-primary' : 'btn-secondary'}"
                onclick={() => goToPage(pageNum as number)}
              >
                {pageNum}
              </button>
            {/if}
          {/each}
        </div>

        <!-- Next button -->
        <button
          class="btn btn-secondary btn-sm !px-2 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!hasNext}
          onclick={() => goToPage(currentPage + 1)}
        >
          <CaretRight size={14} weight="duotone" />
        </button>
      </div>
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