<script lang="ts">
  import { Result } from "better-result";
  import { apiFetch } from "$lib/auth-client";
  import { fade } from "svelte/transition";
  import { X, Plus, Trash2, Loader2, Coins, Check } from "lucide-svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";

  let { 
    isOpen = $bindable(false), 
    creditSystemId = $bindable(""),
    organizationId,
    onclose = () => {}, 
    onsuccess = (data?: any) => {} 
  } = $props();

  let name = $state("");
  let description = $state("");
  let isLoading = $state(false);
  let isSaving = $state(false);
  let error = $state("");
  
  let features = $state<any[]>([]);
  let selectedFeatures = $state<{featureId: string, cost: number}[]>([]);

  async function loadFeatures() {
    try {
      const [featRes, credRes] = await Promise.all([
        apiFetch(`/api/dashboard/features?organizationId=${organizationId}`),
        apiFetch(`/api/dashboard/credits?organizationId=${organizationId}`),
      ]);

      if (featRes.data?.success) {
        const creditSystems = credRes.data?.success ? credRes.data.data : [];
        const csIds = new Set(creditSystems.map((cs: any) => cs.id));
        
        // Only metered features that are NOT credit systems can be part of a credit system
        features = featRes.data.data.filter((f: any) => 
          f.type === 'metered' && !csIds.has(f.id)
        );
      }
    } catch (e) {
      console.error("Failed to load features", e);
    }
  }

  async function loadCreditSystem() {
    if (!creditSystemId) return;
    
    isLoading = true;
    error = "";
    
    try {
      const res = await apiFetch(`/api/dashboard/credits/${creditSystemId}`);
      
      if (res.data?.success) {
        const system = res.data.data;
        name = system.name;
        description = system.description || "";
        selectedFeatures = system.features.map((f: any) => ({
          featureId: f.featureId,
          cost: f.cost
        }));
      } else {
        error = res.data?.error || "Failed to load credit system";
      }
    } catch (e: any) {
      error = e.message || "Failed to load credit system";
      console.error("Failed to load credit system", e);
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    if (isOpen && creditSystemId) {
      loadFeatures();
      loadCreditSystem();
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
    creditSystemId = "";
    name = "";
    description = "";
    selectedFeatures = [];
    error = "";
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

    isSaving = true;
    error = "";

    const result = await Result.tryPromise(async () => {
      const res = await apiFetch(`/api/dashboard/credits/${creditSystemId}`, {
        method: "PUT",
        body: JSON.stringify({
          name,
          description,
          features: selectedFeatures
        }),
      });

      if (res.error) {
        throw new Error(res.error.message || "Failed to update credit system");
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

<SidePanel open={isOpen} title="Edit Credit System" onclose={close} width="max-w-md">
  <div class="text-sm">
    {#if isLoading}
      <div class="p-5 flex items-center justify-center min-h-[300px]">
        <Loader2 size={24} class="animate-spin text-zinc-500" />
      </div>
    {:else}
      <div class="p-5 space-y-6">
        {#if error}
          <div class="bg-red-500/10 p-4 border border-red-500/20 text-xs text-red-500 font-medium">
            {error}
          </div>
        {/if}

        <div class="space-y-4">
          <div>
            <label class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2">Name</label>
            <div class="input-icon-wrapper">
              <Coins size={14} class="input-icon-left text-text-dim" />
              <input
                type="text"
                bind:value={name}
                placeholder="e.g. AI Credits"
                class="input input-has-icon-left"
              />
            </div>
          </div>

          <div>
            <label class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2">Description</label>
            <div class="input-icon-wrapper">
              <textarea
                bind:value={description}
                placeholder="Unified balance for all AI features"
                class="input min-h-[80px]"
              ></textarea>
            </div>
          </div>

          <div class="pt-4 border-t border-border/50">
            <div class="flex items-center justify-between mb-4">
              <label class="block text-[10px] font-bold text-text-dim uppercase tracking-widest">Feature Mappings</label>
              <button 
                class="text-[10px] font-bold text-accent uppercase tracking-widest hover:text-text-primary transition-colors flex items-center gap-1"
                onclick={addFeature}
              >
                <Plus size={12} /> Add Feature
              </button>
            </div>

            <div class="space-y-3">
              {#each selectedFeatures as item, index}
                <div class="flex items-center gap-3 bg-black/5 dark:bg-white/5 border border-border p-3 rounded group" transition:fade>
                  <select
                    bind:value={item.featureId}
                    class="flex-1 bg-transparent text-xs text-text-primary outline-none border-none focus:ring-0"
                  >
                    {#each features as f}
                      <option value={f.id} disabled={selectedFeatures.some((sf, i) => sf.featureId === f.id && i !== index)}>
                        {f.name}
                      </option>
                    {/each}
                  </select>
                  
                  <div class="flex items-center gap-2 border-l border-border pl-3">
                    <input
                      type="number"
                      bind:value={item.cost}
                      min="0.01"
                      step="0.01"
                      class="w-16 bg-transparent text-xs text-text-primary text-right outline-none border-none focus:ring-0"
                    />
                    <span class="text-[9px] font-bold text-text-dim uppercase">Credits</span>
                  </div>

                  <button 
                    class="text-text-dim hover:text-red-500 transition-colors p-1"
                    onclick={() => removeFeature(index)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              {/each}

              {#if selectedFeatures.length === 0}
                <div class="text-center py-8 border border-dashed border-border rounded">
                  <p class="text-[11px] text-text-dim italic">No features added yet</p>
                </div>
              {/if}
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="p-5 border-t border-border flex items-center justify-end gap-3 sticky bottom-0 bg-bg-card">
        <button class="px-4 py-2 text-[11px] font-bold text-text-dim hover:text-text-primary uppercase tracking-widest transition-colors" onclick={close}>
          Cancel
        </button>
        <button
          class="bg-accent hover:bg-accent-hover text-accent-contrast text-[11px] font-bold px-6 py-2 rounded uppercase tracking-widest transition-all disabled:opacity-50 flex items-center gap-2"
          disabled={isSaving}
          onclick={handleSubmit}
        >
          {#if isSaving}
            <Loader2 size={12} class="animate-spin" />
            Saving...
          {:else}
            <Check size={12} />
            Save Changes
          {/if}
        </button>
      </div>
    {/if}
  </div>
</SidePanel>

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
