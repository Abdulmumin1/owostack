<script lang="ts">
  import { Result } from "better-result";
  import { apiFetch } from "$lib/auth-client";
  import { fade, fly } from "svelte/transition";
  import { X, Plus, Trash2, Loader2, Coins, Check } from "lucide-svelte";

  let { 
    isOpen = $bindable(false), 
    organizationId,
    onclose = () => {}, 
    onsuccess = (data?: any) => {} 
  } = $props();

  let name = $state("");
  let description = $state("");
  let isCreating = $state(false);
  let error = $state("");
  
  let features = $state<any[]>([]);
  let selectedFeatures = $state<{featureId: string, cost: number}[]>([]);

  async function loadFeatures() {
    try {
      const res = await apiFetch(`/api/dashboard/features?organizationId=${organizationId}`);
      // Only metered features can be part of a credit system
      if (res.data?.success) {
        features = res.data.data.filter((f: any) => f.type === 'metered');
      }
    } catch (e) {
      console.error("Failed to load features", e);
    }
  }

  $effect(() => {
    if (isOpen) {
      loadFeatures();
      name = "";
      description = "";
      selectedFeatures = [];
      error = "";
    }
  });

  function addFeature() {
    if (features.length === 0) return;
    const firstUnselected = features.find(f => !selectedFeatures.some(sf => sf.featureId === f.id));
    if (firstUnselected) {
      selectedFeatures = [...selectedFeatures, { featureId: firstUnselected.id, cost: 1 }];
    }
  }

  function removeFeature(index: number) {
    selectedFeatures = selectedFeatures.filter((_, i) => i !== index);
  }

  function close() {
    isOpen = false;
    onclose?.();
  }

  async function handleSubmit() {
    if (!name) {
      error = "Name is required";
      return;
    }

    if (selectedFeatures.length === 0) {
      error = "At least one feature must be added to the credit system";
      return;
    }

    isCreating = true;
    error = "";

    const result = await Result.tryPromise(async () => {
      const res = await apiFetch("/api/dashboard/credits", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          name,
          description,
          features: selectedFeatures
        }),
      });

      if (res.error) {
        throw new Error(res.error.message || "Failed to create credit system");
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
    <div class="absolute inset-0 bg-black/80 backdrop-blur-sm" transition:fade onclick={close}></div>

    <div
      class="relative w-full max-w-lg bg-[#0A0A0A] border border-border shadow-2xl rounded-xl overflow-hidden"
      transition:fly={{ y: 20 }}
    >
      <!-- Header -->
      <div class="px-6 py-5 border-b border-border flex items-center justify-between bg-[#0F0F0F]">
        <div>
          <h3 class="text-lg font-bold text-white flex items-center gap-2">
            <Coins size={18} class="text-accent" />
            Create Credit System
          </h3>
          <p class="text-[11px] text-zinc-500 mt-1">
            Map features to credit costs for a unified balance.
          </p>
        </div>
        <button class="text-zinc-500 hover:text-white transition-colors" onclick={close}>
          <X size={20} />
        </button>
      </div>

      <!-- Body -->
      <div class="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
        {#if error}
          <div class="bg-red-500/10 p-4 border border-red-500/20 text-xs text-red-500 font-medium">
            {error}
          </div>
        {/if}

        <div class="space-y-4">
          <div>
            <label class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Name</label>
            <input
              type="text"
              bind:value={name}
              placeholder="e.g. AI Credits"
              class="w-full bg-[#141414] border border-border rounded px-3 py-2 text-sm text-white focus:border-accent outline-none"
            />
          </div>

          <div>
            <label class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Description</label>
            <textarea
              bind:value={description}
              placeholder="Unified balance for all AI features"
              class="w-full bg-[#141414] border border-border rounded px-3 py-2 text-sm text-white focus:border-accent outline-none min-h-[80px]"
            ></textarea>
          </div>

          <div class="pt-4 border-t border-border/50">
            <div class="flex items-center justify-between mb-4">
              <label class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Feature Mappings</label>
              <button 
                class="text-[10px] font-bold text-accent uppercase tracking-widest hover:text-white transition-colors flex items-center gap-1"
                onclick={addFeature}
              >
                <Plus size={12} /> Add Feature
              </button>
            </div>

            <div class="space-y-3">
              {#each selectedFeatures as item, index}
                <div class="flex items-center gap-3 bg-[#141414] border border-border/50 p-3 rounded group" transition:fade>
                  <select
                    bind:value={item.featureId}
                    class="flex-1 bg-transparent text-xs text-white outline-none border-none focus:ring-0"
                  >
                    {#each features as f}
                      <option value={f.id} disabled={selectedFeatures.some((sf, i) => sf.featureId === f.id && i !== index)}>
                        {f.name}
                      </option>
                    {/each}
                  </select>
                  
                  <div class="flex items-center gap-2 border-l border-border/50 pl-3">
                    <input
                      type="number"
                      bind:value={item.cost}
                      min="0.01"
                      step="0.01"
                      class="w-16 bg-transparent text-xs text-white text-right outline-none border-none focus:ring-0"
                    />
                    <span class="text-[9px] font-bold text-zinc-600 uppercase">Credits</span>
                  </div>

                  <button 
                    class="text-zinc-600 hover:text-red-400 transition-colors p-1"
                    onclick={() => removeFeature(index)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              {/each}

              {#if selectedFeatures.length === 0}
                <div class="text-center py-8 border border-dashed border-border/50 rounded">
                  <p class="text-[11px] text-zinc-600 italic">No features added yet</p>
                </div>
              {/if}
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-6 py-4 flex justify-end gap-3 border-t border-border bg-[#0F0F0F]">
        <button class="px-4 py-2 text-[11px] font-bold text-zinc-500 hover:text-white uppercase tracking-widest transition-colors" onclick={close}>
          Cancel
        </button>
        <button
          class="bg-accent hover:bg-accent-hover text-black text-[11px] font-bold px-6 py-2 rounded uppercase tracking-widest transition-all disabled:opacity-50 flex items-center gap-2"
          disabled={isCreating}
          onclick={handleSubmit}
        >
          {#if isCreating}
            <Loader2 size={12} class="animate-spin" />
            Creating...
          {:else}
            <Check size={12} />
            Create System
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .custom-scrollbar::-webkit-scrollbar {
    width: 4px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: #27272a;
    border-radius: 10px;
  }
</style>
