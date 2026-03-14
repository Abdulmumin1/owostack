<script lang="ts">
  import { Check, CircleNotch, FloppyDisk } from "phosphor-svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import { defaultCurrency } from "$lib/stores/currency";
  import { COMMON_CURRENCIES } from "$lib/utils/currency";

  let {
    open = false,
    plan = null,
    isSaving = false,
    onClose = () => {},
    onSave = (_payload: Record<string, unknown>) => {},
  }: {
    open?: boolean;
    plan?: any;
    isSaving?: boolean;
    onClose?: () => void;
    onSave?: (payload: Record<string, unknown>) => void | Promise<void>;
  } = $props();

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
    if (open && plan) {
      editName = plan.name || "";
      editDescription = plan.description || "";
      editType = plan.type || "paid";
      editBillingType = plan.billingType || "recurring";
      editInterval = plan.interval || "monthly";
      editCurrency = plan.currency || $defaultCurrency;
      editPrice = typeof plan.price === "number" ? String(plan.price / 100) : "";
      editTrialDays = String(plan.trialDays || 0);
      editTrialUnit =
        (plan.metadata as any)?.trialUnit === "minutes" ? "minutes" : "days";
      editAutoEnable = Boolean(plan.autoEnable);
    }
  });

  $effect(() => {
    if (editBillingType === "one_time") {
      editInterval = "monthly";
      editTrialDays = "0";
      editTrialUnit = "days";
      editAutoEnable = false;
    }
  });

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();

    const payload: Record<string, unknown> = {
      name: editName.trim(),
      description: editDescription || null,
      type: editType,
      billingType: editBillingType,
      interval: editBillingType === "one_time" ? "monthly" : editInterval,
      currency: editCurrency,
      autoEnable: editBillingType === "one_time" ? false : editAutoEnable,
    };

    if (editType === "free") {
      payload.price = 0;
    } else {
      const parsedPrice = Number(editPrice);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
        alert("Enter a valid price.");
        return;
      }
      payload.price = Math.round(parsedPrice * 100);
    }

    if (editBillingType === "recurring") {
      const parsedTrialDays = Number(editTrialDays);
      if (Number.isFinite(parsedTrialDays) && parsedTrialDays > 0) {
        payload.trialDays = parsedTrialDays;
        payload.trialUnit = editTrialUnit;
      } else {
        payload.trialDays = 0;
      }
    } else {
      payload.trialDays = 0;
    }

    void onSave(payload);
  }
</script>

<SidePanel
  open={open && !!plan}
  title="Edit Plan"
  onclose={onClose}
  width="max-w-[450px]"
>
  <div class="text-sm h-full">
    <form onsubmit={handleSubmit} class="flex flex-col h-full">
      <div class="p-6 space-y-5 flex-1 overflow-y-auto">
        <div>
          <label for="editName" class="label">Name</label>
          <div class="input-icon-wrapper">
            <input id="editName" class="input" type="text" bind:value={editName} />
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
              <select id="editType" class="input" bind:value={editType}>
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
            <select id="editCurrency" class="input" bind:value={editCurrency}>
              {#each COMMON_CURRENCIES as currency}
                <option value={currency.code}>{currency.code}</option>
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

        {#if editBillingType === "recurring"}
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
        {/if}

        {#if editBillingType === "recurring"}
          <div class="space-y-2 pt-2 border-t border-border-light">
            <div class="flex items-center gap-3">
            <label
                for="editAutoEnable"
                class="text-sm flex gap-2 items-center font-medium text-text-primary cursor-pointer group select-none"
              >
              <input
                id="editAutoEnable"
                type="checkbox"
                bind:checked={editAutoEnable}
                class="hidden"
              />
               <div
                class="relative w-4 h-4 rounded border flex items-center justify-center transition-colors {editAutoEnable
                  ? 'bg-accent border-accent'
                  : 'border-border group-hover:border-text-dim'}"
              >
                {#if editAutoEnable}
                  <Check size={10} class="text-accent-contrast" weight="fill" />
                {/if}
              </div>
              
                Auto-enable plan
              </label>
            </div>
            <p class="text-xs text-text-muted ml-7">
              This plan will be enabled automatically for new customers.<br />
              {editType === "free"
                ? "Subscription will be active immediately."
                : "Subscription will be pending until payment."}
            </p>
          </div>
        {/if}
      </div>

      <div
        class="p-5 border-t border-border bg-bg-card flex justify-end gap-3 sticky bottom-0 mt-auto z-10"
      >
        <button type="button" class="btn btn-secondary px-6" onclick={onClose}>
          Cancel
        </button>
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
