<script lang="ts">
  import {
    X,
    Check,
    CreditCard,
    Box,
    Calendar,
    Clock,
    Loader2,
    Plus,
    Minus,
  } from "lucide-svelte";
  import { fade, fly } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import { Result } from "better-result";
  import { onMount } from "svelte";

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

  async function loadData() {
    try {
      const [featRes, credRes] = await Promise.all([
        apiFetch(`/api/dashboard/features?organizationId=${organizationId}`),
        apiFetch(`/api/dashboard/credits?organizationId=${organizationId}`),
      ]);

      if (credRes.data?.success) {
        creditSystems = credRes.data.data;
      }

      if (featRes.data?.success) {
        // Filter out features that are actually credit systems
        const csIds = new Set(creditSystems.map((cs) => cs.id));
        features = featRes.data.data.filter((f: any) => !csIds.has(f.id));
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
    const featureId = isCreditSystem ? feature.id : feature.id; // both have id
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
  let currency = $state("NGN");
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
      if (hasTrial) {
        if (trialUnit === "days") finalTrialDays = trialDuration;
        if (trialUnit === "weeks") finalTrialDays = trialDuration * 7;
        if (trialUnit === "months") finalTrialDays = trialDuration * 30;
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
          trialCardRequired: hasTrial && trialCardRequired,
          isAddon,
          autoEnable,
          planGroup: planGroup || undefined,
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

{#if isOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 text-sm"
    transition:fade={{ duration: 150 }}
  >
    <div
      class="w-full max-w-lg bg-bg-secondary border border-border rounded-xl relative flex flex-col max-h-[90vh]"
      transition:fly={{ y: 20, duration: 200 }}
    >
      <!-- Header -->
      <div
        class="px-6 py-5 border-b border-border flex items-center justify-between"
      >
        <div>
          <h2 class="text-lg font-bold text-white tracking-tight">
            Create Plan
          </h2>
          <p class="text-zinc-500 text-xs mt-0.5">
            Create a new free or paid plan for your application
          </p>
        </div>
        <button
          class="text-zinc-500 hover:text-white transition-colors"
          onclick={close}
        >
          <X size={18} />
        </button>
      </div>

      <!-- Content (Scrollable) -->
      <div class="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
        <!-- Name & ID -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label
              class="block text-xs font-medium text-zinc-400 mb-1.5"
              for="planName">Plan Name</label
            >
            <input
              type="text"
              id="planName"
              bind:value={planName}
              placeholder="eg. Pro Plan"
              class="w-full bg-bg-secondary border border-border rounded-md px-3 py-2 text-white placeholder:text-zinc-700 focus:outline-none focus:border-zinc-500 transition-colors"
              autofocus
            />
          </div>
          <div>
            <label
              class="block text-xs font-medium text-zinc-400 mb-1.5"
              for="planId">ID</label
            >
            <input
              type="text"
              id="planId"
              value={planId || "fills automatically"}
              disabled
              class="w-full bg-bg-secondary/50 border border-border rounded-md px-3 py-2 text-zinc-500 cursor-not-allowed"
            />
          </div>
        </div>

        <!-- Plan Type -->
        <div>
          <div class="text-xs font-medium text-zinc-400 mb-2">
            Select Plan Type
          </div>
          <div class="grid grid-cols-2 gap-3">
            <button
              class="relative border rounded-lg p-4 text-left transition-all {planType ===
              'free'
                ? 'border-accent bg-accent/5'
                : 'border-border bg-bg-secondary hover:border-zinc-600'}"
              onclick={() => (planType = "free")}
            >
              <div
                class="mb-3 w-8 h-8 rounded-full bg-bg-card border border-border flex items-center justify-center"
              >
                <Box
                  size={16}
                  class={planType === "free" ? "text-accent" : "text-zinc-500"}
                />
              </div>
              <div class="font-bold text-white mb-0.5">Free</div>
              <div class="text-[10px] text-zinc-500 leading-relaxed">
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
                : 'border-border bg-bg-secondary hover:border-zinc-600'}"
              onclick={() => (planType = "paid")}
            >
              <div
                class="mb-3 w-8 h-8 rounded-full bg-bg-card border border-border flex items-center justify-center"
              >
                <CreditCard
                  size={16}
                  class={planType === "paid" ? "text-accent" : "text-zinc-500"}
                />
              </div>
              <div class="font-bold text-white mb-0.5">Paid</div>
              <div class="text-[10px] text-zinc-500 leading-relaxed">
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

        <!-- Paid Config -->
        {#if planType === "paid"}
          <div
            class="space-y-4 pt-2"
            transition:fly={{ y: -10, duration: 200 }}
          >
            <div>
              <div class="text-xs font-medium text-zinc-400 mb-2">
                Plan Price
              </div>

              <!-- Billing Model -->
              <div class="flex flex-col gap-2 mb-4">
                <label class="flex items-center gap-2 cursor-pointer group">
                  <div
                    class="w-4 h-4 rounded-full border flex items-center justify-center {billingModel ===
                    'base'
                      ? 'border-accent'
                      : 'border-zinc-600 group-hover:border-zinc-500'}"
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
                    <span class="text-xs text-white block">Base price</span>
                    <span class="text-[10px] text-zinc-500 block"
                      >This plan has a fixed price. You can add per-unit prices
                      later.</span
                    >
                  </div>
                </label>

                <label class="flex items-center gap-2 cursor-pointer group">
                  <div
                    class="w-4 h-4 rounded-full border flex items-center justify-center {billingModel ===
                    'per_unit'
                      ? 'border-accent'
                      : 'border-zinc-600 group-hover:border-zinc-500'}"
                  >
                    {#if billingModel === "per_unit"}
                      <div class="w-2 h-2 rounded-full bg-accent" />
                    {/if}
                  </div>
                  <input
                    type="radio"
                    value="per_unit"
                    bind:group={billingModel}
                    class="hidden"
                  />
                  <div>
                    <span class="text-xs text-white block">Per unit only</span>
                    <span class="text-[10px] text-zinc-500 block"
                      >Plan price is based entirely on usage or units purchased.</span
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
                    ? 'bg-bg-card text-white shadow-sm border border-border'
                    : 'text-zinc-500 hover:text-zinc-300'}"
                  onclick={() => (billingType = "recurring")}
                >
                  <Clock size={12} />
                  Recurring
                </button>
                <button
                  class="flex-1 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 {billingType ===
                  'one_time'
                    ? 'bg-bg-card text-white shadow-sm border border-border'
                    : 'text-zinc-500 hover:text-zinc-300'}"
                  onclick={() => (billingType = "one_time")}
                >
                  <Check size={12} />
                  One-off
                </button>
              </div>

              <!-- Price Input -->
              {#if billingModel === "base"}
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      class="block text-xs font-medium text-zinc-400 mb-1.5"
                      for="priceInput">Price</label
                    >
                    <div class="relative">
                      <input
                        type="number"
                        id="priceInput"
                        bind:value={price}
                        placeholder="eg. 100"
                        min="0"
                        class="w-full bg-bg-secondary border border-border rounded-md pl-3 pr-12 py-2 text-white placeholder:text-zinc-700 focus:outline-none focus:border-zinc-500 transition-colors"
                      />
                      <div
                        class="absolute right-3 top-2 text-xs font-bold text-zinc-500 pointer-events-none"
                      >
                        {currency}
                      </div>
                    </div>
                  </div>

                  {#if billingType === "recurring"}
                    <div>
                      <label
                        class="block text-xs font-medium text-zinc-400 mb-1.5"
                        for="intervalSelect">Billing Interval</label
                      >
                      <select
                        id="intervalSelect"
                        bind:value={interval}
                        class="w-full bg-bg-secondary border border-border rounded-md px-3 py-2 text-white focus:outline-none focus:border-zinc-500 transition-colors appearance-none"
                      >
                        <option value="monthly">per month</option>
                        <option value="yearly">per year</option>
                        <option value="quarterly">per quarter</option>
                        <option value="weekly">per week</option>
                      </select>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Options -->
        <div class="space-y-3 pt-2">
          <!-- Free Trial -->
          <div>
            <label
              class="flex items-center gap-2 cursor-pointer group select-none"
            >
              <div
                class="relative w-4 h-4 rounded border flex items-center justify-center transition-colors {hasTrial
                  ? 'bg-accent border-accent'
                  : 'border-zinc-600 group-hover:border-zinc-500'}"
              >
                {#if hasTrial}
                  <Check size={10} class="text-black" />
                {/if}
              </div>
              <input type="checkbox" bind:checked={hasTrial} class="hidden" />
              <span class="text-xs text-white font-medium">Free trial</span>
            </label>
            <p class="text-[10px] text-zinc-500 pl-6">
              Enable a free trial period for customers to try this plan
            </p>

            {#if hasTrial}
              <div
                class="pl-6 mt-3 grid grid-cols-2 gap-4"
                transition:fly={{ y: -5, duration: 150 }}
              >
                <div>
                  <label
                    class="block text-[10px] font-medium text-zinc-400 mb-1.5"
                    for="trialDuration">Duration</label
                  >
                  <div class="flex">
                    <input
                      type="number"
                      bind:value={trialDuration}
                      class="w-16 bg-bg-secondary border border-r-0 border-border rounded-l-md px-2 py-1.5 text-white text-xs text-center focus:outline-none focus:border-zinc-500"
                    />
                    <select
                      bind:value={trialUnit}
                      class="flex-1 bg-bg-secondary border border-border rounded-r-md px-2 py-1.5 text-white text-xs focus:outline-none focus:border-zinc-500"
                    >
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
                        : 'border-zinc-600 group-hover:border-zinc-500'}"
                    >
                      {#if trialCardRequired}
                        <Check size={10} class="text-black" />
                      {/if}
                    </div>
                    <input
                      type="checkbox"
                      bind:checked={trialCardRequired}
                      class="hidden"
                    />
                    <span class="text-xs text-white">Card Required</span>
                  </label>
                </div>
              </div>
            {/if}
          </div>

          <!-- Add-on -->
          <div>
            <label
              class="flex items-center gap-2 cursor-pointer group select-none"
            >
              <div
                class="relative w-4 h-4 rounded border flex items-center justify-center transition-colors {isAddon
                  ? 'bg-zinc-700 border-zinc-700'
                  : 'border-zinc-600 group-hover:border-zinc-500'}"
              >
                {#if isAddon}
                  <Check size={10} class="text-white" />
                {/if}
              </div>
              <input type="checkbox" bind:checked={isAddon} class="hidden" />
              <span class="text-xs text-zinc-400 font-medium">Add-on plan</span>
            </label>
            <p class="text-[10px] text-zinc-500 pl-6">
              Stack this plan on top of a base plan
            </p>
          </div>

          <!-- Auto-enable -->
          <div>
            <label
              class="flex items-center gap-2 cursor-pointer group select-none"
            >
              <div
                class="relative w-4 h-4 rounded border flex items-center justify-center transition-colors {autoEnable
                  ? 'bg-accent border-accent'
                  : 'border-zinc-600 group-hover:border-zinc-500'}"
              >
                {#if autoEnable}
                  <Check size={10} class="text-black" />
                {/if}
              </div>
              <input type="checkbox" bind:checked={autoEnable} class="hidden" />
              <span class="text-xs text-white font-medium">Auto-enable</span>
            </label>
            <p class="text-[10px] text-zinc-500 pl-6">
              Automatically assign this plan to new customers
            </p>
          </div>

          <!-- Plan Group -->
          <div>
            <label
              class="block text-xs font-medium text-zinc-400 mb-1.5"
              for="planGroup">Plan Group (optional)</label
            >
            <input
              type="text"
              id="planGroup"
              bind:value={planGroup}
              placeholder="eg. support, sales"
              class="w-full bg-bg-secondary border border-border rounded-md px-3 py-2 text-white placeholder:text-zinc-700 focus:outline-none focus:border-zinc-500 transition-colors"
            />
            <p class="text-[10px] text-zinc-500 mt-1">
              Group related plans together (e.g., different tiers of the same
              product)
            </p>
          </div>

          <!-- Feature Selection -->
          <div class="pt-4 border-t border-border">
            <h3
              class="text-xs font-bold text-white mb-4 uppercase tracking-wider"
            >
              Features & Entitlements
            </h3>

            {#if features.length === 0 && creditSystems.length === 0}
              <p class="text-[10px] text-zinc-600 italic">
                No features or credit systems defined. Create them first to link
                to plans.
              </p>
            {:else}
              <div class="space-y-6">
                <!-- Regular Features -->
                {#if features.length > 0}
                  <div class="space-y-3">
                    <div
                      class="text-[10px] font-bold text-zinc-500 uppercase tracking-widest"
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
                                : 'border-zinc-700'}"
                            >
                              {#if isSelected}
                                <Check size={10} class="text-black" />
                              {/if}
                            </div>
                            <input
                              type="checkbox"
                              checked={!!isSelected}
                              onchange={() => toggleFeature(feature)}
                              class="hidden"
                            />
                            <span class="text-xs font-bold text-white"
                              >{feature.name}</span
                            >
                          </label>
                          <span
                            class="text-[10px] font-mono text-zinc-600 uppercase"
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
                                class="block text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1"
                                >Limit Value</label
                              >
                              <div class="flex items-center gap-2">
                                <input
                                  type="number"
                                  bind:value={isSelected.limitValue}
                                  placeholder="Unlimited"
                                  class="w-20 bg-black/40 border border-border rounded px-2 py-1 text-xs text-white focus:border-accent outline-none"
                                />
                                <span
                                  class="text-[10px] text-zinc-600 font-bold uppercase"
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
                      class="text-[10px] font-bold text-zinc-500 uppercase tracking-widest"
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
                                : 'border-zinc-700'}"
                            >
                              {#if isSelected}
                                <Check size={10} class="text-black" />
                              {/if}
                            </div>
                            <input
                              type="checkbox"
                              checked={!!isSelected}
                              onchange={() => toggleFeature(cs, true)}
                              class="hidden"
                            />
                            <span class="text-xs font-bold text-white"
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
                                class="block text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1"
                                >Included Credits</label
                              >
                              <div class="flex items-center gap-2">
                                <input
                                  type="number"
                                  bind:value={isSelected.limitValue}
                                  placeholder="Unlimited"
                                  class="w-20 bg-black/40 border border-border rounded px-2 py-1 text-xs text-white focus:border-accent outline-none"
                                />
                                <span
                                  class="text-[10px] text-zinc-600 font-bold uppercase"
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
        </div>

        {#if error}
          <div
            class="text-red-400 text-xs py-2 bg-red-950/20 px-3 rounded-md border border-red-900/50"
          >
            {error}
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div
        class="p-6 border-t border-border flex items-center justify-end gap-3 bg-bg-secondary/20"
      >
        <button
          class="px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white transition-colors"
          onclick={close}
        >
          Cancel <span class="text-zinc-600 ml-1 font-normal">Esc</span>
        </button>
        <button
          class="px-6 py-2 bg-accent hover:bg-accent-hover text-black text-xs font-bold rounded-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          onclick={handleSubmit}
          disabled={!planName || (planType === "paid" && !price) || isCreating}
        >
          {#if isCreating}
            <Loader2 size={12} class="animate-spin" />
            Creating...
          {:else}
            Create plan <span class="bg-black/10 px-1 rounded ml-1 text-[10px]"
              >⌘↵</span
            >
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Custom Scrollbar for the modal content */
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background-color: #333;
    border-radius: 20px;
  }
</style>
