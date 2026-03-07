<script lang="ts">
  import { Result } from "better-result";
  import { apiFetch } from "$lib/auth-client";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import { Check, CircleNotch } from "phosphor-svelte";

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
  <div class="text-sm h-full flex flex-col">
    <div class="p-5 space-y-6 flex-1">
      {#if error}
        <div class="bg-error-bg p-4 border border-error rounded">
          <p class="text-xs font-medium text-error">{error}</p>
        </div>
      {/if}

      <div class="space-y-5">
        <!-- Name -->
        <div>
          <label
            for="name"
            class="block text-[11px] font-bold text-text-dim uppercase tracking-wider mb-2.5 px-1"
          >
            Name
          </label>
          <div class="input-icon-wrapper">
            <input
              type="text"
              id="name"
              bind:value={name}
              class="input !h-10"
              placeholder="e.g. API Requests"
            />
          </div>
        </div>

        <!-- Type -->
        <div class="space-y-2.5">
          <label
            for="type"
            class="block text-[11px] font-bold text-text-dim uppercase tracking-wider px-1"
          >
            Type
          </label>
          <div class="flex p-1 bg-bg-card border border-border rounded-lg">
            {#each [
              { value: 'metered', label: 'Metered' },
              { value: 'boolean', label: 'Boolean' },
              { value: 'static', label: 'Static' }
            ] as opt}
              <button
                type="button"
                class="flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all flex items-center justify-center gap-1.5 {type === opt.value
                  ? 'bg-accent text-accent-contrast'
                  : 'text-text-muted hover:text-text-primary'}"
                onclick={() => (type = opt.value as typeof type)}
              >
                {opt.label}
              </button>
            {/each}
          </div>
          <p class="mt-2 text-[10px] text-text-dim uppercase tracking-tight px-1 leading-relaxed">
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
          <div class="space-y-2.5">
            <label
              for="meterType"
              class="block text-[11px] font-bold text-text-dim uppercase tracking-wider px-1"
            >
              Meter Type
            </label>
          <div class="flex p-1 bg-bg-card border border-border rounded-lg">
            {#each [
              { value: 'consumable', label: 'Consumable' },
              { value: 'non_consumable', label: 'Non-Consumable' }
            ] as opt}
              <button
                type="button"
                class="flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all flex items-center justify-center gap-1.5 {meterType === opt.value
                  ? 'bg-accent text-accent-contrast'
                  : 'text-text-muted hover:text-text-primary'}"
                onclick={() => (meterType = opt.value as typeof meterType)}
              >
                {opt.label}
              </button>
            {/each}
          </div>
            <p class="mt-2 text-[10px] text-text-dim uppercase tracking-tight px-1 leading-relaxed">
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
              class="block text-[11px] font-bold text-text-dim uppercase tracking-wider mb-2.5 px-1"
            >
              Unit Name
            </label>
            <div class="input-icon-wrapper">
              <input
                type="text"
                id="unit"
                bind:value={unit}
                class="input !h-10"
                placeholder="e.g. request, user, gb"
              />
            </div>
          </div>
        {/if}
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
        class="btn btn-primary"
        onclick={handleSubmit}
        disabled={!name || isCreating}
      >
        {#if isCreating}
          <CircleNotch   size={14} class="animate-spin"  weight="duotone" />
          Creating...
        {:else}
          <Check   size={14}  weight="fill" />
          Create Feature
        {/if}
      </button>
    </div>
  </div>
</SidePanel>
