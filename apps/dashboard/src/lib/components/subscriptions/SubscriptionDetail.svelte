<script lang="ts">
  import {
    ArrowDownRight,
    ArrowRight,
    ArrowUpRight,
    ArrowsClockwise,
    Calendar,
    CheckCircle,
    CircleNotch,
    Clock,
    CreditCard,
    Envelope,
    Hash,
    Lightning,
    Package,
    Prohibit,
    Shield,
    User,
    Warning,
    XCircle,
  } from "phosphor-svelte";
  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import { formatCurrency } from "$lib/utils/currency";
  import Timeline from "$lib/components/ui/Timeline.svelte";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  let {
    subscriptionId,
    onupdate,
    controller = $bindable(),
  }: {
    subscriptionId: string;
    onupdate?: () => void;
    controller?: any;
  } = $props();

  $effect(() => {
    controller = {
      sendCheckout,
      activateDirectly,
      actionLoading,
      status: data?.subscription?.status,
    };
  });

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
    if (
      !confirm(
        immediate
          ? "Cancel this subscription immediately? The customer will lose access right away."
          : "Schedule cancellation at end of billing period?",
      )
    )
      return;

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
      const res = await apiFetch(
        "/api/dashboard/subscriptions/preview-switch",
        {
          method: "POST",
          body: JSON.stringify({
            customerId: data.customer.id,
            newPlanId,
          }),
        },
      );
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
    if (
      !confirm(
        `Confirm ${switchPreview.type}: Switch to ${switchPreview.newPlan.name}?`,
      )
    )
      return;

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
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  async function sendCheckout() {
    actionLoading = "checkout";
    try {
      const res = await apiFetch(
        `/api/dashboard/subscriptions/${subscriptionId}/checkout`,
        {
          method: "POST",
        },
      );
      if (res.data?.success) {
        alert("Checkout link sent to customer email");
        await loadDetail(subscriptionId);
      }
    } catch (e) {
      console.error("Checkout failed:", e);
    } finally {
      actionLoading = null;
    }
  }

  async function activateDirectly() {
    if (
      !confirm(
        "Activate this subscription manually? This will grant access immediately without payment.",
      )
    )
      return;
    actionLoading = "activate";
    try {
      const res = await apiFetch(
        `/api/dashboard/subscriptions/${subscriptionId}/activate`,
        {
          method: "POST",
        },
      );
      if (res.data?.success) {
        await loadDetail(subscriptionId);
        onupdate?.();
      }
    } catch (e) {
      console.error("Activation failed:", e);
    } finally {
      actionLoading = null;
    }
  }

  function formatRelativeTime(ts: number) {
    const diff = Date.now() - ts;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  function statusColor(status: string) {
    switch (status) {
      case "active":
        return "bg-success-bg text-success border-success/20";
      case "canceled":
        return "bg-bg-secondary text-text-dim border-border";
      case "trialing":
        return "bg-info-bg text-info border-info/20";
      case "past_due":
        return "bg-warning-bg text-warning border-warning/20";
      default:
        return "bg-bg-secondary text-text-dim border-border";
    }
  }

  function eventIcon(type: string): any {
    if (type.includes("downgrade")) return ArrowDownRight;
    if (type.includes("upgrade") || type.includes("switch"))
      return ArrowUpRight;
    if (type.includes("cancel")) return XCircle;
    if (type.includes("subscription")) return Calendar;
    if (type.includes("charge") || type.includes("payment")) return CreditCard;
    if (type.includes("customer")) return User;
    return Lightning;
  }

  function eventColor(type: string) {
    if (type.includes("cancel")) return "bg-error-bg text-error";
    if (type.includes("downgrade")) return "bg-warning-bg text-warning";
    if (type.includes("upgrade")) return "bg-success-bg text-success";
    if (type.includes("charge.success") || type.includes("payment"))
      return "bg-success-bg text-success";
    if (type.includes("charge.failed")) return "bg-error-bg text-error";
    return "bg-info-bg text-info";
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
    return (
      labels[type] ||
      type
        .replace(/[._]/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase())
    );
  }

  const isActive = $derived(
    data?.subscription?.status === "active" ||
      data?.subscription?.status === "trialing",
  );
  const isPending = $derived(data?.subscription?.status === "pending");
  const hasPendingCancel = $derived(
    !!data?.subscription?.cancelAt && !data?.subscription?.canceledAt,
  );
  const hasPendingDowngrade = $derived(
    !!(data?.subscription?.metadata as any)?.scheduled_downgrade,
  );
  const isFree = $derived(data?.plan?.type === "free");
  const isOneTime = $derived(
    (data?.subscription?.metadata as any)?.billing_type === "one_time" ||
      ((data?.subscription?.providerSubscriptionCode ||
        data?.subscription?.paystackSubscriptionCode) === "one-time" &&
        data?.subscription?.currentPeriodStart ===
          data?.subscription?.currentPeriodEnd),
  );

  const timeline = $derived.by(() => {
    const timelineData = Array.isArray(data?.timeline) ? data.timeline : [];
    return timelineData.map((item: any) => ({
      label: eventLabel(item.type),
      time: formatRelativeTime(item.timestamp),
      icon: eventIcon(item.type),
      iconColor: eventColor(item.type),
      detail: item.detail,
    }));
  });

  const otherPlans = $derived(
    (data?.availablePlans || []).filter((p: any) => p.id !== data?.plan?.id),
  );
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
    <div class="grid grid-cols-3 gap-3">
      {#each Array(3) as _}
        <Skeleton class="h-16 w-full rounded" />
      {/each}
    </div>
    <div class="space-y-3">
      <Skeleton class="h-3 w-20" />
      {#each Array(2) as _}
        <Skeleton class="h-12 w-full rounded" />
      {/each}
    </div>
    <div class="space-y-3">
      <Skeleton class="h-3 w-20" />
      {#each Array(3) as _}
        <Skeleton class="h-10 w-full rounded" />
      {/each}
    </div>
  </div>
{:else if data}
  <div class="p-5 space-y-5">
    <!-- Subscription Header -->
    <div class="flex items-start gap-3">
      <div
        class="w-10 h-10 rounded-full bg-accent-light border border-accent flex items-center justify-center text-accent shrink-0"
      >
        <Package size={16} weight="duotone" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <h3 class="text-sm font-bold text-text-primary truncate">
            {data.plan.name}
          </h3>
          <ProviderBadge providerId={data.subscription.providerId} size="xs" />
          <span
            class="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border {statusColor(
              data.subscription.status,
            )}"
          >
            {data.subscription.status}
          </span>
        </div>
        <div class="flex flex-col gap-1">
          <span class="flex items-center gap-1.5 text-[10px] text-text-dim">
            <CreditCard size={10} weight="duotone" />
            {formatCurrency(data.plan.price, data.plan.currency)}{isOneTime
              ? " (one-time)"
              : ` / ${data.plan.interval}`}
          </span>
          <span class="flex items-center gap-1.5 text-[10px] text-text-dim">
            <Envelope size={10} weight="duotone" />
            {data.customer.email}
          </span>
          {#if isFree}
            <span class="flex items-center gap-1.5 text-[10px] text-text-dim">
              <Clock size={10} weight="duotone" />
              Active since {formatDate(data.subscription.currentPeriodStart)}
            </span>
          {:else if !isOneTime}
            <span class="flex items-center gap-1.5 text-[10px] text-text-dim">
              <Clock size={10} weight="duotone" />
              {formatDate(data.subscription.currentPeriodStart)} – {formatDate(
                data.subscription.currentPeriodEnd,
              )}
            </span>
          {:else}
            <span class="flex items-center gap-1.5 text-[10px] text-text-dim">
              <Clock size={10} weight="duotone" />
              Purchased {formatDate(data.subscription.createdAt)}
            </span>
          {/if}
          {#if (data.subscription.providerSubscriptionCode || data.subscription.paystackSubscriptionCode) && (data.subscription.providerSubscriptionCode || data.subscription.paystackSubscriptionCode) !== "one-time"}
            <span
              class="flex items-center gap-1.5 text-[10px] text-text-dim font-mono"
            >
              <Hash size={10} weight="duotone" />
              {data.subscription.providerSubscriptionCode ||
                data.subscription.paystackSubscriptionCode}
            </span>
          {/if}
        </div>
      </div>
    </div>

    <!-- Alerts -->
    {#if hasPendingCancel}
      <div
        class="bg-warning-bg border border-warning rounded p-3 flex items-start gap-2"
      >
        <Warning size={14} class="text-warning mt-0.5 shrink-0" weight="fill" />
        <div>
          <p class="text-xs font-semibold text-warning">
            Cancellation scheduled
          </p>
          <p class="text-[10px] text-text-dim mt-0.5">
            Effective {formatDate(data.subscription.cancelAt)}
          </p>
        </div>
      </div>
    {/if}
    {#if hasPendingDowngrade}
      <div
        class="bg-info-bg border border-info rounded p-3 flex items-start gap-2"
      >
        <ArrowDownRight
          size={14}
          class="text-info mt-0.5 shrink-0"
          weight="duotone"
        />
        <div>
          <p class="text-xs font-semibold text-info">Downgrade scheduled</p>
          <p class="text-[10px] text-text-dim mt-0.5">
            Effective {formatDate(
              (data.subscription.metadata as any).scheduled_downgrade
                .effective_at,
            )}
          </p>
        </div>
      </div>
    {/if}

    <!-- Quick Stats -->
    <div class="grid grid-cols-3 gap-3">
      <div class="bg-bg-secondary rounded p-3 text-center">
        <div class="text-lg font-bold text-text-primary">
          {data.entitlements?.length || 0}
        </div>
        <div
          class="text-[9px] text-text-dim uppercase tracking-widest font-bold"
        >
          Features
        </div>
      </div>
      <div class="bg-bg-secondary rounded p-3 text-center">
        <div class="text-lg font-bold text-text-primary">
          {data.timeline?.length || 0}
        </div>
        <div
          class="text-[9px] text-text-dim uppercase tracking-widest font-bold"
        >
          Events
        </div>
      </div>
      <div class="bg-bg-secondary rounded p-3 text-center">
        <div class="text-lg font-bold text-text-primary">
          {otherPlans.length}
        </div>
        <div
          class="text-[9px] text-text-dim uppercase tracking-widest font-bold"
        >
          Plans
        </div>
      </div>
    </div>

    <!-- Actions -->
    {#if isActive}
      <div>
        <h4
          class="text-[10px] font-bold text-text-primary uppercase tracking-widest mb-3"
        >
          Actions
        </h4>
        <div class="flex flex-wrap gap-2">
          {#if !isOneTime}
            <button
              class="btn btn-secondary gap-1.5 text-[10px] uppercase tracking-wider font-bold px-3 py-1.5"
              disabled={actionLoading !== null}
              onclick={() => {
                showSwitchPlan = !showSwitchPlan;
                switchPreview = null;
              }}
            >
              <ArrowsClockwise size={11} weight="fill" />
              Switch Plan
            </button>
            {#if !isFree && !hasPendingCancel}
              <button
                class="btn btn-secondary gap-1.5 text-[10px] uppercase tracking-wider font-bold px-3 py-1.5"
                disabled={actionLoading !== null}
                onclick={() => cancelSubscription(false)}
              >
                {#if actionLoading === "cancel"}
                  <CircleNotch
                    size={11}
                    class="animate-spin"
                    weight="duotone"
                  />
                {:else}
                  <Clock size={11} weight="duotone" />
                {/if}
                Cancel at Period End
              </button>
            {/if}
          {/if}
          <button
            class="btn gap-1.5 text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 bg-error-bg text-error border border-error hover:bg-error-bg/80"
            disabled={actionLoading !== null}
            onclick={() => cancelSubscription(true)}
          >
            {#if actionLoading === "cancel"}
              <CircleNotch size={11} class="animate-spin" weight="duotone" />
            {:else}
              <Prohibit size={11} weight="duotone" />
            {/if}
            {isOneTime ? "Revoke Access" : "Cancel Now"}
          </button>
        </div>
      </div>
    {/if}

    <!-- Switch Plan Panel -->
    {#if showSwitchPlan && otherPlans.length > 0}
      <div class="bg-bg-secondary rounded p-4 space-y-3">
        <h4
          class="text-[10px] font-bold text-text-primary uppercase tracking-widest"
        >
          Switch to...
        </h4>
        <div class="space-y-2">
          {#each otherPlans as plan}
            <button
              class="w-full text-left bg-bg-secondary hover:bg-bg-tertiary rounded p-3 transition-colors flex items-center justify-between group"
              disabled={previewLoading}
              onclick={() => previewPlanSwitch(plan.id)}
            >
              <div>
                <span class="text-xs font-semibold text-text-primary"
                  >{plan.name}</span
                >
                <span class="text-[10px] text-text-dim ml-2">
                  {formatCurrency(plan.price, plan.currency)} / {plan.interval}
                </span>
              </div>
              <ArrowRight
                size={12}
                class="text-text-dim/20 group-hover:text-text-dim transition-colors"
                weight="fill"
              />
            </button>
          {/each}
        </div>

        <!-- Preview Result -->
        {#if previewLoading}
          <div class="flex items-center gap-2 text-text-dim text-xs py-2">
            <CircleNotch size={12} class="animate-spin" weight="duotone" />
            Calculating...
          </div>
        {/if}
        {#if switchPreview}
          <div
            class="bg-bg-secondary rounded p-3 border border-border space-y-2"
          >
            <div class="flex items-center gap-2">
              <span
                class="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border
                {switchPreview.type === 'upgrade'
                  ? 'bg-success-bg text-success border-success/20'
                  : switchPreview.type === 'downgrade'
                    ? 'bg-warning-bg text-warning border-warning/20'
                    : 'bg-info-bg text-info border-info/20'}"
              >
                {switchPreview.type}
              </span>
              <span class="text-xs text-text-dim"
                >{switchPreview.effectiveAt === "immediate"
                  ? "Immediate"
                  : "At period end"}</span
              >
            </div>
            <p class="text-[10px] text-text-dim">{switchPreview.message}</p>
            {#if switchPreview.proratedAmount > 0}
              <p class="text-xs text-text-primary font-semibold">
                Prorated charge: {formatCurrency(
                  switchPreview.proratedAmount,
                  switchPreview.newPlan.currency || "NGN",
                )}
              </p>
            {/if}
            <button
              class="btn btn-primary gap-1.5 text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 w-full mt-2"
              disabled={actionLoading === "switch"}
              onclick={executePlanSwitch}
            >
              {#if actionLoading === "switch"}
                <CircleNotch size={11} class="animate-spin" weight="duotone" />
              {:else}
                <CheckCircle size={11} weight="fill" />
              {/if}
              Confirm {switchPreview.type}
            </button>
          </div>
        {/if}
      </div>
    {:else if showSwitchPlan && otherPlans.length === 0}
      <div class="bg-black/5 dark:bg-white/5 rounded p-4 text-center">
        <p class="text-xs text-text-dim">
          No other plans available in this group.
        </p>
      </div>
    {/if}

    <!-- Entitlements -->
    {#if data.entitlements?.length > 0}
      <div>
        <h4
          class="text-[10px] font-bold text-text-primary uppercase tracking-widest mb-3"
        >
          Entitlements
        </h4>
        <div class="space-y-2">
          {#each data.entitlements as ent}
            <div
              class="bg-bg-secondary rounded p-3 flex items-center justify-between"
            >
              <div class="flex items-center gap-2">
                <Shield size={12} class="text-text-dim" weight="duotone" />
                <span class="text-xs font-medium text-text-primary"
                  >{ent.featureName}</span
                >
                {#if ent.unit}
                  <span class="text-[9px] text-text-dim">({ent.unit})</span>
                {/if}
              </div>
              <div class="text-right">
                {#if ent.limitValue !== null}
                  <span class="text-xs font-bold text-text-primary"
                    >{ent.limitValue}</span
                  >
                  <span class="text-[9px] text-text-dim ml-1"
                    >/ {ent.resetInterval}</span
                  >
                {:else}
                  <span class="text-[9px] font-bold text-success uppercase"
                    >Unlimited</span
                  >
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Pulse Timeline -->
    <div>
      <h4
        class="text-[10px] font-bold text-text-primary uppercase tracking-widest mb-2"
      >
        Pulse
      </h4>
      <div class="bg-bg-secondary rounded overflow-hidden">
        <Timeline items={timeline} />
      </div>
    </div>
  </div>
{:else}
  <div class="flex flex-col items-center justify-center py-16 text-center px-5">
    <Package size={24} class="text-text-dim/20 mb-3" weight="duotone" />
    <p class="text-xs text-text-dim">Subscription not found</p>
  </div>
{/if}
