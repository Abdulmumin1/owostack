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
  width="max-w-sm"
  onclose={() => (open = false)}
>
  <div class="p-3 border-b border-border bg-bg-secondary/30">
    <div class="relative">
      <MagnifyingGlass
        size={14}
        class="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
      />
      <input
        type="text"
        placeholder="Search customers..."
        bind:value={searchQuery}
        oninput={onSearchInput}
        class="w-full bg-bg-card border border-border rounded-lg pl-9 pr-3 py-2 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent transition-colors"
      />
    </div>
  </div>

  <div class="flex flex-col max-h-[60vh] overflow-y-auto">
    <!-- All Customers Option -->
    <button
      class="group flex items-center gap-2.5 px-3 py-2.5 hover:bg-bg-secondary/50 transition-all text-left border-b border-border/50 {selectedId ===
      ''
        ? 'bg-accent/5'
        : ''}"
      onclick={() => selectCustomer(null)}
    >
      <div
        class="w-7 h-7 rounded-full bg-bg-tertiary border border-border flex items-center justify-center shrink-0 transition-colors group-hover:border-accent/30"
      >
        <Users size={14} class="text-text-dim" weight="duotone" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-xs font-semibold text-text-primary">All Customers</div>
        <div class="text-[10px] text-text-dim">Aggregate view</div>
      </div>
      {#if selectedId === ""}
        <div
          class="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0"
        >
          <Check size={10} class="text-accent-contrast" weight="bold" />
        </div>
      {/if}
    </button>

    {#if isLoading && customers.length === 0}
      <div class="p-3 space-y-2">
        {#each Array(4) as _}
          <div class="flex items-center gap-2.5 py-2">
            <Skeleton class="w-7 h-7 rounded-full" />
            <div class="space-y-1.5 flex-1">
              <Skeleton class="h-3 w-28" />
              <Skeleton class="h-2.5 w-40" />
            </div>
          </div>
        {/each}
      </div>
    {:else if customers.length === 0}
      <div class="p-8 flex flex-col items-center justify-center text-center">
        <div
          class="w-10 h-10 bg-bg-secondary rounded-full flex items-center justify-center mb-3"
        >
          <Users size={20} class="text-text-dim" weight="duotone" />
        </div>
        <p class="text-xs font-medium text-text-primary mb-1">
          {searchQuery ? "No matches found" : "No customers"}
        </p>
        <p class="text-[10px] text-text-dim">
          {searchQuery
            ? "Try a different search"
            : "No customers in this organization"}
        </p>
      </div>
    {:else}
      <div class="py-1">
        {#each customers as customer (customer.id)}
          <button
            class="group flex items-center gap-2.5 px-3 py-2 hover:bg-bg-secondary/50 transition-all text-left w-full {selectedId ===
            customer.id
              ? 'bg-accent/5'
              : ''}"
            onclick={() => selectCustomer(customer)}
          >
            <div
              class="w-7 h-7 rounded-full overflow-hidden shrink-0 border border-border transition-all group-hover:border-accent/30"
            >
              <Avatar name={customer.email} size={28} />
            </div>
            <div class="flex-1 min-w-0">
              <div
                class="text-xs font-medium text-text-primary truncate group-hover:text-accent transition-colors"
              >
                {customer.name || customer.email}
              </div>
              <div class="text-[10px] text-text-dim font-mono truncate">
                {customer.externalId || customer.id}
              </div>
            </div>
            {#if selectedId === customer.id}
              <div
                class="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0"
              >
                <Check size={10} class="text-accent-contrast" weight="bold" />
              </div>
            {:else}
              <div
                class="w-5 h-5 rounded-full border border-border shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              ></div>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if customers.length > 0}
    <!-- Pagination Footer -->
    <div
      class="flex items-center justify-between px-3 py-2 border-t border-border bg-bg-secondary/30 shrink-0"
    >
      <div class="text-[10px] text-text-dim">
        {startItem}-{endItem} of {totalCount}
      </div>
      <div class="flex items-center gap-0.5">
        <button
          class="p-1.5 rounded hover:bg-bg-card disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          disabled={!hasPrevious}
          onclick={() => goToPage(currentPage - 1)}
          aria-label="Previous page"
        >
          <CaretLeft size={14} weight="bold" class="text-text-dim" />
        </button>
        {#each getPageNumbers(currentPage, totalPages) as pageNum}
          {#if pageNum === "..."}
            <span class="text-[10px] text-text-dim px-1">...</span>
          {:else}
            <button
              class="min-w-[24px] h-6 px-1.5 rounded text-[10px] font-medium transition-colors {currentPage ===
              pageNum
                ? 'bg-accent text-accent-contrast'
                : 'text-text-dim hover:bg-bg-card hover:text-text-primary'}"
              onclick={() => goToPage(pageNum as number)}
            >
              {pageNum}
            </button>
          {/if}
        {/each}
        <button
          class="p-1.5 rounded hover:bg-bg-card disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          disabled={!hasNext}
          onclick={() => goToPage(currentPage + 1)}
          aria-label="Next page"
        >
          <CaretRight size={14} weight="bold" class="text-text-dim" />
        </button>
      </div>
    </div>
  {/if}
</Modal>
