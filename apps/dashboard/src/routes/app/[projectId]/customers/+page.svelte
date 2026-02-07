<script lang="ts">
  import { Search, Filter, Download, Users, Loader2, MoreHorizontal, Trash2, Copy, ChevronDown } from "lucide-svelte";
  import { page } from "$app/state";
  import { fade } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import { onMount } from "svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import CustomerDetail from "$lib/components/customers/CustomerDetail.svelte";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  const PAGE_SIZE = 25;

  const organizationId = $derived(page.params.projectId);
  let customers = $state<any[]>([]);
  let totalCount = $state(0);
  let currentOffset = $state(0);
  let isLoading = $state(true);
  let isLoadingMore = $state(false);
  let searchQuery = $state("");
  let openMenuId = $state<string | null>(null);
  let selectedCustomerId = $state<string | null>(null);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const hasMore = $derived(currentOffset + PAGE_SIZE < totalCount);

  const selectedCustomer = $derived(
    customers.find(c => c.id === selectedCustomerId)
  );

  async function loadCustomers(reset = true) {
    if (reset) {
      isLoading = true;
      currentOffset = 0;
      customers = [];
    } else {
      isLoadingMore = true;
    }

    try {
      const params = new URLSearchParams();
      params.set("organizationId", organizationId ?? "");
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(reset ? 0 : currentOffset));
      if (searchQuery.trim()) {
        params.set("search", searchQuery.trim());
      }

      const res = await apiFetch(`/api/dashboard/customers?${params}`);
      if (res.data?.success) {
        if (reset) {
          customers = res.data.data;
        } else {
          customers = [...customers, ...res.data.data];
        }
        totalCount = res.data.total;
        currentOffset = customers.length;
      }
    } catch (e) {
      console.error("Failed to load customers", e);
    } finally {
      isLoading = false;
      isLoadingMore = false;
    }
  }

  async function deleteCustomer(id: string) {
    if (!confirm("Are you sure you want to delete this customer? This will also remove their subscriptions.")) return;
    
    try {
      const res = await apiFetch(`/api/dashboard/customers/${id}`, {
        method: "DELETE"
      });
      if (res.data?.success) {
        customers = customers.filter(c => c.id !== id);
        totalCount = Math.max(0, totalCount - 1);
        if (selectedCustomerId === id) selectedCustomerId = null;
      }
    } catch (e) {
      console.error("Failed to delete customer", e);
    }
    openMenuId = null;
  }

  function copyId(id: string) {
    navigator.clipboard.writeText(id);
    openMenuId = null;
  }

  function onSearchInput() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      loadCustomers(true);
    }, 300);
  }

  onMount(() => {
    loadCustomers();
  });

  function formatDate(date: string | number) {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }
</script>

<svelte:head>
  <title>Customers - Owostack</title>
</svelte:head>

<div class="max-w-6xl">
  <div class="mb-8">
    <h1 class="text-xl font-bold text-white mb-2">Customers</h1>
    <p class="text-zinc-500 text-xs uppercase tracking-widest font-semibold">
      View and manage your subscriber base
      {#if totalCount > 0}
        <span class="text-zinc-600 ml-2">· {totalCount} total</span>
      {/if}
    </p>
  </div>

  <!-- Toolbar -->
  <div class="flex items-center justify-between gap-4 mb-6">
    <div class="input-icon-wrapper max-w-sm">
      <Search
        size={14}
        class="input-icon-left"
      />
      <input
        type="text"
        placeholder="Search by email, name or ID..."
        bind:value={searchQuery}
        oninput={onSearchInput}
        class="input input-has-icon-left"
      />
    </div>

    <div class="flex items-center gap-2">
      <button
        class="btn btn-secondary gap-2 text-xs uppercase tracking-wider font-bold"
      >
        <Filter size={14} />
        Filter
      </button>
      <button
        class="btn btn-secondary gap-2 text-xs uppercase tracking-wider font-bold"
        onclick={() => loadCustomers(true)}
      >
        {#if isLoading}
          <Loader2 size={14} class="animate-spin" />
        {:else}
          <Download size={14} />
        {/if}
        Refresh
      </button>
    </div>
  </div>

  {#if isLoading && customers.length === 0}
    <div class="bg-bg-card border border-border overflow-hidden shadow-md">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-white/5 border-b border-border">
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Customer</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">External ID</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Provider</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Joined</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Status</th>
            <th class="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/50">
          {#each Array(5) as _}
            <tr>
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <Skeleton class="w-8 h-8 rounded-full" />
                  <div class="space-y-2">
                    <Skeleton class="h-4 w-32" />
                    <Skeleton class="h-3 w-48" />
                  </div>
                </div>
              </td>
              <td class="px-6 py-4">
                <Skeleton class="h-4 w-24" />
              </td>
              <td class="px-6 py-4">
                <Skeleton class="h-4 w-20" />
              </td>
              <td class="px-6 py-4">
                <Skeleton class="h-4 w-24" />
              </td>
              <td class="px-6 py-4">
                <Skeleton class="h-5 w-16" />
              </td>
              <td class="px-6 py-4"></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if customers.length === 0}
    <div class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center shadow-md">
      <div class="w-12 h-12 bg-white/5 flex items-center justify-center mb-4">
        <Users size={24} class="text-zinc-500" />
      </div>
      <h3 class="text-lg font-bold text-white mb-2">
        {searchQuery ? "No matching customers" : "No customers yet"}
      </h3>
      <p class="text-zinc-500 max-w-sm mb-6 text-sm">
        {searchQuery 
          ? "Try a different search term or clear the filter." 
          : "Customers will appear here once they subscribe to a plan or are added manually via the API."}
      </p>
    </div>
  {:else}
    <!-- Table -->
    <div class="bg-bg-card border border-border overflow-hidden shadow-md">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-white/5 border-b border-border">
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Customer</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">External ID</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Provider</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Joined</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Status</th>
            <th class="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/50">
          {#each customers as customer}
            <tr
              class="group hover:bg-white/2 transition-colors cursor-pointer {selectedCustomerId === customer.id ? 'bg-white/5' : ''}"
              onclick={() => { selectedCustomerId = customer.id; openMenuId = null; }}
            >
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent font-bold text-xs uppercase">
                    {customer.email[0]}
                  </div>
                  <div>
                    <div class="text-sm font-bold text-white">{customer.name || 'Anonymous'}</div>
                    <div class="text-[10px] text-zinc-500 font-mono">{customer.email}</div>
                  </div>
                </div>
              </td>
              <td class="px-6 py-4 text-xs font-mono text-zinc-400">
                {customer.externalId || '—'}
              </td>
              <td class="px-6 py-4">
                <ProviderBadge providerId={customer.providerId} />
              </td>
              <td class="px-6 py-4 text-xs text-zinc-500">
                {formatDate(customer.createdAt)}
              </td>
              <td class="px-6 py-4">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  Active
                </span>
              </td>
              <td class="px-6 py-4 text-right">
                <div class="relative">
                  <button
                    class="p-1 text-zinc-500 hover:text-white transition-colors"
                    onclick={(e) => {
                      e.stopPropagation();
                      openMenuId = openMenuId === customer.id ? null : customer.id;
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>

                  {#if openMenuId === customer.id}
                    <div 
                      class="absolute right-0 mt-2 w-40 bg-bg-card border border-border shadow-xl z-10 py-1"
                      transition:fade={{ duration: 100 }}
                    >
                      <button 
                        class="w-full text-left px-4 py-2 text-xs text-zinc-300 hover:bg-white/5 hover:text-white flex items-center gap-2"
                        onclick={(e) => { e.stopPropagation(); copyId(customer.id); }}
                      >
                        <Copy size={14} />
                        Copy ID
                      </button>
                      <button 
                        class="w-full text-left px-4 py-2 text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                        onclick={(e) => { e.stopPropagation(); deleteCustomer(customer.id); }}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Load More -->
    {#if hasMore}
      <div class="flex justify-center mt-4">
        <button
          class="btn btn-secondary gap-2 text-xs uppercase tracking-wider font-bold"
          disabled={isLoadingMore}
          onclick={() => loadCustomers(false)}
        >
          {#if isLoadingMore}
            <Loader2 size={14} class="animate-spin" />
          {:else}
            <ChevronDown size={14} />
          {/if}
          Load more ({totalCount - currentOffset} remaining)
        </button>
      </div>
    {/if}
  {/if}
</div>

<!-- Customer Detail Sidebar -->
<SidePanel
  open={!!selectedCustomerId}
  title={selectedCustomer?.name || selectedCustomer?.email || "Customer"}
  onclose={() => { selectedCustomerId = null; }}
>
  {#if selectedCustomerId}
    <CustomerDetail customerId={selectedCustomerId} />
  {/if}
</SidePanel>
