<script lang="ts">
  import { Result } from "better-result";
  import { apiFetch } from "$lib/auth-client";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import { Check, CircleNotch, FloppyDisk } from "phosphor-svelte";

  let { 
    isOpen = $bindable(false), 
    feature = $bindable(null),
    onclose = () => {}, 
    onsuccess = (data?: any) => {} 
  }: {
    isOpen: boolean;
    feature: any;
    onclose?: () => void;
    onsuccess?: (data?: any) => void;
  } = $props();

  let name = $state("");
  let description = $state("");
  let unit = $state("");
  let isSaving = $state(false);
  let error = $state("");

  $effect(() => {
    if (isOpen && feature) {
      name = feature.name;
      description = feature.description || "";
      unit = feature.unit || "";
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

    isSaving = true;
    error = "";

    const result = await Result.tryPromise(async () => {
      const res = await apiFetch(`/api/dashboard/features/${feature.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          description: description || undefined,
          unit: unit || undefined,
        }),
      });

      if (res.error) {
        throw new Error(res.error.message || "Failed to update feature");
      }

      if (res.data?.success === false) {
        throw new Error(res.data?.error || "Failed to update feature");
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

<SidePanel open={isOpen} title="Edit Feature" onclose={close} width="max-w-md">
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
            for="edit-feature-name"
            class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
          >
            Name
          </label>
          <input
            type="text"
            id="edit-feature-name"
            bind:value={name}
            class="input"
            placeholder="e.g. API Requests"
          />
        </div>

        <!-- Description -->
        <div>
          <label
            for="edit-feature-desc"
            class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
          >
            Description
          </label>
          <input
            type="text"
            id="edit-feature-desc"
            bind:value={description}
            class="input"
            placeholder="Optional description"
          />
        </div>

        <!-- Type (Read-only) -->
        <div>
          <label class="block text-xs font-bold text-text-dim uppercase tracking-widest mb-2">
            Type
          </label>
          <div class="px-3 py-2 bg-bg-secondary border border-border rounded text-xs text-text-dim capitalize">
            {feature?.type} {#if feature?.meterType}({feature.meterType}){/if}
          </div>
          <p class="mt-1.5 text-[10px] text-text-dim">Feature type cannot be changed after creation.</p>
        </div>

        {#if feature?.type === 'metered'}
          <!-- Unit -->
          <div>
            <label
              for="edit-feature-unit"
              class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
            >
              Unit Name
            </label>
            <input
              type="text"
              id="edit-feature-unit"
              bind:value={unit}
              class="input"
              placeholder="e.g. request, user, gb"
            />
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
        class="bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-bold px-6 py-2 rounded-md uppercase tracking-widest transition-all disabled:opacity-50 flex items-center gap-2"
        onclick={handleSubmit}
        disabled={!name || isSaving}
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
