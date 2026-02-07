<script lang="ts">
  import { Result } from "better-result";
  import { apiFetch } from "$lib/auth-client";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import { Loader2, Check } from "lucide-svelte";

  let { 
    isOpen = $bindable(false), 
    organizationId,
    onclose = () => {}, 
    onsuccess = (data?: any) => {} 
  } = $props();

  let name = $state("");
  let description = $state("");
  let slug = $state("");
  let type = $state<"metered" | "boolean" | "static">("metered");
  let meterType = $state<"consumable" | "non_consumable">("consumable");
  let unit = $state("");
  let isCreating = $state(false);
  let error = $state("");

  // Auto-generate ID from name
  $effect(() => {
    if (name && !slug) {
      slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    }
  });

  function close() {
    isOpen = false;
    onclose?.();
  }

  async function handleSubmit() {
    if (!name) {
      error = "Name is required";
      return;
    }

    isCreating = true;
    error = "";

    const result = await Result.tryPromise(async () => {
      const res = await apiFetch("/api/dashboard/features", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          name,
          slug,
          description,
          type,
          meterType: type === "metered" ? meterType : undefined,
          unit: type === "metered" ? unit : undefined,
        }),
      });

      if (res.error) {
        throw new Error(res.error.message || "Failed to create feature");
      }

      if (res.data?.success === false) {
        throw new Error(res.data?.error || "Failed to create feature");
      }

      return res.data?.data;
    });

    if (result.isErr()) {
      error = result.error.message;
      isCreating = false;
      return;
    }

    isCreating = false;
    onsuccess?.(result.value);
    close();
  }
</script>

<SidePanel open={isOpen} title="Create Feature" onclose={close} width="max-w-md">
  <div class="text-sm">
    <div class="p-5 space-y-6">
      {#if error}
        <div class="bg-red-500/10 p-4 border border-red-500/20">
          <p class="text-xs font-medium text-red-500">{error}</p>
        </div>
      {/if}

      <div class="space-y-5">
        <!-- Name -->
        <div>
          <label
            for="name"
            class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
          >
            Name
          </label>
          <div class="input-icon-wrapper">
            <input
              type="text"
              id="name"
              bind:value={name}
              class="input"
              placeholder="e.g. API Requests"
            />
          </div>
        </div>

        <!-- Type -->
        <div>
          <label
            for="type"
            class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
          >
            Type
          </label>
          <div class="grid grid-cols-3 gap-2">
            {#each [
              { value: 'metered', label: 'Metered' },
              { value: 'boolean', label: 'Boolean' },
              { value: 'static', label: 'Static' }
            ] as opt}
              <button
                type="button"
                class="py-2.5 text-[10px] font-bold uppercase tracking-widest border transition-all {type === opt.value ? 'bg-lime-600 text-lime-600-contrast border-lime-600' : 'bg-bg-card text-text-dim border-border hover:border-border-light hover:text-white'}"
                onclick={() => (type = opt.value as typeof type)}
              >
                {opt.label}
              </button>
            {/each}
          </div>
          <p class="mt-2 text-[10px] text-text-dim uppercase tracking-tight">
            {#if type === "metered"}
              Counted usage (e.g. API calls, Seats).
            {:else if type === "boolean"}
              Binary access (e.g. SSO).
            {:else}
              Fixed value properties (e.g. Region).
            {/if}
          </p>
        </div>

        {#if type === "metered"}
          <!-- Meter Type -->
          <div>
            <label
              for="meterType"
              class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
            >
              Meter Type
            </label>
            <div class="grid grid-cols-2 gap-2">
              {#each [
                { value: 'consumable', label: 'Consumable' },
                { value: 'non_consumable', label: 'Non-Consumable' }
              ] as opt}
                <button
                  type="button"
                  class="py-2.5 text-[10px] font-bold uppercase tracking-widest border transition-all {meterType === opt.value ? 'bg-lime-600 text-lime-600-contrast border-lime-600' : 'bg-bg-card text-text-dim border-border hover:border-border-light hover:text-white'}"
                  onclick={() => (meterType = opt.value as typeof meterType)}
                >
                  {opt.label}
                </button>
              {/each}
            </div>
            <p class="mt-2 text-[10px] text-text-dim uppercase tracking-tight">
              {#if meterType === "consumable"}
                Usage resets or accumulates (e.g. Credits).
              {:else}
                Usage is persistent state (e.g. Seats, Storage).
              {/if}
            </p>
          </div>

          <!-- Unit -->
          <div>
            <label
              for="unit"
              class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
            >
              Unit Name
            </label>
            <div class="input-icon-wrapper">
              <input
                type="text"
                id="unit"
                bind:value={unit}
                class="input"
                placeholder="e.g. request, user, gb"
              />
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Footer -->
    <div class="p-5 border-t border-border flex items-center justify-end gap-3 sticky bottom-0 bg-bg-card">
      <button
        class="px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white transition-colors uppercase tracking-widest"
        onclick={close}
      >
        Cancel
      </button>
      <button
        class="px-6 py-2 bg-accent hover:bg-accent-hover text-black text-xs font-bold rounded-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest"
        onclick={handleSubmit}
        disabled={!name || isCreating}
      >
        {#if isCreating}
          <Loader2 size={14} class="animate-spin" />
          Creating...
        {:else}
          <Check size={14} />
          Create Feature
        {/if}
      </button>
    </div>
  </div>
</SidePanel>
