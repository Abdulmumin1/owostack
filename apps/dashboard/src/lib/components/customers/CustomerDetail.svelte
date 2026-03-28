<script lang="ts">
  import { page } from "$app/state";
  import {
    ArrowSquareOut,
    Calendar,
    Clock,
    Envelope,
    Hash,
    Lightning,
    Package,
    Pulse,
    User,
    WarningCircle,
    CaretRight,
    CaretDown,
    Copy,
    Globe,
    ChartBar,
    Receipt,
    SlidersHorizontal,
    Funnel,
    ArrowSquareOutIcon,
    Check
  } from "phosphor-svelte";
  import { apiFetch } from "$lib/auth-client";
  import { formatCurrency } from "$lib/utils/currency";
  import ProgressBar from "$lib/components/ui/ProgressBar.svelte";
  import Timeline from "$lib/components/ui/Timeline.svelte";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import Avatar from "$lib/components/ui/Avatar.svelte";
  import CustomerAccessSection from "./CustomerAccessSection.svelte";
  import CustomerEntitlementsSection from "./CustomerEntitlementsSection.svelte";

  let {
    customerId,
    planId = null,
    variant = "panel",
  }: {
    customerId: string;
    planId?: string | null;
    variant?: "panel" | "page";
  } = $props();

  const organizationId = $derived(page.params.projectId ?? "");
  const isPageVariant = $derived(variant === "page");

  let isLoading = $state(true);
  let data = $state<any>(null);

  async function loadCustomer(id: string, scopedPlanId: string | null) {
    isLoading = true;
    data = null;

    try {
      const params = new URLSearchParams();
      if (scopedPlanId) {
        params.set("planId", scopedPlanId);
      }

      const query = params.size > 0 ? `?${params.toString()}` : "";
      const res = await apiFetch(`/api/dashboard/customers/${id}${query}`);
      if (res.data?.success) {
        data = res.data.data;
      }
    } catch (error) {
      console.error("Failed to load customer", error);
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    if (customerId) {
      void loadCustomer(customerId, planId);
    }
  });

  function formatDate(ts: number | string) {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatDateTime(ts: number | string) {
    return new Date(ts).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatRelativeTime(ts: number) {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "Just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }

  function formatNumber(value: number) {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toLocaleString();
  }

  function getHealthMessage(sub: any) {
    const reasons = Array.isArray(sub?.health?.reasons)
      ? sub.health.reasons
      : [];
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
    const reasons = Array.isArray(sub?.health?.reasons)
      ? sub.health.reasons
      : [];
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
      case "active":
        return "badge-success bg-success/10 text-success border-transparent";
      case "canceled":
        return "badge-error bg-error/10 text-error border-transparent";
      case "trialing":
        return "badge-info bg-info/10 text-info border-transparent";
      case "past_due":
        return "badge-warning bg-warning/10 text-warning border-transparent";
      default:
        return "badge-default bg-bg-secondary text-text-secondary border-transparent";
    }
  }

  function invoiceStatusColor(status: string) {
    switch (status) {
      case "paid":
        return "badge-success bg-success/10 text-success border-transparent";
      case "open":
        return "badge-warning bg-warning/10 text-warning border-transparent";
      case "void":
      case "uncollectible":
        return "badge-error bg-error/10 text-error border-transparent";
      default:
        return "badge-default bg-bg-secondary text-text-secondary border-transparent";
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
    return (
      labels[type] ||
      type.replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    );
  }

  function eventIcon(type: string): any {
    if (type.includes("subscription")) return Calendar;
    if (type.includes("charge") || type.includes("payment")) return Lightning;
    if (type.includes("customer")) return User;
    return Lightning;
  }

  const customer = $derived(data?.customer ?? null);
  const subscriptions = $derived(
    Array.isArray(data?.subscriptions) ? data.subscriptions : [],
  );
  const recentUsage = $derived(
    Array.isArray(data?.recentUsage) ? data.recentUsage : [],
  );
  const featureUsageSummary = $derived(
    Array.isArray(data?.featureUsageSummary) ? data.featureUsageSummary : [],
  );
  const events = $derived(Array.isArray(data?.events) ? data.events : []);
  const invoices = $derived(Array.isArray(data?.invoices) ? data.invoices : []);
  const customerAccess = $derived(
    Array.isArray(data?.customerAccess) ? data.customerAccess : [],
  );
  const scope = $derived(data?.scope ?? null);
  const scopedFeatureIds = $derived(
    Array.isArray(scope?.featureIds) ? scope.featureIds : null,
  );
  const scopedPlanLabel = $derived(
    scope?.plan?.name || scope?.plan?.slug || scope?.plan?.id || null,
  );

  const activeSubscriptions = $derived(
    subscriptions.filter(
      (subscription: any) => subscription.status === "active",
    ).length,
  );
  const totalUsageAmount = $derived(
    featureUsageSummary.reduce(
      (sum: number, feature: any) => sum + Number(feature.totalUsage || 0),
      0,
    ),
  );
  const totalUsageRecords = $derived(
    featureUsageSummary.reduce(
      (sum: number, feature: any) => sum + Number(feature.recordCount || 0),
      0,
    ),
  );
  const maxUsage = $derived(
    featureUsageSummary.length > 0
      ? Math.max(
          ...featureUsageSummary.map((feature: any) => feature.totalUsage),
        )
      : 1,
  );
  const timeline = $derived.by(() => {
    const merged: {
      label: string;
      ts: number;
      icon: any;
      iconColor: string;
    }[] = [
      ...events.map((event: any) => ({
        label: eventLabel(event.type),
        ts: event.createdAt as number,
        icon: eventIcon(event.type),
        iconColor: "bg-info-bg text-info",
      })),
      ...recentUsage.map((usage: any) => ({
        label: `Used ${usage.amount} ${usage.unit || "units"} of ${usage.featureName}`,
        ts: usage.createdAt as number,
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
  const usageChartData = $derived(data?.usageChartData || null);

  let showExpired = $state(false);

  const customerDetailHref = $derived.by(() => {
    if (!organizationId || !customerId) return null;

    const params = new URLSearchParams();
    if (planId) {
      params.set("planId", planId);
    }

    const query = params.size > 0 ? `?${params.toString()}` : "";
    return `/${organizationId}/customers/${customerId}${query}`;
  });
</script>

{#if isLoading}
  {#if isPageVariant}
    <div class="space-y-10 px-4 py-6">
      <div class="space-y-4">
        <Skeleton class="h-4 w-48" />
        <Skeleton class="h-8 w-64" />
      </div>
      <div class="space-y-4">
        <Skeleton class="h-6 w-32" />
        <Skeleton class="h-32 w-full rounded-md" />
      </div>
      <div class="space-y-4">
        <Skeleton class="h-6 w-32" />
        <Skeleton class="h-24 w-full rounded-md" />
      </div>
    </div>
  {:else}
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
  {/if}
{:else if customer}
  {#if isPageVariant}
    <div class="space-y-10 px-4 py-2 max-w-[1200px] mx-auto pb-16">
      <!-- Header -->
      <div class="space-y-3">
        <div
          class="flex items-center gap-2 text-xs font-medium text-text-dim uppercase tracking-wider"
        >
          <a
            href={`/${organizationId}/customers`}
            class="hover:text-text-primary transition-colors">Customers</a
          >
          <CaretRight size={12} weight="bold" />
          <span class="text-text-primary truncate max-w-xs">{customer.id}</span>
        </div>
        <div
          class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="flex items-center gap-3">
            <h1
              class="text-2xl font-display font-semibold text-text-primary truncate max-w-md"
            >
              {customer.id}
            </h1>
            <div class="flex items-center gap-1.5">
              {#if customer.providerId}
                <div
                  class="flex items-center gap-1.5 px-2 py-1 bg-bg-secondary rounded border border-border text-xs text-text-dim ml-2"
                  title="View in Provider"
                >
                  <Globe size={14} />
                  <span>{customer.providerId}</span>
                </div>
              {/if}
            </div>
          </div>
        </div>
      </div>

      <!-- Plans Section -->
      <section class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-2">
            <Package size={20} class="text-text-dim" weight="fill" />
            <h2 class="text-lg font-semibold text-text-primary">Plans</h2>
          </div>
          <div class="flex items-center gap-4">
            <label
              class="flex items-center gap-2 cursor-pointer group select-none"
            >
              <div
                class="relative w-4 h-4 rounded border flex items-center justify-center transition-colors {showExpired
                  ? 'bg-accent border-accent'
                  : 'border-border group-hover:border-text-dim'}"
              >
                {#if showExpired}
                  <Check size={10} class="text-accent-contrast" weight="fill" />
                {/if}
              </div>
              <input type="checkbox" bind:checked={showExpired} class="hidden" />
              <span class="text-sm text-text-dim font-medium"
                >Show Expired</span
              >
            </label>
          </div>
        </div>

        <div class="space-y-4">
          <div
            class="inline-flex items-center px-3 py-1 bg-bg-secondary/60 text-text-secondary text-xs font-medium rounded-md border border-border/50"
          >
            Subscriptions
          </div>

          <div
            class="table-container rounded-lg border border-border shadow-none bg-bg-card"
          >
            <table class="w-full text-sm text-left">
              <thead
                class="bg-bg-card border-b border-border/50 text-xs text-text-dim font-medium"
              >
                <tr>
                  <th class="py-3 px-4 bg-transparent border-0 font-medium"
                    >Name</th
                  >
                  <th class="py-3 px-4 bg-transparent border-0 font-medium"
                    >Price</th
                  >
                  <th class="py-3 px-4 bg-transparent border-0 font-medium"
                    >Status</th
                  >
                  <th class="py-3 px-4 bg-transparent border-0 font-medium"
                    >Created At</th
                  >
                </tr>
              </thead>
              <tbody class="divide-y divide-border/50">
                {#if subscriptions.length > 0}
                  {#each subscriptions as sub}
                    <tr class="hover:bg-bg-secondary/30 transition-colors">
                      <td class="py-3 px-4 font-medium text-text-primary"
                        >{sub.planName}</td
                      >
                      <td class="py-3 px-4 text-text-dim">
                        <span class="font-medium text-text-primary"
                          >{formatCurrency(
                            sub.planPrice,
                            sub.planCurrency,
                          )}</span
                        >
                        /{sub.planInterval}
                      </td>
                      <td class="py-3 px-4">
                        <span
                          class={`badge ${statusColor(sub.status)} uppercase text-[10px] tracking-wider font-bold`}
                        >
                          {sub.status}
                        </span>
                      </td>
                      <td class="py-3 px-4 text-text-dim"
                        >{formatDate(
                          sub.createdAt || sub.currentPeriodStart,
                        )}</td
                      >
                    </tr>
                  {/each}
                {:else}
                  <tr>
                    <td
                      colspan="4"
                      class="text-center py-8 text-sm text-text-dim bg-bg-secondary/10"
                    >
                      No subscriptions found
                    </td>
                  </tr>
                {/if}
              </tbody>
            </table>
          </div>

          <div
            class="inline-flex items-center px-3 py-1 bg-bg-secondary/60 text-text-secondary text-xs font-medium rounded-md border border-border/50 mt-4"
          >
            Purchases
          </div>

          <div
            class="table-container rounded-lg border border-border shadow-none bg-bg-card"
          >
            <table class="w-full text-sm text-left">
              <thead
                class="bg-bg-card border-b border-border/50 text-xs text-text-dim font-medium"
              >
                <tr>
                  <th class="py-3 px-4 bg-transparent border-0 font-medium"
                    >Name</th
                  >
                  <th class="py-3 px-4 bg-transparent border-0 font-medium"
                    >Price</th
                  >
                  <th class="py-3 px-4 bg-transparent border-0 font-medium"
                    >Status</th
                  >
                  <th class="py-3 px-4 bg-transparent border-0 font-medium"
                    >Created At</th
                  >
                  <th class="py-3 px-4 bg-transparent border-0 font-medium w-10"
                  ></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border/50">
                <!-- Example of purchase mimicking the screenshot -->
                {#if false}
                  <tr class="hover:bg-bg-secondary/30 transition-colors">
                    <td class="py-3 px-4 font-medium text-text-primary"
                      >Flint Credits Pack</td
                    >
                    <td class="py-3 px-4 text-text-dim">
                      <span class="font-medium text-text-primary">$0</span> one-off
                    </td>
                    <td class="py-3 px-4">
                      <span
                        class="inline-flex items-center gap-1.5 text-xs font-medium text-success"
                      >
                        <span class="w-2 h-2 rounded-full bg-success"></span>
                        Active
                      </span>
                    </td>
                    <td class="py-3 px-4 text-text-dim">26 Mar 09:14</td>
                    <td class="py-3 px-4 text-right"> </td>
                  </tr>
                {/if}
                <tr>
                  <td
                    colspan="5"
                    class="text-center py-8 text-sm text-text-dim bg-bg-secondary/10"
                  >
                    No purchases found
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <CustomerAccessSection
        {customerId}
        items={customerAccess}
        allowedFeatureIds={scopedFeatureIds}
      />

      <!-- Usage Section -->
      <section class="space-y-4 pt-4">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-2">
            <ChartBar size={20} class="text-text-dim" weight="fill" />
            <h2 class="text-lg font-semibold text-text-primary">Usage</h2>
          </div>
        </div>

        <div
          class="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-0 rounded-lg border border-border shadow-none overflow-hidden bg-bg-card"
        >
          <div class="border-r border-border/50 overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="bg-bg-card border-b border-border/50">
                <tr>
                  <th
                    class="bg-transparent border-0 text-text-dim font-medium text-xs py-3 px-4"
                    >Feature</th
                  >
                  <th
                    class="bg-transparent border-0 text-text-dim font-medium text-xs py-3 px-4"
                    >Value</th
                  >
                  <th
                    class="bg-transparent border-0 text-text-dim font-medium text-xs py-3 px-4"
                  >
                    <div class="flex items-center justify-between">
                      Timestamp
                      <SlidersHorizontal size={14} class="text-text-dim" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border/50">
                {#if recentUsage.length > 0}
                  {#each recentUsage.slice(0, 6) as usage}
                    <tr class="hover:bg-bg-secondary/30 transition-colors">
                      <td
                        class="py-3 px-4 text-xs font-mono text-text-secondary"
                        >{usage.featureSlug || usage.featureName}</td
                      >
                      <td
                        class="py-3 px-4 text-xs font-medium text-text-primary"
                        >{usage.amount}</td
                      >
                      <td class="py-3 px-4 text-xs text-text-dim"
                        >{formatDateTime(usage.createdAt)}</td
                      >
                    </tr>
                  {/each}
                {:else}
                  <tr>
                    <td
                      colspan="3"
                      class="text-center py-8 text-sm text-text-dim bg-bg-secondary/10"
                    >
                      No usage data found
                    </td>
                  </tr>
                {/if}
              </tbody>
            </table>
          </div>
          <div
            class="p-6 bg-bg-card min-h-[250px] flex items-center justify-center border-t lg:border-t-0 border-border/50"
          >
            {#if usageChartData}
              <div
                class="w-full h-full border-b border-l border-border/50 relative ml-8 mb-4"
              >
                <div class="absolute inset-0 flex items-end justify-around px-2">
                  {#each usageChartData.days as day}
                    {#if day.value > 0}
                      <div
                        class="w-6 sm:w-8 bg-accent rounded-t-sm shadow-sm opacity-90 transition-all"
                        style="height: {(day.value / usageChartData.max) * 100}%"
                        title="{day.value} units on {day.label}"
                      ></div>
                    {:else}
                      <div class="w-8 bg-transparent h-[10%]"></div>
                    {/if}
                  {/each}
                </div>
                <!-- Y Axis labels -->
                <div
                  class="absolute -left-10 top-0 text-[10px] text-text-dim w-8 text-right font-mono"
                >
                  {usageChartData.ticks[0]}
                </div>
                <div
                  class="absolute -left-10 top-1/4 text-[10px] text-text-dim w-8 text-right font-mono"
                >
                  {usageChartData.ticks[1]}
                </div>
                <div
                  class="absolute -left-10 top-2/4 text-[10px] text-text-dim w-8 text-right font-mono"
                >
                  {usageChartData.ticks[2]}
                </div>
                <div
                  class="absolute -left-10 top-3/4 text-[10px] text-text-dim w-8 text-right font-mono"
                >
                  {usageChartData.ticks[3]}
                </div>
                <div
                  class="absolute -left-10 bottom-0 text-[10px] text-text-dim w-8 text-right font-mono translate-y-1.5"
                >
                  {usageChartData.ticks[4]}
                </div>
                <!-- Grid lines -->
                <div
                  class="absolute top-0 left-0 right-0 border-t border-dashed border-border/40"
                ></div>
                <div
                  class="absolute top-1/4 left-0 right-0 border-t border-dashed border-border/40"
                ></div>
                <div
                  class="absolute top-2/4 left-0 right-0 border-t border-dashed border-border/40"
                ></div>
                <div
                  class="absolute top-3/4 left-0 right-0 border-t border-dashed border-border/40"
                ></div>
                <!-- X Axis labels -->
                <div
                  class="absolute bottom-0 left-0 right-0 translate-y-full pt-3 flex justify-around text-[10px] text-text-dim font-mono px-2"
                >
                  {#each usageChartData.days as day, i}
                    <span class={i === 6 ? "font-bold text-text-primary" : ""}>{day.label}</span>
                  {/each}
                </div>
              </div>
            {:else}
              <div class="text-sm text-text-dim">Usage chart data not available</div>
            {/if}
          </div>
        </div>
      </section>

      <!-- Invoices Section -->
      <section class="space-y-4 pt-4">
        <div class="flex items-center gap-2">
          <Receipt size={20} class="text-text-dim" weight="fill" />
          <h2 class="text-lg font-semibold text-text-primary">Invoices</h2>
        </div>

        <div
          class="table-container rounded-lg border border-border shadow-none bg-bg-card"
        >
          <table class="w-full text-left text-sm">
            <thead
              class="bg-bg-card border-b border-border/50 text-xs text-text-dim font-medium"
            >
              <tr>
                <th class="py-3 px-4 bg-transparent border-0 font-medium"
                  >Products</th
                >
                <th class="py-3 px-4 bg-transparent border-0 font-medium"
                  >Total</th
                >
                <th class="py-3 px-4 bg-transparent border-0 font-medium"
                  >Status</th
                >
                <th class="py-3 px-4 bg-transparent border-0 font-medium"
                  >Created At</th
                >
              </tr>
            </thead>
            <tbody>
              {#if invoices.length > 0}
                {#each invoices as invoice}
                  <tr class="border-t border-border/40">
                    <td class="py-4 px-4 bg-transparent border-0 align-top">
                      <div class="space-y-1 min-w-0">
                        <div class="text-sm font-medium text-text-primary truncate">
                          {invoice.products?.[0] || invoice.number || "Usage charges"}
                        </div>

                        {#if invoice.products?.length > 1}
                          <div class="text-xs text-text-dim truncate">
                            {#if invoice.products.length === 2}
                              {invoice.products[1]}
                            {:else}
                              {invoice.products[1]} + {invoice.products.length - 2} more
                            {/if}
                          </div>
                        {/if}

                        {#if invoice.number}
                          <div class="text-[10px] font-mono text-text-dim">
                            {invoice.number}
                          </div>
                        {/if}
                      </div>
                    </td>
                    <td class="py-4 px-4 bg-transparent border-0 align-top">
                      <div class="text-sm font-medium text-text-primary">
                        {formatCurrency(invoice.total || 0, invoice.currency)}
                      </div>
                      {#if invoice.status === "open" && invoice.amountDue > 0}
                        <div class="text-[10px] text-text-dim mt-1">
                          {formatCurrency(invoice.amountDue, invoice.currency)} due
                        </div>
                      {/if}
                    </td>
                    <td class="py-4 px-4 bg-transparent border-0 align-top">
                      <span
                        class="badge {invoiceStatusColor(invoice.status)} uppercase"
                      >
                        {invoice.status}
                      </span>
                    </td>
                    <td class="py-4 px-4 bg-transparent border-0 align-top text-sm text-text-dim">
                      {formatDate(invoice.createdAt)}
                    </td>
                  </tr>
                {/each}
              {:else}
                <tr>
                  <td
                    colspan="4"
                    class="text-center py-10 text-sm text-text-dim bg-bg-secondary/10"
                  >
                    Invoices will display when a customer makes a payment
                  </td>
                </tr>
              {/if}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  {:else}
    <div class="p-5 space-y-5">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-start gap-3 min-w-0">
          <div class="w-10 h-10 rounded-full overflow-hidden shrink-0">
            <Avatar name={customer.email} size={40} />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-bold text-text-primary truncate">
                {customer.name || "Anonymous"}
              </h3>
              <ProviderBadge providerId={customer.providerId} size="xs" />
            </div>

            <div class="flex flex-col gap-1 mt-1">
              <span class="flex items-center gap-1.5 text-[10px] text-text-dim">
                <Envelope size={10} weight="duotone" />
                {customer.email}
              </span>

              {#if customer.externalId}
                <span
                  class="flex items-center gap-1.5 text-[10px] text-text-dim font-mono"
                >
                  <Hash size={10} weight="duotone" />
                  {customer.externalId}
                </span>
              {/if}

              <span class="flex items-center gap-1.5 text-[10px] text-text-dim">
                <Clock size={10} weight="duotone" />
                Joined {formatDate(customer.createdAt)}
              </span>
            </div>
          </div>
        </div>

        {#if customerDetailHref}
          <a href={customerDetailHref} class="gap-1.5 shrink-0">
            <ArrowSquareOutIcon size={12} weight="bold" />
          </a>
        {/if}
      </div>

      {#if planId}
        <div
          class="rounded-lg border border-border bg-info-bg/50 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-info"
        >
          Scoped to {scopedPlanLabel || "selected plan"}
        </div>
      {/if}

      <div class="grid grid-cols-3 gap-3">
        <div class="bg-bg-secondary rounded p-3 text-center">
          <div class="text-lg font-bold text-text-primary">
            {subscriptions.length}
          </div>
          <div
            class="text-[9px] text-text-dim uppercase tracking-widest font-bold"
          >
            Subs
          </div>
        </div>
        <div class="bg-bg-secondary rounded p-3 text-center">
          <div class="text-lg font-bold text-text-primary">
            {featureUsageSummary.length}
          </div>
          <div
            class="text-[9px] text-text-dim uppercase tracking-widest font-bold"
          >
            Features
          </div>
        </div>
        <div class="bg-bg-secondary rounded p-3 text-center">
          <div class="text-lg font-bold text-text-primary">
            {timeline.length}
          </div>
          <div
            class="text-[9px] text-text-dim uppercase tracking-widest font-bold"
          >
            Pulse
          </div>
        </div>
      </div>

      <div>
        <h4
          class="text-[10px] font-bold text-text-primary uppercase tracking-widest mb-3"
        >
          Subscriptions
        </h4>

        {#if subscriptions.length > 0}
          <div class="space-y-2">
            {#each subscriptions as subscription}
              <div class="bg-bg-secondary rounded p-3">
                <div class="flex items-center justify-between mb-1.5 gap-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <Package
                      size={12}
                      class="text-text-dim shrink-0"
                      weight="duotone"
                    />
                    <span
                      class="text-xs font-semibold text-text-primary truncate"
                    >
                      {subscription.planName}
                    </span>
                    <span class="text-[9px] text-text-dim font-mono shrink-0">
                      {formatCurrency(
                        subscription.planPrice,
                        subscription.planCurrency,
                      )}
                      /{subscription.planInterval}
                    </span>
                  </div>

                  <span
                    class="badge {statusColor(subscription.status)} uppercase"
                  >
                    {subscription.status}
                  </span>
                </div>

                <div class="text-[9px] text-text-dim">
                  {formatDate(subscription.currentPeriodStart)} to
                  {formatDate(subscription.currentPeriodEnd)}
                </div>

                {#if subscription.health?.requiresAction}
                  <div
                    class="mt-1 inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-warning"
                    title={getHealthMessage(subscription)}
                  >
                    <WarningCircle size={10} weight="fill" />
                    {getHealthLabel(subscription)}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-xs text-text-dim">
            No subscriptions{planId ? " in this plan" : ""}.
          </p>
        {/if}
      </div>

      {#if featureUsageSummary.length > 0}
        <div>
          <div class="flex items-center justify-between mb-3">
            <h4
              class="text-[10px] font-bold text-text-primary uppercase tracking-widest"
            >
              Feature Usage
            </h4>
            <span
              class="text-[9px] text-text-dim font-bold uppercase tracking-widest"
            >
              This month
            </span>
          </div>

          <div class="space-y-3">
            {#each featureUsageSummary as feature}
              <div>
                <div class="flex items-center justify-between mb-1 gap-3">
                  <span class="text-xs text-text-primary font-medium truncate">
                    {feature.featureName}
                  </span>
                  <span class="text-xs text-text-primary font-bold shrink-0">
                    {formatNumber(feature.totalUsage)}
                    {#if feature.unit}
                      <span
                        class="text-[10px] text-text-dim font-normal ml-0.5"
                      >
                        {feature.unit}
                      </span>
                    {/if}
                  </span>
                </div>

                <ProgressBar
                  value={feature.totalUsage}
                  max={maxUsage}
                  color="bg-accent/70"
                />
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="border-t border-border pt-6 mt-6">
        <CustomerEntitlementsSection
          {customerId}
          allowedFeatureIds={scopedFeatureIds}
        />
      </div>

      <div class="border-t border-border pt-6 mt-6">
        <h4
          class="text-[10px] font-bold text-text-primary uppercase tracking-widest mb-2"
        >
          Pulse
        </h4>
        {#if timeline.length > 0}
          <div class="bg-bg-secondary rounded overflow-hidden">
            <Timeline items={timeline} />
          </div>
        {:else}
          <div
            class="rounded-lg border border-dashed border-border bg-bg-secondary/30 px-4 py-8 text-center text-xs text-text-dim"
          >
            No activity recorded yet.
          </div>
        {/if}
      </div>
    </div>
  {/if}
{:else}
  <div class="flex flex-col items-center justify-center py-16 text-center px-5">
    <User size={24} class="text-text-dim/20 mb-3" weight="duotone" />
    <p class="text-xs text-text-dim">Customer not found</p>
  </div>
{/if}
