<script lang="ts">
  import {
    Check,
    CircleNotch as CircleNotchIcon,
    EnvelopeSimple,
    IdentificationCard,
    User,
  } from "phosphor-svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import { apiFetch } from "$lib/auth-client";

  let {
    isOpen = $bindable(false),
    organizationId,
    onsuccess,
    onclose,
  }: {
    isOpen: boolean;
    organizationId: string;
    onsuccess?: (customer: any) => void;
    onclose?: () => void;
  } = $props();

  let email = $state("");
  let name = $state("");
  let externalId = $state("");
  let isCreating = $state(false);
  let error = $state("");

  async function handleSubmit() {
    if (!email.trim()) {
      error = "Email is required";
      return;
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      error = "Please enter a valid email address";
      return;
    }

    isCreating = true;
    error = "";

    try {
      const res = await apiFetch("/api/dashboard/customers", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          email: email.trim().toLowerCase(),
          name: name.trim() || undefined,
          externalId: externalId.trim() || undefined,
        }),
      });

      if (res.error) {
        throw new Error(res.error.message || "Failed to create customer");
      }

      if (res.data?.success === false) {
        throw new Error(res.data?.error || "Failed to create customer");
      }

      const customer = res.data?.data;
      isCreating = false;
      onsuccess?.(customer);
      close();
    } catch (e: any) {
      console.error(e);
      error = e.message || "An unexpected error occurred";
      isCreating = false;
    }
  }

  function close() {
    isOpen = false;
    onclose?.();
    setTimeout(() => {
      email = "";
      name = "";
      externalId = "";
      error = "";
    }, 300);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<SidePanel
  open={isOpen}
  title="Create Customer"
  onclose={close}
  width="max-w-md"
>
  <div class="text-sm flex flex-col h-full justify-between">
    <div class="p-5 space-y-6">
      <!-- Email -->
      <div>
        <label
          class="block text-xs font-medium text-text-dim mb-1.5"
          for="customerEmail"
          >Email Address <span class="text-error">*</span></label
        >
        <div class="input-icon-wrapper">
          <EnvelopeSimple size={14} class="input-icon-left" weight="duotone" />
          <input
            type="email"
            id="customerEmail"
            bind:value={email}
            placeholder="eg. john@example.com"
            class="input input-has-icon-left"
            autofocus
          />
        </div>
        <p class="text-[10px] text-text-dim mt-1">
          The customer's email address. Used for identification and checkout
          links.
        </p>
      </div>

      <!-- Name -->
      <div>
        <label
          class="block text-xs font-medium text-text-dim mb-1.5"
          for="customerName">Name (optional)</label
        >
        <div class="input-icon-wrapper">
          <User size={14} class="input-icon-left" weight="duotone" />
          <input
            type="text"
            id="customerName"
            bind:value={name}
            placeholder="eg. John Doe"
            class="input input-has-icon-left"
          />
        </div>
      </div>

      <!-- External ID -->
      <div>
        <label
          class="block text-xs font-medium text-text-dim mb-1.5"
          for="customerExternalId">External ID (optional)</label
        >
        <div class="input-icon-wrapper">
          <IdentificationCard
            size={14}
            class="input-icon-left"
            weight="duotone"
          />
          <input
            type="text"
            id="customerExternalId"
            bind:value={externalId}
            placeholder="eg. usr_12345"
            class="input input-has-icon-left"
          />
        </div>
        <p class="text-[10px] text-text-dim mt-1">
          Your internal user ID for this customer. Useful for mapping to your
          system.
        </p>
      </div>

      <!-- Info box about auto-enabled plans -->
      <div
        class="bg-bg-secondary border border-border rounded-lg p-4 space-y-2"
      >
        <div class="flex items-start gap-2">
          <Check size={14} class="text-accent mt-0.5 shrink-0" weight="bold" />
          <div>
            <p
              class="text-[10px] font-bold text-text-primary uppercase tracking-widest"
            >
              Auto-enabled Plans
            </p>
            <p class="text-[10px] text-text-dim mt-0.5 leading-relaxed">
              Any plans marked as "auto-enable" will be automatically assigned
              to this customer. Free plans will be active immediately; paid
              plans will be pending until payment.
            </p>
          </div>
        </div>
      </div>

      {#if error}
        <div
          class="text-error text-xs py-2 bg-error-bg px-3 rounded-md border border-error"
        >
          {error}
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div
      class="p-5 border-t border-border flex items-center justify-end gap-3 sticky bottom-0 bg-bg-card"
    >
      <button
        class="px-4 py-2 text-xs font-bold text-text-dim hover:text-text-primary transition-colors uppercase tracking-widest"
        onclick={close}
      >
        Cancel <span class="text-text-dim/60 ml-1 font-normal uppercase"
          >Esc</span
        >
      </button>
      <button
        class="px-6 py-2 bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-bold rounded-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest"
        onclick={handleSubmit}
        disabled={!email.trim() || isCreating}
      >
        {#if isCreating}
          <CircleNotchIcon size={12} class="animate-spin" />
          Creating...
        {:else}
          Create Customer <span class="px-1 rounded ml-1 text-[10px]">
            ⌘↵
          </span>
        {/if}
      </button>
    </div>
  </div>
</SidePanel>
