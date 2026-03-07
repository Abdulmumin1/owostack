<script lang="ts">
  import {
    ArrowRight,
    ArrowsClockwise,
    CaretLeft,
    CaretRight,
    CheckCircle,
    CircleNotch,
    Clock,
    CreditCard,
    Funnel,
    MagnifyingGlass,
    WarningCircle,
    Envelope,
    Lightning,
  } from "phosphor-svelte";
  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import { formatCurrency } from "$lib/utils/currency";
  import { onMount } from "svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import SubscriptionDetail from "$lib/components/subscriptions/SubscriptionDetail.svelte";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  // Pagination options
  const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

  const organizationId = $derived(page.params.projectId);
  let subscriptions = $state<any[]>([]);
  let totalCount = $state(0);
  let currentPage = $state(1);
  let pageSize = $state(25);
  let isLoading = $state(true);
  let searchQuery = $state("");
  let selectedSubId = $state<string | null>(null);
  let subDetailController = $state<any>(null);

  // Computed values
  const totalPages = $derived(Math.ceil(totalCount / pageSize) || 1);
  const startItem = $derived((currentPage - 1) * pageSize + 1);
  const endItem = $derived(Math.min(currentPage * pageSize, totalCount));
  const hasPrevious = $derived(currentPage > 1);
  const hasNext = $derived(currentPage < totalPages);

  const selectedSub = $derived(
    subscriptions.find((s) => s.id === selectedSubId),
  );

  async function loadSubscriptions() {
    if (!organizationId) return;

    isLoading = true;
    try {
      const offset = (currentPage - 1) * pageSize;
      const params = new URLSearchParams();
      params.set("organizationId", organizationId ?? "");
      params.set("limit", String(pageSize));
      params.set("offset", String(offset));

      const res = await apiFetch(`/api/dashboard/subscriptions?${params}`);
      if (res.data?.success) {
        subscriptions = res.data.data;
        totalCount = Number(res.data.total) || 0;
      }
    } catch (e) {
      console.error("Failed to load subscriptions", e);
    } finally {
      isLoading = false;
    }
  }

  function goToPage(pageNum: number) {
    if (pageNum < 1 || pageNum > totalPages) return;
    currentPage = pageNum;
    loadSubscriptions();
  }

  function changePageSize(newSize: number) {
    pageSize = newSize;
    currentPage = 1;
    loadSubscriptions();
  }

  onMount(() => {
    loadSubscriptions();
  });

  const filteredSubs = $derived(
    subscriptions.filter(
      (s) =>
        s.customer?.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.plan?.name.toLowerCase().includes(searchQuery.toLowerCase()),
    ),
  );

  function getStatusColor(status: string) {
    switch (status.toLowerCase()) {
      case "active":
        return "text-success bg-success-bg border-success/20";
      case "trialing":
        return "text-info bg-info-bg border-info/20";
      case "canceled":
        return "text-text-dim bg-bg-secondary border-border";
      case "expired":
        return "text-warning bg-warning-bg border-warning/20";
      case "past_due":
        return "text-warning bg-warning-bg border-warning/20";
      case "incomplete":
        return "text-error bg-error-bg border-error/20";
      default:
        return "text-text-dim bg-bg-secondary border-border";
    }
  }

  function formatMoney(amount: number, currency: string) {
    return formatCurrency(amount, currency);
  }

  function getHealthMessage(sub: any): string {
    const reasons = Array.isArray(sub?.health?.reasons) ? sub.health.reasons : [];
    const renewalStatus = sub?.health?.renewalSetup?.renewal_setup_status;
    if (reasons.includes("renewal_setup_failed")) {
      if (renewalStatus === "scheduled" || renewalStatus === "retrying") {
        return "Renewal setup failed after trial conversion. Automatic retry is scheduled.";
      }
      return "Renewal setup failed after trial conversion. This subscription will stop at period end unless renewal setup succeeds.";
    }
    if (
      reasons.includes("period_end_stale") &&
      reasons.includes("provider_link_missing")
    ) {
      return "Billing period is stale and provider linkage is missing.";
    }
    if (reasons.includes("period_end_stale")) {
      return "Billing period ended and has not reconciled yet.";
    }
    if (reasons.includes("provider_link_missing")) {
      return "Provider linkage is missing for an active paid subscription.";
    }
    return "Subscription needs billing review.";
  }

  function getHealthLabel(sub: any): string {
    const reasons = Array.isArray(sub?.health?.reasons) ? sub.health.reasons : [];
    const renewalStatus = sub?.health?.renewalSetup?.renewal_setup_status;
    if (reasons.includes("renewal_setup_failed")) {
      return renewalStatus === "scheduled" || renewalStatus === "retrying"
        ? "retrying"
        : "renewal setup";
    }
    return "review";
  }

  // Generate page numbers to display
  function getPageNumbers(current: number, total: number): (number | string)[] {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    if (current <= 3) {
      return [1, 2, 3, 4, "...", total];
    }

    if (current >= total - 2) {
      return [1, "...", total - 3, total - 2, total - 1, total];
    }

    return [1, "...", current - 1, current, current + 1, "...", total];
  }
</script>

<svelte:head>
  <title>Subscriptions - Owostack</title>
</svelte:head>

<div class="max-w-6xl">
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1
        class="text-xl font-bold text-text-primary mb-2 uppercase tracking-wide"
      >
        Subscriptions
      </h1>
      <p class="text-text-dim text-[10px] uppercase tracking-widest font-bold">
        Manage customer recurring payments
        {#if totalCount > 0}
          <span class="text-text-dim/60 ml-2">· {totalCount} total</span>
        {/if}
      </p>
    </div>

    <button
      class="btn btn-secondary gap-2 text-xs uppercase tracking-wider font-bold"
      onclick={() => loadSubscriptions()}
    >
      <ArrowsClockwise
        size={14}
        class={isLoading ? "animate-spin" : ""}
        weight="fill"
      />
      Refresh
    </button>
  </div>

  <!-- Toolbar with search and rows per page -->
  <div class="flex items-center justify-between gap-4 mb-6">
    <div class="input-icon-wrapper max-w-sm">
      <MagnifyingGlass
        size={14}
        class="input-icon-left text-text-dim"
        weight="fill"
      />
      <input
        type="text"
        placeholder="by customer or plan..."
        bind:value={searchQuery}
        class="input input-has-icon-left"
      />
    </div>

    <div class="flex items-center gap-3">
      <!-- Rows per page selector -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-text-dim">Rows:</span>
        <select
          class="input input-sm !py-1 !px-2 !w-auto text-xs"
          value={pageSize}
          onchange={(e) => changePageSize(Number(e.currentTarget.value))}
        >
          {#each PAGE_SIZE_OPTIONS as size}
            <option value={size}>{size}</option>
          {/each}
        </select>
      </div>
    </div>
  </div>

  {#if isLoading && subscriptions.length === 0}
    <div class="bg-bg-card border border-border overflow-hidden">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-bg-secondary border-b border-border">
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Customer</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Plan</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Provider</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Status</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Next Billing</th
            >
            <th class="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/50">
          {#each Array(5) as _}
            <tr>
              <td class="px-6 py-4">
                <div class="space-y-2">
                  <Skeleton class="h-4 w-32" />
                  <Skeleton class="h-3 w-20" />
                </div>
              </td>
              <td class="px-6 py-4">
                <div class="space-y-2">
                  <Skeleton class="h-4 w-24" />
                  <Skeleton class="h-3 w-16" />
                </div>
              </td>
              <td class="px-6 py-4">
                <Skeleton class="h-4 w-20" />
              </td>
              <td class="px-6 py-4">
                <Skeleton class="h-5 w-16" />
              </td>
              <td class="px-6 py-4">
                <Skeleton class="h-4 w-24" />
              </td>
              <td class="px-6 py-4 text-right">
                <Skeleton class="h-4 w-4 ml-auto" />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if filteredSubs.length === 0}
    <div
      class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center"
    >
      <div
        class="w-12 h-12 bg-bg-secondary flex items-center justify-center mb-4"
      >
        <CreditCard size={24} class="text-text-dim" />
      </div>
      <h3 class="text-lg font-bold text-text-primary mb-2">
        {searchQuery ? "No matching subscriptions" : "No active subscriptions"}
      </h3>
      <p class="text-text-dim max-w-sm text-sm">
        {searchQuery
          ? "Try a different search term."
          : "Subscriptions will appear here when customers subscribe to your plans."}
      </p>
    </div>
  {:else}
    <!-- Subscriptions Table -->
    <div class="bg-bg-card border border-border overflow-hidden">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-bg-secondary border-b border-border">
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Customer</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Plan</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Provider</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Status</th
            >
            <th
              class="px-6 py-4 text-[10px] font-bold text-text-dim uppercase tracking-widest"
              >Next Billing</th
            >
            <th class="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/50">
          {#each filteredSubs as sub}
            <tr
              class="group hover:bg-bg-secondary transition-colors cursor-pointer {selectedSubId ===
              sub.id
                ? 'bg-bg-secondary'
                : ''}"
              onclick={() => (selectedSubId = sub.id)}
            >
              <td class="px-6 py-4">
                <div class="flex flex-col">
                  <span class="text-sm font-bold text-text-primary"
                    >{sub.customer?.email}</span
                  >
                  <span class="text-[9px] text-text-dim font-mono"
                    >ID: {sub.id.split("-")[0]}</span
                  >
                </div>
              </td>
              <td class="px-6 py-4">
                <div class="flex flex-col">
                  <span class="text-sm text-text-secondary font-medium"
                    >{sub.plan?.name}</span
                  >
                  <span class="text-[10px] text-text-dim">
                    {formatMoney(sub.plan?.price, sub.plan?.currency)} / {sub
                      .plan?.interval}
                  </span>
                </div>
              </td>
              <td class="px-6 py-4">
                <ProviderBadge providerId={sub.providerId} />
              </td>
              <td class="px-6 py-4">
                <div class="flex items-center gap-2">
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border {getStatusColor(
                      sub.status,
                    )}"
                  >
                    {sub.status}
                  </span>
                  {#if sub.health?.requiresAction}
                    <span
                      class="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold text-warning"
                      title={getHealthMessage(sub)}
                    >
                      <WarningCircle size={11} weight="fill" />
                      {getHealthLabel(sub)}
                    </span>
                  {/if}
                </div>
              </td>
              <td class="px-6 py-4">
                <div class="flex items-center gap-2 text-xs text-text-dim">
                  <Clock size={12} />
                  {#if sub.status === "trialing"}
                    <span class="text-info"
                      >Trial ends {new Date(
                        sub.currentPeriodEnd,
                      ).toLocaleDateString()}</span
                    >
                  {:else if sub.status === "expired"}
                    <span class="text-warning"
                      >Expired {new Date(
                        sub.currentPeriodEnd,
                      ).toLocaleDateString()}</span
                    >
                  {:else}
                    {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                  {/if}
                </div>
              </td>
              <td class="px-6 py-4 text-right">
                <ArrowRight
                  size={14}
                  class="text-text-dim/20 group-hover:text-text-dim transition-colors"
                  weight="fill"
                />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="flex items-center justify-between px-4 py-4">
      <!-- Left: Results info -->
      <div class="text-xs text-text-dim">
        {#if totalCount > 0}
          Showing {startItem} to {endItem} of {totalCount} results
        {:else}
          No results
        {/if}
      </div>

      <!-- Right: Page navigation -->
      <div class="flex items-center gap-1">
        <!-- Previous button -->
        <button
          class="btn btn-secondary btn-sm !px-2 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!hasPrevious}
          onclick={() => goToPage(currentPage - 1)}
        >
          <CaretLeft size={14} weight="duotone" />
        </button>

        <!-- Page numbers -->
        <div class="flex items-center gap-1">
          {#each getPageNumbers(currentPage, totalPages) as pageNum}
            {#if pageNum === "..."}
              <span class="text-xs text-text-dim px-2">...</span>
            {:else}
              <button
                class="btn btn-sm !px-3 !py-1 text-xs {currentPage === pageNum
                  ? 'btn-primary'
                  : 'btn-secondary'}"
                onclick={() => goToPage(pageNum as number)}
              >
                {pageNum}
              </button>
            {/if}
          {/each}
        </div>

        <!-- Next button -->
        <button
          class="btn btn-secondary btn-sm !px-2 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!hasNext}
          onclick={() => goToPage(currentPage + 1)}
        >
          <CaretRight size={14} weight="duotone" />
        </button>
      </div>
    </div>
  {/if}
</div>

<!-- Subscription Detail Sidebar -->
<SidePanel
  open={!!selectedSubId}
  title={selectedSub?.plan?.name || "Subscription"}
  onclose={() => {
    selectedSubId = null;
  }}
  footer={subDetailController?.status === "pending"
    ? subscriptionFooter
    : undefined}
>
  {#if selectedSubId}
    <SubscriptionDetail
      subscriptionId={selectedSubId}
      onupdate={loadSubscriptions}
      bind:controller={subDetailController}
    />
  {/if}
</SidePanel>

{#snippet subscriptionFooter()}
  <div class="grid grid-cols-3 gap-3">
    <div></div>

    <button
      class="btn btn-secondary gap-2 py-2.5 text-[10px] uppercase tracking-wider font-bold"
      disabled={subDetailController.actionLoading === "activate"}
      onclick={() => subDetailController.activateDirectly()}
    >
      {#if subDetailController.actionLoading === "activate"}
        <CircleNotch size={14} class="animate-spin" />
      {:else}
        <Lightning size={14} weight="duotone" />
      {/if}
      Activate
    </button>
    <button
      class="btn btn-primary gap-2 py-2.5 text-[10px] uppercase tracking-wider font-bold"
      disabled={subDetailController.actionLoading === "checkout"}
      onclick={() => subDetailController.sendCheckout()}
    >
      {#if subDetailController.actionLoading === "checkout"}
        <CircleNotch size={14} class="animate-spin" />
      {:else}
        <Envelope size={14} weight="duotone" />
      {/if}
      Send Invoice
    </button>
  </div>
{/snippet}
