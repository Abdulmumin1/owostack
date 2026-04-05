<script lang="ts">
  import {
    PlusIcon,
    UsersIcon,
    CaretLeft,
    CaretRight,
    EnvelopeSimple,
    User,
    Link as LinkIcon,
    Lightning,
  } from "phosphor-svelte";
  import Avatar from "$lib/components/ui/Avatar.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import { slide, fade } from "svelte/transition";

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
    onOpenCustomer = (_customerId: string) => {},
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
    onOpenCustomer?: (customerId: string) => void;
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

  function getStatusStyle(status: string) {
    switch (status.toLowerCase()) {
      case "active":
        return "text-emerald-500 bg-emerald-500/5 border-emerald-500/10";
      case "pending":
        return "text-amber-500 bg-amber-500/5 border-amber-500/10";
      case "canceled":
      case "cancelled":
        return "text-rose-500 bg-rose-500/5 border-rose-500/10";
      case "past_due":
        return "text-red-500 bg-red-500/5 border-red-500/10";
      default:
        return "text-text-dim bg-bg-secondary border-border";
    }
  }
</script>

<section class="space-y-3">
  <div class="flex items-center justify-between px-1">
    <h2 class="text-[11px] font-bold text-text-dim uppercase tracking-wider flex items-center gap-2">
      <UsersIcon class="text-text-dim" size={14} weight="bold" /> Subscribers
      {#if totalCount > 0}
        <span class="px-1.5 py-0.5 rounded-full bg-tertiary/10 text-tertiary text-[10px] font-bold border border-tertiary/20 ml-1">
          {totalCount}
        </span>
      {/if}
    </h2>

    <div class="flex items-center gap-2">
      <select
        class="input input-sm !h-7 !py-0 !px-2 !w-auto text-[10px] font-bold uppercase tracking-tight bg-bg-secondary border-border/60"
        value={statusFilter}
        onchange={(e) => onStatusFilterChange(e.currentTarget.value)}
      >
        <option value="all">ALL STATUS</option>
        <option value="active">ACTIVE</option>
        <option value="pending">PENDING</option>
        <option value="pending_cancel">PENDING CANCEL</option>
        <option value="canceled">CANCELED</option>
        <option value="past_due">PAST DUE</option>
      </select>

      <button class="btn btn-secondary btn-sm h-7 gap-1.5" onclick={onAttachCustomer}>
        <PlusIcon size={12} weight="bold" /> Attach
      </button>
    </div>
  </div>

  <div class="bg-bg-card border border-border divide-y divide-border/40 rounded-xl overflow-hidden">
    {#if isLoading}
      <div class="px-3 py-4 space-y-3">
        {#each Array(3) as _}
          <div class="flex items-center gap-3">
            <Skeleton class="w-7 h-7 rounded-full" />
            <div class="space-y-1.5 flex-1">
              <Skeleton class="h-3 w-1/4" />
              <Skeleton class="h-2 w-1/3" />
            </div>
          </div>
        {/each}
      </div>
    {:else if subscribers.length > 0}
      {#each subscribers as subscriber}
        <div
          role="button"
          tabindex="0"
          class="px-3 py-2 flex items-center justify-between hover:bg-bg-card-hover/30 transition-all duration-200 group cursor-pointer"
          onclick={() => onOpenCustomer(subscriber.customerId)}
          onkeydown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenCustomer(subscriber.customerId);
            }
          }}
        >
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <div class="w-7 h-7 rounded-full border border-border bg-bg-primary overflow-hidden shrink-0 transition-transform group-hover:scale-105">
              <Avatar name={subscriber.customer?.email || "?"} size={28} />
            </div>
            
            <div class="flex flex-col min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-text-primary truncate">
                  {subscriber.customer?.name || subscriber.customer?.email?.split('@')[0] || "Unknown"}
                </span>
                
                <div class="px-1.5 py-0.5 rounded-full {getStatusStyle(subscriber.status)} border text-[9px] font-bold uppercase tracking-tight">
                  {subscriber.status.replace('_', ' ')}
                </div>
              </div>
              
              <div class="flex items-center gap-1.5 text-[10px] text-text-muted font-medium truncate mt-0.5">
                <EnvelopeSimple size={10} class="shrink-0" />
                <span class="truncate font-mono tracking-tight opacity-70">
                  {subscriber.customer?.email || subscriber.customerId}
                </span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            {#if subscriber.status === "pending"}
              <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0">
                <button
                  class="btn btn-secondary btn-sm h-6 px-2 text-[9px] font-bold gap-1 uppercase tracking-wider text-amber-500 border-amber-500/20"
                  onclick={(event) => {
                    event.stopPropagation();
                    onGenerateCheckout(subscriber.id);
                  }}
                >
                  <LinkIcon size={10} weight="bold" /> Link
                </button>
                <button
                  class="btn btn-secondary btn-sm h-6 px-2 text-[9px] font-bold gap-1 uppercase tracking-wider text-emerald-500 border-emerald-500/20"
                  onclick={(event) => {
                    event.stopPropagation();
                    onActivate(subscriber.id);
                  }}
                >
                  <Lightning size={10} weight="fill" /> Act
                </button>
              </div>
            {/if}
            
            <div class="p-1.5 text-text-dim group-hover:text-text-primary transition-colors">
              <CaretRight size={12} weight="bold" />
            </div>
          </div>
        </div>
      {/each}
    {:else}
      <div class="py-10 px-4 text-center">
        <div class="w-10 h-10 bg-bg-secondary rounded-full flex items-center justify-center mx-auto mb-3 border border-border/40">
          <User size={20} class="text-text-dim" />
        </div>
        <p class="text-[11px] font-bold text-text-dim uppercase tracking-wider">No active subscribers</p>
        <p class="text-[10px] text-text-muted mt-1">Attach customers to this plan to start billing them.</p>
      </div>
    {/if}
  </div>

  {#if totalPages > 1}
    <div class="flex items-center justify-between px-1 py-1">
      <div class="text-[9px] text-text-dim font-bold uppercase tracking-widest opacity-60">
        Showing {startItem}-{endItem} of {totalCount}
      </div>
      
      <div class="flex items-center gap-1">
        <button
          class="p-1 h-6 w-6 flex items-center justify-center rounded bg-bg-secondary border border-border disabled:opacity-30 disabled:cursor-not-allowed hover:bg-bg-card transition-colors shadow-sm active:shadow-none"
          disabled={!hasPrevious}
          onclick={() => onPageChange(currentPage - 1)}
          aria-label="Previous page"
        >
          <CaretLeft size={10} weight="bold" class="text-text-dim" />
        </button>

        <div class="flex items-center gap-1">
          {#each getPageNumbers(currentPage, totalPages) as pageNum}
            {#if pageNum === "..."}
              <span class="text-[10px] text-text-dim px-0.5 font-bold">...</span>
            {:else}
              <button
                class="min-w-[24px] h-6 flex items-center justify-center rounded text-[10px] font-bold transition-all {currentPage === pageNum
                  ? 'bg-accent text-accent-contrast border border-accent-border'
                  : 'bg-bg-secondary border border-border text-text-dim hover:text-text-primary hover:border-border-strong'}"
                onclick={() => onPageChange(pageNum as number)}
              >
                {pageNum}
              </button>
            {/if}
          {/each}
        </div>

        <button
          class="p-1 h-6 w-6 flex items-center justify-center rounded bg-bg-secondary border border-border disabled:opacity-30 disabled:cursor-not-allowed hover:bg-bg-card transition-colors shadow-sm active:shadow-none"
          disabled={!hasNext}
          onclick={() => onPageChange(currentPage + 1)}
          aria-label="Next page"
        >
          <CaretRight size={10} weight="bold" class="text-text-dim" />
        </button>
      </div>
    </div>
  {/if}
</section>