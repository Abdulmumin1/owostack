<script lang="ts">
  import {
    CircleNotch,
    FloppyDisk,
    User,
    Envelope,
    Link,
    PlugsConnected,
    Plugs,
  } from "phosphor-svelte";
  import { authClient, useSession } from "$lib/auth-client";
  import { toast } from "svelte-sonner";

  const session = useSession();

  let userName = $state("");
  let userEmail = $state("");
  let isSaving = $state(false);
  let linkedAccounts = $state<any[]>([]);
  let accountsLoading = $state(false);
  let accountAction = $state<string | null>(null);
  let loadedAccountsForUserId = $state<string | null>(null);

  const socialProviders = [
    { id: "google", label: "Google" },
    { id: "github", label: "GitHub" },
  ];

  let hasPassword = $derived(
    linkedAccounts.some((account) => account.provider === "credential" || account.providerId === "credential"),
  );

  $effect(() => {
    if ($session.data?.user) {
      if (!userName) userName = $session.data.user.name || "";
      if (!userEmail) userEmail = $session.data.user.email || "";
      if (loadedAccountsForUserId !== $session.data.user.id) {
        loadedAccountsForUserId = $session.data.user.id;
        void loadLinkedAccounts();
      }
    }
  });

  async function loadLinkedAccounts() {
    accountsLoading = true;
    try {
      const { data } = await (authClient as any).listAccounts();
      linkedAccounts = data || [];
    } catch (e) {
      console.error("Failed to load linked accounts", e);
      linkedAccounts = [];
    } finally {
      accountsLoading = false;
    }
  }

  function findLinkedAccount(provider: string) {
    return linkedAccounts.find(
      (account) => account.provider === provider || account.providerId === provider,
    );
  }

  async function linkProvider(provider: "google" | "github") {
    accountAction = provider;
    try {
      await (authClient as any).linkSocial({ provider });
    } catch (e: any) {
      toast.error("Failed to link account", {
        description: e.message || "Please try again",
      });
      accountAction = null;
    }
  }

  async function unlinkProvider(provider: string) {
    const account = findLinkedAccount(provider);
    if (!account) return;

    const linkedSignInMethods = linkedAccounts.length + (hasPassword ? 1 : 0);
    if (linkedSignInMethods <= 1) {
      toast.error("Cannot unlink last sign-in method", {
        description: "Add another sign-in method before removing this one.",
      });
      return;
    }

    accountAction = provider;
    try {
      const accountId = account.accountId || account.id;
      const { error } = await (authClient as any).unlinkAccount({
        providerId: provider,
        accountId,
      });

      if (error) throw new Error(error.message);

      toast.success("Account unlinked");
      await loadLinkedAccounts();
    } catch (e: any) {
      toast.error("Failed to unlink account", {
        description: e.message || "Please try again",
      });
    } finally {
      accountAction = null;
    }
  }

  async function save() {
    isSaving = true;
    try {
      if (userName && userName !== $session.data?.user?.name) {
        await authClient.updateUser({
          name: userName,
        });
      }

      toast.success("Account updated", {
        description: "Your profile has been saved"
      });
    } catch (e: any) {
      console.error("Failed to save account settings", e);
      toast.error("Failed to update account", {
        description: e.message || "Please try again"
      });
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
      disabled
    />
    <p class="mt-2 text-[11px] text-text-dim">
      Email changes are disabled here. Manage sign-in methods below.
    </p>
  </div>

  <div class="bg-bg-secondary border border-border rounded-lg p-4">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h3 class="flex items-center gap-2 text-xs font-medium text-text-dim">
          <Link size={12} weight="duotone" />
          Sign-in Methods
        </h3>
        <p class="mt-1 text-[11px] text-text-muted">
          Link OAuth providers to sign in with the same account.
        </p>
      </div>
      {#if accountsLoading}
        <CircleNotch size={14} class="animate-spin text-text-dim" />
      {/if}
    </div>

    <div class="space-y-2">
      {#each socialProviders as provider}
        {@const linked = findLinkedAccount(provider.id)}
        <div class="flex items-center justify-between border border-border bg-bg-card px-3 py-2">
          <div class="flex items-center gap-2">
            {#if linked}
              <PlugsConnected size={14} class="text-success" weight="duotone" />
            {:else}
              <Plugs size={14} class="text-text-dim" weight="duotone" />
            {/if}
            <div>
              <p class="text-sm font-medium text-text-primary">{provider.label}</p>
              <p class="text-[10px] uppercase tracking-widest text-text-dim">
                {linked ? "Linked" : "Not linked"}
              </p>
            </div>
          </div>

          {#if linked}
            <button class="btn btn-secondary btn-sm" disabled={accountAction === provider.id} onclick={() => unlinkProvider(provider.id)}>
              {accountAction === provider.id ? "Working..." : "Unlink"}
            </button>
          {:else}
            <button class="btn btn-primary btn-sm" disabled={accountAction === provider.id} onclick={() => linkProvider(provider.id as "google" | "github")}>
              {accountAction === provider.id ? "Connecting..." : "Link"}
            </button>
          {/if}
        </div>
      {/each}
    </div>
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
  </div>
</div>
