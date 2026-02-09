<script lang="ts">
  import {
    Calendar, CreditCard, Clock, Package, Zap, User, Loader2,
    Mail, Hash, Shield, CheckCircle, XCircle, Gift, ShoppingBag,
  } from "lucide-svelte";
  import { apiFetch } from "$lib/auth-client";
  import { formatCurrency } from "$lib/utils/currency";
  import Timeline from "$lib/components/ui/Timeline.svelte";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  let {
    transactionId,
  }: {
    transactionId: string;
  } = $props();

  let isLoading = $state(true);
  let data = $state<any>(null);

  async function loadDetail(id: string) {
    isLoading = true;
    data = null;
    try {
      const res = await apiFetch(`/api/dashboard/transactions/${id}`);
      if (res.data?.success) {
        data = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load transaction detail", e);
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    if (transactionId) {
      loadDetail(transactionId);
    }
  });

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  }

  function formatDateTime(ts: number) {
    return new Date(ts).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function typeColor(type: string) {
    switch (type) {
      case "subscription": return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      case "one_time": return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      case "trial": return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
      case "free": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      default: return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
    }
  }

  function statusColor(status: string) {
    switch (status) {
      case "active": return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
      case "canceled": return "bg-red-400/10 text-red-400 border-red-400/20";
      case "trialing": return "bg-blue-400/10 text-blue-400 border-blue-400/20";
      default: return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
    }
  }

  function typeIcon(type: string) {
    switch (type) {
      case "subscription": return CreditCard;
      case "one_time": return ShoppingBag;
      case "trial": return Gift;
      case "free": return CheckCircle;
      default: return Zap;
    }
  }

  function formatRelativeTime(ts: number) {
    const diff = Date.now() - ts;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  function eventIcon(type: string): any {
    if (type.includes("cancel")) return XCircle;
    if (type.includes("subscription")) return Calendar;
    if (type.includes("charge") || type.includes("payment")) return CreditCard;
    if (type.includes("customer")) return User;
    return Zap;
  }

  function eventColor(type: string) {
    if (type.includes("cancel")) return "bg-red-500/10 text-red-400";
    if (type.includes("charge.success") || type.includes("payment")) return "bg-green-500/10 text-green-400";
    if (type.includes("charge.failed")) return "bg-red-500/10 text-red-400";
    return "bg-blue-500/10 text-blue-400";
  }

  function eventLabel(type: string) {
    const labels: Record<string, string> = {
      "subscription.create": "Subscribed",
      "subscription.cancel": "Canceled",
      "charge.success": "Payment successful",
      "charge.failed": "Payment failed",
      "customer.create": "Customer created",
    };
    return labels[type] || type.replace(/[._]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
  }

  const timeline = $derived.by(() => {
    if (!data?.events) return [];
    return data.events.map((item: any) => ({
      label: eventLabel(item.type),
      time: formatRelativeTime(item.createdAt),
      icon: eventIcon(item.type),
      iconColor: eventColor(item.type),
      detail: (item.data as any)?.message || undefined,
    }));
  });
</script>

{#if isLoading}
  <div class="p-5 space-y-6">
    <div class="flex items-start gap-3">
      <Skeleton class="w-10 h-10 rounded-full shrink-0" />
      <div class="flex-1 space-y-2">
        <Skeleton class="h-4 w-32" />
        <Skeleton class="h-3 w-48" />
        <Skeleton class="h-3 w-36" />
      </div>
    </div>
    <Skeleton class="h-12 w-full rounded" />
    <div class="grid grid-cols-2 gap-3">
      {#each Array(2) as _}
        <Skeleton class="h-16 w-full rounded" />
      {/each}
    </div>
    <div class="space-y-3">
      <Skeleton class="h-3 w-24" />
      {#each Array(3) as _}
        <Skeleton class="h-12 w-full rounded" />
      {/each}
    </div>
  </div>
{:else if data}
  <div class="p-5 space-y-5">
    <!-- Transaction Header -->
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded-full {typeColor(data.transaction.type)} border flex items-center justify-center shrink-0">
        <svelte:component this={typeIcon(data.transaction.type)} size={16} />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <h3 class="text-sm font-bold text-white truncate">{data.plan.name}</h3>
          <ProviderBadge providerId={data.transaction.providerId} size="xs" />
          <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border {statusColor(data.transaction.status)}">
            {data.transaction.status}
          </span>
        </div>
        <div class="flex flex-col gap-1">
          <span class="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <CreditCard size={10} />
            {#if data.plan.price === 0}
              Free
            {:else}
              {formatCurrency(data.plan.price, data.plan.currency)}
              {#if data.transaction.type === 'subscription'}
                / {data.plan.interval}
              {:else}
                (one-time)
              {/if}
            {/if}
          </span>
          <span class="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <Mail size={10} />
            {data.customer.email}
          </span>
          <span class="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <Clock size={10} />
            {formatDateTime(data.transaction.createdAt)}
          </span>
        </div>
      </div>
    </div>

    <!-- Type Badge -->
    <div class="bg-white/5 rounded p-3 flex items-center gap-3">
      <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border {typeColor(data.transaction.type)}">
        {data.transaction.typeLabel}
      </span>
      {#if data.transaction.type === 'subscription'}
        <span class="text-[10px] text-zinc-500">
          {formatDate(data.transaction.currentPeriodStart)} – {formatDate(data.transaction.currentPeriodEnd)}
        </span>
      {:else if data.transaction.type === 'trial'}
        <span class="text-[10px] text-zinc-500">
          Trial until {formatDate(data.transaction.currentPeriodEnd)}
        </span>
      {/if}
    </div>

    <!-- Quick Stats -->
    <div class="grid grid-cols-2 gap-3">
      <div class="bg-white/5 rounded p-3 text-center">
        <div class="text-lg font-bold text-white">{data.entitlements?.length || 0}</div>
        <div class="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Active Entitlements</div>
      </div>
      <div class="bg-white/5 rounded p-3 text-center">
        <div class="text-lg font-bold text-white">{data.planFeatures?.length || 0}</div>
        <div class="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Plan Features</div>
      </div>
    </div>

    <!-- Features Granted -->
    {#if data.planFeatures?.length > 0}
      <div>
        <h4 class="text-[10px] font-bold text-white uppercase tracking-widest mb-3">Features in this Plan</h4>
        <div class="space-y-2">
          {#each data.planFeatures as pf}
            {@const isGranted = data.entitlements?.some((e: any) => e.featureId === pf.featureId)}
            <div class="bg-white/5 rounded p-3 flex items-center justify-between {isGranted ? '' : 'opacity-50'}">
              <div class="flex items-center gap-2">
                {#if isGranted}
                  <CheckCircle size={12} class="text-emerald-500" />
                {:else}
                  <XCircle size={12} class="text-zinc-600" />
                {/if}
                <span class="text-xs font-medium text-white">{pf.featureName}</span>
                {#if pf.unit}
                  <span class="text-[9px] text-zinc-600">({pf.unit})</span>
                {/if}
              </div>
              <div class="text-right">
                {#if pf.limitValue !== null}
                  <span class="text-xs font-bold text-white">{pf.limitValue}</span>
                  <span class="text-[9px] text-zinc-600 ml-1">/ {pf.resetInterval}</span>
                {:else}
                  <span class="text-[9px] font-bold text-emerald-400 uppercase">Unlimited</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Active Entitlements -->
    {#if data.entitlements?.length > 0}
      <div>
        <h4 class="text-[10px] font-bold text-white uppercase tracking-widest mb-3">Active Entitlements</h4>
        <div class="space-y-2">
          {#each data.entitlements as ent}
            <div class="bg-white/5 rounded p-3 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Shield size={12} class="text-zinc-500" />
                <span class="text-xs font-medium text-white">{ent.featureName}</span>
              </div>
              <div class="text-right">
                {#if ent.limitValue !== null}
                  <span class="text-xs font-bold text-white">{ent.limitValue}</span>
                  <span class="text-[9px] text-zinc-600 ml-1">/ {ent.resetInterval}</span>
                {:else}
                  <span class="text-[9px] font-bold text-emerald-400 uppercase">Unlimited</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Activity -->
    {#if timeline.length > 0}
      <div>
        <h4 class="text-[10px] font-bold text-white uppercase tracking-widest mb-2">Activity</h4>
        <div class="bg-white/5 rounded overflow-hidden">
          <Timeline items={timeline} />
        </div>
      </div>
    {/if}
  </div>
{:else}
  <div class="flex flex-col items-center justify-center py-16 text-center px-5">
    <Package size={24} class="text-zinc-600 mb-3" />
    <p class="text-xs text-zinc-500">Transaction not found</p>
  </div>
{/if}
