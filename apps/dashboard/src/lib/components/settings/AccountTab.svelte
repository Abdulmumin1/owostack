<script lang="ts">
  import {
    Check,
    CircleNotch,
    FloppyDisk,
    User,
    Envelope,
  } from "phosphor-svelte";
  import { fade } from "svelte/transition";
  import { authClient, useSession } from "$lib/auth-client";

  const session = useSession();

  let userName = $state("");
  let userEmail = $state("");
  let isSaving = $state(false);
  let successMessage = $state<string | null>(null);

  $effect(() => {
    if ($session.data?.user) {
      if (!userName) userName = $session.data.user.name || "";
      if (!userEmail) userEmail = $session.data.user.email || "";
    }
  });

  function showSuccess(msg: string) {
    successMessage = msg;
    setTimeout(() => (successMessage = null), 3000);
  }

  async function save() {
    isSaving = true;
    try {
      if (userName && userName !== $session.data?.user?.name) {
        await authClient.updateUser({
          name: userName,
        });
      }

      if (userEmail && userEmail !== $session.data?.user?.email) {
        await authClient.updateUser({
          email: userEmail,
        });
      }

      showSuccess("Account updated successfully");
    } catch (e) {
      console.error("Failed to save account settings", e);
    } finally {
      isSaving = false;
    }
  }
</script>

<div class="space-y-5 max-w-2xl">
  <!-- Full Name -->
  <div class="bg-bg-secondary border border-border rounded-lg p-4">
    <label
      for="userName"
      class="flex items-center gap-2 text-xs font-medium text-text-dim mb-2"
    >
      <User size={12} weight="duotone" />
      Full Name
    </label>
    <input
      type="text"
      id="userName"
      bind:value={userName}
      class="input w-full"
      placeholder="Ada Lovelace"
    />
  </div>

  <!-- Email Address -->
  <div class="bg-bg-secondary border border-border rounded-lg p-4">
    <label
      for="userEmail"
      class="flex items-center gap-2 text-xs font-medium text-text-dim mb-2"
    >
      <Envelope size={12} weight="duotone" />
      Email Address
    </label>
    <input
      type="email"
      id="userEmail"
      bind:value={userEmail}
      class="input w-full"
      placeholder="you@example.com"
    />
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
      <span class="text-xs text-success flex items-center gap-1 ml-3" in:fade>
        <Check size={12} weight="duotone" />
        {successMessage}
      </span>
    {/if}
  </div>
</div>
