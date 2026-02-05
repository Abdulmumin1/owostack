<script lang="ts">
  import { Result } from "better-result";
  import { apiFetch } from "$lib/auth-client";
  import { page } from "$app/stores";

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

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0">
    <!-- Backdrop -->
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
      onclick={close}
    ></div>

    <!-- Modal -->
    <div
      class="relative w-full max-w-lg transform overflow-hidden bg-bg-card border border-border shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition-all sm:my-8"
    >
      <!-- Header -->
      <div class="px-6 py-5 border-b border-border">
        <h3 class="text-xl font-bold text-text-primary">Create Feature</h3>
        <p class="mt-1 text-sm text-text-secondary">
          Define a feature that can be added to your plans.
        </p>
      </div>

      <!-- Body -->
      <div class="px-6 py-6 space-y-6">
        {#if error}
          <div class="bg-red-500/10 p-4 border border-red-500/20">
            <p class="text-sm font-medium text-red-500">{error}</p>
          </div>
        {/if}

        <div class="space-y-5">
          <!-- Name -->
          <div>
            <label
              for="name"
              class="block text-sm font-medium text-text-secondary mb-2"
            >
              Name
            </label>
            <input
              type="text"
              id="name"
              bind:value={name}
              class="input"
              placeholder="e.g. API Requests"
            />
          </div>

          <!-- Type -->
          <div>
            <label
              for="type"
              class="block text-sm font-medium text-text-secondary mb-2"
            >
              Type
            </label>
            <div class="grid grid-cols-3 gap-3">
              <button
                type="button"
                class="btn {type === 'metered'
                  ? 'btn-primary'
                  : 'btn-secondary'}"
                onclick={() => (type = "metered")}
              >
                Metered
              </button>
              <button
                type="button"
                class="btn {type === 'boolean'
                  ? 'btn-primary'
                  : 'btn-secondary'}"
                onclick={() => (type = "boolean")}
              >
                Boolean
              </button>
              <button
                type="button"
                class="btn {type === 'static'
                  ? 'btn-primary'
                  : 'btn-secondary'}"
                onclick={() => (type = "static")}
              >
                Static
              </button>
            </div>
            <p class="mt-2 text-xs text-text-dim">
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
                class="block text-sm font-medium text-text-secondary mb-2"
              >
                Meter Type
              </label>
              <div class="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  class="btn {meterType === 'consumable'
                    ? 'btn-primary'
                    : 'btn-secondary'}"
                  onclick={() => (meterType = "consumable")}
                >
                  Consumable
                </button>
                <button
                  type="button"
                  class="btn {meterType === 'non_consumable'
                    ? 'btn-primary'
                    : 'btn-secondary'}"
                  onclick={() => (meterType = "non_consumable")}
                >
                  Non-Consumable
                </button>
              </div>
              <p class="mt-2 text-xs text-text-dim">
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
                class="block text-sm font-medium text-text-secondary mb-2"
              >
                Unit Name
              </label>
              <input
                type="text"
                id="unit"
                bind:value={unit}
                class="input"
                placeholder="e.g. request, user, gb"
              />
            </div>
          {/if}
        </div>
      </div>

      <!-- Footer -->
      <div
        class="px-6 py-4 flex justify-end gap-3 border-t border-border bg-bg-secondary"
      >
        <button type="button" class="btn btn-ghost" onclick={close}>
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={isCreating}
          onclick={handleSubmit}
        >
          {#if isCreating}
            Creating...
          {:else}
            Create Feature
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
