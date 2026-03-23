<script lang="ts">
  import {
    PlusIcon,
    UsersIcon,
    CaretLeft,
    CaretRight,
  } from "phosphor-svelte";
  import Avatar from "$lib/components/ui/Avatar.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  let {
    subscribers = [],
    isLoading = false,
    totalCount = 0,
    currentPage = 1,
    pageSize = 10,
    statusFilter = "active",
    onStatusFilterChange = (_status: string) => {},
    onAttachCustomer = () => {},
    onGenerateCheckout = (_subscriptionId: string) => {},
    onActivate = (_subscriptionId: string) => {},
    onPageChange = (_page: number) => {},
  }: {
    subscribers?: any[];
    isLoading?: boolean;
    totalCount?: number;
    currentPage?: number;
    pageSize?: number;
    statusFilter?: string;
    onStatusFilterChange?: (status: string) => void;
    onAttachCustomer?: () => void;
    onGenerateCheckout?: (subscriptionId: string) => void;
    onActivate?: (subscriptionId: string) => void;
    onPageChange?: (page: number) => void;
  } = $props();

  const totalPages = $derived(Math.ceil(totalCount / pageSize));
  const hasNext = $derived(currentPage < totalPages);
  const hasPrevious = $derived(currentPage > 1);

  const startItem = $derived((currentPage - 1) * pageSize + 1);
  const endItem = $derived(Math.min(currentPage * pageSize, totalCount));

  function getPageNumbers(current: number, total: number): (number | string)[] {
    if (total <= 5) {
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

<section class="space-y-4">
  <div class="flex items-center justify-between px-1 pb-2">
    <h2
      class="text-sm font-semibold text-text-secondary flex items-center gap-2"
    >
      <UsersIcon class="text-tertiary" size={18} weight="duotone" /> Subscribers
      {#if totalCount > 0}
        <span class="text-text-muted font-normal">&middot; {totalCount}</span>
      {/if}
    </h2>

    <div class="flex items-center gap-2">
      <select
        class="input input-sm !py-1 !px-2 !w-auto text-xs"
        value={statusFilter}
        onchange={(e) => onStatusFilterChange(e.currentTarget.value)}
      >
        <option value="all">All</option>
        <option value="active">Active</option>
        <option value="pending">Pending</option>
        <option value="pending_cancel">Pending Cancel</option>
        <option value="canceled">Canceled</option>
        <option value="past_due">Past Due</option>
      </select>

      <button class="btn btn-secondary btn-sm gap-1.5" onclick={onAttachCustomer}>
        <PlusIcon size={14} weight="bold" /> Attach
      </button>
    </div>
  </div>

  <div
    class="bg-bg-card border border-border divide-y divide-border/50 rounded-lg overflow-hidden"
  >
    {#if isLoading}
      <div class="p-4 space-y-3">
        {#each Array(2) as _}
          <div class="flex items-center gap-3">
            <Skeleton class="w-8 h-8 rounded-full" />
            <Skeleton class="h-4 flex-1" />
          </div>
        {/each}
      </div>
    {:else if subscribers.length > 0}
      {#each subscribers as subscriber}
        <div
          class="p-4 flex items-center justify-between hover:bg-bg-card-hover transition-colors group"
        >
          <div class="flex items-center gap-3 min-w-0">
            <div
              class="w-10 h-10 rounded-full border border-border bg-bg-primary overflow-hidden flex-shrink-0"
            >
              <Avatar name={subscriber.customer?.email || "?"} size={40} />
            </div>
            <div class="flex flex-col min-w-0">
              <span class="text-sm font-semibold text-text-primary truncate">
                {subscriber.customer?.name ||
                  subscriber.customer?.email ||
                  "Unknown"}
              </span>
              <span class="text-xs text-text-muted font-mono truncate">
                {subscriber.customer?.email || subscriber.customerId}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            {#if subscriber.status === "pending"}
              <button
                class="text-xs font-semibold text-warning hover:underline uppercase p-0"
                onclick={() => onGenerateCheckout(subscriber.id)}
              >
                Link
              </button>
              <button
                class="text-xs font-semibold text-text-secondary hover:text-text-primary uppercase p-0"
                onclick={() => onActivate(subscriber.id)}
              >
                Act
              </button>
            {:else}
              <span
                class="badge {subscriber.status === 'active'
                  ? 'badge-success'
                  : 'badge-default'} uppercase"
              >
                {subscriber.status}
              </span>
            {/if}
          </div>
        </div>
      {/each}
    {:else}
      <div class="p-8 text-center">
        <span class="text-sm text-text-muted">No subscribers.</span>
      </div>
    {/if}
  </div>

  {#if totalPages > 1}
    <div
      class="flex items-center justify-between px-1 py-2"
    >
      <div class="text-[10px] text-text-dim font-medium uppercase tracking-wider">
        Showing {startItem}-{endItem} of {totalCount}
      </div>
      <div class="flex items-center gap-1">
        <button
          class="p-1.5 rounded bg-bg-secondary border border-border disabled:opacity-30 disabled:cursor-not-allowed hover:bg-bg-card transition-colors"
          disabled={!hasPrevious}
          onclick={() => onPageChange(currentPage - 1)}
          aria-label="Previous page"
        >
          <CaretLeft size={14} weight="bold" class="text-text-dim" />
        </button>

        <div class="flex items-center gap-1">
          {#each getPageNumbers(currentPage, totalPages) as pageNum}
            {#if pageNum === "..."}
              <span class="text-[10px] text-text-dim px-1">...</span>
            {:else}
              <button
                class="min-w-[28px] h-7 flex items-center justify-center rounded text-[10px] font-bold transition-all {currentPage ===
                pageNum
                  ? 'btn btn-primary'
                  : 'bg-bg-secondary border border-border text-text-dim hover:text-text-primary hover:border-border-strong'}"
                onclick={() => onPageChange(pageNum as number)}
              >
                {pageNum}
              </button>
            {/if}
          {/each}
        </div>

        <button
          class="p-1.5 rounded bg-bg-secondary border border-border disabled:opacity-30 disabled:cursor-not-allowed hover:bg-bg-card transition-colors"
          disabled={!hasNext}
          onclick={() => onPageChange(currentPage + 1)}
          aria-label="Next page"
        >
          <CaretRight size={14} weight="bold" class="text-text-dim" />
        </button>
      </div>
    </div>
  {/if}
</section>
