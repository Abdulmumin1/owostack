<script lang="ts">
  import {
    Bell,
    Calendar,
    CircleNotch,
    CreditCard,
    FileText,
    FloppyDisk,
  } from "phosphor-svelte";
  import { apiFetch } from "$lib/auth-client";
  import type { OverageSettings } from "./types";

  let {
    projectId,
    initialSettings = {
      billingMode: "end_of_period",
      thresholdEnabled: false,
      thresholdAmount: null,
      autoCollect: false,
      gracePeriodHours: 0,
    },
  }: {
    projectId: string;
    initialSettings?: OverageSettings;
  } = $props();

  let thresholdEnabled = $state(false);
  let overageThresholdAmount = $state<number | null>(null);
  let overageAutoCollect = $state(false);
  let isSavingOverage = $state(false);
  let overageError = $state<string | null>(null);

  const thresholdConfigInvalid = $derived(
    thresholdEnabled &&
      (!overageThresholdAmount || overageThresholdAmount <= 0),
  );

  $effect(() => {
    thresholdEnabled = initialSettings.thresholdEnabled;
    overageThresholdAmount = initialSettings.thresholdAmount;
    overageAutoCollect = initialSettings.autoCollect;
    overageError = null;
  });

  $effect(() => {
    if (thresholdEnabled) {
      overageAutoCollect = true;
    }
  });

  async function save() {
    overageError = null;

    if (thresholdEnabled) {
      if (!overageThresholdAmount || overageThresholdAmount <= 0) {
        overageError =
          "Threshold collection requires a positive threshold amount.";
        return;
      }

      overageAutoCollect = true;
    }

    isSavingOverage = true;
    try {
      await apiFetch(`/api/dashboard/overage-settings`, {
        method: "PUT",
        body: JSON.stringify({
          organizationId: projectId,
          billingMode: "end_of_period",
          thresholdEnabled,
          thresholdAmount: thresholdEnabled ? overageThresholdAmount : null,
          autoCollect: overageAutoCollect,
          gracePeriodHours: 0,
        }),
      });
    } catch (e) {
      overageError =
        e instanceof Error
          ? e.message
          : "Failed to save overage settings.";
      console.error(e);
    } finally {
      isSavingOverage = false;
    }
  }

  const thresholdOptions = [
    {
      value: false,
      label: "Disabled",
      desc: "Only bill remaining overage at period end",
      icon: Calendar,
    },
    {
      value: true,
      label: "Enabled",
      desc: "Collect overage early once it reaches a threshold",
      icon: Bell,
    },
  ] satisfies Array<{
    value: boolean;
    label: string;
    desc: string;
    icon: typeof Calendar;
  }>;
</script>

<div class="space-y-6">
  <div class="bg-bg-secondary border border-accent/20 rounded-lg p-4">
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-start gap-3">
        <div
          class="w-9 h-9 rounded-full bg-bg-card border border-border flex items-center justify-center shrink-0"
        >
          <Calendar size={16} class="text-accent" weight="duotone" />
        </div>
        <div class="space-y-1">
          <h3 class="text-sm font-bold text-text-primary">
            End-of-Period True-Up
          </h3>
          <p class="text-[11px] text-text-dim max-w-[32rem]">
            Always enabled. Any overage not already collected mid-cycle is
            invoiced when the subscription period renews.
          </p>
        </div>
      </div>
      <span
        class="inline-flex items-center px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest border border-accent/20 bg-accent/10 text-accent"
      >
        Standard
      </span>
    </div>
  </div>

  <div>
    <h3 class="text-xs font-medium text-text-dim mb-2">
      Threshold Collection
    </h3>
    <p class="text-[11px] text-text-dim mb-3">
      Optionally collect part of the same overage balance before period end.
      This reduces credit exposure but does not replace the final period-end
      invoice.
    </p>
    <div
      class="grid grid-cols-2 gap-2"
      role="group"
      aria-label="Threshold collection selection"
    >
      {#each thresholdOptions as option (option.label)}
        {@const Icon = option.icon}
        <button
          onclick={() => (thresholdEnabled = option.value)}
          class="relative border rounded-lg p-3 text-left transition-all {thresholdEnabled === option.value ? 'border-accent bg-accent/5' : 'border-border bg-bg-secondary hover:border-text-dim'}"
        >
          <div
            class="mb-2 w-7 h-7 rounded-full bg-bg-card border border-border flex items-center justify-center"
          >
            <Icon
              size={14}
              class={thresholdEnabled === option.value
                ? "text-accent"
                : "text-text-dim"}
              weight="duotone"
            />
          </div>
          <div class="font-bold text-sm text-text-primary">{option.label}</div>
          <div class="text-[10px] text-text-dim mt-0.5">{option.desc}</div>
          {#if thresholdEnabled === option.value}
            <div class="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent">
            </div>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  {#if thresholdEnabled}
    <div class="bg-bg-secondary border border-border rounded-lg p-4">
      <label
        for="thresholdAmount"
        class="block text-xs font-medium text-text-dim mb-2"
      >
        Threshold Amount
      </label>
      <input
        type="number"
        id="thresholdAmount"
        bind:value={overageThresholdAmount}
        placeholder="e.g. 5000"
        class="input w-full"
      />
      <p class="text-[10px] text-text-dim mt-2">
        Enter the smallest currency unit for your billing currency, for
        example 5000 = 50.00. Once estimated unbilled overage reaches this
        amount, the system will collect an early overage slice and still true
        up the remainder at period end.
      </p>
    </div>
  {/if}

  <div>
    <h3 class="text-xs font-medium text-text-dim mb-3">Collection Method</h3>
    <div class="grid grid-cols-2 gap-2">
      <button
        onclick={() => {
          if (!thresholdEnabled) overageAutoCollect = false;
        }}
        disabled={thresholdEnabled}
        class="relative border rounded-lg p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 {thresholdEnabled ? 'border-border bg-bg-secondary' : !overageAutoCollect ? 'border-accent bg-accent/5' : 'border-border bg-bg-secondary hover:border-text-dim'}"
      >
        <div
          class="mb-2 w-7 h-7 rounded-full bg-bg-card border border-border flex items-center justify-center"
        >
          <FileText
            size={14}
            class={thresholdEnabled
              ? "text-text-dim"
              : !overageAutoCollect
                ? "text-accent"
                : "text-text-dim"}
            weight="duotone"
          />
        </div>
        <div class="font-bold text-sm text-text-primary">Manual Invoice</div>
        <div class="text-[10px] text-text-dim mt-0.5">
          {thresholdEnabled
            ? "Unavailable while threshold collection is enabled"
            : "Leave the period-end invoice open for manual collection"}
        </div>
        {#if !overageAutoCollect && !thresholdEnabled}
          <div class="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent">
          </div>
        {/if}
      </button>

      <button
        onclick={() => (overageAutoCollect = true)}
        class="relative border rounded-lg p-3 text-left transition-all {overageAutoCollect ? 'border-accent bg-accent/5' : 'border-border bg-bg-secondary hover:border-text-dim'}"
      >
        <div
          class="mb-2 w-7 h-7 rounded-full bg-bg-card border border-border flex items-center justify-center"
        >
          <CreditCard
            size={14}
            class={overageAutoCollect ? "text-accent" : "text-text-dim"}
            weight="duotone"
          />
        </div>
        <div class="font-bold text-sm text-text-primary">Auto-Charge</div>
        <div class="text-[10px] text-text-dim mt-0.5">
          Charge the saved payment method for overage invoices
        </div>
        {#if overageAutoCollect}
          <div class="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent">
          </div>
        {/if}
      </button>
    </div>
    <p class="mt-2 text-[10px] text-text-dim">
      {thresholdEnabled
        ? "Threshold collection requires auto-charge. Any remaining overage is still settled at period end."
        : "This method applies to the final period-end overage invoice."}
    </p>
  </div>

  {#if overageError}
    <div
      class="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger"
    >
      {overageError}
    </div>
  {/if}

  <div class="pt-4 flex justify-end">
    <button
      class="btn btn-primary btn-sm flex items-center gap-1.5 text-xs"
      onclick={save}
      disabled={isSavingOverage || thresholdConfigInvalid}
    >
      {#if isSavingOverage}
        <CircleNotch size={14} class="animate-spin" weight="duotone" />
        Saving...
      {:else}
        <FloppyDisk size={14} weight="fill" />
        Save Settings
      {/if}
    </button>
  </div>
</div>
