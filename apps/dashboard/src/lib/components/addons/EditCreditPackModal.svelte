<script lang="ts">
  import { Result } from "better-result";
  import { apiFetch } from "$lib/auth-client";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import { Check, CircleNotch, FloppyDisk } from "phosphor-svelte";
  import { formatCurrency, COMMON_CURRENCIES } from "$lib/utils/currency";

  let { 
    isOpen = $bindable(false), 
    pack = $bindable(null),
    onclose = () => {}, 
    onsuccess = (data?: any) => {} 
  }: {
    isOpen: boolean;
    pack: any;
    onclose?: () => void;
    onsuccess?: (data?: any) => void;
  } = $props();

  let name = $state("");
  let description = $state("");
  let credits = $state(0);
  let price = $state(0);
  let currency = $state("USD");
  let isSaving = $state(false);
  let error = $state("");

  $effect(() => {
    if (isOpen && pack) {
      name = pack.name;
      description = pack.description || "";
      credits = pack.credits;
      price = pack.price;
      currency = pack.currency;
    }
  });

  function close() {
    isOpen = false;
    error = "";
    onclose?.();
  }

  async function handleSubmit() {
    if (!name) {
      error = "Name is required";
      return;
    }
    if (credits < 1) {
      error = "Credits must be at least 1";
      return;
    }

    isSaving = true;
    error = "";

    const result = await Result.tryPromise(async () => {
      const res = await apiFetch(`/api/dashboard/credit-packs/${pack.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          description: description || undefined,
          credits,
          price,
          currency,
        }),
      });

      if (res.error) {
        throw new Error(res.error.message || "Failed to update credit pack");
      }

      if (res.data?.success === false) {
        throw new Error(res.data?.error || "Failed to update credit pack");
      }

      return res.data?.data;
    });

    if (result.isErr()) {
      error = result.error.message;
      isSaving = false;
      return;
    }

    isSaving = false;
    onsuccess?.(result.value);
    close();
  }
</script>

<SidePanel open={isOpen} title="Edit Credit Pack" onclose={close} width="max-w-md">
  <div class="text-sm h-full flex flex-col">
    <div class="p-5 space-y-6 flex-1">
      {#if error}
        <div class="bg-error-bg p-4 border border-error rounded text-xs text-error font-medium">
          {error}
        </div>
      {/if}

      <div class="space-y-5">
        <!-- Name -->
        <div>
          <label
            for="edit-pack-name"
            class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
          >
            Name
          </label>
          <input
            type="text"
            id="edit-pack-name"
            bind:value={name}
            class="input"
            placeholder="e.g. 50 Extra Credits"
          />
        </div>

        <!-- Description -->
        <div>
          <label
            for="edit-pack-desc"
            class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
          >
            Description
          </label>
          <input
            type="text"
            id="edit-pack-desc"
            bind:value={description}
            class="input"
            placeholder="Optional description"
          />
        </div>

        <!-- Credits -->
        <div>
          <label
            for="edit-pack-credits"
            class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
          >
            Credits
          </label>
          <input
            type="number"
            id="edit-pack-credits"
            bind:value={credits}
            min="1"
            class="input"
          />
        </div>

        <!-- Price + Currency -->
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2">
            <label
              for="edit-pack-price"
              class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
            >
              Price ({currency} smallest unit)
            </label>
            <input
              type="number"
              id="edit-pack-price"
              bind:value={price}
              min="0"
              class="input"
            />
          </div>
          <div>
            <label
              for="edit-pack-currency"
              class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
            >
              Currency
            </label>
            <select
              id="edit-pack-currency"
              bind:value={currency}
              class="input"
            >
              {#each COMMON_CURRENCIES as c}
                <option value={c.code}>{c.code}</option>
              {/each}
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="p-5 border-t border-border flex items-center justify-end gap-3 sticky bottom-0 bg-bg-card mt-auto">
      <button
        class="px-4 py-2 text-xs font-bold text-text-dim hover:text-text-primary transition-colors uppercase tracking-widest"
        onclick={close}
      >
        Cancel
      </button>
      <button
        class="bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-bold px-6 py-2 rounded-md uppercase tracking-widest transition-all disabled:opacity-50 flex items-center gap-2"
        onclick={handleSubmit}
        disabled={!name || credits < 1 || isSaving}
      >
        {#if isSaving}
          <CircleNotch size={14} class="animate-spin" weight="duotone" />
          Saving...
        {:else}
          <FloppyDisk size={14} weight="fill" />
          Save Changes
        {/if}
      </button>
    </div>
  </div>
</SidePanel>
