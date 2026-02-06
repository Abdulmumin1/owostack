<script lang="ts">
  import {
    Calendar, CreditCard, Clock, Package, Zap, User, Loader2,
    Mail, Hash, Shield, ArrowUpRight, ArrowDownRight, ArrowRight,
    XCircle, AlertTriangle, CheckCircle, RefreshCw, Ban,
  } from "lucide-svelte";
  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import Timeline from "$lib/components/ui/Timeline.svelte";

  let {
    subscriptionId,
    onupdate,
  }: {
    subscriptionId: string;
    onupdate?: () => void;
  } = $props();

  const organizationId = $derived(page.params.projectId);

  let isLoading = $state(true);
  let data = $state<any>(null);
  let actionLoading = $state<string | null>(null);
  let showSwitchPlan = $state(false);
  let switchPreview = $state<any>(null);
  let previewLoading = $state(false);

  async function loadDetail(id: string) {
    isLoading = true;
    data = null;
    try {
      const res = await apiFetch(`/api/dashboard/subscriptions/${id}`);
      if (res.data?.success) {
        data = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load subscription detail", e);
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    if (subscriptionId) {
      loadDetail(subscriptionId);
      showSwitchPlan = false;
      switchPreview = null;
    }
  });

  // ── Actions ──────────────────────────────────────────────

  async function cancelSubscription(immediate: boolean) {
    if (!confirm(
      immediate
        ? "Cancel this subscription immediately? The customer will lose access right away."
        : "Schedule cancellation at end of billing period?"
    )) return;

    actionLoading = "cancel";
    try {
      const res = await apiFetch("/api/dashboard/subscriptions/cancel", {
        method: "POST",
        body: JSON.stringify({
          subscriptionId,
          organizationId,
          immediate,
        }),
      });
      if (res.data?.success) {
        await loadDetail(subscriptionId);
        onupdate?.();
      }
    } catch (e) {
      console.error("Cancel failed:", e);
    } finally {
      actionLoading = null;
    }
  }

  async function previewPlanSwitch(newPlanId: string) {
    previewLoading = true;
    switchPreview = null;
    try {
      const res = await apiFetch("/api/dashboard/subscriptions/preview-switch", {
        method: "POST",
        body: JSON.stringify({
          customerId: data.customer.id,
          newPlanId,
        }),
      });
      if (res.data?.success) {
        switchPreview = { ...res.data.data, newPlanId };
      }
    } catch (e) {
      console.error("Preview failed:", e);
    } finally {
      previewLoading = false;
    }
  }

  async function executePlanSwitch() {
    if (!switchPreview) return;
    if (!confirm(`Confirm ${switchPreview.type}: Switch to ${switchPreview.newPlan.name}?`)) return;

    actionLoading = "switch";
    try {
      const res = await apiFetch("/api/dashboard/subscriptions/switch-plan", {
        method: "POST",
        body: JSON.stringify({
          customerId: data.customer.id,
          newPlanId: switchPreview.newPlanId,
          organizationId,
        }),
      });
      if (res.data?.success) {
        showSwitchPlan = false;
        switchPreview = null;
        await loadDetail(subscriptionId);
        onupdate?.();
      }
    } catch (e) {
      console.error("Switch failed:", e);
    } finally {
      actionLoading = null;
    }
  }

  // ── Helpers ──────────────────────────────────────────────

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
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
    return new Intl.NumberFormat("en-NG", {
      style: "currency", currency, minimumFractionDigits: 0,
    }).format(amount / 100);
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

  function eventIcon(type: string): any {
    if (type.includes("downgrade")) return ArrowDownRight;
    if (type.includes("upgrade") || type.includes("switch")) return ArrowUpRight;
    if (type.includes("cancel")) return XCircle;
    if (type.includes("subscription")) return Calendar;
    if (type.includes("charge") || type.includes("payment")) return CreditCard;
    if (type.includes("customer")) return User;
    return Zap;
  }

  function eventColor(type: string) {
    if (type.includes("cancel")) return "bg-red-500/10 text-red-400";
    if (type.includes("downgrade")) return "bg-amber-500/10 text-amber-400";
    if (type.includes("upgrade")) return "bg-emerald-500/10 text-emerald-400";
    if (type.includes("charge.success") || type.includes("payment")) return "bg-green-500/10 text-green-400";
    if (type.includes("charge.failed")) return "bg-red-500/10 text-red-400";
    return "bg-blue-500/10 text-blue-400";
  }

  function eventLabel(type: string) {
    const labels: Record<string, string> = {
      "subscription.create": "Subscribed",
      "subscription.cancel": "Canceled",
      "subscription.cancel_scheduled": "Cancellation scheduled",
      "subscription.downgrade_scheduled": "Downgrade scheduled",
      "subscription.switch": "Plan switched",
      "charge.success": "Payment successful",
      "charge.failed": "Payment failed",
      "customer.create": "Customer created",
    };
    return labels[type] || type.replace(/[._]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
  }

  const isActive = $derived(data?.subscription?.status === "active" || data?.subscription?.status === "trialing");
  const hasPendingCancel = $derived(!!data?.subscription?.cancelAt && !data?.subscription?.canceledAt);
  const hasPendingDowngrade = $derived(!!(data?.subscription?.metadata as any)?.scheduled_downgrade);

  const timeline = $derived.by(() => {
    if (!data?.timeline) return [];
    return data.timeline.map((item: any) => ({
      label: eventLabel(item.type),
      time: formatRelativeTime(item.timestamp),
      icon: eventIcon(item.type),
      iconColor: eventColor(item.type),
      detail: item.detail,
    }));
  });

  const otherPlans = $derived(
    (data?.availablePlans || []).filter((p: any) => p.id !== data?.plan?.id)
  );
</script>

{#if isLoading}
  <div class="flex items-center justify-center py-16">
    <Loader2 size={20} class="text-zinc-500 animate-spin" />
  </div>
{:else if data}
  <div class="p-5 space-y-5">
    <!-- Subscription Header -->
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
        <Package size={16} />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <h3 class="text-sm font-bold text-white truncate">{data.plan.name}</h3>
          <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border {statusColor(data.subscription.status)}">
            {data.subscription.status}
          </span>
        </div>
        <div class="flex flex-col gap-1">
          <span class="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <CreditCard size={10} />
            {formatCurrency(data.plan.price, data.plan.currency)} / {data.plan.interval}
          </span>
          <span class="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <Mail size={10} />
            {data.customer.email}
          </span>
          <span class="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <Clock size={10} />
            {formatDate(data.subscription.currentPeriodStart)} – {formatDate(data.subscription.currentPeriodEnd)}
          </span>
          {#if data.subscription.paystackSubscriptionCode && data.subscription.paystackSubscriptionCode !== "one-time"}
            <span class="flex items-center gap-1.5 text-[10px] text-zinc-600 font-mono">
              <Hash size={10} />
              {data.subscription.paystackSubscriptionCode}
            </span>
          {/if}
        </div>
      </div>
    </div>

    <!-- Alerts -->
    {#if hasPendingCancel}
      <div class="bg-amber-500/5 border border-amber-500/20 rounded p-3 flex items-start gap-2">
        <AlertTriangle size={14} class="text-amber-500 mt-0.5 shrink-0" />
        <div>
          <p class="text-xs font-semibold text-amber-400">Cancellation scheduled</p>
          <p class="text-[10px] text-zinc-500 mt-0.5">
            Effective {formatDate(data.subscription.cancelAt)}
          </p>
        </div>
      </div>
    {/if}
    {#if hasPendingDowngrade}
      <div class="bg-blue-500/5 border border-blue-500/20 rounded p-3 flex items-start gap-2">
        <ArrowDownRight size={14} class="text-blue-400 mt-0.5 shrink-0" />
        <div>
          <p class="text-xs font-semibold text-blue-400">Downgrade scheduled</p>
          <p class="text-[10px] text-zinc-500 mt-0.5">
            Effective {formatDate((data.subscription.metadata as any).scheduled_downgrade.effective_at)}
          </p>
        </div>
      </div>
    {/if}

    <!-- Quick Stats -->
    <div class="grid grid-cols-3 gap-3">
      <div class="bg-white/5 rounded p-3 text-center">
        <div class="text-lg font-bold text-white">{data.entitlements?.length || 0}</div>
        <div class="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Features</div>
      </div>
      <div class="bg-white/5 rounded p-3 text-center">
        <div class="text-lg font-bold text-white">{data.timeline?.length || 0}</div>
        <div class="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Events</div>
      </div>
      <div class="bg-white/5 rounded p-3 text-center">
        <div class="text-lg font-bold text-white">{otherPlans.length}</div>
        <div class="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Plans</div>
      </div>
    </div>

    <!-- Actions -->
    {#if isActive}
      <div>
        <h4 class="text-[10px] font-bold text-white uppercase tracking-widest mb-3">Actions</h4>
        <div class="flex flex-wrap gap-2">
          <button
            class="btn btn-secondary gap-1.5 text-[10px] uppercase tracking-wider font-bold px-3 py-1.5"
            disabled={actionLoading !== null}
            onclick={() => { showSwitchPlan = !showSwitchPlan; switchPreview = null; }}
          >
            <RefreshCw size={11} />
            Switch Plan
          </button>
          {#if !hasPendingCancel}
            <button
              class="btn btn-secondary gap-1.5 text-[10px] uppercase tracking-wider font-bold px-3 py-1.5"
              disabled={actionLoading !== null}
              onclick={() => cancelSubscription(false)}
            >
              {#if actionLoading === "cancel"}
                <Loader2 size={11} class="animate-spin" />
              {:else}
                <Clock size={11} />
              {/if}
              Cancel at Period End
            </button>
          {/if}
          <button
            class="btn gap-1.5 text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
            disabled={actionLoading !== null}
            onclick={() => cancelSubscription(true)}
          >
            {#if actionLoading === "cancel"}
              <Loader2 size={11} class="animate-spin" />
            {:else}
              <Ban size={11} />
            {/if}
            Cancel Now
          </button>
        </div>
      </div>
    {/if}

    <!-- Switch Plan Panel -->
    {#if showSwitchPlan && otherPlans.length > 0}
      <div class="bg-white/5 rounded p-4 space-y-3">
        <h4 class="text-[10px] font-bold text-white uppercase tracking-widest">Switch to...</h4>
        <div class="space-y-2">
          {#each otherPlans as plan}
            <button
              class="w-full text-left bg-white/5 hover:bg-white/10 rounded p-3 transition-colors flex items-center justify-between group"
              disabled={previewLoading}
              onclick={() => previewPlanSwitch(plan.id)}
            >
              <div>
                <span class="text-xs font-semibold text-white">{plan.name}</span>
                <span class="text-[10px] text-zinc-500 ml-2">
                  {formatCurrency(plan.price, plan.currency)} / {plan.interval}
                </span>
              </div>
              <ArrowRight size={12} class="text-zinc-700 group-hover:text-zinc-400 transition-colors" />
            </button>
          {/each}
        </div>

        <!-- Preview Result -->
        {#if previewLoading}
          <div class="flex items-center gap-2 text-zinc-500 text-xs py-2">
            <Loader2 size={12} class="animate-spin" />
            Calculating...
          </div>
        {/if}
        {#if switchPreview}
          <div class="bg-white/5 rounded p-3 border border-border space-y-2">
            <div class="flex items-center gap-2">
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border
                {switchPreview.type === 'upgrade' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                 switchPreview.type === 'downgrade' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                 'bg-blue-500/10 text-blue-400 border-blue-500/20'}">
                {switchPreview.type}
              </span>
              <span class="text-xs text-zinc-400">{switchPreview.effectiveAt === 'immediate' ? 'Immediate' : 'At period end'}</span>
            </div>
            <p class="text-[10px] text-zinc-500">{switchPreview.message}</p>
            {#if switchPreview.proratedAmount > 0}
              <p class="text-xs text-white font-semibold">
                Prorated charge: {formatCurrency(switchPreview.proratedAmount, switchPreview.newPlan.currency || 'NGN')}
              </p>
            {/if}
            <button
              class="btn btn-primary gap-1.5 text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 w-full mt-2"
              disabled={actionLoading === "switch"}
              onclick={executePlanSwitch}
            >
              {#if actionLoading === "switch"}
                <Loader2 size={11} class="animate-spin" />
              {:else}
                <CheckCircle size={11} />
              {/if}
              Confirm {switchPreview.type}
            </button>
          </div>
        {/if}
      </div>
    {:else if showSwitchPlan && otherPlans.length === 0}
      <div class="bg-white/5 rounded p-4 text-center">
        <p class="text-xs text-zinc-500">No other plans available in this group.</p>
      </div>
    {/if}

    <!-- Entitlements -->
    {#if data.entitlements?.length > 0}
      <div>
        <h4 class="text-[10px] font-bold text-white uppercase tracking-widest mb-3">Entitlements</h4>
        <div class="space-y-2">
          {#each data.entitlements as ent}
            <div class="bg-white/5 rounded p-3 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Shield size={12} class="text-zinc-500" />
                <span class="text-xs font-medium text-white">{ent.featureName}</span>
                {#if ent.unit}
                  <span class="text-[9px] text-zinc-600">({ent.unit})</span>
                {/if}
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
    <Package size={24} class="text-zinc-600 mb-3" />
    <p class="text-xs text-zinc-500">Subscription not found</p>
  </div>
{/if}
