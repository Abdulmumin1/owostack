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
    Check,
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

  type RatingModel = "package" | "graduated" | "volume";
  type TierFormRow = {
    id: string;
    upTo: string;
    unitPrice: string;
    flatFee: string;
  };
  type ParsedPricingTier = {
    upTo: number | null;
    unitPrice?: number;
    flatFee?: number;
  };

  let configLimitValue = $state<string>("");
  let configResetInterval = $state<string>("monthly");
  let configUsageModel = $state<"included" | "usage_based">("included");
  let configRatingModel = $state<RatingModel>("package");
  let configPricePerUnit = $state<string>("");
  let configBillingUnits = $state<string>("1");
  let configTiers = $state<TierFormRow[]>([]);
  let configOverage = $state<"block" | "charge">("block");
  let configMaxOverageUnits = $state<string>("");
  let configRolloverEnabled = $state<boolean>(false);
  let configRolloverMaxBalance = $state<string>("");

  let featureSearchQuery = $state<string>("");

  function createTierRow(
    tier?: Partial<{ upTo: number | null; unitPrice?: number; flatFee?: number }>,
  ): TierFormRow {
    return {
      id: Math.random().toString(36).slice(2, 10),
      upTo:
        tier?.upTo === null || tier?.upTo === undefined ? "" : String(tier.upTo),
      unitPrice:
        tier?.unitPrice === undefined ? "" : String(tier.unitPrice / 100),
      flatFee:
        tier?.flatFee === undefined ? "" : String(tier.flatFee / 100),
    };
  }

  function addPricingTier() {
    configTiers = [...configTiers, createTierRow()];
  }

  function removePricingTier(id: string) {
    configTiers = configTiers.filter((tier) => tier.id !== id);
  }

  function parsePricingTiers():
    | { ok: true; tiers: ParsedPricingTier[] }
    | { ok: false; error: string } {
    const parsed: ParsedPricingTier[] = [];
    let previousUpTo = 0;

    for (let index = 0; index < configTiers.length; index += 1) {
      const tier = configTiers[index];
      const upToText = String(tier.upTo).trim();
      const unitPriceText = String(tier.unitPrice).trim();
      const flatFeeText = String(tier.flatFee).trim();

      if (unitPriceText === "" && flatFeeText === "") {
        return {
          ok: false,
          error: `Tier ${index + 1} must define a unit price, flat price, or both.`,
        };
      }

      let upTo: number | null = null;
      if (upToText === "") {
        if (index !== configTiers.length - 1) {
          return {
            ok: false,
            error: `Only the last tier can be open-ended.`,
          };
        }
      } else {
        const parsedUpTo = Number(upToText);
        if (!Number.isFinite(parsedUpTo) || parsedUpTo <= previousUpTo) {
          return {
            ok: false,
            error: `Tier ${index + 1} must end above tier ${index}.`,
          };
        }
        upTo = parsedUpTo;
        previousUpTo = parsedUpTo;
      }

      let unitPrice: number | undefined;
      if (unitPriceText !== "") {
        const parsedUnitPrice = Number(unitPriceText);
        if (!Number.isFinite(parsedUnitPrice) || parsedUnitPrice < 0) {
          return {
            ok: false,
            error: `Tier ${index + 1} has an invalid unit price.`,
          };
        }
        unitPrice = Math.round(parsedUnitPrice * 100);
      }

      let flatFee: number | undefined;
      if (flatFeeText !== "") {
        const parsedFlatFee = Number(flatFeeText);
        if (!Number.isFinite(parsedFlatFee) || parsedFlatFee < 0) {
          return {
            ok: false,
            error: `Tier ${index + 1} has an invalid flat price.`,
          };
        }
        flatFee = Math.round(parsedFlatFee * 100);
      }

      parsed.push({
        upTo,
        ...(unitPrice !== undefined ? { unitPrice } : {}),
        ...(flatFee !== undefined ? { flatFee } : {}),
      });
    }

    return { ok: true, tiers: parsed };
  }

  function usesTieredPricing() {
    return configRatingModel === "graduated" || configRatingModel === "volume";
  }

  function hasUsagePricingConfig() {
    return configUsageModel === "usage_based";
  }

  function hasOveragePricingConfig() {
    return configUsageModel === "included" && configOverage === "charge";
  }

  function requiresPricingConfig() {
    return hasUsagePricingConfig() || hasOveragePricingConfig();
  }

  function selectRatingModel(model: RatingModel) {
    configRatingModel = model;
    if (
      (configRatingModel === "graduated" || configRatingModel === "volume") &&
      configTiers.length === 0
    ) {
      configTiers = [createTierRow()];
    }
  }

  function getAttachableFeatures() {
    if (!plan?.planFeatures) return features;

    const query = featureSearchQuery.toLowerCase();
    return features.filter((feature: any) => {
      const alreadyAttached = plan.planFeatures.some(
        (planFeature: any) => planFeature.featureId === feature.id,
      );
      const matchesQuery =
        feature.name.toLowerCase().includes(query) ||
        feature.slug.toLowerCase().includes(query);

      return !alreadyAttached && matchesQuery;
    });
  }

  function describeFeaturePricing(pf: any) {
    const currencyCode = plan?.currency || $defaultCurrency;
    const ratingModel: RatingModel = pf.ratingModel || "package";
    const billingUnits = pf.billingUnits || 1;
    const unitPrice =
      pf.usageModel === "usage_based"
        ? pf.pricePerUnit
        : (pf.overagePrice ?? pf.pricePerUnit);

    if (pf.usageModel === "usage_based") {
      if (ratingModel === "package" && unitPrice != null) {
        return `Priced · ${formatMoney(unitPrice, currencyCode)} / ${billingUnits} ${pf.feature.unit || "units"}`;
      }
      return `Priced · ${ratingModel}`;
    }

    if (pf.overage === "charge") {
      if (ratingModel === "package" && unitPrice != null) {
        return `Inc: ${pf.limitValue ?? "Unlimited"} · Overage ${formatMoney(unitPrice, currencyCode)} / ${billingUnits} ${pf.feature.unit || "units"}`;
      }
      return `Inc: ${pf.limitValue ?? "Unlimited"} · ${ratingModel} overage`;
    }

    return pf.limitValue === null ? "Unlimited" : `Inc: ${pf.limitValue}`;
  }

  $effect(() => {
    if (showConfigModal && editingPlanFeature) {
      configLimitValue =
        editingPlanFeature.limitValue === null ||
        editingPlanFeature.limitValue === undefined
          ? ""
          : String(editingPlanFeature.limitValue);
      const rawInterval = editingPlanFeature.resetInterval || "monthly";
      const intervalAliases: Record<string, string> = {
        hour: "hourly",
        month: "monthly",
        week: "weekly",
        day: "daily",
        quarter: "quarterly",
        year: "yearly",
      };
      configResetInterval = intervalAliases[rawInterval] || rawInterval;
      configUsageModel = editingPlanFeature.usageModel || "included";
      configRatingModel = editingPlanFeature.ratingModel || "package";
      const storedPrice =
        editingPlanFeature.usageModel === "usage_based"
          ? editingPlanFeature.pricePerUnit
          : (editingPlanFeature.overagePrice ?? editingPlanFeature.pricePerUnit);
      configPricePerUnit = storedPrice
        ? String(storedPrice / 100)
        : "";
      configBillingUnits = String(editingPlanFeature.billingUnits || 1);
      const initialTiers =
        editingPlanFeature.tiers && editingPlanFeature.tiers.length > 0
          ? editingPlanFeature.tiers.map((tier: any) => createTierRow(tier))
          : [];

      if (
        (editingPlanFeature.ratingModel === "graduated" ||
          editingPlanFeature.ratingModel === "volume") &&
        initialTiers.length === 0
      ) {
        configTiers = [createTierRow()];
      } else {
        configTiers = initialTiers;
      }
      configOverage =
        editingPlanFeature.usageModel === "usage_based"
          ? "charge"
          : (editingPlanFeature.overage || "block");
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
    if (!projectId) {
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
      <div class="flex items-center gap-4">
        <a
          href="/{projectId}/plans"
          class="p-2 bg-bg-card border border-border hover:bg-bg-secondary text-text-dim hover:text-text-primary transition-all rounded-lg shrink-0"
          title="Back to Plans"
        >
          <CaretLeft size={20} weight="bold" />
        </a>
        <div class="flex flex-col">
          <div class="flex items-center gap-3">
            <h1 class="text-2xl font-display font-semibold text-text-primary">
              {plan.name}
            </h1>
            <div class="flex items-center gap-2 shrink-0">
              <span class="badge badge-warning uppercase">{plan.type}</span>
              {#if plan.billingType === "one_time"}
                <span class="badge badge-default uppercase">One-off</span>
              {/if}
            </div>
          </div>
          <p class="text-sm text-text-secondary mt-1 max-w-xl">
            {plan.description || "No description provided."}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-6">
        <!-- Compact Info Grid -->
        <div class="hidden sm:flex items-center gap-6">
          <div class="flex flex-col text-right">
            <span class="text-xs font-medium text-text-muted">Pricing</span>
            <span class="text-base font-semibold text-text-primary"
              >{formatMoney(plan.price, plan.currency)}</span
            >
          </div>
          <div class="w-px h-10 bg-border"></div>
          <div class="flex flex-col text-right">
            <span class="text-xs font-medium text-text-muted">Billing</span>
            <span class="text-base font-semibold text-text-primary capitalize"
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
            <PencilSimple size={16} weight="fill" /> Edit
          </button>
        </div>
      </div>
    </div>

    <!-- Metadata Strip -->
    <div class="flex flex-wrap items-center gap-x-8 gap-y-3 py-4 text-sm mb-4">
      <div class="flex items-center gap-2">
        <span class="text-text-muted font-medium">Slug:</span>
        <code
          class="text-text-primary font-mono bg-bg-secondary px-2 py-0.5 rounded text-xs border border-border"
          >{plan.slug}</code
        >
        <button
          class="text-text-muted hover:text-text-primary p-1"
          onclick={() => navigator.clipboard.writeText(plan.slug)}
          ><Copy size={14} /></button
        >
      </div>

      {#if plan.providerPlanId || plan.paystackPlanId}
        {@const planCode = plan.providerPlanId || plan.paystackPlanId}
        <div class="flex items-center gap-2">
          <span class="text-text-muted font-medium">Provider:</span>
          <span class="text-text-primary font-mono text-sm">{planCode}</span>
        </div>
      {/if}

      <div class="flex items-center gap-2">
        <span class="text-text-muted font-medium">Trial:</span>
        <span class="text-text-primary font-medium"
          >{plan.trialDays > 0
            ? `${plan.trialDays} ${(plan.metadata as any)?.trialUnit === "minutes" ? "minutes" : "days"}`
            : "None"}</span
        >
      </div>

      {#if plan.autoEnable}
        <div
          class="flex items-center gap-1.5 text-accent font-medium"
        >
          <Lightning size={14} weight="fill" /> Auto-enabled
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
      <section class="space-y-4">
        <div class="flex items-center justify-between px-1 pb-2">
          <h2
            class="text-sm font-semibold text-text-secondary flex items-center gap-2"
          >
            <PackageIcon class="text-secondary" size={18} weight="fill" /> Features
          </h2>

          <button
            class="btn btn-primary btn-sm gap-1.5"
            onclick={() => (showAttachModal = true)}
          >
            <PlusIcon size={14} weight="bold" /> Add Feature
          </button>
        </div>

        <div
          class="bg-bg-card border border-border divide-y divide-border/50 rounded-lg overflow-hidden"
        >
          {#if plan.planFeatures && plan.planFeatures.length > 0}
            {#each plan.planFeatures as pf}
              {@const cs = creditSystems.find(
                (s: any) => s.id === pf.featureId,
              )}
              {#if cs}
                <div
                  class="group hover:bg-bg-card-hover/40 transition-colors border-l-4 border-warning/50"
                >
                  <div class="px-4 py-3 flex items-center justify-between">
                    <button
                      class="flex items-center gap-4 flex-1 text-left"
                      onclick={() => toggleCreditSystem(cs.id)}
                    >
                      <div
                        class="w-8 h-8 bg-warning-bg border border-warning/30 flex items-center justify-center rounded-md text-warning shrink-0"
                      >
                        <span class="text-base leading-none">&#9733;</span>
                      </div>
                      <div class="flex flex-col">
                        <div class="flex items-center gap-2">
                          <span
                            class="text-sm font-semibold text-text-primary"
                            >{cs.name}</span
                          >
                          <CaretDown
                            size={14}
                            class="text-text-muted transition-transform {expandedCreditSystems.includes(
                              cs.id,
                            )
                              ? 'rotate-180'
                              : ''}"
                          />
                        </div>
                        <span
                          class="text-xs text-text-muted mt-0.5"
                        >
                          Credit Pool &middot; {pf.limitValue === null
                            ? "Unlimited"
                            : pf.limitValue}
                        </span>
                      </div>
                    </button>
                    <div
                      class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <button
                        class="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors"
                        onclick={() => {
                          editingPlanFeature = pf;
                          showConfigModal = true;
                        }}
                      >
                        <Sliders size={16} weight="duotone" />
                      </button>
                      <button
                        class="p-2 text-text-muted hover:text-red-500 hover:bg-error-bg rounded transition-colors"
                        onclick={() => detachFeature(pf.id)}
                      >
                        <Trash size={16} weight="fill" />
                      </button>
                    </div>
                  </div>

                  {#if expandedCreditSystems.includes(cs.id)}
                    <div
                      class="px-4 pb-4 pl-16 flex flex-col gap-2"
                      transition:slide
                    >
                      {#if cs.features && cs.features.length > 0}
                        {#each cs.features as csf}
                          <div
                            class="flex items-center justify-between py-1.5 border-b border-border-light last:border-0"
                          >
                            <div class="flex items-center gap-3">
                              <div
                                class="w-1.5 h-1.5 rounded-full bg-warning/60"
                              ></div>
                              <span
                                class="text-sm text-text-secondary"
                                >{csf.feature?.name || csf.featureId}</span
                              >
                            </div>
                            <span class="text-xs font-mono text-text-muted"
                              >{csf.cost} units</span
                            >
                          </div>
                        {/each}
                      {:else}
                        <span class="text-sm text-text-muted italic"
                          >No connected features</span
                        >
                      {/if}
                    </div>
                  {/if}
                </div>
              {:else}
                <div
                  class="px-4 py-3 flex items-center justify-between group hover:bg-bg-card-hover transition-colors"
                >
                  <div class="flex items-center gap-4">
                    <div
                      class="w-8 h-8 bg-bg-secondary border border-border flex items-center justify-center rounded-md text-text-muted group-hover:text-accent transition-colors shrink-0"
                    >
                      <Lightning size={16} weight="duotone" />
                    </div>
                    <div class="flex flex-col">
                      <span
                        class="text-sm font-semibold text-text-primary"
                        >{pf.feature.name}</span
                      >
                      <span
                        class="text-xs text-text-muted capitalize mt-0.5"
                      >
                        {pf.feature.type}
                        {#if pf.feature.type === "metered"}&middot; {describeFeaturePricing(
                            pf,
                          )}{/if}
                      </span>
                    </div>
                  </div>
                  <div
                    class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {#if pf.feature.type === "metered"}
                      <button
                        class="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors"
                        onclick={() => {
                          editingPlanFeature = pf;
                          showConfigModal = true;
                        }}
                      >
                        <Sliders size={16} weight="duotone" />
                      </button>
                    {/if}
                    <button
                      class="p-2 text-text-muted hover:text-red-500 hover:bg-error-bg rounded transition-colors"
                      onclick={() => detachFeature(pf.id)}
                    >
                      <Trash size={16} weight="fill" />
                    </button>
                  </div>
                </div>
              {/if}
            {/each}
          {:else}
            <div class="p-8 text-center">
              <span
                class="text-sm text-text-muted"
                >No features attached.</span
              >
            </div>
          {/if}
        </div>
      </section>

      <!-- Subscribers Section -->
      <section class="space-y-4">
        <div class="flex items-center justify-between px-1 pb-2">
          <h2
            class="text-sm font-semibold text-text-secondary flex items-center gap-2"
          >
            <UsersIcon class="text-tertiary" size={18} weight="duotone" /> Subscribers
            {#if subscribers.length > 0}<span class="text-text-muted font-normal">&middot;
              {subscribers.length}</span>{/if}
          </h2>

          <button
            class="btn btn-secondary btn-sm gap-1.5"
            onclick={() => (showAttachCustomerPanel = true)}
          >
            <PlusIcon size={14} weight="bold" /> Attach
          </button>
        </div>

        <div
          class="bg-bg-card border border-border divide-y divide-border/50 rounded-lg overflow-hidden"
        >
          {#if isLoadingSubscribers}
            <div class="p-4 space-y-3">
              {#each Array(2) as _}
                <div class="flex items-center gap-3">
                  <Skeleton class="w-8 h-8 rounded-full" />
                  <Skeleton class="h-4 flex-1" />
                </div>
              {/each}
            </div>
          {:else if subscribers.length > 0}
            {#each subscribers as sub}
              <div
                class="p-4 flex items-center justify-between hover:bg-bg-card-hover transition-colors group"
              >
                <div class="flex items-center gap-3 min-w-0">
                  <div
                    class="w-10 h-10 rounded-full border border-border bg-bg-primary overflow-hidden flex-shrink-0"
                  >
                    <Avatar name={sub.customer?.email || "?"} size={40} />
                  </div>
                  <div class="flex flex-col min-w-0">
                    <span class="text-sm font-semibold text-text-primary truncate"
                      >{sub.customer?.name ||
                        sub.customer?.email ||
                        "Unknown"}</span
                    >
                    <span class="text-xs text-text-muted font-mono truncate"
                      >{sub.customer?.email || sub.customerId}</span
                    >
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  {#if sub.status === "pending"}
                    <button
                      class="text-xs font-semibold text-warning hover:underline uppercase p-0"
                      onclick={() => generateCheckoutLink(sub.id)}>Link</button
                    >
                    <button
                      class="text-xs font-semibold text-text-secondary hover:text-text-primary uppercase p-0"
                      onclick={() => activateSubscription(sub.id)}>Act</button
                    >
                  {:else}
                    <span
                      class="badge {sub.status === 'active' ? 'badge-success' : 'badge-default'} uppercase"
                    >
                      {sub.status}
                    </span>
                  {/if}
                </div>
              </div>
            {/each}
          {:else}
            <div class="p-8 text-center">
              <span class="text-sm text-text-muted">No subscribers.</span>
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
          class="label"
        >
          Available Features
        </label>
        <div class="input-icon-wrapper">
          <MagnifyingGlass size={16} class="input-icon-left" weight="fill" />
          <input
            id="featureSearch"
            type="text"
            placeholder="Search features..."
            bind:value={featureSearchQuery}
            class="input input-has-icon-left placeholder:text-text-dim"
          />
        </div>

        <div class="space-y-2 mt-2">
          {#each getAttachableFeatures() as feature}
            <button
              class="w-full p-4 flex items-center gap-4 bg-bg-card border border-border hover:border-border-light rounded transition-all text-left group"
              onclick={() => handleAttachFeature(feature.id)}
              disabled={isSaving}
            >
              <div
                class="w-10 h-10 bg-bg-primary border border-border flex items-center justify-center rounded-md group-hover:border-accent transition-colors shrink-0"
              >
                <Lightning
                  size={18}
                  class="text-text-dim group-hover:text-accent transition-colors"
                  weight="duotone"
                />
              </div>
              <div class="flex-1 min-w-0">
                <div
                  class="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors truncate"
                >
                  {feature.name}
                </div>
                <div
                  class="text-xs text-text-muted mt-0.5 truncate capitalize"
                >
                  {feature.type} &middot; {feature.slug}
                </div>
              </div>
            </button>
          {/each}

          <button
            class="w-full p-4 flex items-center gap-4 bg-bg-primary border border-border border-dashed text-text-muted hover:text-text-primary transition-all rounded text-left group mt-2"
            onclick={() => (showCreateFeatureModal = true)}
          >
            <div
              class="w-10 h-10 bg-bg-card border border-border flex items-center justify-center rounded-md shrink-0 group-hover:bg-bg-secondary"
            >
              <Plus size={18} weight="fill" />
            </div>
            <span class="text-sm font-semibold">Create new feature</span>
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
        const normalizedPrice =
          String(configPricePerUnit).trim() === ""
            ? null
            : Math.round(Number(configPricePerUnit) * 100);
        const parsedBillingUnits = Number(configBillingUnits);
        const normalizedBillingUnits =
          Number.isFinite(parsedBillingUnits) && parsedBillingUnits > 0
            ? parsedBillingUnits
            : null;
        let tiers: ParsedPricingTier[] | null = null;

        if (requiresPricingConfig()) {
          if (usesTieredPricing()) {
            const parsedTiers = parsePricingTiers();
            if (!parsedTiers.ok) {
              alert(parsedTiers.error);
              return;
            }
            tiers = parsedTiers.tiers;

            if (tiers.length === 0) {
              alert("Add at least one pricing tier before saving.");
              return;
            }
          } else if (normalizedPrice === null) {
            alert("Set a price before saving this pricing configuration.");
            return;
          } else if (normalizedBillingUnits === null) {
            alert("Set a valid billing unit size before saving.");
            return;
          }
        }

        const data = {
          usageModel: configUsageModel,
          limitValue:
            configUsageModel === "usage_based" ||
            String(configLimitValue).trim() === ""
              ? null
              : Number(configLimitValue),
          resetInterval: configResetInterval,
          pricePerUnit:
            configUsageModel === "usage_based" && configRatingModel === "package"
              ? normalizedPrice
              : null,
          billingUnits: configRatingModel === "package" ? normalizedBillingUnits || 1 : 1,
          ratingModel: requiresPricingConfig() ? configRatingModel : "package",
          tiers: usesTieredPricing() ? tiers : null,
          overage: configOverage,
          overagePrice:
            configUsageModel === "included" &&
            configOverage === "charge" &&
            configRatingModel === "package"
              ? normalizedPrice
              : null,
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
        <div class="space-y-3">
          <div class="text-[11px] font-bold text-text-dim uppercase tracking-wider px-1">Feature Type</div>
          <div class="grid grid-cols-2 gap-3">
            <button
              type="button"
              class="relative group text-left flex gap-3 p-4 rounded-lg transition-all duration-200 {configUsageModel ===
              'included'
                ? 'bg-accent-light/20 border-accent'
                : 'bg-bg-card border-border hover:border-border-strong hover:bg-bg-card-hover'}"
              style="border-width: 1px;"
              onclick={() => (configUsageModel = "included")}
            >
              <div
                class="w-10 h-10 bg-bg-primary border border-border flex items-center justify-center flex-shrink-0 rounded-md transition-colors {configUsageModel === 'included' ? 'border-accent/30' : 'group-hover:border-border-strong'}"
              >
                <Calendar
                  size={20}
                  class={configUsageModel === "included"
                    ? "text-accent"
                    : "text-text-muted"}
                  weight={configUsageModel === "included" ? "fill" : "duotone"}
                />
              </div>
              <div class="min-w-0">
                <div class="text-sm font-bold text-text-primary mb-0.5">
                  Included
                </div>
                <p class="text-[11px] text-text-muted leading-tight font-medium">
                  Included usage limit.
                </p>
              </div>
              {#if configUsageModel === "included"}
                <div class="absolute top-2.5 right-2.5" transition:fade={{ duration: 150 }}>
                  <div class="w-4 h-4 rounded-full bg-accent flex items-center justify-center text-accent-contrast shadow-sm">
                    <Check size={10} weight="bold" />
                  </div>
                </div>
              {/if}
            </button>

            <button
              type="button"
              class="relative group text-left flex gap-3 p-4 rounded-lg transition-all duration-200 {configUsageModel ===
              'usage_based'
                ? 'bg-accent-light/20 border-accent'
                : 'bg-bg-card border-border hover:border-border-strong hover:bg-bg-card-hover'}"
              style="border-width: 1px;"
              onclick={() => {
                configUsageModel = "usage_based";
                configOverage = "charge";
              }}
            >
              <div
                class="w-10 h-10 bg-bg-primary border border-border flex items-center justify-center flex-shrink-0 rounded-md transition-colors {configUsageModel === 'usage_based' ? 'border-accent/30' : 'group-hover:border-border-strong'}"
              >
                <Sliders
                  size={20}
                  class={configUsageModel === "usage_based"
                    ? "text-accent"
                    : "text-text-muted"}
                  weight={configUsageModel === "usage_based" ? "fill" : "duotone"}
                />
              </div>
              <div class="min-w-0">
                <div class="text-sm font-bold text-text-primary mb-0.5">
                  Priced
                </div>
                <p class="text-[11px] text-text-muted leading-tight font-medium">
                  Charge for usage.
                </p>
              </div>
              {#if configUsageModel === "usage_based"}
                <div class="absolute top-2.5 right-2.5" transition:fade={{ duration: 150 }}>
                  <div class="w-4 h-4 rounded-full bg-accent flex items-center justify-center text-accent-contrast shadow-sm">
                    <Check size={10} weight="bold" />
                  </div>
                </div>
              {/if}
            </button>
          </div>
        </div>

        <!-- Usage Pricing -->
        {#if hasUsagePricingConfig()}
          <div
            class="space-y-4 p-5 bg-bg-secondary border border-border rounded-lg"
          >
            <div class="flex flex-col justify-between gap-4">
              <div>
                <div class="text-sm font-semibold text-text-primary">
                  Usage Pricing
                </div>
                <p class="mt-1 text-[11px] text-text-muted">
                  Billing starts from the first tracked unit.
                </p>
              </div>
              <div class="flex w-fit bg-bg-card border border-border p-1 rounded-md">
                {#each [
                  { value: "package", label: "Package" },
                  { value: "graduated", label: "Graduated" },
                  { value: "volume", label: "Volume" },
                ] as model}
                  <button
                    type="button"
                    class="px-4 py-1.5 text-xs font-bold transition-all rounded-sm {configRatingModel ===
                    model.value
                      ? 'bg-accent text-accent-contrast shadow-sm'
                      : 'text-text-muted hover:text-text-primary'}"
                    onclick={() => selectRatingModel(model.value as RatingModel)}
                  >
                    {model.label}
                  </button>
                {/each}
              </div>
            </div>

            {#if configRatingModel === "package"}
              <div class="grid grid-cols-2 gap-4 pt-1">
                <div class="space-y-1.5">
                  <label for="pricePerUnit" class="text-[10px] font-bold text-text-dim uppercase tracking-wider px-1">
                    {configUsageModel === "usage_based"
                      ? "Price per Unit"
                      : "Overage Price"}
                  </label>
                  <div class="input-icon-wrapper">
                    <input
                      id="pricePerUnit"
                      type="number"
                      step="0.01"
                      placeholder="5.00"
                      class="input h-9 !text-xs !pl-8"
                      bind:value={configPricePerUnit}
                    />
                    <div class="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-text-dim font-medium pointer-events-none">
                      {COMMON_CURRENCIES.find(
                        (c) => c.code === (plan?.currency || $defaultCurrency),
                      )?.symbol ||
                        plan?.currency ||
                        "₦"}
                    </div>
                  </div>
                </div>

                <div class="space-y-1.5">
                  <label for="billingUnits" class="text-[10px] font-bold text-text-dim uppercase tracking-wider px-1">Per X Units</label>
                  <input
                    id="billingUnits"
                    type="number"
                    placeholder="1000"
                    class="input h-9 !text-xs"
                    bind:value={configBillingUnits}
                  />
                </div>
              </div>

              <p class="text-[11px] text-text-muted">
                {#if configPricePerUnit && configBillingUnits}
                  Charging <strong>{COMMON_CURRENCIES.find(
                    (c) => c.code === (plan?.currency || $defaultCurrency),
                  )?.symbol ||
                    plan?.currency ||
                    "₦"}{configPricePerUnit}</strong> per
                  <strong>{configBillingUnits}
                    {editingPlanFeature.feature.unit || "units"}</strong>
                {:else}
                  Set price and units to configure billing.
                {/if}
              </p>
            {:else}
              <div class="space-y-4 pt-2">
                <div class="flex items-center justify-between">
                  <div class="text-sm font-semibold text-text-primary">
                    Pricing Tiers
                  </div>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm h-7 px-3 gap-1"
                    onclick={addPricingTier}
                  >
                    <Plus size={12} weight="bold" /> Add Tier
                  </button>
                </div>

                <div class="">
                  <!-- Header Labels -->
                  <div class="grid grid-cols-[1fr_1fr_1fr_18px] gap-3 px-1">
                    <div class="text-[10px] font-bold text-text-dim uppercase tracking-wider">Up To</div>
                    <div class="text-[10px] font-bold text-text-dim uppercase tracking-wider">Unit Price</div>
                    <div class="text-[10px] font-bold text-text-dim uppercase tracking-wider">Flat Price</div>
                  </div>

                  {#each configTiers as tier, index (tier.id)}
                    <div class="grid grid-cols-[1fr_1fr_1fr_18px] gap-1 items-center group">
                      <div class="relative">
                        <input
                          type="number"
                          placeholder={index === configTiers.length - 1 ? "Infinity" : "1000"}
                          class="input h-9 !text-xs"
                          bind:value={tier.upTo}
                        />
                      </div>
                      <div class="input-icon-wrapper">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0.50"
                          class="input h-9 !text-xs !pl-7"
                          bind:value={tier.unitPrice}
                        />
                        <div class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-text-dim font-medium pointer-events-none">
                          {COMMON_CURRENCIES.find(
                            (c) => c.code === (plan?.currency || $defaultCurrency),
                          )?.symbol || plan?.currency || "₦"}
                        </div>
                      </div>
                      <div class="input-icon-wrapper">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Optional"
                          class="input h-9 !text-xs !pl-7"
                          bind:value={tier.flatFee}
                        />
                        <div class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-text-dim font-medium pointer-events-none">
                          {COMMON_CURRENCIES.find(
                            (c) => c.code === (plan?.currency || $defaultCurrency),
                          )?.symbol || plan?.currency || "₦"}
                        </div>
                      </div>
                      <div class="flex justify-end">
                        {#if configTiers.length > 1}
                          <button
                            type="button"
                            class="p-1.5 text-text-dim hover:text-error hover:bg-error-bg/10 rounded-md transition-all opacity-0 group-hover:opacity-100"
                            onclick={() => removePricingTier(tier.id)}
                          >
                            <Trash size={14} weight="bold" />
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>

                <p class="text-[10px] text-text-muted px-1">
                  Each tier can charge by unit, by flat price, or both.
                </p>
                <p class="text-[10px] text-text-muted italic px-1">
                  * {configRatingModel === 'graduated'
                    ? 'Each tier prices only the billable units inside it. Flat price is added once when usage enters that tier.'
                    : 'All billable units use the reached tier. Flat price can be used on its own for fixed-price bands.'}
                </p>
              </div>
            {/if}
          </div>
        {/if}

        {#if configUsageModel === "included"}
          <!-- Grant Amount -->
          <div class="space-y-2.5">
            <div class="flex items-center justify-between px-1">
              <label for="limitValueConfig" class="text-[11px] font-bold text-text-dim uppercase tracking-wider">
                Grant Amount
              </label>
              <button
                type="button"
                class="text-[11px] font-bold text-accent hover:text-accent-hover transition-colors uppercase tracking-wider"
                onclick={() => (configLimitValue = "")}
              >
                Set Unlimited
              </button>
            </div>

            <div class="input-icon-wrapper">
              <input
                id="limitValueConfig"
                name="limitValue"
                type="number"
                placeholder="e.g. 100"
                class="input !h-10 !text-sm !pr-16"
                bind:value={configLimitValue}
              />
              <div class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-text-dim pointer-events-none capitalize">
                {editingPlanFeature.feature.unit || "units"}
              </div>
            </div>
          </div>
        {:else}
          <div class="rounded-lg border border-border bg-bg-card p-4 shadow-[2px_2px_0_0_var(--color-border-muted)]">
            <div class="text-sm font-semibold text-text-primary">
              Usage-based billing
            </div>
            <p class="mt-1 text-xs text-text-muted leading-relaxed">
              Billing starts from the first tracked unit. If you want included units
              before charging, switch to <strong>Included</strong> and set overage to
              <strong>Charge</strong>.
            </p>
          </div>
        {/if}

        <!-- Overage Behavior (shown when Included is selected) -->
        {#if configUsageModel === "included"}
          <div class="space-y-3 pt-2">
            <div class="text-[11px] font-bold text-text-dim uppercase tracking-wider px-1">When Limit Exceeded</div>
            <div class="flex bg-bg-card border border-border p-1 rounded-md">
              {#each [{ value: "block", label: "Block" }, { value: "charge", label: "Charge" }] as opt}
                <button
                  type="button"
                  class="flex-1 py-1.5 text-xs font-bold transition-all rounded-sm {configOverage ===
                  opt.value
                    ? 'bg-accent text-accent-contrast'
                    : 'text-text-muted hover:text-text-primary'}"
                  onclick={() =>
                    (configOverage = opt.value as typeof configOverage)}
                >
                  {opt.label}
                </button>
              {/each}
            </div>

            {#if configOverage === "charge"}
              <div class="space-y-5 p-5 bg-bg-elevated border border-border rounded-lg" transition:fly={{ y: 5, duration: 150 }}>
                <div class="flex flex-col gap-4">
                  <div>
                    <div class="text-sm font-bold text-text-primary">
                      Overage Pricing
                    </div>
                    <p class="mt-1 text-xs text-text-muted">
                      Applied only after the included grant is exhausted.
                    </p>
                  </div>
                  <div class="flex w-fit bg-bg-card border border-border p-1 rounded-md">
                    {#each [
                      { value: "package", label: "Package" },
                      { value: "graduated", label: "Graduated" },
                      { value: "volume", label: "Volume" },
                    ] as model}
                      <button
                        type="button"
                        class="px-4 py-1.5 text-[11px] font-bold transition-all rounded-sm {configRatingModel ===
                        model.value
                          ? 'bg-accent text-accent-contrast'
                          : 'text-text-muted hover:text-text-primary'}"
                        onclick={() => selectRatingModel(model.value as RatingModel)}
                      >
                        {model.label}
                      </button>
                    {/each}
                  </div>
                </div>

                {#if configRatingModel === "package"}
                  <div class="grid grid-cols-2 gap-4">
                    <div class="">
                      <label for="overagePricePerUnit" class="text-[10px] font-bold text-text-dim uppercase tracking-wider px-1">
                        Overage Price
                      </label>
                      <div class="input-icon-wrapper">
                        <input
                          id="overagePricePerUnit"
                          type="number"
                          step="0.01"
                          placeholder="5.00"
                          class="input h-9 !text-xs !pl-8"
                          bind:value={configPricePerUnit}
                        />
                        <div class="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-text-dim font-medium pointer-events-none">
                          {COMMON_CURRENCIES.find(
                            (c) => c.code === (plan?.currency || $defaultCurrency),
                          )?.symbol ||
                            plan?.currency ||
                            "₦"}
                        </div>
                      </div>
                    </div>

                    <div class="space-y-1.5">
                      <label for="overageBillingUnits" class="text-[10px] font-bold text-text-dim uppercase tracking-wider px-1">
                        Per X Units
                      </label>
                      <input
                        id="overageBillingUnits"
                        type="number"
                        placeholder="1000"
                        class="input h-9 !text-xs"
                        bind:value={configBillingUnits}
                      />
                    </div>
                  </div>
                {:else}
                  <div class="space-y-4 pt-1">
                    <div class="flex items-center justify-between">
                      <div class="text-sm font-semibold text-text-primary">
                        Overage Tiers
                      </div>
                      <button
                        type="button"
                        class="btn btn-secondary btn-sm h-7 px-3 gap-1"
                        onclick={addPricingTier}
                      >
                        <Plus size={12} weight="bold" /> Add Tier
                      </button>
                    </div>

                    <div class="">
                      <div class="grid grid-cols-[1fr_1fr_1fr_18px] gap-3 px-1">
                        <div class="text-[10px] font-bold text-text-dim uppercase tracking-wider">Up To</div>
                        <div class="text-[10px] font-bold text-text-dim uppercase tracking-wider">Unit Price</div>
                        <div class="text-[10px] font-bold text-text-dim uppercase tracking-wider">Flat Price</div>
                      </div>

                      {#each configTiers as tier, index (tier.id)}
                        <div class="grid grid-cols-[1fr_1fr_1fr_18px] gap-1 items-center group">
                          <div class="relative">
                            <input
                              type="number"
                              placeholder={index === configTiers.length - 1
                                ? "Infinity"
                                : "1000"}
                              class="input h-9 !text-xs"
                              bind:value={tier.upTo}
                            />
                          </div>
                          <div class="input-icon-wrapper">
                            <input
                              type="number"
                              step="0.01"
                              placeholder="0.50"
                              class="input h-9 !text-xs !pl-7"
                              bind:value={tier.unitPrice}
                            />
                            <div class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-text-dim font-medium pointer-events-none">
                              {COMMON_CURRENCIES.find(
                                (c) => c.code === (plan?.currency || $defaultCurrency),
                              )?.symbol || plan?.currency || "₦"}
                            </div>
                          </div>
                          <div class="input-icon-wrapper">
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Optional"
                              class="input h-9 !text-xs !pl-7"
                              bind:value={tier.flatFee}
                            />
                            <div class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-text-dim font-medium pointer-events-none">
                              {COMMON_CURRENCIES.find(
                                (c) => c.code === (plan?.currency || $defaultCurrency),
                              )?.symbol || plan?.currency || "₦"}
                            </div>
                          </div>
                          <div class="flex justify-end">
                            {#if configTiers.length > 1}
                              <button
                                type="button"
                                class="p-1.5 text-text-dim hover:text-error hover:bg-error-bg/10 rounded-md transition-all opacity-0 group-hover:opacity-100"
                                onclick={() => removePricingTier(tier.id)}
                              >
                                <Trash size={14} weight="bold" />
                              </button>
                            {/if}
                          </div>
                        </div>
                      {/each}
                    </div>

                    <p class="text-[10px] text-text-muted px-1">
                      Each tier can charge by unit, by flat price, or both.
                    </p>
                    <p class="text-[10px] text-text-muted italic px-1">
                      * {configRatingModel === 'graduated'
                        ? 'Each tier prices only overage units inside it. Flat price is added once when overage enters that tier.'
                        : 'All overage units use the reached tier. Flat price can be used on its own for fixed-price overage bands.'}
                    </p>
                  </div>
                {/if}

                <div class="space-y-1.5 pt-1">
                  <label for="maxOverageUnits" class="text-[10px] font-bold text-text-dim uppercase tracking-wider px-1">Max Overage Units</label>
                  <input
                    id="maxOverageUnits"
                    type="number"
                    placeholder="Leave empty for unlimited"
                    class="input h-9 !text-xs"
                    bind:value={configMaxOverageUnits}
                  />
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Reset Window -->
        {#if configUsageModel === "included"}
          <div class="space-y-3">
            <div class="text-[11px] font-bold text-text-dim uppercase tracking-wider px-1">Reset Window</div>
            <div class="grid grid-cols-5 gap-2">
              {#each [{ value: "5min", label: "5 Min" }, { value: "15min", label: "15 Min" }, { value: "30min", label: "30 Min" }, { value: "hourly", label: "Hourly" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarter" }, { value: "yearly", label: "Yearly" }, { value: "none", label: "One-off" }] as int}
                <button
                  type="button"
                  class="py-2 text-[10px] font-bold border rounded-md transition-all duration-75 {configResetInterval ===
                  int.value
                    ? 'bg-accent text-accent-contrast border-accent-border'
                    : 'bg-bg-card text-text-muted border-border hover:border-border-strong hover:text-text-primary'}"
                  onclick={() => (configResetInterval = int.value)}
                >
                  {int.label}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Rollover -->
        {#if configUsageModel === "included" && configResetInterval !== "none"}
          <div class="space-y-4">
            <div class="flex items-center gap-3">
              <input
                id="configRolloverEnabled"
                type="checkbox"
                bind:checked={configRolloverEnabled}
                class="w-4 h-4 border border-border rounded-sm bg-bg-card text-accent focus:ring-accent accent-accent cursor-pointer"
              />
              <label
                for="configRolloverEnabled"
                class="text-sm font-medium text-text-primary cursor-pointer select-none"
              >
                Rollover unused balance
              </label>
            </div>
            <p class="text-xs text-text-muted ml-7 -mt-2">
              Carry unused quota to the next period.
            </p>

            {#if configRolloverEnabled}
              <div
                class="p-4 bg-bg-secondary border border-border rounded-lg space-y-2 ml-7"
              >
                <label for="rolloverMaxBalance" class="label">
                  Max Rollover Balance
                </label>
                <input
                  id="rolloverMaxBalance"
                  type="number"
                  placeholder="Leave empty for no cap"
                  class="input"
                  bind:value={configRolloverMaxBalance}
                />
                <p class="text-xs text-text-muted">
                  Cap on how much unused balance can accumulate. Empty = no cap.
                </p>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div class="p-6 border-t border-border bg-bg-card sticky bottom-0 z-10">
        <button
          type="submit"
          class="btn btn-primary w-full py-2.5 text-sm"
          disabled={isSaving}
        >
          {#if isSaving}
            <CircleNotch size={18} class="animate-spin" weight="duotone" />
            Saving...
          {:else}
            <FloppyDiskIcon /> Save Configuration
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
      <div class="p-6 space-y-5 flex-1 overflow-y-auto">
        <div>
          <label for="editName" class="label">Name</label>
          <div class="input-icon-wrapper">
            <input
              id="editName"
              class="input"
              type="text"
              bind:value={editName}
            />
          </div>
        </div>

        <div>
          <label for="editDescription" class="label">Description</label>
          <div class="input-icon-wrapper">
            <textarea
              id="editDescription"
              class="input min-h-[90px]"
              bind:value={editDescription}
            ></textarea>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="editType" class="label">Type</label>
            <div class="input-icon-wrapper">
              <select
                id="editType"
                class="input"
                bind:value={editType}
              >
                <option value="paid">Paid</option>
                <option value="free">Free</option>
              </select>
            </div>
          </div>

          <div>
            <label for="editBillingType" class="label">Billing</label>
            <div class="input-icon-wrapper">
              <select
                id="editBillingType"
                class="input"
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
            <label for="editPrice" class="label">Price</label>
            <div class="input-icon-wrapper">
              <input
                id="editPrice"
                class="input"
                type="number"
                step="0.01"
                min="0"
                bind:value={editPrice}
                disabled={editType === "free"}
              />
            </div>
          </div>

          <div>
            <label for="editCurrency" class="label">Currency</label>
            <select
              id="editCurrency"
              class="input"
              bind:value={editCurrency}
            >
              {#each COMMON_CURRENCIES as c}
                <option value={c.code}>{c.code}</option>
              {/each}
            </select>
          </div>

          <div>
            <label for="editInterval" class="label">Interval</label>
            <div class="input-icon-wrapper">
              <select
                id="editInterval"
                class="input"
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
          <label for="editTrialDays" class="label">Trial Duration</label>
          <div class="flex gap-2">
            <div class="input-icon-wrapper w-full">
              <input
                id="editTrialDays"
                class="input"
                type="number"
                min="0"
                bind:value={editTrialDays}
              />
            </div>
            <select class="input" bind:value={editTrialUnit}>
              <option value="minutes">minutes</option>
              <option value="days">days</option>
            </select>
          </div>
        </div>

        <div class="space-y-2 pt-2 border-t border-border-light">
          <div class="flex items-center gap-3">
            <input
              id="editAutoEnable"
              type="checkbox"
              bind:checked={editAutoEnable}
              class="w-4 h-4 border border-border rounded-sm bg-bg-card text-accent focus:ring-accent accent-accent cursor-pointer"
            />
            <label
              for="editAutoEnable"
              class="text-sm font-medium text-text-primary cursor-pointer select-none"
            >
              Auto-enable plan
            </label>
          </div>
          <p class="text-xs text-text-muted ml-7">
            This plan will be enabled automatically for new customers.<br/>
            {plan?.type === "free"
              ? "Subscription will be active immediately."
              : "Subscription will be pending until payment."}
          </p>
        </div>
      </div>

      <div
        class="p-5 border-t border-border bg-bg-card flex justify-end gap-3 sticky bottom-0 mt-auto z-10"
      >
        <button
          type="button"
          class="btn btn-secondary px-6"
          onclick={() => (showEditPlanModal = false)}>Cancel</button
        >
        <button
          type="submit"
          class="btn btn-primary px-8"
          disabled={isSaving || !editName.trim()}
        >
          {#if isSaving}
            <CircleNotch
              size={18}
              class="animate-spin text-accent-contrast"
              weight="duotone"
            />
            Saving...
          {:else}
            <FloppyDisk size={18} weight="fill" /> Save Changes
          {/if}
        </button>
      </div>
    </form>
  </div>
</SidePanel>

{#if projectId}
  <CreateFeatureModal
    bind:isOpen={showCreateFeatureModal}
    organizationId={projectId}
    onclose={() => (showCreateFeatureModal = false)}
    onsuccess={onFeatureCreated}
  />
{/if}

<!-- Attach Customer Panel -->
<SidePanel
  open={showAttachCustomerPanel}
  title="Attach Customer to Plan"
  onclose={() => {
    showAttachCustomerPanel = false;
    attachCustomerSearch = "";
    attachCustomerResults = [];
  }}
  width="max-w-[450px]"
>
  <div class="text-sm flex flex-col h-full">
    <div class="p-6 space-y-4">
      <p class="text-sm text-text-secondary leading-relaxed">
        Search for an existing customer to subscribe to <strong
          class="text-text-primary font-semibold"
          >{plan?.name || "this plan"}</strong
        >.
        {#if plan?.type !== "free"}
          Their subscription will start as <strong class="text-warning font-semibold"
            >pending</strong
          > until they complete payment.
        {:else}
          Their subscription will be <strong class="text-success font-semibold"
            >active</strong
          > immediately.
        {/if}
      </p>

      <div class="input-icon-wrapper pt-2">
        <MagnifyingGlass size={18} class="input-icon-left text-text-muted" />
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
      class="flex-1 overflow-y-auto divide-y divide-border/50 border-t border-border-light bg-bg-card"
    >
      {#if isSearchingCustomers}
        <div class="p-5 space-y-3">
          {#each Array(3) as _}
            <div class="flex items-center gap-3">
              <Skeleton class="w-10 h-10 rounded-full" />
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
            class="w-full flex items-center gap-3 px-6 py-4 hover:bg-bg-card-hover transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed group"
            disabled={alreadyAttached || attachingCustomerId === customer.id}
            onclick={() => attachCustomerToPlan(customer.id)}
          >
            <div
              class="w-10 h-10 rounded-full overflow-hidden shrink-0 border border-border"
            >
              <Avatar name={customer.email} size={40} />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-semibold text-text-primary truncate">
                {customer.name || customer.email}
              </div>
              <div class="text-xs text-text-muted font-mono truncate">
                {customer.email}
              </div>
            </div>
            {#if alreadyAttached}
              <span class="badge badge-default uppercase">Subscribed</span>
            {:else if attachingCustomerId === customer.id}
              <CircleNotch size={18} class="animate-spin text-accent" />
            {/if}
          </button>
        {/each}
      {:else if attachCustomerSearch.trim()}
        <div class="p-12 flex flex-col items-center justify-center text-center">
          <Users size={32} class="text-text-muted mb-4" weight="duotone" />
          <p class="text-sm font-semibold text-text-secondary mb-1">
            No customers found
          </p>
          <p class="text-xs text-text-muted mb-6">
            We couldn't find anyone matching that search.
          </p>
          <button
            class="btn btn-primary"
            onclick={() => {
              showAttachCustomerPanel = false;
              showCreateCustomerModal = true;
            }}
          >
            <Plus size={16} weight="fill" />
            Create Customer
          </button>
        </div>
      {:else}
        <div class="p-16 flex flex-col items-center justify-center text-center">
          <MagnifyingGlass
            size={32}
            class="text-text-muted mb-4"
            weight="duotone"
          />
          <p class="text-sm text-text-muted">
            Type to search for customers
          </p>
        </div>
      {/if}
    </div>

    <div class="p-5 border-t border-border bg-bg-card">
      <button
        class="btn btn-secondary w-full py-2.5 gap-2"
        onclick={() => {
          showAttachCustomerPanel = false;
          showCreateCustomerModal = true;
        }}
      >
        <Plus size={16} weight="bold" />
        Create New Customer Instead
      </button>
    </div>
  </div>
</SidePanel>

{#if projectId}
  <CreateCustomerModal
    bind:isOpen={showCreateCustomerModal}
    organizationId={projectId}
    onsuccess={(customer) => {
      // After creating the customer, attach them to the plan
      attachCustomerToPlan(customer.id);
    }}
  />
{/if}

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
