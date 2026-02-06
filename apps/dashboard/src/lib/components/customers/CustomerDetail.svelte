<script lang="ts">
  import { Activity, Calendar, CreditCard, Clock, Package, Zap, User, Loader2, Mail, Hash } from "lucide-svelte";
  import { apiFetch } from "$lib/auth-client";
  import ProgressBar from "$lib/components/ui/ProgressBar.svelte";
  import Timeline from "$lib/components/ui/Timeline.svelte";

  let {
    customerId,
  }: {
    customerId: string;
  } = $props();

  let isLoading = $state(true);
  let data = $state<any>(null);

  async function loadCustomer(id: string) {
    isLoading = true;
    data = null;
    try {
      const res = await apiFetch(`/api/dashboard/customers/${id}`);
      if (res.data?.success) {
        data = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load customer", e);
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    if (customerId) {
      loadCustomer(customerId);
    }
  });

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatRelativeTime(ts: number) {
    const diff = Date.now() - ts;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  function formatCurrency(amount: number, currency: string = "NGN") {
    const major = amount / 100;
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: 0 }).format(major);
  }

  function formatNumber(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  }

  function statusColor(status: string) {
    switch (status) {
      case "active": return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
      case "canceled": return "bg-red-400/10 text-red-400 border-red-400/20";
      case "trialing": return "bg-blue-400/10 text-blue-400 border-blue-400/20";
      case "past_due": return "bg-amber-400/10 text-amber-400 border-amber-400/20";
      default: return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
    }
  }

  function eventLabel(type: string) {
    const labels: Record<string, string> = {
      "subscription.create": "Subscribed",
      "subscription.cancel": "Canceled subscription",
      "subscription.update": "Subscription updated",
      "charge.success": "Payment successful",
      "charge.failed": "Payment failed",
      "customer.create": "Customer created",
    };
    return labels[type] || type.replace(/\./g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
  }

  function eventIcon(type: string): any {
    if (type.includes("subscription")) return Calendar;
    if (type.includes("charge") || type.includes("payment")) return CreditCard;
    if (type.includes("customer")) return User;
    return Zap;
  }

  const maxUsage = $derived(
    data?.featureUsageSummary?.length > 0
      ? Math.max(...data.featureUsageSummary.map((f: any) => f.totalUsage))
      : 1
  );

  const timeline = $derived.by(() => {
    const merged: { label: string; ts: number; icon: any; iconColor: string }[] = [
      ...(data?.events || []).map((e: any) => ({
        label: eventLabel(e.type),
        ts: e.createdAt as number,
        icon: eventIcon(e.type),
        iconColor: "bg-blue-500/10 text-blue-400",
      })),
      ...(data?.recentUsage || []).map((u: any) => ({
        label: `Used ${u.amount} ${u.unit || "units"} of ${u.featureName}`,
        ts: u.createdAt as number,
        icon: Activity,
        iconColor: "bg-accent/10 text-accent",
      })),
    ];
    return merged
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 20)
      .map((item) => ({
        label: item.label,
        time: formatRelativeTime(item.ts),
        icon: item.icon,
        iconColor: item.iconColor,
      }));
  });
</script>

{#if isLoading}
  <div class="flex items-center justify-center py-16">
    <Loader2 size={20} class="text-zinc-500 animate-spin" />
  </div>
{:else if data}
  <div class="p-5 space-y-5">
    <!-- Customer Info -->
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent font-bold text-sm uppercase shrink-0">
        {data.customer.email[0]}
      </div>
      <div class="flex-1 min-w-0">
        <h3 class="text-sm font-bold text-white truncate">{data.customer.name || "Anonymous"}</h3>
        <div class="flex flex-col gap-1 mt-1">
          <span class="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <Mail size={10} />
            {data.customer.email}
          </span>
          {#if data.customer.externalId}
            <span class="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono">
              <Hash size={10} />
              {data.customer.externalId}
            </span>
          {/if}
          <span class="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <Clock size={10} />
            Joined {formatDate(data.customer.createdAt)}
          </span>
        </div>
      </div>
    </div>

    <!-- Quick Stats -->
    <div class="grid grid-cols-3 gap-3">
      <div class="bg-white/5 rounded p-3 text-center">
        <div class="text-lg font-bold text-white">{data.subscriptions?.length || 0}</div>
        <div class="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Subs</div>
      </div>
      <div class="bg-white/5 rounded p-3 text-center">
        <div class="text-lg font-bold text-white">{data.featureUsageSummary?.length || 0}</div>
        <div class="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Features</div>
      </div>
      <div class="bg-white/5 rounded p-3 text-center">
        <div class="text-lg font-bold text-white">{data.events?.length || 0}</div>
        <div class="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Events</div>
      </div>
    </div>

    <!-- Subscriptions -->
    <div>
      <h4 class="text-[10px] font-bold text-white uppercase tracking-widest mb-3">Subscriptions</h4>
      {#if data.subscriptions?.length > 0}
        <div class="space-y-2">
          {#each data.subscriptions as sub}
            <div class="bg-white/5 rounded p-3">
              <div class="flex items-center justify-between mb-1.5">
                <div class="flex items-center gap-2">
                  <Package size={12} class="text-zinc-500" />
                  <span class="text-xs font-semibold text-white">{sub.planName}</span>
                  <span class="text-[9px] text-zinc-600 font-mono">{formatCurrency(sub.planPrice, sub.planCurrency)}/{sub.planInterval}</span>
                </div>
                <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border {statusColor(sub.status)}">
                  {sub.status}
                </span>
              </div>
              <div class="text-[9px] text-zinc-600">
                {formatDate(sub.currentPeriodStart)} – {formatDate(sub.currentPeriodEnd)}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-xs text-zinc-600">No subscriptions</p>
      {/if}
    </div>

    <!-- Feature Usage -->
    {#if data.featureUsageSummary?.length > 0}
      <div>
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-[10px] font-bold text-white uppercase tracking-widest">Feature Usage</h4>
          <span class="text-[9px] text-zinc-600 font-bold uppercase tracking-widest">This month</span>
        </div>
        <div class="space-y-3">
          {#each data.featureUsageSummary as feat}
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-xs text-white font-medium">{feat.featureName}</span>
                <span class="text-xs text-white font-bold">
                  {formatNumber(feat.totalUsage)}
                  {#if feat.unit}
                    <span class="text-[10px] text-zinc-600 font-normal ml-0.5">{feat.unit}</span>
                  {/if}
                </span>
              </div>
              <ProgressBar value={feat.totalUsage} max={maxUsage} color="bg-accent/70" />
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Activity Timeline -->
    <div>
      <h4 class="text-[10px] font-bold text-white uppercase tracking-widest mb-2">Activity</h4>
      <div class="bg-white/5 rounded overflow-hidden">
        <Timeline items={timeline} />
      </div>
    </div>
  </div>
{:else}
  <div class="flex flex-col items-center justify-center py-16 text-center px-5">
    <User size={24} class="text-zinc-600 mb-3" />
    <p class="text-xs text-zinc-500">Customer not found</p>
  </div>
{/if}
