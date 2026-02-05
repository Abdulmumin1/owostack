<script lang="ts">
  import { Activity, BarChart3, Clock, Users, Zap } from "lucide-svelte";
  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import { onMount } from "svelte";

  const organizationId = $derived(page.params.projectId);
  let isLoading = $state(true);
  let usage = $state<any>(null);

  async function loadUsage() {
    isLoading = true;
    try {
      const res = await apiFetch(`/api/dashboard/usage?organizationId=${organizationId}`);
      if (res.data) {
        usage = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load usage", e);
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    loadUsage();
  });
</script>

<svelte:head>
  <title>Usage - Owostack</title>
</svelte:head>

<div class="max-w-6xl">
  <div class="mb-8">
    <h1 class="text-xl font-bold text-white mb-2 uppercase tracking-wide">Usage Analytics</h1>
    <p class="text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
      Monitor consumption across all features
    </p>
  </div>

  <div class="grid md:grid-cols-3 gap-6 mb-8">
    <div class="bg-bg-card border border-border p-6 shadow-md">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-8 h-8 bg-accent/10 flex items-center justify-center text-accent rounded">
          <Zap size={16} />
        </div>
        <h3 class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Total Events</h3>
      </div>
      <div class="text-3xl font-bold text-white">{usage?.totalEvents || 0}</div>
      <p class="text-[10px] text-zinc-500 mt-2 uppercase tracking-widest">All time processed</p>
    </div>

    <div class="bg-bg-card border border-border p-6 shadow-md">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-8 h-8 bg-blue-500/10 flex items-center justify-center text-blue-500 rounded">
          <Users size={16} />
        </div>
        <h3 class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Total Customers</h3>
      </div>
      <div class="text-3xl font-bold text-white">{usage?.totalCustomers || 0}</div>
      <p class="text-[10px] text-zinc-500 mt-2 uppercase tracking-widest">Across all plans</p>
    </div>

    <div class="bg-bg-card border border-border p-6 shadow-md">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-8 h-8 bg-emerald-500/10 flex items-center justify-center text-emerald-500 rounded">
          <BarChart3 size={16} />
        </div>
        <h3 class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Success Rate</h3>
      </div>
      <div class="text-3xl font-bold text-white">100%</div>
      <p class="text-[10px] text-zinc-500 mt-2 uppercase tracking-widest">API processing</p>
    </div>
  </div>

  {#if usage?.eventsByType?.length > 0}
    <div class="bg-bg-card border border-border overflow-hidden shadow-md">
      <div class="p-6 border-b border-border">
        <h3 class="text-xs font-bold text-white uppercase tracking-widest">Events by Type</h3>
      </div>
      <table class="w-full text-left">
        <thead>
          <tr class="bg-white/5">
            <th class="px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Event Type</th>
            <th class="px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-right">Count</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/50">
          {#each usage.eventsByType as item}
            <tr class="hover:bg-white/[0.02]">
              <td class="px-6 py-3 text-sm text-zinc-300 font-mono">{item.type}</td>
              <td class="px-6 py-3 text-sm text-white font-bold text-right">{item.count}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <div class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center shadow-md">
      <div class="w-12 h-12 bg-white/5 flex items-center justify-center mb-4">
        <BarChart3 size={24} class="text-zinc-500" />
      </div>
      <h3 class="text-lg font-bold text-white mb-2">Usage Data Coming Soon</h3>
      <p class="text-zinc-500 max-w-sm mb-6 text-sm">
        Detailed usage analytics and charts will be available once your application starts reporting usage via the SDK.
      </p>
    </div>
  {/if}
</div>
