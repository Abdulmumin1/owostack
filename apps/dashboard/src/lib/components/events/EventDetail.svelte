<script lang="ts">
  import { onMount } from "svelte";
  import { apiFetch } from "$lib/auth-client";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import { Webhook, User, Clock, Zap, CheckCircle, XCircle } from "lucide-svelte";
  import { fade } from "svelte/transition";

  let { eventId } = $props<{ eventId: string }>();

  let event = $state<any>(null);
  let isLoading = $state(true);
  let error = $state("");

  async function loadEvent() {
    isLoading = true;
    error = "";
    try {
      const res = await apiFetch(`/api/dashboard/events/${eventId}`);
      if (res.data?.success) {
        event = res.data.data;
      } else {
        error = res.data?.error || "Failed to load event";
      }
    } catch (e: any) {
      error = e.message || "Failed to load event";
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    if (eventId) {
      loadEvent();
    }
  });

  function getEventIcon(type: string) {
    if (type.startsWith("subscription")) return Clock;
    if (type.startsWith("customer")) return User;
    if (type.startsWith("payment") || type.startsWith("charge")) return Zap;
    return Webhook;
  }

  function formatKey(key: string) {
    return key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  }
</script>

<div class="h-full flex flex-col">
  {#if isLoading}
    <div class="p-6 space-y-6">
      <div class="flex items-center gap-4">
        <Skeleton class="w-12 h-12 rounded" />
        <div class="space-y-2">
          <Skeleton class="h-5 w-48" />
          <Skeleton class="h-4 w-32" />
        </div>
      </div>
      <div class="space-y-4 pt-6">
        <Skeleton class="h-4 w-full" />
        <Skeleton class="h-4 w-3/4" />
        <Skeleton class="h-32 w-full rounded" />
      </div>
    </div>
  {:else if error}
    <div class="p-8 text-center">
      <div class="w-12 h-12 bg-red-500/10 text-red-600 dark:text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
        <XCircle size={24} />
      </div>
      <p class="text-red-600 dark:text-red-400 font-medium">{error}</p>
      <button class="mt-4 text-xs text-text-dim hover:text-text-primary underline" onclick={loadEvent}>
        Try again
      </button>
    </div>
  {:else if event}
    <div class="flex-1 overflow-y-auto custom-scrollbar" transition:fade>
      <!-- Header -->
      <div class="p-6 border-b border-border bg-bg-card">
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 bg-black/5 dark:bg-white/5 border border-border rounded flex items-center justify-center shrink-0">
            <svelte:component this={getEventIcon(event.type)} size={24} class="text-text-dim" />
          </div>
          <div>
            <h2 class="text-lg font-bold text-text-primary break-all">{event.type}</h2>
            <div class="flex items-center gap-2 mt-1">
              <span class="text-xs font-mono text-text-dim">{event.id}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-bg-secondary text-text-secondary font-bold uppercase tracking-wider border border-border">
                {event.processed ? "Processed" : "Logged"}
              </span>
            </div>
            <p class="text-xs text-text-dim mt-2 flex items-center gap-1">
              <Clock size={12} />
              {new Date(event.createdAt).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      <div class="p-6 space-y-8">
        <!-- Customer Info -->
        {#if event.customer}
          <div>
            <h3 class="text-xs font-bold text-text-dim uppercase tracking-widest mb-3">Customer</h3>
            <div class="bg-bg-card border border-border rounded p-4 flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent font-bold text-xs">
                {event.customer.email[0].toUpperCase()}
              </div>
              <div>
                <div class="text-sm font-bold text-text-primary">{event.customer.name || 'Anonymous'}</div>
                <div class="text-xs text-text-dim font-mono">{event.customer.email}</div>
              </div>
            </div>
          </div>
        {/if}

        <!-- Event Data -->
        <div>
          <h3 class="text-xs font-bold text-text-dim uppercase tracking-widest mb-3">Event Payload</h3>
          <div class="bg-bg-secondary border border-border rounded overflow-hidden">
            <div class="flex border-b border-border">
               <div class="px-4 py-2 text-[10px] font-bold text-text-dim uppercase bg-black/5 dark:bg-white/5">JSON</div>
            </div>
            <pre class="p-4 text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre-wrap">{JSON.stringify(event.data, null, 2)}</pre>
          </div>
        </div>

        <!-- Metadata -->
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-bg-card border border-border p-4 rounded">
            <div class="text-[10px] font-bold text-text-dim uppercase mb-1">Organization</div>
            <div class="text-xs font-mono text-text-secondary truncate">{event.organizationId}</div>
          </div>
          <div class="bg-bg-card border border-border p-4 rounded">
            <div class="text-[10px] font-bold text-text-dim uppercase mb-1">Timestamp</div>
            <div class="text-xs font-mono text-text-secondary">{event.createdAt}</div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 10px;
  }
</style>
