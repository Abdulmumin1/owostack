<script lang="ts">
  import {
    MagnifyingGlass,
    Users,
    CircleNotch,
    CaretLeft,
    CaretRight,
    Check,
  } from "phosphor-svelte";
  import Modal from "$lib/components/ui/Modal.svelte";
  import Avatar from "$lib/components/ui/Avatar.svelte";
  import { apiFetch } from "$lib/auth-client";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  let {
    open = $bindable(false),
    organizationId,
    selectedId = $bindable(""),
    onSelect,
  } = $props();

  let customers = $state<any[]>([]);
  let totalCount = $state(0);
  let currentPage = $state(1);
  const pageSize = 10;
  let isLoading = $state(false);
  let searchQuery = $state("");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const totalPages = $derived(Math.ceil(totalCount / pageSize) || 1);
  const startItem = $derived((currentPage - 1) * pageSize + 1);
  const endItem = $derived(Math.min(currentPage * pageSize, totalCount));
  const hasPrevious = $derived(currentPage > 1);
  const hasNext = $derived(currentPage < totalPages);

  async function loadCustomers() {
    if (!organizationId || !open) return;
    isLoading = true;
    try {
      const offset = (currentPage - 1) * pageSize;
      const params = new URLSearchParams();
      params.set("organizationId", organizationId);
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
      console.error(e);
    } finally {
      isLoading = false;
    }
  }

  function goToPage(pageNum: number) {
    if (pageNum < 1 || pageNum > totalPages) return;
    currentPage = pageNum;
    loadCustomers();
  }

  function onSearchInput() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentPage = 1;
      loadCustomers();
    }, 300);
  }

  let wasOpen = $state(false);
  $effect(() => {
    if (open && !wasOpen) {
      const needsReload = searchQuery !== "" || customers.length === 0;
      searchQuery = "";
      currentPage = 1;
      if (needsReload) {
        loadCustomers();
      }
    }
    wasOpen = open;
  });

  function selectCustomer(customer: any | null) {
    if (customer) {
      selectedId = customer.id;
      if (onSelect) onSelect(customer.id, customer.name || customer.email);
    } else {
      selectedId = "";
      if (onSelect) onSelect("", "All Customers");
    }
    open = false;
  }

  function getPageNumbers(current: number, total: number): (number | string)[] {
    if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 3) return [1, 2, 3, 4, "...", total];
    if (current >= total - 2)
      return [1, "...", total - 3, total - 2, total - 1, total];
    return [1, "...", current - 1, current, current + 1, "...", total];
  }
</script>

<Modal
  bind:open
  title="Select Customer"
  width="max-w-md"
  onclose={() => (open = false)}
>
  <div
    class="px-5 py-3 border-b border-border flex items-center justify-between gap-4 sticky top-0 bg-bg-card z-10"
  >
    <div class="input-icon-wrapper w-full">
      <MagnifyingGlass size={14} class="input-icon-left text-text-dim" />
      <input
        type="text"
        placeholder="Search by email, name or ID..."
        bind:value={searchQuery}
        oninput={onSearchInput}
        class="input input-has-icon-left"
      />
    </div>
  </div>

  <div class="flex flex-col min-h-[360px] max-h-[50vh] overflow-y-auto">
    <!-- All Customers Sticky Option -->
    <button
      class="w-full flex items-center gap-3 px-5 py-3 border-b border-border border-b-2 hover:bg-bg-secondary transition-colors text-left {selectedId ===
      ''
        ? 'bg-bg-secondary sticky top-0 z-20 shadow-sm'
        : ''}"
      onclick={() => selectCustomer(null)}
    >
      <div
        class="w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center border border-border"
      >
        <Users size={16} class="text-text-dim" weight="duotone" />
      </div>
      <div class="flex-1">
        <div class="text-sm font-bold text-text-primary">All Customers</div>
        <div
          class="text-[10px] text-text-dim font-mono uppercase tracking-widest"
        >
          Aggregate usage
        </div>
      </div>
      {#if selectedId === ""}
        <Check size={16} class="text-accent" weight="bold" />
      {/if}
    </button>

    {#if isLoading && customers.length === 0}
      <div class="p-5 space-y-4">
        {#each Array(4) as _}
          <div class="flex items-center gap-3 py-2 border-b border-border/50">
            <Skeleton class="w-8 h-8 rounded-full" />
            <div class="space-y-2">
              <Skeleton class="h-4 w-32" />
              <Skeleton class="h-3 w-48" />
            </div>
          </div>
        {/each}
      </div>
    {:else if customers.length === 0}
      <div
        class="p-12 flex flex-col items-center justify-center text-center flex-1"
      >
        <div
          class="w-12 h-12 bg-bg-secondary flex items-center justify-center mb-4 rounded-full"
        >
          <Users size={24} class="text-text-dim" weight="duotone" />
        </div>
        <h3
          class="text-xs font-bold text-text-primary uppercase tracking-widest mb-1"
        >
          {searchQuery ? "No matching customers" : "No customers"}
        </h3>
        <p class="text-[10px] text-text-dim uppercase tracking-widest max-w-sm">
          {searchQuery
            ? "Try a different search term"
            : "No customers found for this organization"}
        </p>
      </div>
    {:else}
      <div class="flex-1">
        {#each customers as customer}
          <button
            class="w-full flex items-center gap-3 px-5 py-3 border-b border-border hover:bg-bg-card-hover transition-colors text-left {selectedId ===
            customer.id
              ? 'bg-bg-card-hover'
              : ''}"
            onclick={() => selectCustomer(customer)}
          >
            <div
              class="w-8 h-8 rounded-full overflow-hidden shrink-0 border border-border"
            >
              <Avatar name={customer.email} size={32} />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-bold text-text-primary truncate">
                {customer.name || customer.email}
              </div>
              <div class="text-[10px] text-text-dim font-mono truncate">
                {customer.externalId || customer.id}
              </div>
            </div>
            {#if selectedId === customer.id}
              <Check size={16} class="text-accent shrink-0" weight="bold" />
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if customers.length > 0}
    <!-- Pagination Footer -->
    <div
      class="flex items-center justify-between px-5 py-3 border-t border-border mt-auto bg-bg-secondary/50 shrink-0"
    >
      <div
        class="text-[10px] text-text-dim uppercase font-bold tracking-widest"
      >
        {startItem}-{endItem} of {totalCount}
      </div>
      <div class="flex items-center gap-1">
        <button
          class="btn btn-secondary !p-1 border border-border disabled:opacity-50"
          disabled={!hasPrevious}
          onclick={() => goToPage(currentPage - 1)}
        >
          <CaretLeft size={14} weight="bold" />
        </button>
        {#each getPageNumbers(currentPage, totalPages) as pageNum}
          {#if pageNum === "..."}
            <span class="text-xs text-text-dim px-1 font-bold">...</span>
          {:else}
            <button
              class="btn {currentPage === pageNum
                ? 'btn-primary'
                : 'bg-bg-card hover:bg-bg-secondary text-text-primary border border-border'} !px-2 !py-0.5 text-[10px] font-bold"
              onclick={() => goToPage(pageNum as number)}
            >
              {pageNum}
            </button>
          {/if}
        {/each}
        <button
          class="btn btn-secondary !p-1 border border-border disabled:opacity-50"
          disabled={!hasNext}
          onclick={() => goToPage(currentPage + 1)}
        >
          <CaretRight size={14} weight="bold" />
        </button>
      </div>
    </div>
  {/if}
</Modal>
