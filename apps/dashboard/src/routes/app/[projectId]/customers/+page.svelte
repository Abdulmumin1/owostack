<script lang="ts">
  import { Search, Filter, Download, Users, Loader2, ChevronRight, Mail, MoreHorizontal, Trash2, Copy } from "lucide-svelte";
  import { page } from "$app/state";
  import { fade } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import { onMount } from "svelte";

  const organizationId = $derived(page.params.projectId);
  let customers = $state<any[]>([]);
  let isLoading = $state(true);
  let searchQuery = $state("");
  let openMenuId = $state<string | null>(null);

  async function loadCustomers() {
    isLoading = true;
    try {
      const res = await apiFetch(`/api/dashboard/customers?organizationId=${organizationId}`);
      if (res.data) {
        customers = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load customers", e);
    } finally {
      isLoading = false;
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

  onMount(() => {
    loadCustomers();
  });

  const filteredCustomers = $derived(
    customers.filter(c => 
      c.email.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (c.name && c.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (c.externalId && c.externalId.toLowerCase().includes(searchQuery.toLowerCase()))
    )
  );

  function formatDate(date: string) {
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
    </p>
  </div>

  <!-- Toolbar -->
  <div class="flex items-center justify-between gap-4 mb-6">
    <div class="relative flex-1 max-w-sm">
      <Search
        size={14}
        class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
      />
      <input
        type="text"
        placeholder="Search by email, name or ID..."
        bind:value={searchQuery}
        class="input pl-9"
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
        onclick={loadCustomers}
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
    <div class="flex items-center gap-2 text-zinc-500 p-12 justify-center">
      <Loader2 size={16} class="animate-spin" />
      <span>Loading customers...</span>
    </div>
  {:else if filteredCustomers.length === 0}
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
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Joined</th>
            <th class="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Status</th>
            <th class="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/50">
          {#each filteredCustomers as customer}
            <tr class="group hover:bg-white/[0.02] transition-colors cursor-pointer">
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
                        onclick={() => copyId(customer.id)}
                      >
                        <Copy size={14} />
                        Copy ID
                      </button>
                      <button 
                        class="w-full text-left px-4 py-2 text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                        onclick={() => deleteCustomer(customer.id)}
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
  {/if}
</div>
