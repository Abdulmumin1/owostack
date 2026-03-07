<script lang="ts">
  import {
    CircleNotch as CircleNotchIcon,
    Plus as PlusIcon,
    ShieldCheck,
    Calendar,
    WarningCircle,
    Note,
    CaretDown,
  } from "phosphor-svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import { apiFetch } from "$lib/auth-client";
  import { onMount } from "svelte";
  import { page } from "$app/state";

  let {
    isOpen = $bindable(false),
    customerId,
    onsuccess,
    onclose,
  }: {
    isOpen: boolean;
    customerId: string;
    onsuccess?: (override: any) => void;
    onclose?: () => void;
  } = $props();

  const organizationId = $derived(page.params.projectId);
  let features = $state<any[]>([]);
  let selectedFeatureId = $state("");
  let selectedFeature = $derived(features.find(f => f.id === selectedFeatureId));
  let limitValue = $state<number | null>(null);
  let isUnlimited = $state(false);
  let expiresAt = $state("");
  let resetInterval = $state("monthly");
  let reason = $state("");
  let isSubmitting = $state(false);
  let isLoadingFeatures = $state(false);
  let error = $state("");

  async function loadFeatures() {
    if (!organizationId) return;
    isLoadingFeatures = true;
    try {
      const res = await apiFetch(`/api/dashboard/features?organizationId=${organizationId}`);
      if (res.data?.success) {
        features = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load features:", e);
    } finally {
      isLoadingFeatures = false;
    }
  }

  onMount(() => {
    loadFeatures();
  });

  $effect(() => {
    if (isOpen && features.length === 0) {
      loadFeatures();
    }
  });

  $effect(() => {
    if (isUnlimited) {
      limitValue = null;
    } else if (limitValue === null) {
      limitValue = 1000;
    }
  });

  async function handleSubmit() {
    if (!selectedFeatureId) {
      error = "Please select a feature";
      return;
    }

    isSubmitting = true;
    error = "";

    try {
      const res = await apiFetch("/api/dashboard/entitlement-overrides", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          customerId,
          featureId: selectedFeatureId,
          limitValue: isUnlimited ? null : limitValue,
          expiresAt: expiresAt ? new Date(expiresAt).getTime() : null,
          resetInterval,
          reason: reason.trim() || undefined,
        }),
      });

      if (res.error) {
        throw new Error(res.error.message || "Failed to grant override");
      }

      if (res.data?.success === false) {
        throw new Error(res.data?.error || "Failed to grant override");
      }

      onsuccess?.(res.data?.data);
      close();
    } catch (e: any) {
      error = e.message || "An unexpected error occurred";
    } finally {
      isSubmitting = false;
    }
  }

  function close() {
    isOpen = false;
    onclose?.();
    // Reset form after animation
    setTimeout(() => {
      selectedFeatureId = "";
      limitValue = null;
      isUnlimited = false;
      expiresAt = "";
      resetInterval = "monthly";
      reason = "";
      error = "";
    }, 300);
  }
</script>

<SidePanel
  open={isOpen}
  title="Grant Entitlement Override"
  onclose={close}
  width="max-w-md"
>
  <div class="text-sm flex flex-col h-full justify-between">
    <div class="p-5 space-y-6">
      <div class="bg-accent/10 border border-accent/20 rounded-lg p-4 flex gap-3">
        <ShieldCheck size={18} class="text-accent shrink-0" weight="duotone" />
        <div class="space-y-1">
          <p class="text-xs font-bold text-accent uppercase tracking-widest">Manual Override</p>
          <p class="text-[11px] text-text-dim leading-relaxed">
            This override will take precedence over the customer's current plan and will persist even if they switch plans.
          </p>
        </div>
      </div>

      <!-- Feature Selection -->
      <div>
        <label class="block text-xs font-medium text-text-dim mb-1.5" for="featureSelect">
          Select Feature <span class="text-error">*</span>
        </label>
        <div class="relative">
          <select
            id="featureSelect"
            bind:value={selectedFeatureId}
            class="input appearance-none pr-10"
            disabled={isLoadingFeatures}
          >
            <option value="" disabled>Choose a feature...</option>
            {#each features as feature}
              <option value={feature.id}>{feature.name} ({feature.slug})</option>
            {/each}
          </select>
          <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-dim">
            <CaretDown size={14} />
          </div>
        </div>
      </div>

      {#if selectedFeature?.type === "metered" || selectedFeature?.type === "static"}
        <!-- Limit Value -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <label
              class="block text-xs font-medium text-text-dim"
              for="limitValue"
            >
              {selectedFeature.type === "static" ? "Value" : "Usage Limit"}
            </label>
            {#if selectedFeature.type === "metered"}
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  bind:checked={isUnlimited}
                  class="checkbox"
                />
                <span
                  class="text-[11px] text-text-dim font-medium uppercase tracking-wider"
                  >Unlimited</span
                >
              </label>
            {/if}
          </div>

          {#if !isUnlimited || selectedFeature.type === "static"}
            <div class="input-icon-wrapper">
              <input
                type="number"
                id="limitValue"
                bind:value={limitValue}
                placeholder={selectedFeature.type === "static"
                  ? "Value"
                  : "eg. 1000"}
                class="input"
                min="0"
              />
            </div>
          {/if}
        </div>

        {#if selectedFeature.type === "metered"}
          <!-- Reset Interval -->
          <div>
            <label
              class="block text-xs font-medium text-text-dim mb-1.5"
              for="resetInterval"
            >
              Reset Interval
            </label>
            <select id="resetInterval" bind:value={resetInterval} class="input">
              <option value="never">Never</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
        {/if}
      {:else if selectedFeature?.type === "boolean"}
        <div class="bg-bg-secondary p-3 rounded-md border border-border">
          <p class="text-[11px] text-text-dim italic">
            This is a boolean feature. Granting this override will enable the feature indefinitely (or until the expiration date below).
          </p>
        </div>
      {/if}

      <!-- Expiration -->
      <div>
        <label class="block text-xs font-medium text-text-dim mb-1.5" for="expiresAt">
          Expiration (optional)
        </label>
        <div class="input-icon-wrapper">
          <Calendar size={14} class="input-icon-left" weight="duotone" />
          <input
            type="date"
            id="expiresAt"
            bind:value={expiresAt}
            class="input input-has-icon-left"
          />
        </div>
        <p class="text-[10px] text-text-dim mt-1">
          When this override should automatically expire. Leave blank for indefinite.
        </p>
      </div>

      <!-- Reason -->
      <div>
        <label class="block text-xs font-medium text-text-dim mb-1.5" for="reason">
          Reason for Override
        </label>
        <div class="input-icon-wrapper">
          <Note size={14} class="input-icon-left mt-2.5" weight="duotone" />
          <textarea
            id="reason"
            bind:value={reason}
            placeholder="eg. Early adopter beta access"
            class="input input-has-icon-left min-h-[80px] py-2"
          ></textarea>
        </div>
      </div>

      {#if error}
        <div class="flex items-center gap-2 text-error text-[11px] py-2 bg-error/10 px-3 rounded-md border border-error/20">
          <WarningCircle size={14} />
          {error}
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div class="p-5 border-t border-border flex items-center justify-end gap-3 sticky bottom-0 bg-bg-card">
      <button
        class="px-4 py-2 text-xs font-bold text-text-dim hover:text-text-primary transition-colors uppercase tracking-widest"
        onclick={close}
      >
        Cancel
      </button>
      <button
        class="px-6 py-2 bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-bold rounded-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest"
        onclick={handleSubmit}
        disabled={!selectedFeatureId || isSubmitting}
      >
        {#if isSubmitting}
          <CircleNotchIcon size={12} class="animate-spin" />
          Granting...
        {:else}
          <PlusIcon size={12} weight="bold" />
          Grant Override
        {/if}
      </button>
    </div>
  </div>
</SidePanel>
