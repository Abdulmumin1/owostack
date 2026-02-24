<script lang="ts">
  import { Check, CircleNotch, FloppyDisk } from "phosphor-svelte";
  import { fade } from "svelte/transition";
  import { organization } from "$lib/auth-client";
  import { defaultCurrency } from "$lib/stores/currency";
  import { COMMON_CURRENCIES } from "$lib/utils/currency";
  import { apiFetch } from "$lib/auth-client";

  let { 
    projectId,
    initialName = "",
    initialSlug = "",
    initialCurrency = "USD"
  }: {
    projectId: string;
    initialName?: string;
    initialSlug?: string;
    initialCurrency?: string;
  } = $props();

  let projectName = $state(initialName);
  let projectSlug = $state(initialSlug);
  let orgCurrency = $state(initialCurrency);
  let isSaving = $state(false);
  let successMessage = $state<string | null>(null);

  function showSuccess(msg: string) {
    successMessage = msg;
    setTimeout(() => successMessage = null, 3000);
  }

  async function save() {
    isSaving = true;
    try {
      await organization.update({
        organizationId: projectId,
        data: { name: projectName, slug: projectSlug },
      });
      
      await apiFetch(`/api/dashboard/config/default-currency`, {
        method: "PUT",
        body: JSON.stringify({
          organizationId: projectId,
          defaultCurrency: orgCurrency,
        }),
      });
      defaultCurrency.set(orgCurrency);
      
      showSuccess("Settings updated successfully");
    } catch (e) {
      console.error("Failed to save settings", e);
    } finally {
      isSaving = false;
    }
  }
</script>

<div class="space-y-8">
  <div>
    <label for="projectName" class="block text-xs font-bold text-text-dim uppercase tracking-widest mb-2">Project Name</label>
    <input type="text" id="projectName" bind:value={projectName} class="input w-full" placeholder="e.g. Acme Inc" />
  </div>

  <div>
    <label for="projectSlug" class="block text-xs font-bold text-text-dim uppercase tracking-widest mb-2">Project Slug</label>
    <div class="flex items-center">
      <span class="bg-bg-secondary border border-r-0 border-border px-4 py-2 text-text-dim text-xs font-mono h-[42px] flex items-center rounded-l">owostack.com/</span>
      <input type="text" id="projectSlug" bind:value={projectSlug} class="input border-l-0 flex-1 rounded-l-none" placeholder="acme-slug" />
    </div>
  </div>

  <div>
    <label for="orgCurrency" class="block text-xs font-bold text-text-dim uppercase tracking-widest mb-2">Default Currency</label>
    <select id="orgCurrency" bind:value={orgCurrency} class="input w-full">
      {#each COMMON_CURRENCIES as c (c.code)}
        <option value={c.code}>{c.symbol} {c.code} — {c.name}</option>
      {/each}
    </select>
    <p class="text-xs text-text-dim/60 mt-2">Used as default for new plans and credit packs.</p>
  </div>

  <div class="pt-6 border-t border-border flex items-center justify-between">
    <button class="btn btn-primary flex items-center gap-2" onclick={save} disabled={isSaving}>
      {#if isSaving} <CircleNotch size={16} class="animate-spin" weight="duotone" /> Saving... {:else} <FloppyDisk size={16} weight="fill" /> Save Changes {/if}
    </button>
    {#if successMessage}
      <span class="text-sm text-success flex items-center gap-1" in:fade>
        <Check size={14} weight="fill" /> {successMessage}
      </span>
    {/if}
  </div>
</div>
