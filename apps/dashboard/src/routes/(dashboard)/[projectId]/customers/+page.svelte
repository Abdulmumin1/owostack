<script lang="ts">
  import {
    CaretLeft,
    CaretRight,
    CircleNotch,
    Copy,
    DotsThree,
    DownloadSimple,
    Funnel,
    MagnifyingGlass,
    Plus,
    Trash,
    Users,
  } from "phosphor-svelte";
  import { page } from "$app/state";
  import { fade } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import { onMount } from "svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import CustomerDetail from "$lib/components/customers/CustomerDetail.svelte";
  import CreateCustomerModal from "$lib/components/customers/CreateCustomerModal.svelte";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import Avatar from "$lib/components/ui/Avatar.svelte";

  // Pagination options
  const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

  const organizationId = $derived(page.params.projectId ?? "");
  let customers = $state<any[]>([]);
  let totalCount = $state(0);
  let currentPage = $state(1);
  let pageSize = $state(25);
  let isLoading = $state(true);
  let searchQuery = $state("");
  let openMenuId = $state<string | null>(null);
  let selectedCustomerId = $state<string | null>(null);
  let showCreateCustomerModal = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Computed values
  const totalPages = $derived(Math.ceil(totalCount / pageSize) || 1);
  const startItem = $derived((currentPage - 1) * pageSize + 1);
  const endItem = $derived(Math.min(currentPage * pageSize, totalCount));
  const hasPrevious = $derived(currentPage > 1);
  const hasNext = $derived(currentPage < totalPages);

  const selectedCustomer = $derived(
    customers.find((c) => c.id === selectedCustomerId),
  );

  async function loadCustomers() {
    if (!organizationId) return;

    isLoading = true;

    try {
      const offset = (currentPage - 1) * pageSize;
      const params = new URLSearchParams();
      params.set("organizationId", organizationId ?? "");
      params.set("limit", String(pageSize));
      params.set("offset", String(offset));
      if (searchQuery.trim()) {
        params.set("search", searchQuery.trim());
      }

      const res = await apiFetch(`/api/dashboard/customers?${params}`);
      if (res.data?.success) {
        customers = res.data.data;
        totalCount = Number(res.data.total) || 0;
      }
    } catch (e) {
      console.error("Failed to load customers", e);
    } finally {
      isLoading = false;
    }
  }

  function goToPage(pageNum: number) {
    if (pageNum < 1 || pageNum > totalPages) return;
    currentPage = pageNum;
    loadCustomers();
  }

  function changePageSize(newSize: number) {
    pageSize = newSize;
    currentPage = 1;
    loadCustomers();
  }

  async function deleteCustomer(id: string) {
    if (
      !confirm(
        "Are you sure you want to delete this customer? This will also remove their subscriptions.",
      )
    )
      return;

    try {
      const res = await apiFetch(`/api/dashboard/customers/${id}`, {
        method: "DELETE",
      });
      if (res.data?.success) {
        customers = customers.filter((c) => c.id !== id);
        totalCount = Math.max(0, totalCount - 1);
        if (selectedCustomerId === id) selectedCustomerId = null;
        if (customers.length === 0 && currentPage > 1) {
          currentPage--;
          loadCustomers();
        }
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
      currentPage = 1;
      loadCustomers();
    }, 300);
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest(".dropdown-container")) {
      openMenuId = null;
    }
  }

  onMount(() => {
    loadCustomers();
    document.addEventListener("click", handleClickOutside);
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  });

  function formatDate(date: string | number) {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function getPageNumbers(current: number, total: number): (number | string)[] {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    if (current <= 3) {
      return [1, 2, 3, 4, "...", total];
    }

    if (current >= total - 2) {
      return [1, "...", total - 3, total - 2, total - 1, total];
    }

    return [1, "...", current - 1, current, current + 1, "...", total];
  }
</script>

<svelte:head>
  <title>Customers - Owostack</title>
</svelte:head>

<div class="max-w-6xl">
  <div class="mb-8">
    <h1 class="text-xl font-bold text-text-primary mb-2">Customers</h1>
    <p class="text-text-dim text-xs uppercase tracking-widest font-semibold">
      View and manage your subscriber base
      {#if totalCount > 0}
        <span class="text-text-dim/60 ml-2">· {totalCount} total</span>
      {/if}
    </p>
  </div>

  <!-- Toolbar -->
  <div class="flex items-center justify-between gap-4 mb-6">
    <div class="input-icon-wrapper max-w-sm">
      <MagnifyingGlass size={14} class="input-icon-left text-text-dim" />
      <input
        type="text"
        placeholder="Search by email, name or ID..."
        bind:value={searchQuery}
        oninput={onSearchInput}
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

      <button
        class="btn btn-secondary gap-2 text-xs uppercase tracking-wider font-bold"
      >
        <Funnel size={14} weight="duotone" />
        Filter
      </button>
      <button
        class="btn btn-secondary gap-2 text-xs uppercase tracking-wider font-bold"
        onclick={() => loadCustomers()}
      >
        {#if isLoading}
          <CircleNotch size={14} class="animate-spin" weight="duotone" />
        {:else}
          <DownloadSimple size={14} weight="duotone" />
        {/if}
        Refresh
      </button>
      <button
        class="btn btn-primary gap-2 text-xs uppercase tracking-wider font-bold"
        onclick={() => (showCreateCustomerModal = true)}
      >
        <Plus size={14} weight="fill" />
        Create Customer
      </button>
    </div>
  </div>

  {#if isLoading && customers.length === 0}
    <div class="table-container !overflow-visible">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-bg-secondary border-b border-border">
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Customer</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >External ID</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Provider</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Joined</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Status</th
            >
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
    <div
      class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center"
    >
      <div
        class="w-12 h-12 bg-bg-secondary flex items-center justify-center mb-4"
      >
        <Users size={24} class="text-text-dim" weight="duotone" />
      </div>
      <h3 class="text-lg font-bold text-text-primary mb-2">
        {searchQuery ? "No matching customers" : "No customers yet"}
      </h3>
      <p class="text-text-dim max-w-sm mb-6 text-sm">
        {searchQuery
          ? "Try a different search term or clear the filter."
          : "Customers will appear here once they subscribe to a plan or are added manually."}
      </p>
      {#if !searchQuery}
        <button
          class="btn btn-primary gap-2"
          onclick={() => (showCreateCustomerModal = true)}
        >
          <Plus size={14} weight="fill" />
          Create First Customer
        </button>
      {/if}
    </div>
  {:else}
    <!-- Table -->
    <div class="table-container !overflow-visible">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-bg-secondary border-b border-border">
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Customer</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >External ID</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Provider</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Joined</th
            >
            <!-- <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Status</th
            > -->
            <th class="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/50">
          {#each customers as customer}
            <tr
              class="group hover:bg-bg-tertiary transition-colors cursor-pointer {selectedCustomerId ===
              customer.id
                ? 'bg-bg-secondary'
                : ''} {openMenuId === customer.id ? 'relative z-20' : ''}"
              onclick={() => {
                selectedCustomerId = customer.id;
                openMenuId = null;
              }}
            >
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full overflow-hidden">
                    <Avatar name={customer.email} size={32} />
                  </div>
                  <div>
                    <div class="text-sm font-bold text-text-primary">
                      {customer.name || "Anonymous"}
                    </div>
                    <div class="text-[10px] text-text-dim font-mono">
                      {customer.email}
                    </div>
                  </div>
                </div>
              </td>
              <td class="px-6 py-4 text-xs font-mono text-text-dim">
                {customer.externalId || "—"}
              </td>
              <td class="px-6 py-4">
                <ProviderBadge providerId={customer.providerId} />
              </td>
              <td class="px-6 py-4 text-xs text-text-dim">
                {formatDate(customer.createdAt)}
              </td>
              <!-- <td class="px-6 py-4">
                <span
                  class="inline-flex items-center px-2 rounded text-[9px] font-bold uppercase tracking-wider bg-success-bg text-success border border-success/20"
                >
                  Active
                </span>
              </td> -->
              <td class="px-6 py-4 text-right">
                <div class="relative dropdown-container">
                  <button
                    class="p-1 text-text-dim hover:text-text-primary transition-colors"
                    onclick={(e) => {
                      e.stopPropagation();
                      openMenuId =
                        openMenuId === customer.id ? null : customer.id;
                    }}
                  >
                    <DotsThree size={16} weight="duotone" />
                  </button>

                  {#if openMenuId === customer.id}
                    <div
                      class="absolute right-0 mt-2 w-40 bg-bg-card border border-border z-[100] py-1 rounded shadow-sm"
                      transition:fade={{ duration: 100 }}
                      onclick={(e) => e.stopPropagation()}
                    >
                      <button
                        class="w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-bg-secondary hover:text-text-primary flex items-center gap-2"
                        onclick={(e) => {
                          e.stopPropagation();
                          copyId(customer.id);
                        }}
                      >
                        <Copy size={14} weight="fill" />
                        Copy ID
                      </button>
                      <button
                        class="w-full text-left px-4 py-2 text-xs text-error hover:bg-error-bg flex items-center gap-2"
                        onclick={(e) => {
                          e.stopPropagation();
                          deleteCustomer(customer.id);
                        }}
                      >
                        <Trash size={14} weight="fill" />
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

    <!-- Pagination -->
    <div class="flex items-center rounded justify-between px-4 py-4">
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
            {#if pageNum === "..."}
              <span class="text-xs text-text-dim px-2">...</span>
            {:else}
              <button
                class="btn btn-sm !px-3 !py-1 text-xs {currentPage === pageNum
                  ? 'btn-primary'
                  : 'btn-secondary'}"
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

<!-- Customer Detail Sidebar -->
<SidePanel
  open={!!selectedCustomerId}
  title={selectedCustomer?.name || selectedCustomer?.email || "Customer"}
  onclose={() => {
    selectedCustomerId = null;
  }}
>
  {#if selectedCustomerId}
    <CustomerDetail customerId={selectedCustomerId} />
  {/if}
</SidePanel>

<CreateCustomerModal
  bind:isOpen={showCreateCustomerModal}
  {organizationId}
  onsuccess={(customer) => {
    loadCustomers();
    selectedCustomerId = customer.id;
  }}
/>
