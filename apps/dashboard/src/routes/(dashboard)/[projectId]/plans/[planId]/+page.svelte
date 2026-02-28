<script lang="ts">
  import {
    ArrowSquareOut,
    Calendar,
    CaretLeft,
    CircleNotch,
    Copy,
    Cube,
    FloppyDisk,
    FloppyDiskIcon,
    Info,
    Lightning,
    LightningSlash,
    Link as LinkIcon,
    MagnifyingGlass,
    PencilSimple,
    Plus,
    Sliders,
    Trash,
    UserPlus,
    Users,
    CaretDown,
    X,
    PlusIcon,
    UserPlusIcon,
    PackageIcon,
    UsersIcon,
  } from "phosphor-svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import Avatar from "$lib/components/ui/Avatar.svelte";
  import CreateCustomerModal from "$lib/components/customers/CreateCustomerModal.svelte";
  import { fade, slide, fly } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { defaultCurrency } from "$lib/stores/currency";
  import { formatCurrency, COMMON_CURRENCIES } from "$lib/utils/currency";
  import CreateFeatureModal from "$lib/components/features/CreateFeatureModal.svelte";

  const projectId = $derived(page.params.projectId);
  const planId = $derived(page.params.planId);

  let plan = $state<any>(null);
  let features = $state<any[]>([]);
  let creditSystems = $state<any[]>([]);
  let subscribers = $state<any[]>([]);
  let isLoading = $state(true);
  let isSaving = $state(false);
  let isLoadingSubscribers = $state(false);
  let generatingCheckoutFor = $state<string | null>(null);

  // Modals state
  let showAttachModal = $state(false);
  let showConfigModal = $state(false);
  let showEditPlanModal = $state(false);
  let showCreateFeatureModal = $state(false);
  let showCreateCustomerModal = $state(false);
  let showAttachCustomerPanel = $state(false);
  let attachCustomerSearch = $state("");
  let attachCustomerResults = $state<any[]>([]);
  let isSearchingCustomers = $state(false);
  let attachingCustomerId = $state<string | null>(null);
  let selectedFeature = $state<any>(null);
  let editingPlanFeature = $state<any>(null);

  let configLimitValue = $state<string>("");
  let configResetInterval = $state<string>("monthly");
  let configUsageModel = $state<"included" | "usage_based">("included");
  let configPricePerUnit = $state<string>("");
  let configBillingUnits = $state<string>("1");
  let configOverage = $state<"block" | "charge">("block");
  let configMaxOverageUnits = $state<string>("");
  let configRolloverEnabled = $state<boolean>(false);
  let configRolloverMaxBalance = $state<string>("");

  let featureSearchQuery = $state<string>("");

  $effect(() => {
    if (showConfigModal && editingPlanFeature) {
      configLimitValue =
        editingPlanFeature.limitValue === null ||
        editingPlanFeature.limitValue === undefined
          ? ""
          : String(editingPlanFeature.limitValue);
      const rawInterval = editingPlanFeature.resetInterval || "monthly";
      const intervalAliases: Record<string, string> = {
        month: "monthly",
        week: "weekly",
        day: "daily",
        year: "yearly",
      };
      configResetInterval = intervalAliases[rawInterval] || rawInterval;
      configUsageModel = editingPlanFeature.usageModel || "included";
      configPricePerUnit = editingPlanFeature.pricePerUnit
        ? String(editingPlanFeature.pricePerUnit / 100)
        : "";
      configBillingUnits = String(editingPlanFeature.billingUnits || 1);
      configOverage = editingPlanFeature.overage || "block";
      configMaxOverageUnits = editingPlanFeature.maxOverageUnits
        ? String(editingPlanFeature.maxOverageUnits)
        : "";
      configRolloverEnabled = editingPlanFeature.rolloverEnabled || false;
      configRolloverMaxBalance = editingPlanFeature.rolloverMaxBalance
        ? String(editingPlanFeature.rolloverMaxBalance)
        : "";
    }
  });

  let editName = $state<string>("");
  let editDescription = $state<string>("");
  let editType = $state<"free" | "paid">("paid");
  let editBillingType = $state<"recurring" | "one_time">("recurring");
  let editInterval = $state<string>("monthly");
  let editCurrency = $state<string>($defaultCurrency);
  let editPrice = $state<string>("");
  let editTrialDays = $state<string>("0");
  let editTrialUnit = $state<string>("days");
  let editAutoEnable = $state<boolean>(false);

  $effect(() => {
    if (showEditPlanModal && plan) {
      editName = plan.name || "";
      editDescription = plan.description || "";
      editType = plan.type || "paid";
      editBillingType = plan.billingType || "recurring";
      editInterval = plan.interval || "monthly";
      editCurrency = plan.currency || $defaultCurrency;
      editPrice =
        typeof plan.price === "number" ? String(plan.price / 100) : "";
      editTrialDays = String(plan.trialDays || 0);
      editTrialUnit =
        (plan.metadata as any)?.trialUnit === "minutes" ? "minutes" : "days";
      editAutoEnable = plan.autoEnable || false;
    }
  });

  async function savePlanEdits() {
    if (!editName.trim()) return;

    isSaving = true;
    try {
      const payload: any = {
        name: editName.trim(),
        description: editDescription.trim() ? editDescription.trim() : null,
        type: editType,
        billingType: editBillingType,
        interval: editBillingType === "one_time" ? "monthly" : editInterval,
        currency: editCurrency,
        trialDays: Math.max(0, Number(editTrialDays || 0)),
        trialUnit: editTrialUnit,
        autoEnable: editAutoEnable,
      };

      if (editType === "free") {
        payload.price = 0;
      } else {
        const parsed = Number(editPrice);
        payload.price = Number.isFinite(parsed)
          ? Math.max(0, Math.round(parsed * 100))
          : 0;
      }

      console.log("Saving plan edits:", { planId, payload });

      const res = await apiFetch(`/api/dashboard/plans/${planId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      console.log("FloppyDisk plan response:", res);

      if (res.error) {
        throw new Error(res.error.message || "Failed to update plan");
      }

      showEditPlanModal = false;
      await loadData();
    } catch (e: any) {
      console.error("Failed to update plan", e);
      alert(e.message || "An error occurred while saving changes");
    } finally {
      isSaving = false;
    }
  }

  async function loadData() {
    isLoading = true;
    try {
      const [planRes, featuresRes, creditsRes] = await Promise.all([
        apiFetch(`/api/dashboard/plans/${planId}`),
        apiFetch(`/api/dashboard/features?organizationId=${projectId}`),
        apiFetch(`/api/dashboard/credits?organizationId=${projectId}`),
      ]);

      if (planRes.data) plan = planRes.data.data;
      if (featuresRes.data) features = featuresRes.data.data;
      if (creditsRes.data) creditSystems = creditsRes.data.data || [];

      // Load subscribers for this plan
      await loadSubscribers();
    } catch (e) {
      console.error("Failed to load data", e);
    } finally {
      isLoading = false;
    }
  }

  async function loadSubscribers() {
    isLoadingSubscribers = true;
    try {
      const res = await apiFetch(
        `/api/dashboard/subscriptions?organizationId=${projectId}&limit=100`,
      );
      if (res.data?.success) {
        // Filter to only subscriptions for this plan
        subscribers = (res.data.data || []).filter(
          (sub: any) => sub.planId === planId,
        );
      }
    } catch (e) {
      console.error("Failed to load subscribers", e);
    } finally {
      isLoadingSubscribers = false;
    }
  }

  async function searchCustomersForAttach() {
    if (!attachCustomerSearch.trim()) {
      attachCustomerResults = [];
      return;
    }
    isSearchingCustomers = true;
    try {
      const params = new URLSearchParams();
      params.set("organizationId", projectId);
      params.set("limit", "10");
      params.set("search", attachCustomerSearch.trim());
      const res = await apiFetch(`/api/dashboard/customers?${params}`);
      if (res.data?.success) {
        attachCustomerResults = res.data.data || [];
      }
    } catch (e) {
      console.error("Failed to search customers", e);
    } finally {
      isSearchingCustomers = false;
    }
  }

  async function attachCustomerToPlan(customerId: string) {
    attachingCustomerId = customerId;
    try {
      // Create a subscription for this customer on this plan
      const status = plan?.type === "free" ? "active" : "pending";
      const res = await apiFetch(`/api/dashboard/subscriptions`, {
        method: "POST",
        body: JSON.stringify({
          customerId,
          planId,
          status,
        }),
      });
      if (res.data?.success) {
        showAttachCustomerPanel = false;
        attachCustomerSearch = "";
        attachCustomerResults = [];
        await loadSubscribers();
      } else if (res.error) {
        // Handle conflict (409) - subscription already exists
        if ((res.error as any).status === 409) {
          showAttachCustomerPanel = false;
          attachCustomerSearch = "";
          attachCustomerResults = [];
          await loadSubscribers();
        } else {
          alert(res.error.message || "Failed to attach customer to plan");
        }
      }
    } catch (e) {
      console.error("Failed to attach customer", e);
    } finally {
      attachingCustomerId = null;
    }
  }

  async function generateCheckoutLink(subscriptionId: string) {
    generatingCheckoutFor = subscriptionId;
    try {
      const res = await apiFetch(
        `/api/dashboard/subscriptions/${subscriptionId}/checkout`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      if (res.data?.success) {
        if (res.data.activated) {
          // Free plan was auto-activated
          await loadSubscribers();
        } else if (res.data.checkoutUrl) {
          // Copy checkout URL to clipboard
          await navigator.clipboard.writeText(res.data.checkoutUrl);
          alert(
            `Checkout link copied to clipboard!\n\nSend this to the customer:\n${res.data.checkoutUrl}`,
          );
        }
      } else {
        alert(res.data?.error || "Failed to generate checkout link");
      }
    } catch (e: any) {
      console.error(e);
      alert(e.message || "Failed to generate checkout link");
    } finally {
      generatingCheckoutFor = null;
    }
  }

  async function activateSubscription(subscriptionId: string) {
    try {
      const res = await apiFetch(
        `/api/dashboard/subscriptions/${subscriptionId}/activate`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (res.data?.success) {
        await loadSubscribers();
      } else {
        alert(res.data?.error || "Failed to activate subscription");
      }
    } catch (e: any) {
      console.error(e);
      alert(e.message || "Failed to activate");
    }
  }

  let attachSearchTimer: ReturnType<typeof setTimeout> | null = null;
  function onAttachSearchInput() {
    if (attachSearchTimer) clearTimeout(attachSearchTimer);
    attachSearchTimer = setTimeout(() => {
      searchCustomersForAttach();
    }, 300);
  }

  $effect(() => {
    if (planId) loadData();
  });

  async function detachFeature(planFeatureId: string) {
    if (!confirm("Are you sure you want to remove this feature from the plan?"))
      return;
    try {
      await apiFetch(`/api/dashboard/plans/features/${planFeatureId}`, {
        method: "DELETE",
      });
      await loadData();
    } catch (e) {
      console.error("Failed to detach feature", e);
    }
  }

  async function handleAttachFeature(featureId: string) {
    isSaving = true;
    try {
      await apiFetch(`/api/dashboard/plans/${planId}/features`, {
        method: "POST",
        body: JSON.stringify({ featureId }),
      });
      showAttachModal = false;
      await loadData();
    } catch (e) {
      console.error("Failed to attach feature", e);
    } finally {
      isSaving = false;
    }
  }

  async function handleUpdateFeatureConfig(config: any) {
    isSaving = true;
    try {
      await apiFetch(`/api/dashboard/plans/features/${editingPlanFeature.id}`, {
        method: "PATCH",
        body: JSON.stringify(config),
      });
      showConfigModal = false;
      editingPlanFeature = null;
      await loadData();
    } catch (e) {
      console.error("Failed to update config", e);
    } finally {
      isSaving = false;
    }
  }

  function formatMoney(amount: number, currency: string) {
    return formatCurrency(amount, currency);
  }

  function onFeatureCreated(feature: any) {
    if (feature) {
      features = [...features, feature];
      // Automatically attach the new feature
    }
  }

  let expandedCreditSystems = $state<string[]>([]);
  function toggleCreditSystem(id: string) {
    if (expandedCreditSystems.includes(id)) {
      expandedCreditSystems = expandedCreditSystems.filter((i) => i !== id);
    } else {
      expandedCreditSystems = [...expandedCreditSystems, id];
    }
  }
</script>

<svelte:head>
  <title>{plan ? plan.name : "Plan Details"} - Owostack</title>
</svelte:head>

<div class="max-w-4xl mx-auto space-y-4">
  {#if plan}
    <!-- Header: Compact & Crammed -->
    <div class="flex items-start justify-between gap-6 pb-4">
      <div class="flex items-center gap-3">
        <a
          href="/{projectId}/plans"
          class="p-2 bg-bg-card border border-border hover:bg-bg-secondary text-text-dim hover:text-text-primary transition-all rounded-lg shrink-0"
          title="Back to Plans"
        >
          <CaretLeft size={16} weight="bold" />
        </a>
        <div class="flex flex-col">
          <div class="flex items-center gap-2">
            <h1
              class="text-lg font-bold text-text-primary tracking-tight uppercase italic leading-none"
            >
              {plan.name}
            </h1>
            <div class="flex items-center gap-1.5 shrink-0">
              <span
                class="px-1.5 py-0.5 bg-accent text-accent-contrast text-[8px] font-bold uppercase tracking-wider rounded"
                >{plan.type}</span
              >
              {#if plan.billingType === "one_time"}
                <span
                  class="px-1.5 py-0.5 bg-bg-secondary text-text-dim border border-border text-[8px] font-bold rounded uppercase tracking-wider"
                  >One-off</span
                >
              {/if}
            </div>
          </div>
          <p
            class="text-[10px] text-text-dim mt-1 font-medium truncate max-w-sm"
          >
            {plan.description || "No description provided."}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-6">
        <!-- Compact Info Grid -->
        <div class="hidden sm:flex items-center gap-4">
          <div class="flex flex-col text-right">
            <span
              class="text-[8px] font-bold text-text-dim uppercase tracking-widest"
              >Pricing</span
            >
            <span class="text-sm font-bold text-text-primary tracking-tight"
              >{formatMoney(plan.price, plan.currency)}</span
            >
          </div>
          <div class="w-px h-8 bg-border"></div>
          <div class="flex flex-col text-right">
            <span
              class="text-[8px] font-bold text-text-dim uppercase tracking-widest"
              >Billing</span
            >
            <span class="text-[10px] font-bold text-text-secondary uppercase"
              >{plan.interval}</span
            >
          </div>
        </div>
        <div class="flex items-center gap-3">
          <!-- Consolidated Actions -->

          <button
            class="btn btn-secondary gap-1.5"
            onclick={() => (showEditPlanModal = true)}
          >
            <PencilSimple size={12} weight="fill" /> Edit
          </button>
        </div>
      </div>
    </div>

    <!-- Metadata Strip -->
    <div class="flex flex-wrap items-center gap-x-8 gap-y-2 py-2 text-[10px]">
      <div class="flex items-center gap-2">
        <span class="text-text-dim font-bold uppercase tracking-widest"
          >Slug:</span
        >
        <code
          class="text-text-primary font-mono bg-bg-card px-1.5 py-0.5 border border-border rounded"
          >{plan.slug}</code
        >
        <button
          class="text-text-dim hover:text-text-primary"
          onclick={() => navigator.clipboard.writeText(plan.slug)}
          ><Copy size={10} /></button
        >
      </div>

      {#if plan.providerPlanId || plan.paystackPlanId}
        {@const planCode = plan.providerPlanId || plan.paystackPlanId}
        <div class="flex items-center gap-2">
          <span class="text-text-dim font-bold uppercase tracking-widest"
            >Provider:</span
          >
          <span class="text-text-primary font-mono">{planCode}</span>
        </div>
      {/if}

      <div class="flex items-center gap-2">
        <span class="text-text-dim font-bold uppercase tracking-widest"
          >Trial:</span
        >
        <span class="text-text-primary font-bold uppercase"
          >{plan.trialDays > 0
            ? `${plan.trialDays} ${(plan.metadata as any)?.trialUnit === "minutes" ? "minutes" : "days"}`
            : "None"}</span
        >
      </div>

      {#if plan.autoEnable}
        <div
          class="flex items-center gap-1.5 text-accent font-bold uppercase tracking-tighter"
        >
          <Lightning size={10} weight="fill" /> Auto-enabled
        </div>
      {/if}
    </div>
  {/if}

  {#if isLoading}
    <div class="space-y-10">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
        {#each Array(4) as _}
          <div class="bg-bg-card border border-border p-4 rounded-lg space-y-3">
            <Skeleton class="h-3 w-20" />
            <Skeleton class="h-5 w-32" />
          </div>
        {/each}
      </div>

      <div class="grid lg:grid-cols-2 gap-8 lg:gap-12">
        {#each Array(2) as _}
          <div class="space-y-6">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <Skeleton class="w-8 h-8 rounded" />
                <Skeleton class="h-4 w-48" />
              </div>
              <Skeleton class="h-9 w-32" />
            </div>
            <div
              class="bg-bg-card border border-border divide-y divide-border/50 rounded"
            >
              {#each Array(3) as _}
                <div class="p-6 flex items-center justify-between">
                  <div class="flex items-center gap-5">
                    <Skeleton class="w-10 h-10 rounded" />
                    <div class="space-y-2">
                      <Skeleton class="h-4 w-32" />
                      <Skeleton class="h-3 w-48" />
                    </div>
                  </div>
                  <Skeleton class="h-8 w-8 rounded" />
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {:else if plan}
    <div class="flex flex-col gap-8">
      <!-- Features Section -->
      <section class="space-y-2">
        <div class="flex items-center justify-between px-1 pb-3">
          <h2
            class="text-xs font-bold text-text-dim uppercase tracking-widest items-center gap-2 flex"
          >
            <PackageIcon class="text-green-400" size={14} weight="bold" /> Features
          </h2>

          <button
            class="btn btn-primary gap-1 border-none bg-transparent hover:bg-bg-secondary"
            onclick={() => (showAttachModal = true)}
          >
            <PlusIcon size={10} weight="bold" /> Feature
          </button>
        </div>

        <div
          class="bg-bg-card border border-border divide-y divide-border/50 rounded overflow-hidden"
        >
          {#if plan.planFeatures && plan.planFeatures.length > 0}
            {#each plan.planFeatures as pf}
              {@const cs = creditSystems.find(
                (s: any) => s.id === pf.featureId,
              )}
              {#if cs}
                <div
                  class="group hover:bg-bg-card-hover/40 transition-colors border-l-2 border-warning/30"
                >
                  <div class="px-3 py-2 flex items-center justify-between">
                    <button
                      class="flex items-center gap-3 flex-1 text-left"
                      onclick={() => toggleCreditSystem(cs.id)}
                    >
                      <div
                        class="w-7 h-7 bg-warning-bg border border-warning/50 flex items-center justify-center rounded text-warning"
                      >
                        <span class="text-xs">&#9733;</span>
                      </div>
                      <div class="flex flex-col">
                        <div class="flex items-center gap-1.5">
                          <span
                            class="text-xs font-bold text-text-primary uppercase leading-tight"
                            >{cs.name}</span
                          >
                          <CaretDown
                            size={10}
                            class="text-text-dim transition-transform {expandedCreditSystems.includes(
                              cs.id,
                            )
                              ? 'rotate-180'
                              : ''}"
                          />
                        </div>
                        <span
                          class="text-[8px] font-bold text-warning uppercase tracking-tighter"
                        >
                          Credit Pool · {pf.limitValue === null
                            ? "Unlimited"
                            : pf.limitValue}
                        </span>
                      </div>
                    </button>
                    <div
                      class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <button
                        class="p-1.5 text-text-dim hover:text-text-primary"
                        onclick={() => {
                          editingPlanFeature = pf;
                          showConfigModal = true;
                        }}
                      >
                        <Sliders size={14} weight="duotone" />
                      </button>
                      <button
                        class="p-1.5 text-text-dim hover:text-red-500"
                        onclick={() => detachFeature(pf.id)}
                      >
                        <Trash size={14} weight="fill" />
                      </button>
                    </div>
                  </div>

                  {#if expandedCreditSystems.includes(cs.id)}
                    <div
                      class="px-3 pb-3 ml-10 flex flex-col gap-1.5 border-l border-border/50"
                      transition:slide
                    >
                      {#if cs.features && cs.features.length > 0}
                        {#each cs.features as csf}
                          <div
                            class="flex items-center justify-between group/item"
                          >
                            <div class="flex items-center gap-2">
                              <div
                                class="w-1 h-1 rounded-full bg-warning/50"
                              ></div>
                              <span
                                class="text-[10px] font-bold text-text-secondary uppercase"
                                >{csf.feature?.name || csf.featureId}</span
                              >
                            </div>
                            <span class="text-[9px] font-mono text-text-dim"
                              >{csf.cost} units</span
                            >
                          </div>
                        {/each}
                      {:else}
                        <span class="text-[8px] text-text-dim italic"
                          >No connected features</span
                        >
                      {/if}
                    </div>
                  {/if}
                </div>
              {:else}
                <div
                  class="px-3 py-2 flex items-center justify-between group hover:bg-bg-card-hover transition-colors"
                >
                  <div class="flex items-center gap-3">
                    <div
                      class="w-7 h-7 bg-bg-primary border border-border flex items-center justify-center rounded text-text-dim group-hover:text-accent transition-colors"
                    >
                      <Lightning size={14} weight="duotone" />
                    </div>
                    <div class="flex flex-col">
                      <span
                        class="text-xs font-bold text-text-primary uppercase leading-tight"
                        >{pf.feature.name}</span
                      >
                      <span
                        class="text-[8px] font-bold text-text-dim uppercase tracking-tighter"
                      >
                        {pf.feature.type}
                        {#if pf.feature.type === "metered"}· {pf.limitValue ===
                          null
                            ? "Unlimited"
                            : `Inc: ${pf.limitValue}`}{/if}
                      </span>
                    </div>
                  </div>
                  <div
                    class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    {#if pf.feature.type === "metered"}
                      <button
                        class="p-1.5 text-text-dim hover:text-text-primary"
                        onclick={() => {
                          editingPlanFeature = pf;
                          showConfigModal = true;
                        }}
                      >
                        <Sliders size={14} weight="duotone" />
                      </button>
                    {/if}
                    <button
                      class="p-1.5 text-text-dim hover:text-red-500"
                      onclick={() => detachFeature(pf.id)}
                    >
                      <Trash size={14} weight="fill" />
                    </button>
                  </div>
                </div>
              {/if}
            {/each}
          {:else}
            <div class="p-8 text-center bg-bg-card/50">
              <span
                class="text-[10px] font-bold text-text-dim uppercase tracking-widest"
                >No features attached.</span
              >
            </div>
          {/if}
        </div>
      </section>

      <!-- Subscribers Section -->
      <section class="space-y-2">
        <div class="flex items-center justify-between px-1 pb-3">
          <h2
            class="text-xs font-bold text-text-dim uppercase tracking-widest flex gap-2 items-center"
          >
            <UsersIcon class="text-purple-500" size={14} weight="bold" /> Subscribers
            {#if subscribers.length > 0}·
              {subscribers.length}{/if}
          </h2>

          <button
            class="btn btn-primary gap-1 border-none bg-transparent hover:bg-bg-secondary"
            onclick={() => (showAttachCustomerPanel = true)}
          >
            <UserPlusIcon size={10} weight="bold" /> Attach
          </button>
        </div>

        <div
          class="bg-bg-card border border-border divide-y divide-border/50 rounded overflow-hidden"
        >
          {#if isLoadingSubscribers}
            <div class="p-4 space-y-2">
              {#each Array(2) as _}
                <div class="flex items-center gap-2">
                  <Skeleton class="w-6 h-6 rounded-full" />
                  <Skeleton class="h-4 flex-1" />
                </div>
              {/each}
            </div>
          {:else if subscribers.length > 0}
            {#each subscribers as sub}
              <div
                class="p-3 flex items-center justify-between hover:bg-bg-card-hover transition-colors group"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <div
                    class="w-8 h-8 rounded-full border border-border bg-bg-primary overflow-hidden flex-shrink-0"
                  >
                    <Avatar name={sub.customer?.email || "?"} size={24} />
                  </div>
                  <div class="flex flex-col min-w-0">
                    <span class="text-sm font-bold text-text-primary truncate"
                      >{sub.customer?.name ||
                        sub.customer?.email ||
                        "Unknown"}</span
                    >
                    <span class="text-xs text-text-dim font-mono truncate"
                      >{sub.customer?.email || sub.customerId}</span
                    >
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  {#if sub.status === "pending"}
                    <button
                      class="text-[9px] font-bold text-warning hover:underline uppercase p-0"
                      onclick={() => generateCheckoutLink(sub.id)}>Link</button
                    >
                    <button
                      class="text-[9px] font-bold text-text-secondary hover:text-white uppercase p-0"
                      onclick={() => activateSubscription(sub.id)}>Act</button
                    >
                  {:else}
                    <span
                      class="text-[8px] font-bold uppercase py-0.5 px-1 rounded border {sub.status ===
                      'active'
                        ? 'border-success/20 text-success'
                        : 'border-border text-text-dim'}"
                    >
                      {sub.status}
                    </span>
                  {/if}
                </div>
              </div>
            {/each}
          {:else}
            <div class="p-8 text-center bg-bg-card/50">
              <span
                class="text-[10px] font-bold text-text-dim uppercase tracking-widest"
                >No subscribers.</span
              >
            </div>
          {/if}
        </div>
      </section>
    </div>
  {/if}
</div>

<!-- Attach Feature Side Panel -->
<SidePanel
  open={showAttachModal}
  title="Select Feature"
  onclose={() => (showAttachModal = false)}
  width="max-w-[400px]"
>
  <div class="text-sm">
    <div class="p-6 space-y-6">
      <div class="space-y-4">
        <label
          for="featureSearch"
          class="text-[10px] font-bold text-text-dim uppercase tracking-widest"
          >Available Features</label
        >
        <div class="input-icon-wrapper">
          <MagnifyingGlass size={14} class="input-icon-left" weight="fill" />
          <input
            id="featureSearch"
            type="text"
            placeholder="SEARCH FEATURES..."
            bind:value={featureSearchQuery}
            class="input input-has-icon-left font-bold placeholder:text-text-dim text-xs"
          />
        </div>

        <div class="space-y-2 mt-2">
          {#each features.filter((f) => !plan.planFeatures.some((pf: any) => pf.featureId === f.id) && (f.name
                .toLowerCase()
                .includes(featureSearchQuery.toLowerCase()) || f.slug
                  .toLowerCase()
                  .includes(featureSearchQuery.toLowerCase()))) as feature}
            <button
              class="w-full p-4 flex items-center gap-4 bg-bg-card border border-border hover:border-border-light transition-all text-left group"
              onclick={() => handleAttachFeature(feature.id)}
              disabled={isSaving}
            >
              <div
                class="w-10 h-10 bg-bg-primary border border-border flex items-center justify-center group-hover:border-secondary transition-colors"
              >
                <Lightning
                  size={16}
                  class="text-text-dim group-hover:text-secondary transition-colors"
                  weight="duotone"
                />
              </div>
              <div>
                <div
                  class="text-xs font-bold text-text-primary uppercase tracking-tight group-hover:text-secondary transition-colors"
                >
                  {feature.name}
                </div>
                <div
                  class="text-[9px] text-text-dim font-bold uppercase tracking-widest mt-0.5"
                >
                  {feature.type} • {feature.slug}
                </div>
              </div>
            </button>
          {/each}

          <button
            class="w-full p-4 flex items-center gap-4 bg-bg-primary border border-border border-dashed text-text-dim hover:text-text-primary dark:hover:text-white transition-all text-left group mt-2"
            onclick={() => (showCreateFeatureModal = true)}
          >
            <div
              class="w-10 h-10 bg-bg-card border border-border flex items-center justify-center"
            >
              <Plus size={16} weight="fill" />
            </div>
            <span class="text-xs font-bold uppercase tracking-widest"
              >Create new feature</span
            >
          </button>
        </div>
      </div>
    </div>
  </div>
</SidePanel>

<!-- Configure Feature Side Panel -->
<SidePanel
  open={showConfigModal && !!editingPlanFeature}
  title={`Configure ${editingPlanFeature?.feature?.name}`}
  onclose={() => (showConfigModal = false)}
  width="max-w-[450px]"
>
  <div class="text-sm h-full">
    <form
      class="flex flex-col justify-between h-full"
      onsubmit={(e) => {
        e.preventDefault();
        const data = {
          usageModel: configUsageModel,
          limitValue:
            String(configLimitValue).trim() === ""
              ? null
              : Number(configLimitValue),
          resetInterval: configResetInterval,
          pricePerUnit:
            String(configPricePerUnit).trim() === ""
              ? null
              : Math.round(Number(configPricePerUnit) * 100),
          billingUnits: Number(configBillingUnits) || 1,
          overage: configOverage,
          maxOverageUnits:
            String(configMaxOverageUnits).trim() === ""
              ? null
              : Number(configMaxOverageUnits),
          rolloverEnabled: configRolloverEnabled,
          rolloverMaxBalance:
            String(configRolloverMaxBalance).trim() === ""
              ? null
              : Number(configRolloverMaxBalance),
        };
        handleUpdateFeatureConfig(data);
      }}
    >
      <div class="p-6 space-y-8">
        <!-- Feature Type -->
        <div class="space-y-4">
          <label
            class="text-[10px] font-bold text-text-dim uppercase tracking-widest"
            >Feature Type</label
          >
          <div class="space-y-3">
            <button
              type="button"
              class="relative w-full p-4 text-left flex gap-4 rounded transition-all {configUsageModel ===
              'included'
                ? 'bg-accent-light border border-accent'
                : 'bg-bg-card border border-border hover:border-border-light'}"
              onclick={() => (configUsageModel = "included")}
            >
              <div
                class="w-10 h-10 bg-bg-primary border border-border flex items-center justify-center flex-shrink-0 rounded"
              >
                <Calendar
                  size={18}
                  class={configUsageModel === "included"
                    ? "text-accent"
                    : "text-text-dim"}
                  weight="duotone"
                />
              </div>
              <div>
                <div
                  class="text-xs font-bold text-text-primary uppercase tracking-tight mb-0.5"
                >
                  Included
                </div>
                <p
                  class="text-[10px] font-bold text-text-dim uppercase tracking-widest leading-relaxed"
                >
                  Included usage limit.
                </p>
              </div>
              {#if configUsageModel === "included"}
                <div
                  class="absolute top-4 right-4 w-4 h-4 border-2 border-accent flex items-center justify-center rounded"
                >
                  <div class="w-2 h-2 bg-accent rounded"></div>
                </div>
              {/if}
            </button>

            <button
              type="button"
              class="relative w-full p-4 text-left flex gap-4 rounded transition-all {configUsageModel ===
              'usage_based'
                ? 'bg-accent-light border border-accent'
                : 'bg-bg-card border border-border hover:border-border-light'}"
              onclick={() => (configUsageModel = "usage_based")}
            >
              <div
                class="w-10 h-10 bg-bg-primary border border-border flex items-center justify-center flex-shrink-0 rounded"
              >
                <Sliders
                  size={18}
                  class={configUsageModel === "usage_based"
                    ? "text-accent"
                    : "text-text-dim"}
                  weight="duotone"
                />
              </div>
              <div>
                <div
                  class="text-xs font-bold text-text-primary uppercase tracking-tight mb-0.5"
                >
                  Priced
                </div>
                <p
                  class="text-[10px] font-bold text-text-dim uppercase tracking-widest leading-relaxed"
                >
                  Charge for usage.
                </p>
              </div>
              {#if configUsageModel === "usage_based"}
                <div
                  class="absolute top-4 right-4 w-4 h-4 border-2 border-accent flex items-center justify-center rounded"
                >
                  <div class="w-2 h-2 bg-accent rounded"></div>
                </div>
              {/if}
            </button>
          </div>
        </div>

        <!-- Pricing Config (shown when Priced is selected) -->
        {#if configUsageModel === "usage_based"}
          <div
            class="space-y-4 p-4 bg-warning-bg border border-warning rounded"
          >
            <div
              class="text-[10px] font-bold text-warning uppercase tracking-widest"
            >
              Pricing Configuration
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-2">
                <label
                  for="pricePerUnit"
                  class="text-[10px] font-bold text-text-dim uppercase tracking-widest"
                  >Price per Unit</label
                >
                <div class="input-icon-wrapper">
                  <input
                    id="pricePerUnit"
                    type="number"
                    step="0.01"
                    placeholder="5.00"
                    class="input font-bold !pl-7"
                    bind:value={configPricePerUnit}
                  />
                  <div
                    class="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-text-dim uppercase pointer-events-none"
                  >
                    {COMMON_CURRENCIES.find(
                      (c) => c.code === (plan?.currency || $defaultCurrency),
                    )?.symbol ||
                      plan?.currency ||
                      "₦"}
                  </div>
                </div>
              </div>

              <div class="space-y-2">
                <label
                  for="billingUnits"
                  class="text-[10px] font-bold text-text-dim uppercase tracking-widest"
                  >Per X Units</label
                >
                <input
                  id="billingUnits"
                  type="number"
                  placeholder="1000"
                  class="input font-bold"
                  bind:value={configBillingUnits}
                />
              </div>
            </div>

            <p
              class="text-[9px] text-text-dim font-bold uppercase tracking-tight"
            >
              {#if configPricePerUnit && configBillingUnits}
                Charging {COMMON_CURRENCIES.find(
                  (c) => c.code === (plan?.currency || $defaultCurrency),
                )?.symbol ||
                  plan?.currency ||
                  "₦"}{configPricePerUnit} per {configBillingUnits}
                {editingPlanFeature.feature.unit || "units"}
              {:else}
                Set price and units to configure billing
              {/if}
            </p>
          </div>
        {/if}

        <!-- Grant Amount (Included limit for both models) -->
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <label
              for="limitValueConfig"
              class="text-[10px] font-bold text-text-dim uppercase tracking-widest"
            >
              {configUsageModel === "usage_based"
                ? "Included Free"
                : "Grant Amount"}
            </label>
            <button
              type="button"
              class="text-[10px] font-bold text-text-dim hover:text-text-primary flex items-center gap-1.5 transition-colors uppercase tracking-widest"
              onclick={() => (configLimitValue = "")}
            >
              {configUsageModel === "usage_based" ? "0 Free" : "∞ Unlimited"}
            </button>
          </div>

          <div class="input-icon-wrapper">
            <input
              id="limitValueConfig"
              name="limitValue"
              type="number"
              placeholder={configUsageModel === "usage_based" ? "0" : "EG. 100"}
              class="input font-bold"
              bind:value={configLimitValue}
            />
            <div
              class="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-bold text-text-dim uppercase tracking-widest"
            >
              {editingPlanFeature.feature.unit || "units"}
            </div>
          </div>

          {#if configUsageModel === "usage_based" && configLimitValue}
            <p class="text-[9px] text-text-dim">
              First {configLimitValue}
              {editingPlanFeature.feature.unit || "units"} are free, then billing
              starts.
            </p>
          {/if}
        </div>

        <!-- Overage Behavior (shown when Included is selected) -->
        {#if configUsageModel === "included"}
          <div class="space-y-4">
            <div
              class="text-[10px] font-bold text-text-dim uppercase tracking-widest"
            >
              When Limit Exceeded
            </div>
            <div class="grid grid-cols-2 gap-2">
              {#each [{ value: "block", label: "Block" }, { value: "charge", label: "Charge" }] as opt}
                <button
                  type="button"
                  class="py-2.5 text-[10px] font-bold uppercase tracking-widest border rounded transition-all {configOverage ===
                  opt.value
                    ? 'bg-accent text-accent-contrast border-accent'
                    : 'bg-bg-card text-text-dim border-border hover:border-border-light hover:text-text-primary'}"
                  onclick={() =>
                    (configOverage = opt.value as typeof configOverage)}
                >
                  {opt.label}
                </button>
              {/each}
            </div>

            {#if configOverage === "charge"}
              <div
                class="grid grid-cols-2 gap-4 p-4 bg-warning-bg border border-warning rounded"
              >
                <div class="space-y-2">
                  <label
                    for="overagePricePerUnit"
                    class="text-[10px] font-bold text-text-dim uppercase tracking-widest"
                    >Overage Price</label
                  >
                  <div class="input-icon-wrapper">
                    <input
                      id="overagePricePerUnit"
                      type="number"
                      step="0.01"
                      placeholder="5.00"
                      class="input font-bold !pl-7"
                      bind:value={configPricePerUnit}
                    />
                    <div
                      class="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-text-dim uppercase pointer-events-none"
                    >
                      {COMMON_CURRENCIES.find(
                        (c) => c.code === (plan?.currency || $defaultCurrency),
                      )?.symbol ||
                        plan?.currency ||
                        "₦"}
                    </div>
                  </div>
                </div>

                <div class="space-y-2">
                  <label
                    for="overageBillingUnits"
                    class="text-[10px] font-bold text-text-dim uppercase tracking-widest"
                    >Per X Units</label
                  >
                  <input
                    id="overageBillingUnits"
                    type="number"
                    placeholder="1000"
                    class="input font-bold"
                    bind:value={configBillingUnits}
                  />
                </div>
                <div class="space-y-2 col-span-2">
                  <label
                    for="maxOverageUnits"
                    class="text-[10px] font-bold text-text-dim uppercase tracking-widest"
                    >Max Overage Units</label
                  >
                  <input
                    id="maxOverageUnits"
                    type="number"
                    placeholder="Leave empty for unlimited"
                    class="input font-bold"
                    bind:value={configMaxOverageUnits}
                  />
                  <p class="text-[9px] text-text-dim/60 font-bold uppercase">
                    Hard cap on how many overage units a customer can use per
                    period. Empty = no cap.
                  </p>
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Interval -->
        <div class="space-y-4">
          <div
            class="text-[10px] font-bold text-text-dim uppercase tracking-widest"
          >
            Interval
          </div>
          <div class="grid grid-cols-4 gap-2">
            {#each [{ value: "5min", label: "5 Min" }, { value: "15min", label: "15 Min" }, { value: "30min", label: "30 Min" }, { value: "hourly", label: "Hourly" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "quarter", label: "Quarterly" }, { value: "yearly", label: "Yearly" }, { value: "none", label: "One-off" }] as int}
              <button
                type="button"
                class="py-2.5 text-[10px] font-bold uppercase tracking-widest border rounded transition-all {configResetInterval ===
                int.value
                  ? 'bg-accent text-accent-contrast border-accent'
                  : 'bg-bg-card text-text-dim border-border hover:border-border-light hover:text-text-primary'}"
                onclick={() => (configResetInterval = int.value)}
              >
                {int.label}
              </button>
            {/each}
          </div>
        </div>

        <!-- Rollover -->
        {#if configResetInterval !== "none"}
          <div class="space-y-4">
            <div class="flex items-center gap-3">
              <input
                id="configRolloverEnabled"
                type="checkbox"
                bind:checked={configRolloverEnabled}
                class="w-4 h-4 border border-border rounded bg-bg-primary text-accent focus:ring-accent"
              />
              <label
                for="configRolloverEnabled"
                class="text-[10px] font-bold text-text-primary uppercase tracking-widest cursor-pointer"
              >
                Rollover unused balance
              </label>
            </div>
            <p
              class="text-[9px] font-bold text-text-dim uppercase tracking-widest leading-relaxed"
            >
              Carry unused quota to the next period.
            </p>

            {#if configRolloverEnabled}
              <div class="p-4 bg-bg-card border border-border rounded space-y-2">
                <label
                  for="rolloverMaxBalance"
                  class="text-[10px] font-bold text-text-dim uppercase tracking-widest"
                >
                  Max Rollover Balance
                </label>
                <input
                  id="rolloverMaxBalance"
                  type="number"
                  placeholder="Leave empty for no cap"
                  class="input font-bold"
                  bind:value={configRolloverMaxBalance}
                />
                <p class="text-[9px] text-text-dim/60 font-bold uppercase">
                  Cap on how much unused balance can accumulate. Empty = no cap.
                </p>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div class="p-6 border-t border-border bg-bg-card sticky bottom-0">
        <button
          type="submit"
          class="btn btn-primary w-full py-2.5 uppercase tracking-widest font-bold"
          disabled={isSaving}
        >
          {#if isSaving}
            <CircleNotch size={16} class="animate-spin" weight="duotone" />
            Saving...
          {:else}
            <FloppyDiskIcon /> Configuration
          {/if}
        </button>
      </div>
    </form>
  </div>
</SidePanel>

<!-- Edit Plan Side Panel -->
<SidePanel
  open={showEditPlanModal && !!plan}
  title="Edit Plan"
  onclose={() => (showEditPlanModal = false)}
  width="max-w-[450px]"
>
  <div class="text-sm h-full">
    <form
      onsubmit={(e) => {
        e.preventDefault();
        savePlanEdits();
      }}
      class="flex flex-col h-full"
    >
      <div class="p-6 space-y-5 flex-1">
        <div>
          <label
            for="editName"
            class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2"
            >Name</label
          >
          <div class="input-icon-wrapper">
            <input
              id="editName"
              class="input font-bold"
              type="text"
              bind:value={editName}
            />
          </div>
        </div>

        <div>
          <label
            for="editDescription"
            class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2"
            >Description</label
          >
          <div class="input-icon-wrapper">
            <textarea
              id="editDescription"
              class="input font-bold min-h-22.5"
              bind:value={editDescription}
            ></textarea>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label
              for="editType"
              class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2"
              >Type</label
            >
            <div class="input-icon-wrapper">
              <select
                id="editType"
                class="input font-bold"
                bind:value={editType}
              >
                <option value="paid">Paid</option>
                <option value="free">Free</option>
              </select>
            </div>
          </div>

          <div>
            <label
              for="editBillingType"
              class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2"
              >Billing</label
            >
            <div class="input-icon-wrapper">
              <select
                id="editBillingType"
                class="input font-bold"
                bind:value={editBillingType}
              >
                <option value="recurring">Recurring</option>
                <option value="one_time">One-off</option>
              </select>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-4">
          <div>
            <label
              for="editPrice"
              class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2"
              >Price</label
            >
            <div class="input-icon-wrapper">
              <input
                id="editPrice"
                class="input font-bold"
                type="number"
                step="0.01"
                min="0"
                bind:value={editPrice}
                disabled={editType === "free"}
              />
            </div>
          </div>

          <div>
            <label
              for="editCurrency"
              class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2"
              >Currency</label
            >
            <select
              id="editCurrency"
              class="input font-bold"
              bind:value={editCurrency}
              disabled={editType === "free"}
            >
              {#each COMMON_CURRENCIES as c}
                <option value={c.code}>{c.code}</option>
              {/each}
            </select>
          </div>

          <div>
            <label
              for="editInterval"
              class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2"
              >Interval</label
            >
            <div class="input-icon-wrapper">
              <select
                id="editInterval"
                class="input font-bold"
                bind:value={editInterval}
                disabled={editBillingType === "one_time"}
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="quarterly">Quarterly</option>
                <option value="weekly">Weekly</option>
                <option value="annually">Annually</option>
              </select>
            </div>
          </div>
        </div>

        <div>
          <label
            for="editTrialDays"
            class="text-[10px] font-bold text-text-dim uppercase tracking-widest block mb-2"
            >Trial Duration</label
          >
          <div class="flex gap-2">
            <div class="input-icon-wrapper w-full">
              <input
                id="editTrialDays"
                class="input font-bold"
                type="number"
                min="0"
                bind:value={editTrialDays}
              />
            </div>
            <select class="input font-bold" bind:value={editTrialUnit}>
              <option value="minutes">minutes</option>
              <option value="days">days</option>
            </select>
          </div>
        </div>

        <div class="space-y-3">
          <div class="flex items-center gap-3">
            <input
              id="editAutoEnable"
              type="checkbox"
              bind:checked={editAutoEnable}
              class="w-4 h-4 border border-border rounded bg-bg-primary text-accent focus:ring-accent"
            />
            <label
              for="editAutoEnable"
              class="text-[10px] font-bold text-text-primary uppercase tracking-widest cursor-pointer"
            >
              Auto-enable plan
            </label>
          </div>
          <p
            class="text-[9px] font-bold text-text-dim uppercase tracking-widest leading-relaxed"
          >
            This plan will be enabled automatically for new customers.
            {plan?.type === "free"
              ? "Subscription will be active immediately."
              : "Subscription will be pending until payment."}
          </p>
        </div>
      </div>

      <div
        class="p-6 border-t border-border bg-bg-card flex justify-end gap-3 sticky bottom-0 mt-auto"
      >
        <button
          type="button"
          class="px-4 py-2 text-xs font-bold text-text-dim hover:text-text-primary dark:hover:text-white transition-colors uppercase tracking-widest"
          onclick={() => (showEditPlanModal = false)}>Cancel</button
        >
        <button
          type="submit"
          class="btn btn-primary px-8"
          disabled={isSaving || !editName.trim()}
        >
          {#if isSaving}
            <CircleNotch
              size={16}
              class="animate-spin text-accent-contrast"
              weight="duotone"
            />
            Saving...
          {:else}
            <FloppyDisk size={16} weight="fill" /> Save Changes
          {/if}
        </button>
      </div>
    </form>
  </div>
</SidePanel>

<CreateFeatureModal
  bind:isOpen={showCreateFeatureModal}
  organizationId={projectId}
  onclose={() => (showCreateFeatureModal = false)}
  onsuccess={onFeatureCreated}
/>

<!-- Attach Customer Panel -->
<SidePanel
  open={showAttachCustomerPanel}
  title="Attach Customer to Plan"
  onclose={() => {
    showAttachCustomerPanel = false;
    attachCustomerSearch = "";
    attachCustomerResults = [];
  }}
  width="max-w-md"
>
  <div class="text-sm flex flex-col h-full">
    <div class="p-5 space-y-4">
      <p
        class="text-[10px] text-text-dim uppercase tracking-widest font-bold leading-relaxed"
      >
        Search for an existing customer to subscribe to <strong
          class="text-text-primary">{plan?.name || "this plan"}</strong
        >.
        {#if plan?.type !== "free"}
          Their subscription will start as <strong class="text-warning"
            >pending</strong
          > until they complete payment.
        {:else}
          Their subscription will be <strong class="text-success">active</strong
          > immediately.
        {/if}
      </p>

      <div class="input-icon-wrapper">
        <MagnifyingGlass size={14} class="input-icon-left text-text-dim" />
        <input
          type="text"
          placeholder="Search by email, name or ID..."
          bind:value={attachCustomerSearch}
          oninput={onAttachSearchInput}
          class="input input-has-icon-left"
          autofocus
        />
      </div>
    </div>

    <div
      class="flex-1 overflow-y-auto divide-y divide-border/50 border-t border-border"
    >
      {#if isSearchingCustomers}
        <div class="p-5 space-y-3">
          {#each Array(3) as _}
            <div class="flex items-center gap-3">
              <Skeleton class="w-8 h-8 rounded-full" />
              <div class="space-y-1.5 flex-1">
                <Skeleton class="h-4 w-32" />
                <Skeleton class="h-3 w-48" />
              </div>
            </div>
          {/each}
        </div>
      {:else if attachCustomerResults.length > 0}
        {#each attachCustomerResults as customer}
          {@const alreadyAttached = subscribers.some(
            (s) => s.customerId === customer.id,
          )}
          <button
            class="w-full flex items-center gap-3 px-5 py-3 hover:bg-bg-card-hover transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={alreadyAttached || attachingCustomerId === customer.id}
            onclick={() => attachCustomerToPlan(customer.id)}
          >
            <div
              class="w-8 h-8 rounded-full overflow-hidden shrink-0 border border-border"
            >
              <Avatar name={customer.email} size={32} />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-bold text-text-primary truncate">
                {customer.name || customer.email}
              </div>
              <div class="text-[10px] text-text-dim font-mono truncate">
                {customer.email}
              </div>
            </div>
            {#if alreadyAttached}
              <span
                class="text-[9px] font-bold text-text-dim uppercase tracking-widest"
                >Already subscribed</span
              >
            {:else if attachingCustomerId === customer.id}
              <CircleNotch size={14} class="animate-spin text-accent" />
            {/if}
          </button>
        {/each}
      {:else if attachCustomerSearch.trim()}
        <div class="p-8 flex flex-col items-center justify-center text-center">
          <Users size={20} class="text-text-dim mb-2" weight="duotone" />
          <p class="text-[10px] text-text-dim uppercase tracking-widest mb-3">
            No customers found
          </p>
          <button
            class="btn btn-primary text-xs"
            onclick={() => {
              showAttachCustomerPanel = false;
              showCreateCustomerModal = true;
            }}
          >
            <Plus size={12} weight="fill" />
            Create New Customer
          </button>
        </div>
      {:else}
        <div class="p-8 flex flex-col items-center justify-center text-center">
          <MagnifyingGlass
            size={20}
            class="text-text-dim mb-2"
            weight="duotone"
          />
          <p class="text-[10px] text-text-dim uppercase tracking-widest">
            Type to search for customers
          </p>
        </div>
      {/if}
    </div>

    <div class="p-4 border-t border-border bg-bg-card">
      <button
        class="btn btn-secondary w-full text-xs gap-2"
        onclick={() => {
          showAttachCustomerPanel = false;
          showCreateCustomerModal = true;
        }}
      >
        <Plus size={12} weight="fill" />
        Create New Customer Instead
      </button>
    </div>
  </div>
</SidePanel>

<CreateCustomerModal
  bind:isOpen={showCreateCustomerModal}
  organizationId={projectId}
  onsuccess={(customer) => {
    // After creating the customer, attach them to the plan
    attachCustomerToPlan(customer.id);
  }}
/>

<style lang="postcss">
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background-color: #333;
  }
</style>
