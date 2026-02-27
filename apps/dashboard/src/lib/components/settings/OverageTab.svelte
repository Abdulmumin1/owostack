<script lang="ts">
  import { CircleNotch, FloppyDisk, Calendar, Clock, Bell, CreditCard, FileText } from "phosphor-svelte";
  import { apiFetch } from "$lib/auth-client";

  let { 
    projectId,
    initialSettings = {
      billingInterval: "end_of_period",
      thresholdAmount: null,
      autoCollect: false,
      gracePeriodHours: 0
    }
  }: {
    projectId: string;
    initialSettings?: {
      billingInterval: string;
      thresholdAmount: number | null;
      autoCollect: boolean;
      gracePeriodHours: number;
    };
  } = $props();

  let overageBillingInterval = $state(initialSettings.billingInterval);
  let overageThresholdAmount = $state<number | null>(initialSettings.thresholdAmount);
  let overageAutoCollect = $state(initialSettings.autoCollect);
  let isSavingOverage = $state(false);

  async function save() {
    isSavingOverage = true;
    try {
      await apiFetch(`/api/dashboard/overage-settings`, {
        method: "PUT",
        body: JSON.stringify({
          organizationId: projectId,
          billingInterval: overageBillingInterval,
          thresholdAmount: overageBillingInterval === "threshold" ? overageThresholdAmount : null,
          autoCollect: overageAutoCollect,
          gracePeriodHours: 0,
        }),
      });
    } catch (e) { console.error(e); } finally { isSavingOverage = false; }
  }

  const billingOptions = [
    { value: "end_of_period", label: "End of Period", desc: "Bill when subscription renews", icon: Calendar },
    { value: "monthly", label: "Monthly", desc: "Bill on the 1st of month", icon: Clock },
    { value: "threshold", label: "Threshold", desc: "Bill when limit reached", icon: Bell },
  ];
</script>

<h2 class="text-base font-bold text-text-primary mb-5">Overage Billing</h2>

<div class="space-y-6 ">
  <!-- Billing Interval -->
  <div>
    <h3 class="text-xs font-medium text-text-dim mb-3">Billing Interval</h3>
    <div class="grid grid-cols-3 gap-2" role="group" aria-label="Billing Interval Selection">
      {#each billingOptions as option (option.value)}
        {@const Icon = option.icon}
        <button
          onclick={() => (overageBillingInterval = option.value)}
          class="relative border rounded-lg p-3 text-left transition-all {overageBillingInterval === option.value ? 'border-accent bg-accent/5' : 'border-border bg-bg-secondary hover:border-text-dim'}"
        >
          <div class="mb-2 w-7 h-7 rounded-full bg-bg-card border border-border flex items-center justify-center">
            <Icon size={14} class={overageBillingInterval === option.value ? "text-accent" : "text-text-dim"} weight="duotone" />
          </div>
          <div class="font-bold text-sm text-text-primary">{option.label}</div>
          <div class="text-[10px] text-text-dim mt-0.5">{option.desc}</div>
          {#if overageBillingInterval === option.value}
            <div class="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent"></div>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <!-- Threshold Amount (conditional) -->
  {#if overageBillingInterval === "threshold"}
    <div class="bg-bg-secondary border border-border rounded-lg p-4">
      <label for="thresholdAmount" class="block text-xs font-medium text-text-dim mb-2">Threshold Amount (Minor Units)</label>
      <input 
        type="number" 
        id="thresholdAmount" 
        bind:value={overageThresholdAmount} 
        placeholder="e.g. 50000" 
        class="input w-full" 
      />
      <p class="text-[10px] text-text-dim mt-2">Overage will be billed when usage reaches this amount</p>
    </div>
  {/if}

  <!-- Collection Method -->
  <div>
    <h3 class="text-xs font-medium text-text-dim mb-3">Collection Method</h3>
    <div class="grid grid-cols-2 gap-2">
      <button 
        onclick={() => overageAutoCollect = false} 
        class="relative border rounded-lg p-3 text-left transition-all {!overageAutoCollect ? 'border-accent bg-accent/5' : 'border-border bg-bg-secondary hover:border-text-dim'}"
      >
        <div class="mb-2 w-7 h-7 rounded-full bg-bg-card border border-border flex items-center justify-center">
          <FileText size={14} class={!overageAutoCollect ? "text-accent" : "text-text-dim"} weight="duotone" />
        </div>
        <div class="font-bold text-sm text-text-primary">Manual Invoice</div>
        <div class="text-[10px] text-text-dim mt-0.5">Send invoice for overage</div>
        {#if !overageAutoCollect}
          <div class="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent"></div>
        {/if}
      </button>
      
      <button 
        onclick={() => overageAutoCollect = true} 
        class="relative border rounded-lg p-3 text-left transition-all {overageAutoCollect ? 'border-accent bg-accent/5' : 'border-border bg-bg-secondary hover:border-text-dim'}"
      >
        <div class="mb-2 w-7 h-7 rounded-full bg-bg-card border border-border flex items-center justify-center">
          <CreditCard size={14} class={overageAutoCollect ? "text-accent" : "text-text-dim"} weight="duotone" />
        </div>
        <div class="font-bold text-sm text-text-primary">Auto-Charge</div>
        <div class="text-[10px] text-text-dim mt-0.5">Automatically charge card</div>
        {#if overageAutoCollect}
          <div class="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent"></div>
        {/if}
      </button>
    </div>
  </div>

  <!-- Save Button -->
  <div class="pt-4 flex justify-end">
    <button 
      class="btn btn-primary btn-sm flex items-center gap-1.5 text-xs" 
      onclick={save} 
      disabled={isSavingOverage}
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
