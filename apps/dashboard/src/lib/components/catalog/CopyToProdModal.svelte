<script lang="ts">
  import Modal from "$lib/components/ui/Modal.svelte";
  import { CircleNotch, Storefront } from "phosphor-svelte";
  import { copyItemToProd } from "$lib/utils/catalog";

  let {
    open = $bindable(false),
    organizationId,
    itemType,
    itemId,
    itemName,
    onsuccess
  }: {
    open: boolean;
    organizationId: string;
    itemType: "plan" | "feature" | "creditSystem" | "creditPack";
    itemId: string;
    itemName: string;
    onsuccess?: () => void;
  } = $props();

  let copyState = $state<"confirm" | "loading" | "success" | "error">("confirm");
  let errorMessage = $state<string>("");

  // reset state when modal opens
  $effect(() => {
    if (open) {
      copyState = "confirm";
      errorMessage = "";
    }
  });

  async function handleCopy() {
    copyState = "loading";
    try {
      await copyItemToProd(organizationId, itemType, itemId);
      copyState = "success";
      if (onsuccess) onsuccess();
    } catch (e: any) {
      copyState = "error";
      errorMessage = e.message || "Failed to copy to production";
    }
  }

  function close() {
    open = false;
  }

  const typeLabels = {
    plan: "plan",
    feature: "feature",
    creditSystem: "credit system",
    creditPack: "credit pack"
  };
</script>

<Modal bind:open title="Copy to Production" width="max-w-md" onclose={close}>
  <div class="p-6">
    {#if copyState === "confirm"}
      <div class="text-center mb-6">
        <h3 class="text-lg font-bold text-text-primary mb-2">Copy {typeLabels[itemType]}?</h3>
        <p class="text-sm text-text-dim">
          Are you sure you want to copy the {typeLabels[itemType]} <strong class="text-text-primary">{itemName}</strong> to production?
          {#if itemType === 'plan' || itemType === 'creditSystem'}
            <br/><br/>
            <span class="text-xs text-text-muted">This will also intelligently copy any associated features and their configurations if they don't already exist in production.</span>
          {/if}
        </p>
      </div>
      <div class="flex items-center gap-3 justify-end">
        <button class="btn btn-secondary flex-1" onclick={close}>Cancel</button>
        <button class="btn btn-primary flex-1 gap-2" onclick={handleCopy}>
          <Storefront size={16} weight="duotone" />
          Copy to Prod
        </button>
      </div>
    {:else if copyState === "loading"}
      <div class="flex flex-col items-center justify-center py-8">
        <CircleNotch size={32} class="animate-spin text-info mb-4" weight="duotone" />
        <p class="text-sm font-medium text-text-primary">Copying to production...</p>
        <p class="text-xs text-text-dim mt-1">Please wait</p>
      </div>
    {:else if copyState === "success"}
      <div class="text-center mb-6">
        <h3 class="text-lg font-bold text-text-primary mb-2">Success!</h3>
        <p class="text-sm text-text-dim">
          The {typeLabels[itemType]} <strong class="text-text-primary">{itemName}</strong> was successfully copied to production.
        </p>
      </div>
      <button class="btn btn-primary w-full" onclick={close}>Done</button>
    {:else if copyState === "error"}
      <div class="text-center mb-6">
        <h3 class="text-lg font-bold text-text-primary mb-2">Copy Failed</h3>
        <p class="text-sm text-text-dim bg-bg-secondary p-3 rounded border border-border text-left break-words">
          {errorMessage}
        </p>
      </div>
      <div class="flex items-center gap-3">
        <button class="btn btn-secondary flex-1" onclick={close}>Close</button>
        <button class="btn btn-primary flex-1" onclick={handleCopy}>Try Again</button>
      </div>
    {/if}
  </div>
</Modal>