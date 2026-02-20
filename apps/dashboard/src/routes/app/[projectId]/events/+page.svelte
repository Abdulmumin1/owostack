<script lang="ts">
  import { ArrowRight, ArrowsClockwise, CaretDown, CircleNotch, Clock, Funnel, Globe, Lightning, MagnifyingGlass, User } from "phosphor-svelte";
  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import { onMount } from "svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import EventDetail from "$lib/components/events/EventDetail.svelte";

  const PAGE_SIZE = 20;

  const organizationId = $derived(page.params.projectId);
  let events = $state<any[]>([]);
  let isLoading = $state(true);
  let isLoadingMore = $state(false);
  let searchQuery = $state("");
  let selectedEventId = $state<string | null>(null);
  let currentOffset = $state(0);
  let hasMore = $state(true);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function loadEvents(reset = true) {
    if (!organizationId) return;
    if (!reset && (isLoading || isLoadingMore || !hasMore)) return;

    if (reset) {
      isLoading = true;
      currentOffset = 0;
      events = [];
      hasMore = true;
    } else {
      isLoadingMore = true;
    }

    try {
      const params = new URLSearchParams();
      params.set("organizationId", organizationId ?? "");
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(reset ? 0 : currentOffset));

      const res = await apiFetch(`/api/dashboard/events?${params}`);
      if (res.data?.success) {
        const newEvents = res.data.data;
        if (reset) {
          events = newEvents;
        } else {
          events = [...events, ...newEvents];
        }

        hasMore = newEvents.length === PAGE_SIZE;
        currentOffset = events.length;
      }
    } catch (e) {
      console.error("Failed to load events", e);
    } finally {
      isLoading = false;
      isLoadingMore = false;
    }
  }

  function onSearchInput() {
    // Client-side filtering only works on loaded data if API doesn't support search
    // Since API doesn't support search yet, we rely on client-side filtering of loaded events?
    // Wait, infinite scroll + client-side filtering is broken.
    // If we search, we should probably just filter what we have or implement server search.
    // For now, let's keep client filtering but acknowledge it's limited to loaded items.
    // Actually, let's remove search for now or keep it simple.
    // The previous implementation used client-side filtering.
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

  // Infinite Scroll Observer
  let loadMoreTrigger = $state<HTMLElement | null>(null);
  $effect(() => {
    if (loadMoreTrigger && hasMore && !isLoading && !isLoadingMore) {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadEvents(false);
        }
      }, {
        root: loadMoreTrigger.closest("main"),
        rootMargin: "0px 0px 240px 0px",
      });
      observer.observe(loadMoreTrigger);
      return () => observer.disconnect();
    }
  });
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
      </p>
    </div>

    <button
      class="btn btn-secondary gap-2 text-xs uppercase tracking-wider font-bold"
      onclick={() => loadEvents(true)}
    >
      <ArrowsClockwise   size={14} class={isLoading ? "animate-spin" : ""}  weight="fill" />
      Refresh
    </button>
  </div>

  <!-- Toolbar -->
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

    <!-- Infinite Scroll Trigger -->
    {#if hasMore && !isLoadingMore}
      <div bind:this={loadMoreTrigger} class="h-4 w-full"></div>
    {/if}
    
    {#if isLoadingMore}
      <div class="flex justify-center py-4">
        <CircleNotch size={20} class="animate-spin text-text-muted" weight="duotone" />
      </div>
    {/if}
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
