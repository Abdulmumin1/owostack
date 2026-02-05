<script lang="ts">
  import { Search, Filter, RefreshCw, ArrowRight, Webhook, Loader2, Clock, User, Zap } from "lucide-svelte";
  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import { onMount } from "svelte";

  const organizationId = $derived(page.params.projectId);
  let events = $state<any[]>([]);
  let isLoading = $state(true);
  let searchQuery = $state("");

  async function loadEvents() {
    isLoading = true;
    try {
      const res = await apiFetch(`/api/dashboard/events?organizationId=${organizationId}`);
      if (res.data) {
        events = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load events", e);
    } finally {
      isLoading = false;
    }
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
      e.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.customer?.email && e.customer.email.toLowerCase().includes(searchQuery.toLowerCase()))
    )
  );

  function getEventIcon(type: string) {
    if (type.startsWith("subscription")) return Clock;
    if (type.startsWith("customer")) return User;
    if (type.startsWith("payment")) return Zap;
    return Webhook;
  }
</script>

<svelte:head>
  <title>Events - Owostack</title>
</svelte:head>

<div class="max-w-6xl">
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1 class="text-xl font-bold text-white mb-2">Events</h1>
      <p class="text-zinc-500 text-xs uppercase tracking-widest font-semibold">
        Real-time log of all system activity
      </p>
    </div>

    <button
      class="btn btn-secondary gap-2 text-xs uppercase tracking-wider font-bold"
      onclick={loadEvents}
    >
      <RefreshCw size={14} class={isLoading ? "animate-spin" : ""} />
      Refresh
    </button>
  </div>

  <!-- Toolbar -->
  <div
    class="bg-bg-card border border-border p-4 flex items-center gap-4 mb-6 shadow-sm"
  >
    <div class="relative flex-1">
      <Search
        size={14}
        class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
      />
      <input
        type="text"
        placeholder="Filter by event type, customer, or ID..."
        bind:value={searchQuery}
        class="input pl-9"
      />
    </div>
  </div>

  {#if isLoading && events.length === 0}
    <div class="flex items-center gap-2 text-zinc-500 p-12 justify-center">
      <Loader2 size={16} class="animate-spin" />
      <span>Loading events...</span>
    </div>
  {:else if filteredEvents.length === 0}
    <div class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center shadow-md">
      <div class="w-12 h-12 bg-white/5 flex items-center justify-center mb-4">
        <Webhook size={24} class="text-zinc-500" />
      </div>
      <h3 class="text-lg font-bold text-white mb-2">
        {searchQuery ? "No matching events" : "No events found"}
      </h3>
      <p class="text-zinc-500 max-w-sm text-sm">
        {searchQuery ? "Try a different filter." : "Events will appear here when your integration starts processing requests."}
      </p>
    </div>
  {:else}
    <!-- Events List -->
    <div class="space-y-3">
      {#each filteredEvents as event}
        <div class="bg-bg-card border border-border p-4 flex items-center justify-between group hover:border-zinc-500 transition-colors cursor-pointer">
          <div class="flex items-center gap-4">
            <div class="w-10 h-10 bg-white/5 border border-border flex items-center justify-center rounded">
              <svelte:component this={getEventIcon(event.type)} size={20} class="text-zinc-400" />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="text-sm font-bold text-white">{event.type}</span>
                <span class="text-[10px] bg-white/5 text-zinc-500 px-1.5 py-0.5 font-mono">
                  {event.id.split('-')[0]}
                </span>
              </div>
              <div class="text-[10px] text-zinc-500">
                {#if event.customer}
                  for <span class="text-zinc-300 font-bold">{event.customer.email}</span>
                {:else}
                  System event
                {/if}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-6">
            <div class="text-right">
              <div class="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                {formatRelativeTime(event.createdAt)}
              </div>
              <div class="text-[9px] text-zinc-600 font-mono">
                {new Date(event.createdAt).toLocaleTimeString()}
              </div>
            </div>
            <ArrowRight size={16} class="text-zinc-800 group-hover:text-zinc-500 transition-colors" />
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
