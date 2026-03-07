<script lang="ts">
  import { Calendar, CircleNotch, Clock, CreditCard, Envelope, Hash, Lightning, Package, Pulse, User, WarningCircle } from "phosphor-svelte";
  import { apiFetch } from "$lib/auth-client";
  import { formatCurrency } from "$lib/utils/currency";
  import ProgressBar from "$lib/components/ui/ProgressBar.svelte";
  import Timeline from "$lib/components/ui/Timeline.svelte";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import Avatar from "$lib/components/ui/Avatar.svelte";
  import CustomerEntitlementsSection from "./CustomerEntitlementsSection.svelte";

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


  function formatNumber(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  }

  function getHealthMessage(sub: any) {
    const reasons = Array.isArray(sub?.health?.reasons) ? sub.health.reasons : [];
    const renewalStatus = sub?.health?.renewalSetup?.renewal_setup_status;
    if (reasons.includes("renewal_setup_failed")) {
      if (renewalStatus === "scheduled" || renewalStatus === "retrying") {
        return "Renewal setup failed after trial conversion. Automatic retry is scheduled.";
      }
      return "Renewal setup failed after trial conversion. Access will stop at period end unless renewal setup succeeds.";
    }
    if (
      reasons.includes("period_end_stale") &&
      reasons.includes("provider_link_missing")
    ) {
      return "Period ended and provider link is missing.";
    }
    if (reasons.includes("period_end_stale")) {
      return "Period ended and renewal reconciliation is pending.";
    }
    if (reasons.includes("provider_link_missing")) {
      return "Provider linkage is missing.";
    }
    return "Needs review.";
  }

  function getHealthLabel(sub: any) {
    const reasons = Array.isArray(sub?.health?.reasons) ? sub.health.reasons : [];
    const renewalStatus = sub?.health?.renewalSetup?.renewal_setup_status;
    if (reasons.includes("renewal_setup_failed")) {
      return renewalStatus === "scheduled" || renewalStatus === "retrying"
        ? "retrying"
        : "renewal setup";
    }
    return "billing review";
  }

  function statusColor(status: string) {
    switch (status) {
      case "active": return "bg-success-bg text-success border-success/20";
      case "canceled": return "bg-error-bg text-error border-error/20";
      case "trialing": return "bg-info-bg text-info border-info/20";
      case "past_due": return "bg-warning-bg text-warning border-warning/20";
      default: return "bg-bg-secondary text-text-dim border-border";
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
    return Lightning;
  }

  const maxUsage = $derived(
    Array.isArray(data?.featureUsageSummary) && data.featureUsageSummary.length > 0
      ? Math.max(...data.featureUsageSummary.map((f: any) => f.totalUsage))
      : 1
  );

  const timeline = $derived.by(() => {
    const events = Array.isArray(data?.events) ? data.events : [];
    const recentUsage = Array.isArray(data?.recentUsage) ? data.recentUsage : [];

    const merged: { label: string; ts: number; icon: any; iconColor: string }[] = [
      ...events.map((e: any) => ({
        label: eventLabel(e.type),
        ts: e.createdAt as number,
        icon: eventIcon(e.type),
        iconColor: "bg-info-bg text-info",
      })),
      ...recentUsage.map((u: any) => ({
        label: `Used ${u.amount} ${u.unit || "units"} of ${u.featureName}`,
        ts: u.createdAt as number,
        icon: Pulse,
        iconColor: "bg-accent-light text-accent",
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
  <div class="p-5 space-y-6">
    <div class="flex items-start gap-3">
      <Skeleton class="w-10 h-10 rounded-full shrink-0" />
      <div class="flex-1 space-y-2">
        <Skeleton class="h-4 w-32" />
        <Skeleton class="h-3 w-48" />
        <Skeleton class="h-3 w-24" />
      </div>
    </div>
    <div class="grid grid-cols-3 gap-3">
      {#each Array(3) as _}
        <Skeleton class="h-16 w-full" />
      {/each}
    </div>
    <div class="space-y-3">
      <Skeleton class="h-3 w-20" />
      {#each Array(2) as _}
        <Skeleton class="h-12 w-full" />
      {/each}
    </div>
    <div class="space-y-3">
      <Skeleton class="h-3 w-20" />
      {#each Array(3) as _}
        <Skeleton class="h-8 w-full" />
      {/each}
    </div>
  </div>
{:else if data}
  <div class="p-5 space-y-5">
    <!-- Customer Info -->
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded-full overflow-hidden shrink-0">
        <Avatar name={data.customer.email} size={40} />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-bold text-text-primary truncate">{data.customer.name || "Anonymous"}</h3>
          <ProviderBadge providerId={data.customer.providerId} size="xs" />
        </div>
        <div class="flex flex-col gap-1 mt-1">
          <span class="flex items-center gap-1.5 text-[10px] text-text-dim">
            <Envelope   size={10}  weight="duotone" />
            {data.customer.email}
          </span>
          {#if data.customer.externalId}
            <span class="flex items-center gap-1.5 text-[10px] text-text-dim font-mono">
              <Hash   size={10}  weight="duotone" />
              {data.customer.externalId}
            </span>
          {/if}
          <span class="flex items-center gap-1.5 text-[10px] text-text-dim">
            <Clock   size={10}  weight="duotone" />
            Joined {formatDate(data.customer.createdAt)}
          </span>
        </div>
      </div>
    </div>

    <!-- Quick Stats -->
    <div class="grid grid-cols-3 gap-3">
      <div class="bg-bg-secondary rounded p-3 text-center">
        <div class="text-lg font-bold text-text-primary">{(Array.isArray(data.subscriptions) ? data.subscriptions : []).length}</div>
        <div class="text-[9px] text-text-dim uppercase tracking-widest font-bold">Subs</div>
      </div>
      <div class="bg-bg-secondary rounded p-3 text-center">
        <div class="text-lg font-bold text-text-primary">{(Array.isArray(data.featureUsageSummary) ? data.featureUsageSummary : []).length}</div>
        <div class="text-[9px] text-text-dim uppercase tracking-widest font-bold">Features</div>
      </div>
      <div class="bg-bg-secondary rounded p-3 text-center">
        <div class="text-lg font-bold text-text-primary">{(Array.isArray(data.events) ? data.events : []).length}</div>
        <div class="text-[9px] text-text-dim uppercase tracking-widest font-bold">Events</div>
      </div>
    </div>

    <!-- Subscriptions -->
    <div>
      <h4 class="text-[10px] font-bold text-text-primary uppercase tracking-widest mb-3">Subscriptions</h4>
      {#if Array.isArray(data.subscriptions) && data.subscriptions.length > 0}
        <div class="space-y-2">
          {#each data.subscriptions as sub}
            <div class="bg-bg-secondary rounded p-3">
              <div class="flex items-center justify-between mb-1.5">
                <div class="flex items-center gap-2">
                  <Package   size={12} class="text-text-dim"  weight="duotone" />
                  <span class="text-xs font-semibold text-text-primary">{sub.planName}</span>
                  <span class="text-[9px] text-text-dim font-mono">{formatCurrency(sub.planPrice, sub.planCurrency)}/{sub.planInterval}</span>
                </div>
                <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border {statusColor(sub.status)}">
                  {sub.status}
                </span>
              </div>
              <div class="text-[9px] text-text-dim">
                {formatDate(sub.currentPeriodStart)} – {formatDate(sub.currentPeriodEnd)}
              </div>
              {#if sub.health?.requiresAction}
                <div
                  class="mt-1 inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-warning"
                  title={getHealthMessage(sub)}
                >
                  <WarningCircle size={10} weight="fill" />
                  {getHealthLabel(sub)}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-xs text-text-dim">No subscriptions</p>
      {/if}
    </div>

    <!-- Feature Usage -->
    {#if Array.isArray(data.featureUsageSummary) && data.featureUsageSummary.length > 0}
      <div>
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-[10px] font-bold text-text-primary uppercase tracking-widest">Feature Usage</h4>
          <span class="text-[9px] text-text-dim font-bold uppercase tracking-widest">This month</span>
        </div>
        <div class="space-y-3">
          {#each data.featureUsageSummary as feat}
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-xs text-text-primary font-medium">{feat.featureName}</span>
                <span class="text-xs text-text-primary font-bold">
                  {formatNumber(feat.totalUsage)}
                  {#if feat.unit}
                    <span class="text-[10px] text-text-dim font-normal ml-0.5">{feat.unit}</span>
                  {/if}
                </span>
              </div>
              <ProgressBar value={feat.totalUsage} max={maxUsage} color="bg-accent/70" />
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Entitlement Overrides -->
    <div class="border-t border-border pt-6 mt-6">
      <CustomerEntitlementsSection {customerId} />
    </div>

    <!-- Pulse Timeline -->
    <div class="border-t border-border pt-6 mt-6">
      <h4 class="text-[10px] font-bold text-text-primary uppercase tracking-widest mb-2">Pulse</h4>
      <div class="bg-bg-secondary rounded overflow-hidden">
        <Timeline items={timeline} />
      </div>
    </div>
  </div>
{:else}
  <div class="flex flex-col items-center justify-center py-16 text-center px-5">
    <User   size={24} class="text-text-dim/20 mb-3"  weight="duotone" />
    <p class="text-xs text-text-dim">Customer not found</p>
  </div>
{/if}
