<script lang="ts">
  import {
    Check,
    CircleNotch,
    FloppyDisk,
    Buildings,
    Link,
    Coins,
  } from "phosphor-svelte";
  import { fade } from "svelte/transition";
  import { organization } from "$lib/auth-client";
  import { defaultCurrency } from "$lib/stores/currency";
  import { COMMON_CURRENCIES } from "$lib/utils/currency";
  import { apiFetch } from "$lib/auth-client";
  import { onMount } from "svelte";

  let {
    projectId,
    initialName = "",
    initialSlug = "",
    initialCurrency = "USD",
  }: {
    projectId: string;
    initialName?: string;
    initialSlug?: string;
    initialCurrency?: string;
  } = $props();

  let projectName = $state("");
  let projectSlug = $state("");
  let orgCurrency = $state("");
  let isSaving = $state(false);
  let successMessage = $state<string | null>(null);

  function showSuccess(msg: string) {
    successMessage = msg;
    setTimeout(() => (successMessage = null), 3000);
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

  onMount(() => {
    projectName = initialName;
    projectSlug = initialSlug;
    orgCurrency = initialCurrency;
  });
</script>

<div class="space-y-5 max-w-2xl">
  <!-- Project Name -->
  <div class="bg-bg-secondary border border-border rounded-lg p-4">
    <label
      for="projectName"
      class="flex items-center gap-2 text-xs font-medium text-text-dim mb-2"
    >
      <Buildings size={12} weight="duotone" />
      Project Name
    </label>
    <input
      type="text"
      id="projectName"
      bind:value={projectName}
      class="input w-full"
      placeholder="e.g. Acme Inc"
    />
  </div>

  <!-- Project Slug -->
  <div class="bg-bg-secondary border border-border rounded-lg p-4">
    <label
      for="projectSlug"
      class="flex items-center gap-2 text-xs font-medium text-text-dim mb-2"
    >
      <Link size={12} weight="duotone" />
      Project Slug
    </label>
    <div class="flex items-center">
      <span
        class="bg-bg-primary border border-r-0 border-border px-3 py-2 text-text-dim text-xs font-mono h-[38px] flex items-center rounded-l"
        >app.owostack.com/</span
      >
      <input
        type="text"
        id="projectSlug"
        bind:value={projectSlug}
        class="input border-l-0 flex-1 rounded-l-none h-[38px]"
        placeholder="acme-slug"
      />
    </div>
  </div>

  <!-- Default Currency -->
  <div class="bg-bg-secondary border border-border rounded-lg p-4">
    <label
      for="orgCurrency"
      class="flex items-center gap-2 text-xs font-medium text-text-dim mb-2"
    >
      <Coins size={12} weight="duotone" />
      Default Currency
    </label>
    <select id="orgCurrency" bind:value={orgCurrency} class="input w-full">
      {#each COMMON_CURRENCIES as c (c.code)}
        <option value={c.code}>{c.symbol} {c.code} — {c.name}</option>
      {/each}
    </select>
    <p class="text-[10px] text-text-dim mt-2">
      Used as default for new plans and credit packs.
    </p>
  </div>

  <!-- Save Button -->
  <div class="pt-2 flex items-center justify-end">
    <button
      class="btn btn-primary btn-sm flex items-center gap-1.5 text-xs"
      onclick={save}
      disabled={isSaving}
    >
      {#if isSaving}
        <CircleNotch size={14} class="animate-spin" weight="duotone" />
        Saving...
      {:else}
        <FloppyDisk size={14} weight="duotone" />
        Save Changes
      {/if}
    </button>

    {#if successMessage}
      <span class="text-xs text-success flex items-center gap-1" in:fade>
        <Check size={12} weight="duotone" />
        {successMessage}
      </span>
    {/if}
  </div>
</div>
