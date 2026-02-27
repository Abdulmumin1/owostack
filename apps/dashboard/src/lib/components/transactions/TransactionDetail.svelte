<script lang="ts">
  import { Calendar, CheckCircle, CircleNotch, Clock, CreditCard, Envelope, Gift, Hash, Lightning, Package, Shield, ShoppingBag, User, XCircle } from "phosphor-svelte";
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
      case "subscription": return "bg-info-bg text-info border-info/20";
      case "one_time": return "bg-tertiary-light text-tertiary border-tertiary/20";
      case "trial": return "bg-tertiary-light text-tertiary border-tertiary/20";
      case "free": return "bg-success-bg text-success border-success/20";
      default: return "bg-bg-secondary text-text-dim border-border";
    }
  }

  function statusColor(status: string) {
    switch (status) {
      case "active": return "bg-success-bg text-success border-success/20";
      case "canceled": return "bg-bg-secondary text-text-dim border-border";
      case "trialing": return "bg-info-bg text-info border-info/20";
      default: return "bg-bg-secondary text-text-dim border-border";
    }
  }

  function typeIcon(type: string) {
    switch (type) {
      case "subscription": return CreditCard;
      case "one_time": return ShoppingBag;
      case "trial": return Gift;
      case "free": return CheckCircle;
      default: return Lightning;
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
    return Lightning;
  }

  function eventColor(type: string) {
    if (type.includes("cancel")) return "bg-error-bg text-error";
    if (type.includes("charge.success") || type.includes("payment")) return "bg-success-bg text-success";
    if (type.includes("charge.failed")) return "bg-error-bg text-error";
    return "bg-info-bg text-info";
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
    const events = Array.isArray(data?.events) ? data.events : [];
    return events.map((item: any) => ({
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
        <svelte:component this={typeIcon(data.transaction.type)} weight="duotone" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <h3 class="text-sm font-bold text-text-primary truncate">{data.plan.name}</h3>
          <ProviderBadge providerId={data.transaction.providerId} size="xs" />
          <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border {statusColor(data.transaction.status)}">
            {data.transaction.status}
          </span>
        </div>
        <div class="flex flex-col gap-1">
          <span class="flex items-center gap-1.5 text-[10px] text-text-dim">
            <CreditCard size={10} class="text-info" weight="duotone" />
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
          <span class="flex items-center gap-1.5 text-[10px] text-text-dim">
            <Envelope size={10} class="text-tertiary" weight="duotone" />
            {data.customer.email}
          </span>
          <span class="flex items-center gap-1.5 text-[10px] text-text-dim">
            <Clock size={10} class="text-warning" weight="duotone" />
            {formatDateTime(data.transaction.createdAt)}
          </span>
        </div>
      </div>
    </div>

    <!-- Type Badge -->
    <div class="bg-bg-secondary rounded p-3 flex items-center gap-3">
      <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border {typeColor(data.transaction.type)}">
        {data.transaction.typeLabel}
      </span>
      {#if data.transaction.type === 'subscription'}
        <span class="text-[10px] text-text-dim">
          {formatDate(data.transaction.currentPeriodStart)} – {formatDate(data.transaction.currentPeriodEnd)}
        </span>
      {:else if data.transaction.type === 'trial'}
        <span class="text-[10px] text-text-dim">
          Trial until {formatDate(data.transaction.currentPeriodEnd)}
        </span>
      {/if}
    </div>

    <!-- Quick Stats -->
    <div class="grid grid-cols-2 gap-3">
      <div class="bg-bg-secondary rounded p-3 text-center">
        <div class="text-lg font-bold text-text-primary">{data.entitlements?.length || 0}</div>
        <div class="text-[9px] text-text-dim uppercase tracking-widest font-bold">Active Entitlements</div>
      </div>
      <div class="bg-bg-secondary rounded p-3 text-center">
        <div class="text-lg font-bold text-text-primary">{data.planFeatures?.length || 0}</div>
        <div class="text-[9px] text-text-dim uppercase tracking-widest font-bold">Plan Features</div>
      </div>
    </div>

    <!-- Features Granted -->
    {#if data.planFeatures?.length > 0}
      <div>
        <h4 class="text-[10px] font-bold text-text-primary uppercase tracking-widest mb-3">Features in this Plan</h4>
        <div class="space-y-2">
          {#each data.planFeatures as pf}
            {@const isGranted = data.entitlements?.some((e: any) => e.featureId === pf.featureId)}
            <div class="bg-bg-secondary rounded p-3 flex items-center justify-between {isGranted ? '' : 'opacity-50'}">
              <div class="flex items-center gap-2">
                {#if isGranted}
                  <CheckCircle size={12} class="text-success" weight="fill" />
                {:else}
                  <XCircle size={12} class="text-text-dim" weight="duotone" />
                {/if}
                <span class="text-xs font-medium text-text-primary">{pf.featureName}</span>
                {#if pf.unit}
                  <span class="text-[9px] text-text-dim">({pf.unit})</span>
                {/if}
              </div>
              <div class="text-right">
                {#if pf.limitValue !== null}
                  <span class="text-xs font-bold text-text-primary">{pf.limitValue}</span>
                  <span class="text-[9px] text-text-dim ml-1">/ {pf.resetInterval}</span>
                {:else}
                  <span class="text-[9px] font-bold text-success uppercase">Unlimited</span>
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
        <h4 class="text-[10px] font-bold text-text-primary uppercase tracking-widest mb-3">Active Entitlements</h4>
        <div class="space-y-2">
          {#each data.entitlements as ent}
            <div class="bg-bg-secondary rounded p-3 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Shield size={12} class="text-text-dim" weight="duotone" />
                <span class="text-xs font-medium text-text-primary">{ent.featureName}</span>
              </div>
              <div class="text-right">
                {#if ent.limitValue !== null}
                  <span class="text-xs font-bold text-text-primary">{ent.limitValue}</span>
                  <span class="text-[9px] text-text-dim ml-1">/ {ent.resetInterval}</span>
                {:else}
                  <span class="text-[9px] font-bold text-success uppercase">Unlimited</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Pulse -->
    {#if timeline.length > 0}
      <div>
        <h4 class="text-[10px] font-bold text-text-primary uppercase tracking-widest mb-2">Pulse</h4>
        <div class="bg-bg-secondary rounded overflow-hidden">
          <Timeline items={timeline} />
        </div>
      </div>
    {/if}
  </div>
{:else}
  <div class="flex flex-col items-center justify-center py-16 text-center px-5">
    <Package   size={24} class="text-text-dim/20 mb-3"  weight="duotone" />
    <p class="text-xs text-text-dim">Transaction not found</p>
  </div>
{/if}
