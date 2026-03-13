<script lang="ts">
  import {
    CheckCircle,
    CircleNotch,
    Copy,
    Eye,
    EyeSlash,
    FloppyDisk,
    Globe,
    Lock,
  } from "phosphor-svelte";
  import { apiFetch } from "$lib/auth-client";
  import { getActiveEnvironment, getApiUrl } from "$lib/env";
  import { SUPPORTED_PROVIDERS } from "$lib/providers";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import type { ProviderAccount } from "./types";

  let {
    open = false,
    projectId,
    editingAccount = null,
    availableProviderIds = [],
    onClose,
    onSaved,
  }: {
    open?: boolean;
    projectId: string;
    editingAccount?: ProviderAccount | null;
    availableProviderIds?: string[];
    onClose: () => void;
    onSaved: () => void;
  } = $props();

  // Internal state - derived from props
  let formStep = $state<"configure" | "webhook">("configure");
  let formProviderId = $state("paystack");
  let formDisplayName = $state("");
  let formCredentials = $state<Record<string, string>>({});
  let showSecretFields = $state<Record<string, boolean>>({});
  let isSavingProvider = $state(false);
  let providerError = $state<string | null>(null);
  let lastCreatedProviderId = $state<string | null>(null);

  // API base URL derived from environment
  let apiBase = $derived(getApiUrl());
  let activeEnvironment = $derived(getActiveEnvironment());

  // Reset state when open changes or editingAccount changes
  $effect(() => {
    if (open) {
      formStep = "configure";
      formCredentials = {};
      showSecretFields = {};
      providerError = null;
      lastCreatedProviderId = null;

      if (editingAccount) {
        formProviderId = editingAccount.providerId;
        formDisplayName = editingAccount.displayName || "";
      } else {
        const firstAvailable = availableProviders[0]?.id;
        formProviderId = firstAvailable || "paystack";
        formDisplayName = "";
      }
    }
  });

  let availableProviders = $derived(
    SUPPORTED_PROVIDERS.filter((p) => availableProviderIds.includes(p.id)),
  );

  let selectedProviderConfig = $derived(
    availableProviders.find((p) => p.id === formProviderId) ||
      SUPPORTED_PROVIDERS.find((p) => p.id === formProviderId),
  );

  let title = $derived(
    formStep === "webhook"
      ? "Configure Webhook"
      : editingAccount
        ? "Update Provider"
        : "Add Payment Provider",
  );

  async function save() {
    isSavingProvider = true;
    providerError = null;
    try {
      const credentials: Record<string, unknown> = {};
      const providerConfig = SUPPORTED_PROVIDERS.find(
        (p) => p.id === formProviderId,
      );
      if (providerConfig) {
        for (const field of providerConfig.fields) {
          const val = formCredentials[field.key];
          if (val && val.trim().length > 0) credentials[field.key] = val.trim();
        }
      }

      if (editingAccount) {
        const result = await apiFetch(
          `/api/dashboard/providers/accounts/${editingAccount.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              organizationId: projectId,
              displayName: formDisplayName || undefined,
              credentials:
                Object.keys(credentials).length > 0 ? credentials : undefined,
            }),
          },
        );
        if (result.error) {
          throw new Error(result.error.message || "Failed to update provider");
        }
        onSaved();
        onClose();
      } else {
        if (Object.keys(credentials).length === 0)
          throw new Error("Credentials required");
        const result = await apiFetch("/api/dashboard/providers/accounts", {
          method: "POST",
          body: JSON.stringify({
            organizationId: projectId,
            providerId: formProviderId,
            environment: getActiveEnvironment(),
            displayName: formDisplayName || undefined,
            credentials,
          }),
        });
        if (result.error) {
          throw new Error(result.error.message || "Failed to connect provider");
        }
        lastCreatedProviderId = formProviderId;
        formStep = "webhook";
        onSaved();
      }
    } catch (e: any) {
      providerError = e.message;
    } finally {
      isSavingProvider = false;
    }
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url);
  }
</script>

<SidePanel {open} {title} onclose={onClose} width="max-w-md">
  <div class="flex justify-between h-full flex-col">
    <div class="p-6 space-y-8">
      {#if providerError}
        <div
          class="p-4 bg-error-bg border border-error text-error text-xs flex items-center gap-2"
        >
          {providerError}
        </div>
      {/if}

      <div class="flex items-center justify-between gap-3">
        <div>
          <div
            class="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-1"
          >
            Target Environment
          </div>
          <p class="text-xs text-text-secondary">
            This provider key will be validated and saved for the current app
            environment.
          </p>
        </div>
        <span
          class="text-[10px] px-2 py-0.5 border {activeEnvironment === 'live'
            ? 'border-success text-success bg-success-bg'
            : 'border-warning text-warning bg-warning-bg'} uppercase tracking-widest font-bold rounded-sm"
        >
          {activeEnvironment} Mode
        </span>
      </div>

      {#if formStep === "configure"}
        {#if !editingAccount}
          <div>
            <div
              class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-4"
            >
              Select Provider
            </div>
            <div class="grid grid-cols-2 gap-2">
              {#each availableProviders as provider (provider.id)}
                <button
                  class="p-3 border rounded text-left flex flex-col items-center gap-2 transition-all relative {formProviderId ===
                  provider.id
                    ? 'border-accent bg-accent/5'
                    : 'border-border hover:border-text-dim'}"
                  onclick={() => {
                    formProviderId = provider.id;
                    formCredentials = {};
                  }}
                >
                  <div
                    class="w-10 h-10 flex items-center justify-center bg-bg-card border border-border rounded-sm shrink-0 overflow-hidden p-1"
                  >
                    <img
                      src={provider.logoUrl}
                      alt={provider.name}
                      class="w-full h-full object-contain"
                      onerror={(e) => {
                        const target = e.currentTarget as HTMLImageElement;
                        target.style.display = "none";
                      }}
                    />
                  </div>
                  <div class="text-center min-w-0">
                    <span
                      class="text-xs font-bold text-text-primary block truncate"
                      >{provider.name}</span
                    >
                  </div>
                  {#if formProviderId === provider.id}
                    <CheckCircle
                      size={16}
                      weight="fill"
                      class="text-accent absolute top-2 right-2"
                    />
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <div>
          <label
            for="displayName"
            class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-3"
            >Display Name</label
          >
          <input
            type="text"
            id="displayName"
            bind:value={formDisplayName}
            class="input w-full"
            placeholder={selectedProviderConfig
              ? `e.g. ${selectedProviderConfig.name} Live`
              : "e.g. Paystack Live"}
          />
        </div>

        {#if selectedProviderConfig}
          {#each selectedProviderConfig.fields as field (field.key)}
            {@const isWebhookSecret = field.key === "webhookSecret"}
            <div>
              <label
                for={field.key}
                class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-3"
                >{field.label}</label
              >
              <div class="space-y-2">
                <div class="relative input-icon-wrapper">
                  <Lock size={12} class="input-icon-left text-text-dim" />
                  <input
                    type={field.secret && !showSecretFields[field.key]
                      ? "password"
                      : "text"}
                    id={field.key}
                    bind:value={formCredentials[field.key]}
                    placeholder={field.placeholder}
                    class="input input-has-icon-left w-full pr-10 font-mono text-xs"
                  />
                  <button
                    type="button"
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-primary"
                    onclick={() =>
                      (showSecretFields[field.key] =
                        !showSecretFields[field.key])}
                  >
                    {#if showSecretFields[field.key]}
                      <EyeSlash size={14} />
                    {:else}
                      <Eye size={14} />
                    {/if}
                  </button>
                </div>
                {#if isWebhookSecret}
                  {@const webhookUrl = `${apiBase}/webhooks/${projectId}/${formProviderId}`}
                  <div
                    class="bg-info-bg border border-info p-2 flex items-start gap-2"
                  >
                    <div class="flex-1 min-w-0">
                      <p
                        class="text-[10px] font-bold text-info uppercase tracking-widest mb-1"
                      >
                        Webhook URL
                      </p>
                      <code class="font-mono text-[10px] text-info break-all"
                        >{webhookUrl}</code
                      >
                    </div>
                    <button
                      type="button"
                      class="text-info hover:text-info/80 transition-colors shrink-0 mt-0.5"
                      onclick={() => copyUrl(webhookUrl)}
                      title="Copy webhook URL"
                    >
                      <Copy size={12} weight="fill" />
                    </button>
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      {:else if formStep === "webhook" && lastCreatedProviderId}
        <div class="space-y-4">
          <div
            class="bg-success-bg border border-success p-4 rounded text-success text-xs flex gap-2"
          >
            <CheckCircle weight="fill" size={16} /> Provider connected successfully!
          </div>
          <p class="text-xs text-text-dim">
            Add this webhook URL to your provider settings:
          </p>
          <div
            class="bg-[var(--color-bg-code)] p-3 rounded border border-border flex gap-2"
          >
            <code
              class="flex-1 font-mono text-xs text-[var(--color-text-code)] break-all"
              >{apiBase}/webhooks/{projectId}/{lastCreatedProviderId}</code
            >
            <button
              class="text-text-dim hover:text-text-primary"
              onclick={() =>
                copyUrl(
                  `${apiBase}/webhooks/${projectId}/${lastCreatedProviderId}`,
                )}><Copy size={14} weight="fill" /></button
            >
          </div>
        </div>
      {/if}
    </div>
    <div
      class="p-6 border-t border-border flex justify-end gap-3 sticky bottom-0 bg-bg-card"
    >
      {#if formStep === "configure"}
        <button class="btn btn-secondary" onclick={onClose}>Cancel</button>
        <button
          class="btn btn-primary flex items-center gap-2"
          onclick={save}
          disabled={isSavingProvider}
        >
          {#if isSavingProvider}
            <CircleNotch size={14} class="animate-spin" weight="duotone" /> Saving...
          {:else}
            <FloppyDisk size={14} weight="fill" />
            {editingAccount ? "Update" : "Save"} Provider
          {/if}
        </button>
      {:else}
        <button class="btn btn-primary" onclick={onClose}>Done</button>
      {/if}
    </div>
  </div>
</SidePanel>
