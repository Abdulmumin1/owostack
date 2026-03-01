<script lang="ts">
  import {
    Calendar,
    CaretDown,
    CaretRight,
    Check,
    CircleNotchIcon,
    Clock,
    CreditCard,
    Cube,
    Minus,
    Plus,
    X,
  } from "phosphor-svelte";
  import { fade, fly } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import { Result } from "better-result";
  import { onMount } from "svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import { defaultCurrency } from "$lib/stores/currency";
  import { COMMON_CURRENCIES } from "$lib/utils/currency";
  import { SUPPORTED_PROVIDERS, type ProviderConfig } from "$lib/providers";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";

  let {
    organizationId,
    isOpen = $bindable(false),
    onclose = () => {},
    onsuccess = (data?: any) => {},
  } = $props();

  let isCreating = $state(false);
  let error = $state("");
  let features = $state<any[]>([]);
  let creditSystems = $state<any[]>([]);
  let selectedFeatures = $state<any[]>([]);
  let isFeaturesExpanded = $state(false);
  let connectedProviders = $state<any[]>([]);
  let selectedProviderId = $state("");
  let uniqueProviderIds = $derived([
    ...new Set(connectedProviders.map((p: any) => p.providerId)),
  ]);

  async function loadData() {
    try {
      const [featRes, credRes, provRes] = await Promise.all([
        apiFetch(`/api/dashboard/features?organizationId=${organizationId}`),
        apiFetch(`/api/dashboard/credits?organizationId=${organizationId}`),
        apiFetch(
          `/api/dashboard/providers/accounts?organizationId=${organizationId}`,
        ),
      ]);

      if (credRes.data?.success) {
        creditSystems = credRes.data.data;
      }

      if (featRes.data?.success) {
        // Filter out features that are actually credit systems
        const csIds = new Set(creditSystems.map((cs) => cs.id));
        features = featRes.data.data.filter((f: any) => !csIds.has(f.id));
      }

      if (Array.isArray(provRes.data.data)) {
        connectedProviders = provRes.data.data;
        // Auto-select the first connected provider if none selected
        if (!selectedProviderId && connectedProviders.length > 0) {
          selectedProviderId = connectedProviders[0].providerId;
        }
      }
    } catch (e) {
      console.error("Failed to load data", e);
    }
  }

  $effect(() => {
    if (isOpen) {
      loadData();
    }
  });

  function toggleFeature(feature: any, isCreditSystem = false) {
    const featureId = isCreditSystem ? feature.id : feature.id;
    const index = selectedFeatures.findIndex((f) => f.id === featureId);

    if (index === -1) {
      selectedFeatures = [
        ...selectedFeatures,
        {
          id: featureId,
          name: feature.name,
          limitValue: feature.type === "boolean" ? null : 100,
          isCreditSystem,
        },
      ];
    } else {
      selectedFeatures = selectedFeatures.filter((f) => f.id !== featureId);
    }
  }

  // Form State
  let planName = $state("");
  let planType = $state<"free" | "paid">("paid");
  let billingModel = $state<"base" | "per_unit">("base");
  let billingType = $state<"recurring" | "one_time">("recurring");

  // Paid Config
  let price = $state("");
  let currency = $state($defaultCurrency);
  let interval = $state("monthly");

  // Trial Config
  let hasTrial = $state(false);
  let trialDuration = $state(7);
  let trialUnit = $state("days");
  let trialCardRequired = $state(false);

  // Plan Properties
  let isAddon = $state(false);
  let autoEnable = $state(false);
  let planGroup = $state("");

  // Derive the selected provider's config
  let selectedProviderConfig = $derived(
    SUPPORTED_PROVIDERS.find((p) => p.id === selectedProviderId),
  );

  // Derive available currencies based on selected provider
  let availableCurrencies = $derived(
    selectedProviderConfig?.supportedCurrencies
      ? COMMON_CURRENCIES.filter((c) =>
          selectedProviderConfig!.supportedCurrencies!.includes(c.code),
        )
      : COMMON_CURRENCIES,
  );

  // Reset currency when provider changes if current currency isn't supported
  $effect(() => {
    if (selectedProviderConfig?.supportedCurrencies) {
      if (!selectedProviderConfig.supportedCurrencies.includes(currency)) {
        currency = selectedProviderConfig.supportedCurrencies[0] || "USD";
      }
    }
  });

  // Auto-generate ID preview
  let planId = $derived(
    planName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
  );

  async function handleSubmit() {
    if (!planName) {
      error = "Plan name is required";
      return;
    }
    if (planType === "paid" && !price) {
      error = "Price is required for paid plans";
      return;
    }

    isCreating = true;
    error = "";

    const result = await Result.tryPromise(async () => {
      const priceValue =
        planType === "free" ? 0 : Math.round(parseFloat(price) * 100);

      let finalTrialDays = 0;
      let finalTrialUnit = "days";
      if (hasTrial) {
        if (trialUnit === "minutes") {
          finalTrialDays = trialDuration;
          finalTrialUnit = "minutes";
        } else if (trialUnit === "days") {
          finalTrialDays = trialDuration;
        } else if (trialUnit === "weeks") {
          finalTrialDays = trialDuration * 7;
        } else if (trialUnit === "months") {
          finalTrialDays = trialDuration * 30;
        }
      }

      const planRes = await apiFetch("/api/dashboard/plans", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          name: planName,
          price: priceValue,
          currency: currency,
          interval: billingType === "one_time" ? "monthly" : interval,
          type: planType,
          billingModel,
          billingType,
          trialDays: finalTrialDays,
          trialUnit: finalTrialUnit,
          trialCardRequired: hasTrial && trialCardRequired,
          isAddon,
          autoEnable,
          planGroup: planGroup || undefined,
          providerId: selectedProviderId || undefined,
        }),
      });

      if (planRes.error) {
        throw new Error(planRes.error.message || "Failed to create plan");
      }

      if (planRes.data?.success === false) {
        throw new Error(planRes.data?.error || "Failed to create plan");
      }

      const plan = planRes.data?.data;

      // Link selected features
      if (selectedFeatures.length > 0) {
        await Promise.all(
          selectedFeatures.map((f) =>
            apiFetch(`/api/dashboard/plans/${plan.id}/features`, {
              method: "POST",
              body: JSON.stringify({
                featureId: f.id,
                limitValue: f.limitValue === "" ? null : Number(f.limitValue),
              }),
            }),
          ),
        );
      }

      return plan;
    });

    if (result.isErr()) {
      console.error(result.error);
      error = result.error.message || "An unexpected error occurred";
      isCreating = false;
      return;
    }

    isCreating = false;
    onsuccess?.(result.value);
    close();
  }

  function close() {
    isOpen = false;
    onclose?.();
    // Reset form after delay
    setTimeout(() => {
      planName = "";
      price = "";
      error = "";
    }, 300);
  }
</script>

<SidePanel open={isOpen} title="Create Plan" onclose={close} width="max-w-md">
  <div class="text-sm flex flex-col h-full justify-between">
    <div class="p-5 space-y-6">
      <!-- Name & ID -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label
            class="block text-xs font-medium text-text-dim mb-1.5"
            for="planName">Plan Name</label
          >
          <div class="input-icon-wrapper">
            <input
              type="text"
              id="planName"
              bind:value={planName}
              placeholder="eg. Pro Plan"
              class="input"
              autofocus
            />
          </div>
        </div>
        <div>
          <label
            class="block text-xs font-medium text-text-dim mb-1.5"
            for="planId">ID</label
          >
          <div class="input-icon-wrapper">
            <input
              type="text"
              id="planId"
              value={planId || "fills automatically"}
              disabled
              class="input opacity-50 cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      <!-- Provider Selection (only show when multiple providers are connected) -->
      {#if uniqueProviderIds.length > 1}
        <div>
          <div class="text-xs font-medium text-text-dim mb-2">
            Payment Provider
          </div>
          <div
            class="grid grid-cols-{Math.min(uniqueProviderIds.length, 3)} gap-2"
          >
            {#each uniqueProviderIds as pid}
              {@const provConfig = SUPPORTED_PROVIDERS.find(
                (p) => p.id === pid,
              )}
              {#if provConfig}
                <button
                  class="relative border rounded-lg p-3 text-left transition-all {selectedProviderId ===
                  pid
                    ? 'border-accent bg-accent/5'
                    : 'border-border bg-bg-secondary hover:border-text-dim'}"
                  onclick={() => (selectedProviderId = pid)}
                >
                  <div class="text-xs font-bold text-text-primary">
                    {provConfig.name}
                  </div>
                  <div class="text-[10px] text-text-dim mt-0.5 truncate">
                    {provConfig.description}
                  </div>
                  {#if selectedProviderId === pid}
                    <div
                      class="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent"
                    ></div>
                  {/if}
                </button>
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      <!-- Plan Type -->
      <div>
        <div class="text-xs font-medium text-text-dim mb-2">
          Select Plan Type
        </div>
        <div class="grid grid-cols-2 gap-3">
          <button
            class="relative border rounded-lg p-4 text-left transition-all {planType ===
            'free'
              ? 'border-accent bg-accent/5'
              : 'border-border bg-bg-secondary hover:border-text-dim'}"
            onclick={() => {
              planType = "free";
              hasTrial = false;
            }}
          >
            <div
              class="mb-3 w-8 h-8 rounded-full bg-bg-card border border-border flex items-center justify-center"
            >
              <Cube
                size={16}
                class={planType === "free" ? "text-accent" : "text-text-dim"}
                weight="duotone"
              />
            </div>
            <div class="font-bold text-text-primary mb-0.5">Free</div>
            <div class="text-[10px] text-text-dim leading-relaxed">
              A plan without pricing that customers can use for free
            </div>
            {#if planType === "free"}
              <div
                class="absolute top-3 right-3 w-2 h-2 rounded-full bg-accent"
              ></div>
            {/if}
          </button>

          <button
            class="relative border rounded-lg p-4 text-left transition-all {planType ===
            'paid'
              ? 'border-accent bg-accent/5'
              : 'border-border bg-bg-secondary hover:border-text-dim'}"
            onclick={() => (planType = "paid")}
          >
            <div
              class="mb-3 w-8 h-8 rounded-full bg-bg-card border border-border flex items-center justify-center"
            >
              <CreditCard
                size={16}
                class={planType === "paid" ? "text-accent" : "text-text-dim"}
                weight="duotone"
              />
            </div>
            <div class="font-bold text-text-primary mb-0.5">Paid</div>
            <div class="text-[10px] text-text-dim leading-relaxed">
              A plan with fixed or usage-based pricing that customers may
              purchase
            </div>
            {#if planType === "paid"}
              <div
                class="absolute top-3 right-3 w-2 h-2 rounded-full bg-accent"
              ></div>
            {/if}
          </button>
        </div>
      </div>

      <!-- Free Plan Config (Currency for overages) -->
      {#if planType === "free"}
        <div class="pt-2" transition:fly={{ y: -10, duration: 200 }}>
          <label
            class="block text-xs font-medium text-text-dim mb-1.5"
            for="freeCurrencySelect">Default Currency</label
          >
          <div class="input-icon-wrapper">
            <select
              id="freeCurrencySelect"
              bind:value={currency}
              class="input appearance-none"
            >
              {#each availableCurrencies as c}
                <option value={c.code}>{c.code}</option>
              {:else}
                <option value="USD">USD</option>
              {/each}
            </select>
          </div>
          <p class="text-[10px] text-text-dim mt-1.5 leading-relaxed">
            This currency will be used for any overage charges or linked billing
            on this free plan.
          </p>
        </div>
      {/if}

      <!-- Paid Config -->
      {#if planType === "paid"}
        <div class="space-y-4 pt-2" transition:fly={{ y: -10, duration: 200 }}>
          <div>
            <div class="text-xs font-medium text-text-dim mb-2">Plan Price</div>

            <!-- Billing Model -->
            <div class="flex flex-col gap-2 mb-4">
              <label class="flex items-center gap-2 cursor-pointer group">
                <div
                  class="w-4 h-4 rounded-full border flex items-center justify-center {billingModel ===
                  'base'
                    ? 'border-accent'
                    : 'border-border group-hover:border-text-dim'}"
                >
                  {#if billingModel === "base"}
                    <div class="w-2 h-2 rounded-full bg-accent" />
                  {/if}
                </div>
                <input
                  type="radio"
                  value="base"
                  bind:group={billingModel}
                  class="hidden"
                />
                <div>
                  <span class="text-xs text-text-primary block">Base price</span
                  >
                  <span class="text-[10px] text-text-dim block"
                    >This plan has a fixed price. You can add per-unit prices
                    later.</span
                  >
                </div>
              </label>
            </div>

            <!-- Recurring vs One-off segment -->
            <div
              class="flex p-1 bg-bg-secondary rounded-lg border border-border mb-4"
            >
              <button
                class="flex-1 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 {billingType ===
                'recurring'
                  ? 'bg-bg-card text-text-primary shadow-sm border border-border'
                  : 'text-text-dim hover:text-text-secondary'}"
                onclick={() => (billingType = "recurring")}
              >
                <Clock size={12} weight="duotone" />
                Recurring
              </button>
              <button
                class="flex-1 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 {billingType ===
                'one_time'
                  ? 'bg-bg-card text-text-primary shadow-sm border border-border'
                  : 'text-text-dim hover:text-text-secondary'}"
                onclick={() => (billingType = "one_time")}
              >
                <Check size={12} weight="fill" />
                One-off
              </button>
            </div>

            <!-- Price + Currency -->
            {#if billingModel === "base"}
              <div class="grid grid-cols-3 gap-4">
                <div class="col-span-2">
                  <label
                    class="block text-xs font-medium text-text-dim mb-1.5"
                    for="priceInput">Price</label
                  >
                  <div class="input-icon-wrapper">
                    <input
                      type="number"
                      id="priceInput"
                      bind:value={price}
                      placeholder="eg. 100"
                      min="0"
                      class="input pr-12"
                    />
                    <div
                      class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-text-dim pointer-events-none"
                    >
                      {currency}
                    </div>
                  </div>
                </div>
                <div>
                  <label
                    class="block text-xs font-medium text-text-dim mb-1.5"
                    for="currencySelect">Currency</label
                  >
                  <select
                    id="currencySelect"
                    bind:value={currency}
                    class="input appearance-none"
                  >
                    {#each availableCurrencies as c}
                      <option value={c.code}>{c.code}</option>
                    {/each}
                  </select>
                </div>
              </div>

              {#if billingType === "recurring"}
                <div class="mt-4">
                  <label
                    class="block text-xs font-medium text-text-dim mb-1.5"
                    for="intervalSelect">Billing Interval</label
                  >
                  <div class="input-icon-wrapper">
                    <select
                      id="intervalSelect"
                      bind:value={interval}
                      class="input appearance-none"
                    >
                      <option value="monthly">per month</option>
                      <option value="yearly">per year</option>
                      <option value="quarterly">per quarter</option>
                      <option value="weekly">per week</option>
                    </select>
                  </div>
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {/if}

      <!-- Options -->
      <div class="space-y-3 pt-2">
        <!-- Free Trial (only for paid plans) -->
        {#if planType === "paid"}
          <div>
            <label
              class="flex items-center gap-2 cursor-pointer group select-none"
            >
              <div
                class="relative w-4 h-4 rounded border flex items-center justify-center transition-colors {hasTrial
                  ? 'bg-accent border-accent'
                  : 'border-border group-hover:border-text-dim'}"
              >
                {#if hasTrial}
                  <Check size={10} class="text-accent-contrast" weight="fill" />
                {/if}
              </div>
              <input type="checkbox" bind:checked={hasTrial} class="hidden" />
              <span class="text-xs text-text-primary font-medium"
                >Free trial</span
              >
            </label>
            <p class="text-[10px] text-text-dim pl-6">
              Enable a free trial period for customers to try this plan
            </p>

            {#if hasTrial}
              <div
                class="pl-6 mt-3 grid grid-cols-2 gap-4"
                transition:fly={{ y: -5, duration: 150 }}
              >
                <div>
                  <label
                    class="block text-[10px] font-medium text-text-dim mb-1.5"
                    for="trialDuration">Duration</label
                  >
                  <div class="flex">
                    <input
                      type="number"
                      bind:value={trialDuration}
                      class="w-16 bg-bg-secondary border border-r-0 border-border rounded-l-md px-2 py-1.5 text-text-primary text-xs text-center focus:outline-none focus:border-text-dim"
                    />
                    <select
                      bind:value={trialUnit}
                      class="flex-1 bg-bg-secondary border border-border rounded-r-md px-2 py-1.5 text-text-primary text-xs focus:outline-none focus:border-text-dim"
                    >
                      <option value="minutes">minutes</option>
                      <option value="days">days</option>
                      <option value="weeks">weeks</option>
                      <option value="months">months</option>
                    </select>
                  </div>
                </div>
                <div class="flex items-center pt-5">
                  <label
                    class="flex items-center gap-2 cursor-pointer group select-none"
                  >
                    <div
                      class="relative w-4 h-4 rounded border flex items-center justify-center transition-colors {trialCardRequired
                        ? 'bg-accent border-accent'
                        : 'border-border group-hover:border-text-dim'}"
                    >
                      {#if trialCardRequired}
                        <Check
                          size={10}
                          class="text-accent-contrast"
                          weight="fill"
                        />
                      {/if}
                    </div>
                    <input
                      type="checkbox"
                      bind:checked={trialCardRequired}
                      class="hidden"
                    />
                    <span class="text-xs text-text-primary">Card Required</span>
                  </label>
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Plan Group -->
        <div class="mt-4">
          <label
            class="block text-xs font-medium text-text-dim mb-1.5"
            for="planGroup"
            >Plan Group (optional) <a
              class="text-accent hover:text-accent-hover underline"
              target="_blank"
              href="{import.meta.env
                .VITE_DOCS_URL}/concepts/plans-and-products#plan-groups-and-mutual-exclusivity"
              >docs</a
            >
          </label>
          <div class="input-icon-wrapper">
            <input
              type="text"
              id="planGroup"
              bind:value={planGroup}
              placeholder="eg. support, sales"
              class="input"
            />
          </div>
          <p class="text-[10px] text-text-dim mt-1">
            Group related plans together (e.g., different tiers of the same
            product)
          </p>
        </div>

        <!-- Auto-enable Plan -->
        <div class="mt-4">
          <label
            class="flex items-center gap-2 cursor-pointer group select-none"
          >
            <div
              class="relative w-4 h-4 rounded border flex items-center justify-center transition-colors {autoEnable
                ? 'bg-accent border-accent'
                : 'border-border group-hover:border-text-dim'}"
            >
              {#if autoEnable}
                <Check size={10} class="text-accent-contrast" weight="fill" />
              {/if}
            </div>
            <input type="checkbox" bind:checked={autoEnable} class="hidden" />
            <span class="text-xs text-text-primary font-medium"
              >Auto-enable plan</span
            >
          </label>
          <p class="text-[10px] text-text-dim pl-6">
            {planType === "free"
              ? "New customers will be subscribed to this plan automatically"
              : "New customers will receive a pending subscription awaiting payment"}
          </p>
        </div>

        <!-- Feature Selection -->
        <div class="pt-4 border-t border-border">
          <button
            class="w-full flex items-center justify-between text-left focus:outline-none mb-2"
            onclick={() => (isFeaturesExpanded = !isFeaturesExpanded)}
            type="button"
          >
            <h3
              class="text-xs font-bold text-text-primary uppercase tracking-wider"
            >
              Features & Entitlements {selectedFeatures.length > 0
                ? `(${selectedFeatures.length})`
                : ""}
            </h3>
            <div
              class="text-text-dim hover:text-text-primary transition-colors"
            >
              {#if isFeaturesExpanded}
                <CaretDown size={16} weight="bold" />
              {:else}
                <CaretRight size={16} weight="bold" />
              {/if}
            </div>
          </button>

          {#if isFeaturesExpanded}
            <div transition:fly={{ y: -5, duration: 200 }}>
              {#if features.length === 0 && creditSystems.length === 0}
                <p class="text-[10px] text-text-dim italic">
                  No features or credit systems defined. Create them first to
                  link to plans.
                </p>
              {:else}
                <div class="space-y-6">
                  <!-- Regular Features -->
                  {#if features.length > 0}
                    <div class="space-y-3">
                      <div
                        class="text-[10px] font-bold text-text-dim uppercase tracking-widest"
                      >
                        Regular Features
                      </div>
                      {#each features as feature}
                        {@const isSelected = selectedFeatures.find(
                          (f) => f.id === feature.id && !f.isCreditSystem,
                        )}
                        <div
                          class="bg-bg-card border {isSelected
                            ? 'border-accent/50 bg-accent/5'
                            : 'border-border'} p-3 rounded-lg transition-all"
                        >
                          <div class="flex items-center justify-between mb-2">
                            <label
                              class="flex items-center gap-3 cursor-pointer select-none"
                            >
                              <div
                                class="w-4 h-4 rounded border flex items-center justify-center transition-colors {isSelected
                                  ? 'bg-accent border-accent'
                                  : 'border-border'}"
                              >
                                {#if isSelected}
                                  <Check
                                    size={10}
                                    class="text-accent-contrast"
                                    weight="fill"
                                  />
                                {/if}
                              </div>
                              <input
                                type="checkbox"
                                checked={!!isSelected}
                                onchange={() => toggleFeature(feature)}
                                class="hidden"
                              />
                              <span class="text-xs font-bold text-text-primary"
                                >{feature.name}</span
                              >
                            </label>
                            <span
                              class="text-[10px] font-mono text-text-dim uppercase"
                              >{feature.type}</span
                            >
                          </div>

                          {#if isSelected && feature.type !== "boolean"}
                            <div
                              class="pl-7 flex items-center gap-4"
                              transition:fly={{ y: -5, duration: 150 }}
                            >
                              <div class="flex-1">
                                <label
                                  class="block text-[9px] font-bold text-text-dim uppercase tracking-widest mb-1"
                                  >Limit Value</label
                                >
                                <div class="flex items-center gap-2">
                                  <input
                                    type="number"
                                    bind:value={isSelected.limitValue}
                                    placeholder="Unlimited"
                                    class="w-20 bg-bg-secondary border border-border rounded px-2 py-1 text-xs text-text-primary focus:border-accent outline-none"
                                  />
                                  <span
                                    class="text-[10px] text-text-dim font-bold uppercase"
                                    >{feature.unit || "units"}</span
                                  >
                                </div>
                              </div>
                            </div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}

                  <!-- Credit Systems -->
                  {#if creditSystems.length > 0}
                    <div class="space-y-3">
                      <div
                        class="text-[10px] font-bold text-text-dim uppercase tracking-widest"
                      >
                        Credit Systems
                      </div>
                      {#each creditSystems as cs}
                        {@const isSelected = selectedFeatures.find(
                          (f) => f.id === cs.id && f.isCreditSystem,
                        )}
                        <div
                          class="bg-bg-card border {isSelected
                            ? 'border-accent/50 bg-accent/5'
                            : 'border-border'} p-3 rounded-lg transition-all"
                        >
                          <div class="flex items-center justify-between mb-2">
                            <label
                              class="flex items-center gap-3 cursor-pointer select-none"
                            >
                              <div
                                class="w-4 h-4 rounded border flex items-center justify-center transition-colors {isSelected
                                  ? 'bg-accent border-accent'
                                  : 'border-border'}"
                              >
                                {#if isSelected}
                                  <Check
                                    size={10}
                                    class="text-accent-contrast"
                                    weight="fill"
                                  />
                                {/if}
                              </div>
                              <input
                                type="checkbox"
                                checked={!!isSelected}
                                onchange={() => toggleFeature(cs, true)}
                                class="hidden"
                              />
                              <span class="text-xs font-bold text-text-primary"
                                >{cs.name}</span
                              >
                            </label>
                            <span
                              class="text-[10px] font-mono text-accent uppercase font-bold"
                              >Credits</span
                            >
                          </div>

                          {#if isSelected}
                            <div
                              class="pl-7 flex items-center gap-4"
                              transition:fly={{ y: -5, duration: 150 }}
                            >
                              <div class="flex-1">
                                <label
                                  class="block text-[9px] font-bold text-text-dim uppercase tracking-widest mb-1"
                                  >Included Credits</label
                                >
                                <div class="flex items-center gap-2">
                                  <input
                                    type="number"
                                    bind:value={isSelected.limitValue}
                                    placeholder="Unlimited"
                                    class="w-20 bg-bg-secondary border border-border rounded px-2 py-1 text-xs text-text-primary focus:border-accent outline-none"
                                  />
                                  <span
                                    class="text-[10px] text-text-dim font-bold uppercase"
                                    >credits</span
                                  >
                                </div>
                              </div>
                            </div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      {#if error}
        <div
          class="text-error text-xs py-2 bg-error-bg px-3 rounded-md border border-error"
        >
          {error}
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div
      class="p-5 border-t border-border flex items-center justify-end gap-3 sticky bottom-0 bg-bg-card"
    >
      <button
        class="px-4 py-2 text-xs font-bold text-text-dim hover:text-text-primary transition-colors uppercase tracking-widest"
        onclick={close}
      >
        Cancel <span class="text-text-dim/60 ml-1 font-normal uppercase"
          >Esc</span
        >
      </button>
      <button
        class="px-6 py-2 bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-bold rounded-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest"
        onclick={handleSubmit}
        disabled={!planName || (planType === "paid" && !price) || isCreating}
      >
        {#if isCreating}
          <CircleNotchIcon size={12} class="animate-spin" />
          Creating...
        {:else}
          Create plan <span class=" px-1 rounded ml-1 text-[10px]"> ⌘↵ </span>
        {/if}
      </button>
    </div>
  </div>
</SidePanel>
