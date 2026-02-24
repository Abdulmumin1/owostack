<script lang="ts">
  import { CircleNotch, FloppyDisk } from "phosphor-svelte";
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
</script>

<h2 class="text-lg font-bold text-text-primary mb-6">Overage Billing</h2>

<div class="space-y-8">
  <div>
    <h3 class="block text-xs font-bold text-text-dim uppercase tracking-widest mb-3">Billing Interval</h3>
    <div class="grid grid-cols-2 gap-3" role="group" aria-label="Billing Interval Selection">
      {#each [
        { value: "end_of_period", label: "End of Period", desc: "Bill when subscription renews" },
        { value: "monthly", label: "Monthly", desc: "Bill on the 1st of month" },
        { value: "threshold", label: "Threshold", desc: "Bill when limit reached" },
      ] as option (option.value)}
        <button
          onclick={() => (overageBillingInterval = option.value)}
          class="p-4 border rounded text-left transition-all {overageBillingInterval === option.value ? 'border-accent bg-accent/5' : 'border-border hover:border-text-dim'}"
        >
          <div class="text-[10px] font-bold uppercase tracking-widest mb-1 {overageBillingInterval === option.value ? 'text-accent' : 'text-text-dim'}">{option.label}</div>
          <div class="text-[9px] text-text-dim/60">{option.desc}</div>
        </button>
      {/each}
    </div>
  </div>

  {#if overageBillingInterval === "threshold"}
    <div>
      <label for="thresholdAmount" class="block text-xs font-bold text-text-dim uppercase tracking-widest mb-2">Threshold Amount (Minor Units)</label>
      <input type="number" id="thresholdAmount" bind:value={overageThresholdAmount} placeholder="e.g. 50000" class="input w-full" />
    </div>
  {/if}

  <div>
    <h3 class="block text-xs font-bold text-text-dim uppercase tracking-widest mb-3">Collection Method</h3>
    <div class="flex gap-3" role="group" aria-label="Collection Method Selection">
      <button onclick={() => overageAutoCollect = false} class="flex-1 p-3 border rounded text-[10px] font-bold uppercase tracking-widest {!overageAutoCollect ? 'border-accent bg-accent/5 text-accent' : 'border-border text-text-dim'}">Manual Invoice</button>
      <button onclick={() => overageAutoCollect = true} class="flex-1 p-3 border rounded text-[10px] font-bold uppercase tracking-widest {overageAutoCollect ? 'border-accent bg-accent/5 text-accent' : 'border-border text-text-dim'}">Auto-Charge Card</button>
    </div>
  </div>

  <div class="pt-6 border-t border-border flex justify-end">
    <button class="btn btn-primary flex items-center gap-2" onclick={save} disabled={isSavingOverage}>
      {#if isSavingOverage} <CircleNotch size={16} class="animate-spin" weight="duotone" /> Saving... {:else} <FloppyDisk size={16} weight="fill" /> Save Settings {/if}
    </button>
  </div>
</div>
