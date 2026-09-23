<script lang="ts">
  import {
    Buildings,
    CheckCircle,
    CircleNotch,
    Flask,
    Link,
  } from "phosphor-svelte";
  import { organization, apiFetch } from "$lib/auth-client";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import { goto } from "$app/navigation";

  let { open = $bindable(false) } = $props();

  // Organization fields
  let newOrgName = $state("");
  let newOrgSlug = $state("");
  let isCheckingSlug = $state(false);
  let slugAvailable = $state<boolean | null>(null);

  // Update slug automatically from name if not already set
  $effect(() => {
    if (newOrgName && !newOrgSlug) {
      newOrgSlug = newOrgName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    }
  });

  // Check slug availability when it changes (debounced)
  let slugTimeout: ReturnType<typeof setTimeout>;
  $effect(() => {
    if (newOrgSlug.length >= 3) {
      clearTimeout(slugTimeout);
      isCheckingSlug = true;
      slugTimeout = setTimeout(async () => {
        try {
          const res = await apiFetch(
            `/api/organizations/slug-check/${newOrgSlug}`,
          );
          slugAvailable = res.data?.available;
        } catch {
          slugAvailable = null;
        } finally {
          isCheckingSlug = false;
        }
      }, 500);
    } else {
      slugAvailable = null;
      isCheckingSlug = false;
    }
  });

  // UI state
  let isCreating = $state(false);
  let createError = $state<string | null>(null);

  let canCreate = $derived(
    !!newOrgName && newOrgSlug.length >= 3 && slugAvailable === true,
  );

  /**
   * Sandbox is managed by Owostack, so a new organization needs no provider
   * credentials to start. Live providers are connected from the deploy flow.
   */
  async function createOrganization() {
    if (!canCreate) return;

    isCreating = true;
    createError = null;

    try {
      const { data: orgData, error: orgError } = await organization.create({
        name: newOrgName,
        slug: newOrgSlug,
      });

      if (orgError) throw new Error(orgError.message);
      if (!orgData?.id) throw new Error("Failed to create organization");

      closeModal();
      goto(`/${orgData.slug || orgData.id}/plans`);
    } catch (err: unknown) {
      createError =
        err instanceof Error ? err.message : "Failed to create organization";
    } finally {
      isCreating = false;
    }
  }

  function closeModal() {
    open = false;
    newOrgName = "";
    newOrgSlug = "";
    slugAvailable = null;
    isCheckingSlug = false;
    createError = null;
  }
</script>

<SidePanel
  {open}
  title="Create Organization"
  onclose={closeModal}
  width="max-w-md"
>
  <div class="text-sm">
    <div class="p-5 space-y-6">
      {#if createError}
        <div
          class="mb-4 p-3 bg-error-bg border border-error text-error text-xs uppercase tracking-tight"
        >
          {createError}
        </div>
      {/if}

      <div class="space-y-5">
        <div>
          <label
            for="orgName"
            class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2"
            >Organization Name</label
          >
          <div class="input-icon-wrapper">
            <Buildings size={14} class="input-icon-left" weight="duotone" />
            <input
              type="text"
              id="orgName"
              bind:value={newOrgName}
              placeholder="e.g. Acme Corp"
              class="input input-has-icon-left font-bold"
            />
          </div>
        </div>

        <div>
          <label
            for="orgSlug"
            class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2"
            >Slug</label
          >
          <div class="input-icon-wrapper">
            <Link size={14} class="input-icon-left" weight="duotone" />
            <input
              type="text"
              id="orgSlug"
              bind:value={newOrgSlug}
              placeholder="e.g. acme-corp"
              class="input input-has-icon-left pr-10 font-bold {slugAvailable ===
              false
                ? 'border-error'
                : slugAvailable === true
                  ? 'border-success'
                  : ''}"
            />
            <div
              class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center"
            >
              {#if isCheckingSlug}
                <CircleNotch size={14} class="animate-spin text-text-dim" />
              {:else if slugAvailable === true}
                <CheckCircle size={14} weight="fill" class="text-success" />
              {:else if slugAvailable === false}
                <div
                  class="w-1.5 h-1.5 bg-error rounded-full animate-pulse"
                ></div>
              {/if}
            </div>
          </div>
          {#if slugAvailable === false}
            <p
              class="mt-1.5 text-[10px] text-error font-bold uppercase tracking-tight"
            >
              Slug is already taken
            </p>
          {/if}
        </div>

        <div
          class="p-3 bg-accent/5 border border-accent/20 rounded-sm flex items-start gap-3"
        >
          <Flask size={14} weight="duotone" class="text-accent mt-0.5 shrink-0" />
          <p
            class="text-[10px] text-text-primary leading-relaxed uppercase tracking-tight opacity-70"
          >
            New organizations start in the sandbox with Owostack's shared test
            providers. Connect your own provider when you go live.
          </p>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div
      class="p-5 border-t border-border flex items-center justify-between sticky bottom-0 bg-bg-card"
    >
      <button
        class="px-4 py-2 text-xs font-bold text-text-dim hover:text-text-primary transition-colors uppercase tracking-widest"
        onclick={closeModal}
        disabled={isCreating}
      >
        Cancel
      </button>
      <button
        class="btn btn-primary px-6"
        onclick={createOrganization}
        disabled={!canCreate || isCreating}
      >
        {#if isCreating}
          <CircleNotch size={14} class="animate-spin" weight="duotone" />
          Creating...
        {:else}
          <CheckCircle size={14} weight="fill" />
          Create organization
        {/if}
      </button>
    </div>
  </div>
</SidePanel>
