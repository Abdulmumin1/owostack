<script lang="ts">
  import { ArrowRight, ArrowsClockwise, CaretLeft, CaretRight, CircleNotch, Clock, Funnel, Globe, Lightning, MagnifyingGlass, User } from "phosphor-svelte";
  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import { onMount } from "svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import EventDetail from "$lib/components/events/EventDetail.svelte";

  // Pagination options
  const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

  const organizationId = $derived(page.params.projectId);
  let events = $state<any[]>([]);
  let totalCount = $state(0);
  let currentPage = $state(1);
  let pageSize = $state(20);
  let isLoading = $state(true);
  let searchQuery = $state("");
  let selectedEventId = $state<string | null>(null);

  // Computed values
  const totalPages = $derived(Math.ceil(totalCount / pageSize) || 1);
  const startItem = $derived((currentPage - 1) * pageSize + 1);
  const endItem = $derived(Math.min(currentPage * pageSize, totalCount));
  const hasPrevious = $derived(currentPage > 1);
  const hasNext = $derived(currentPage < totalPages);

  async function loadEvents() {
    if (!organizationId) return;
    
    isLoading = true;

    try {
      const offset = (currentPage - 1) * pageSize;
      const params = new URLSearchParams();
      params.set("organizationId", organizationId ?? "");
      params.set("limit", String(pageSize));
      params.set("offset", String(offset));

      const res = await apiFetch(`/api/dashboard/events?${params}`);
      if (res.data?.success) {
        events = res.data.data;
        totalCount = Number(res.data.total) || 0;
      }
    } catch (e) {
      console.error("Failed to load events", e);
    } finally {
      isLoading = false;
    }
  }

  function goToPage(pageNum: number) {
    if (pageNum < 1 || pageNum > totalPages) return;
    currentPage = pageNum;
    loadEvents();
  }

  function changePageSize(newSize: number) {
    pageSize = newSize;
    currentPage = 1;
    loadEvents();
  }

  onMount(() => {
    loadEvents();
  });

  function formatRelativeTime(date: string) {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  }

  const filteredEvents = $derived(
    events.filter(e => 
      !searchQuery || 
      e.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.customer?.email && e.customer.email.toLowerCase().includes(searchQuery.toLowerCase()))
    )
  );

  function getEventIcon(type: string) {
    if (type.startsWith("subscription")) return Clock;
    if (type.startsWith("customer")) return User;
    if (type.startsWith("payment") || type.startsWith("charge")) return Lightning;
    return Globe;
  }

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
  <title>Events - Owostack</title>
</svelte:head>

<div class="max-w-6xl">
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1 class="text-xl font-bold text-text-primary mb-2">Events</h1>
      <p class="text-text-dim text-xs uppercase tracking-widest font-semibold">
        Real-time log of all system activity
        {#if totalCount > 0}
          <span class="text-text-dim/60 ml-2">· {totalCount} total</span>
        {/if}
      </p>
    </div>

    <button
      class="btn btn-secondary gap-2 text-xs uppercase tracking-wider font-bold"
      onclick={() => loadEvents()}
    >
      <ArrowsClockwise   size={14} class={isLoading ? "animate-spin" : ""}  weight="fill" />
      Refresh
    </button>
  </div>

  <!-- Toolbar with search and rows per page -->
  <div class="flex items-center justify-between gap-4 mb-6">
    <div class="input-icon-wrapper max-w-sm">
      <MagnifyingGlass  
        size={14}
        class="input-icon-left text-text-dim"
       weight="fill" />
      <input
        type="text"
        placeholder="Filter loaded events..."
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

  {#if isLoading && events.length === 0}
    <div class="table-container">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-bg-secondary border-b border-border">
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Type</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Customer</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Date</th>
            <th class="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/50">
          {#each Array(5) as _}
            <tr>
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <Skeleton class="w-8 h-8 rounded" />
                  <Skeleton class="h-4 w-32" />
                </div>
              </td>
              <td class="px-6 py-4">
                <Skeleton class="h-4 w-48" />
              </td>
              <td class="px-6 py-4">
                <Skeleton class="h-4 w-24" />
              </td>
              <td class="px-6 py-4"></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if filteredEvents.length === 0}
    <div class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center rounded-lg">
      <div class="w-12 h-12 bg-bg-secondary flex items-center justify-center mb-4">
        <Globe   size={24} class="text-text-dim"  weight="duotone" />
      </div>
      <h3 class="text-lg font-bold text-text-primary mb-2">
        {searchQuery ? "No matching events" : "No events found"}
      </h3>
      <p class="text-text-dim max-w-sm text-sm">
        {searchQuery ? "Try a different filter." : "Events will appear here when your integration starts processing requests."}
      </p>
    </div>
  {:else}
    <!-- Events Table -->
    <div class="table-container">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-bg-secondary border-b border-border">
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Type</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Customer</th>
            <th class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest">Date</th>
            <th class="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/50">
          {#each filteredEvents as event}
            <tr
              class="group hover:bg-bg-tertiary transition-colors cursor-pointer {selectedEventId === event.id ? 'bg-bg-secondary' : ''}"
              onclick={() => selectedEventId = event.id}
            >
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 bg-bg-secondary border border-border flex items-center justify-center rounded shrink-0">
                    <svelte:component this={getEventIcon(event.type)} weight="duotone" />
                  </div>
                  <div>
                    <div class="text-sm font-bold text-text-primary">{event.type}</div>
                    <div class="text-[10px] font-mono text-text-dim">{event.id.split('-')[0]}</div>
                  </div>
                </div>
              </td>
              <td class="px-6 py-4">
                {#if event.customer}
                  <div class="text-sm font-medium text-text-secondary">{event.customer.email}</div>
                  {#if event.customer.name}
                    <div class="text-[10px] text-text-dim">{event.customer.name}</div>
                  {/if}
                {:else}
                  <span class="text-xs text-text-dim italic">System event</span>
                {/if}
              </td>
              <td class="px-6 py-4">
                <div class="text-xs font-bold text-text-secondary uppercase tracking-widest">
                  {formatRelativeTime(event.createdAt)}
                </div>
                <div class="text-[9px] text-text-dim font-mono">
                  {new Date(event.createdAt).toLocaleString()}
                </div>
              </td>
              <td class="px-6 py-4 text-right">
                <ArrowRight   size={14} class="text-text-dim/20 group-hover:text-text-dim transition-colors ml-auto"  weight="fill" />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="flex items-center justify-between px-4 py-4 border-t border-border bg-bg-secondary mt-4">
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

<!-- Event Detail Sidebar -->
<SidePanel
  open={!!selectedEventId}
  title={selectedEventId ? "Event Details" : ""}
  onclose={() => { selectedEventId = null; }}
>
  {#if selectedEventId}
    <EventDetail eventId={selectedEventId}  />
  {/if}
</SidePanel>