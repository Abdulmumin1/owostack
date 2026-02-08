<script lang="ts">
  import {
    Save,
    Eye,
    EyeOff,
    CheckCircle,
    AlertCircle,
    Loader2,
    Copy,
    Check,
    Webhook,
    Settings as SettingsIcon,
    Cpu,
    Lock,
    Plus,
    Trash2,
    Pencil,
    X,
  } from "lucide-svelte";
  import { page } from "$app/state";
  import { organization, apiFetch } from "$lib/auth-client";
  import { getActiveEnvironment } from "$lib/env";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";

  // =========================================================================
  // Types
  // =========================================================================

  interface ProviderAccount {
    id: string;
    organizationId: string;
    providerId: string;
    environment: "test" | "live";
    displayName?: string | null;
    credentials: Record<string, unknown>;
    metadata?: Record<string, unknown> | null;
    createdAt: number;
    updatedAt: number;
  }

  // =========================================================================
  // Supported providers — add new ones here
  // =========================================================================

  const SUPPORTED_PROVIDERS = [
    {
      id: "paystack",
      name: "Paystack",
      description: "Accept payments across Africa",
      color: "teal",
      docsUrl: "https://dashboard.paystack.com/#/settings/developers",
      fields: [
        { key: "secretKey", label: "Secret Key", placeholder: "sk_test_xxxxxxxxxxxxxxx", secret: true },
        { key: "publicKey", label: "Public Key", placeholder: "pk_test_xxxxxxxxxxxxxxx", secret: false },
      ],
    },
    {
      id: "stripe",
      name: "Stripe",
      description: "Global payment infrastructure",
      color: "indigo",
      docsUrl: "https://dashboard.stripe.com/apikeys",
      fields: [
        { key: "secretKey", label: "Secret Key", placeholder: "sk_test_xxxxxxxxxxxxxxx", secret: true },
        { key: "publishableKey", label: "Publishable Key", placeholder: "pk_test_xxxxxxxxxxxxxxx", secret: false },
      ],
    },
    {
      id: "dodopayments",
      name: "Dodo Payments",
      description: "Simple payment processing",
      color: "violet",
      docsUrl: "https://dodopayments.com/docs",
      fields: [
        { key: "secretKey", label: "API Key", placeholder: "dodo_sk_xxxxxxxxxxxxxxx", secret: true },
      ],
    },
  ];

  // =========================================================================
  // State
  // =========================================================================

  let projectId = $derived(page.params.projectId);
  let projectName = $state("");
  let projectSlug = $state("");
  let activeTab = $state("general");

  // Provider accounts
  let providerAccounts = $state<ProviderAccount[]>([]);
  let enabledProviderIds = $state<string[]>([]);
  let isLoadingProviders = $state(true);
  let providerError = $state<string | null>(null);
  let providerSuccess = $state<string | null>(null);

  // Add/Edit form
  let showForm = $state(false);
  let editingAccountId = $state<string | null>(null);
  let formProviderId = $state("paystack");
  let formDisplayName = $state("");
  let formCredentials = $state<Record<string, string>>({});
  let showSecretFields = $state<Record<string, boolean>>({});
  let isSavingProvider = $state(false);
  let formStep = $state<"configure" | "webhook">("configure");
  let lastCreatedProviderId = $state<string | null>(null);

  // Only show providers the API says are enabled
  let availableProviders = $derived(
    SUPPORTED_PROVIDERS.filter((p) => enabledProviderIds.includes(p.id))
  );

  // Delete confirmation
  let deletingId = $state<string | null>(null);
  let isDeleting = $state(false);

  // General settings
  let isSaving = $state(false);
  let isLoading = $state(true);

  // Webhook
  let copiedUrl = $state<string | null>(null);

  // Derived
  let apiBase = $derived(
    typeof window !== "undefined"
      ? window.location.origin.replace("dashboard.", "api.")
      : ""
  );

  let webhookUrls = $derived(
    providerAccounts.length > 0
      ? [...new Set(providerAccounts.map((a) => a.providerId))].map((pid) => ({
          providerId: pid,
          url: `${apiBase}/webhooks/${projectId}/${pid}`,
        }))
      : [{ providerId: "default", url: `${apiBase}/webhooks/${projectId}` }]
  );

  let selectedProviderConfig = $derived(
    availableProviders.find((p) => p.id === formProviderId) ||
    SUPPORTED_PROVIDERS.find((p) => p.id === formProviderId)
  );

  // =========================================================================
  // Load data
  // =========================================================================

  $effect(() => {
    if (projectId) {
      loadOrganization();
      loadProviderAccounts();
      loadEnabledProviders();
    }
  });

  async function loadOrganization() {
    isLoading = true;
    try {
      const { data } = await organization.list();
      const currentOrg = data?.find((o: any) => o.id === projectId);
      if (currentOrg) {
        projectName = currentOrg.name;
        projectSlug = currentOrg.slug;
      }
    } catch (e) {
      console.error("Failed to load organization", e);
    } finally {
      isLoading = false;
    }
  }

  async function loadProviderAccounts() {
    isLoadingProviders = true;
    try {
      const res = await apiFetch(
        `/api/dashboard/providers/accounts?organizationId=${projectId}`,
      );
      if (res.data?.data) {
        providerAccounts = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load provider accounts", e);
    } finally {
      isLoadingProviders = false;
    }
  }

  async function loadEnabledProviders() {
    try {
      const res = await apiFetch(`/api/dashboard/providers/enabled`);
      if (res.data?.data) {
        enabledProviderIds = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load enabled providers", e);
      // Fallback: show paystack only
      enabledProviderIds = ["paystack"];
    }
  }

  // =========================================================================
  // General settings
  // =========================================================================

  async function saveSettings() {
    isSaving = true;
    try {
      await organization.update({
        organizationId: projectId,
        data: { name: projectName, slug: projectSlug },
      });
      await loadOrganization();
    } catch (e) {
      console.error("Failed to update organization", e);
    } finally {
      isSaving = false;
    }
  }

  // =========================================================================
  // Provider CRUD
  // =========================================================================

  function openAddForm() {
    editingAccountId = null;
    formProviderId = availableProviders[0]?.id || "paystack";
    formDisplayName = "";
    formCredentials = {};
    showSecretFields = {};
    showForm = true;
    formStep = "configure";
    lastCreatedProviderId = null;
    providerError = null;
  }

  function openEditForm(account: ProviderAccount) {
    editingAccountId = account.id;
    formProviderId = account.providerId;
    formDisplayName = account.displayName || "";
    formCredentials = {};
    showSecretFields = {};
    showForm = true;
    providerError = null;
  }

  function closeForm() {
    showForm = false;
    editingAccountId = null;
    formCredentials = {};
    formStep = "configure";
    lastCreatedProviderId = null;
  }

  async function saveProviderAccount() {
    isSavingProvider = true;
    providerError = null;
    providerSuccess = null;

    try {
      // Build credentials (only include non-empty values)
      const credentials: Record<string, unknown> = {};
      const providerConfig = SUPPORTED_PROVIDERS.find((p) => p.id === formProviderId);
      if (providerConfig) {
        for (const field of providerConfig.fields) {
          const val = formCredentials[field.key];
          if (val && val.trim().length > 0) {
            credentials[field.key] = val.trim();
          }
        }
      }

      if (editingAccountId) {
        // Update existing
        const res = await apiFetch(
          `/api/dashboard/providers/accounts/${editingAccountId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              organizationId: projectId,
              displayName: formDisplayName || undefined,
              credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
            }),
          },
        );
        if (res.error) throw new Error(res.error.message);
        providerSuccess = "Provider account updated successfully";
      } else {
        // Create new
        if (Object.keys(credentials).length === 0) {
          throw new Error("At least one credential field is required");
        }

        const res = await apiFetch("/api/dashboard/providers/accounts", {
          method: "POST",
          body: JSON.stringify({
            organizationId: projectId,
            providerId: formProviderId,
            environment: getActiveEnvironment(),
            displayName: formDisplayName || undefined,
            credentials,
          }),
        });
        if (res.error) throw new Error(res.error.message);
        providerSuccess = `${providerConfig?.name || formProviderId} connected successfully`;
        lastCreatedProviderId = formProviderId;
        formStep = "webhook";
      }

      await loadProviderAccounts();
      if (formStep !== "webhook") {
        closeForm();
      }
      setTimeout(() => (providerSuccess = null), 3000);
    } catch (e: any) {
      providerError = e.message || "Failed to save provider account";
    } finally {
      isSavingProvider = false;
    }
  }

  async function deleteProviderAccount(id: string) {
    isDeleting = true;
    providerError = null;
    try {
      const res = await apiFetch(
        `/api/dashboard/providers/accounts/${id}?organizationId=${projectId}`,
        { method: "DELETE" },
      );
      if (res.error) throw new Error(res.error.message);
      deletingId = null;
      await loadProviderAccounts();
      providerSuccess = "Provider account removed";
      setTimeout(() => (providerSuccess = null), 3000);
    } catch (e: any) {
      providerError = e.message || "Failed to delete provider account";
    } finally {
      isDeleting = false;
    }
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url);
    copiedUrl = url;
    setTimeout(() => (copiedUrl = null), 2000);
  }

  function getProviderLabel(id: string): string {
    return SUPPORTED_PROVIDERS.find((p) => p.id === id)?.name || id;
  }
</script>

<svelte:head>
  <title>Settings - Owostack</title>
</svelte:head>

<div class="max-w-3xl">
  <div class="mb-8">
    <h1 class="text-xl font-bold text-white mb-2 uppercase tracking-wide flex items-center gap-3">
      Project Settings
      <span class="text-[10px] px-2 py-0.5 border {getActiveEnvironment() === 'live' ? 'border-emerald-500/50 text-emerald-500 bg-emerald-500/5' : 'border-amber-500/50 text-amber-500 bg-amber-500/5'} uppercase tracking-widest font-bold">
        {getActiveEnvironment()}
      </span>
    </h1>
    <p class="text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-bold">
      Configure your project environment
    </p>
  </div>

  <!-- Tabs -->
  <div class="flex items-center border-b border-border mb-8">
    <button
      onclick={() => (activeTab = "general")}
      class="px-6 py-3 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 {activeTab === 'general' ? 'border-accent text-white bg-accent/5' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
    >
      <div class="flex items-center gap-2">
        <SettingsIcon size={14} />
        General
      </div>
    </button>
    <button
      onclick={() => (activeTab = "providers")}
      class="px-6 py-3 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 {activeTab === 'providers' ? 'border-accent text-white bg-accent/5' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
    >
      <div class="flex items-center gap-2">
        <Cpu size={14} />
        Payment Providers
      </div>
    </button>
    <button
      onclick={() => (activeTab = "webhook")}
      class="px-6 py-3 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 {activeTab === 'webhook' ? 'border-accent text-white bg-accent/5' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
    >
      <div class="flex items-center gap-2">
        <Webhook size={14} />
        Webhooks
      </div>
    </button>
  </div>

  <div class="min-h-[400px]">
    {#if isLoading}
      <div class="bg-bg-card border border-border p-8 shadow-md space-y-8">
        <div class="space-y-2">
          <Skeleton class="h-4 w-32" />
          <Skeleton class="h-3 w-48" />
        </div>
        <div class="space-y-6">
          <div class="space-y-2">
            <Skeleton class="h-3 w-24" />
            <Skeleton class="h-10 w-full" />
          </div>
          <div class="space-y-2">
            <Skeleton class="h-3 w-24" />
            <Skeleton class="h-10 w-full" />
          </div>
        </div>
        <div class="flex justify-end">
          <Skeleton class="h-10 w-32" />
        </div>
      </div>

    <!-- ================================================================= -->
    <!-- GENERAL TAB                                                       -->
    <!-- ================================================================= -->
    {:else if activeTab === "general"}
      <div class="bg-bg-card border border-border p-8 shadow-md">
        <div class="mb-8">
          <h3 class="text-xs font-bold text-white mb-1 uppercase tracking-wider">
            Basic Information
          </h3>
          <p class="text-[10px] text-zinc-500 uppercase tracking-widest">Update your project identity</p>
        </div>

        <div class="space-y-8">
          <div>
            <label for="name" class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Project Name</label>
            <input type="text" id="name" bind:value={projectName} class="input w-full" placeholder="e.g. Acme Inc" />
          </div>

          <div>
            <label for="slug" class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Project Slug</label>
            <div class="flex items-center group">
              <span class="bg-bg-secondary border border-r-0 border-border px-4 py-2 text-zinc-500 text-xs font-mono h-[42px] flex items-center">owostack.com/</span>
              <input type="text" id="slug" bind:value={projectSlug} class="input border-l-0 flex-1 h-[42px]" placeholder="acme-slug" />
            </div>
            <p class="mt-2 text-[9px] text-zinc-600 italic">This slug is used in your checkout URLs.</p>
          </div>
        </div>

        <div class="mt-10 pt-6 border-t border-border flex justify-end">
          <button class="btn btn-primary px-8" onclick={saveSettings}>
            {#if isSaving}
              <Loader2 size={16} class="animate-spin" />
              Saving...
            {:else}
              <Save size={16} />
              Save Changes
            {/if}
          </button>
        </div>
      </div>

    <!-- ================================================================= -->
    <!-- PAYMENT PROVIDERS TAB                                             -->
    <!-- ================================================================= -->
    {:else if activeTab === "providers"}
      <div class="space-y-6">
        {#if providerError}
          <div class="p-4 bg-red-900/20 border border-red-500/50 text-red-400 text-xs shadow-inner">
            <div class="flex items-center gap-2">
              <AlertCircle size={14} />
              {providerError}
            </div>
          </div>
        {/if}

        {#if providerSuccess}
          <div class="p-4 bg-emerald-900/20 border border-emerald-500/50 text-emerald-400 text-xs shadow-inner">
            <div class="flex items-center gap-2">
              <CheckCircle size={14} />
              {providerSuccess}
            </div>
          </div>
        {/if}

        <!-- Connected Providers List -->
        <div class="bg-bg-card border border-border p-8 shadow-md">
          <div class="flex items-center justify-between mb-8">
            <div>
              <h3 class="text-xs font-bold text-white uppercase tracking-wider">Connected Providers</h3>
              <p class="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mt-1">
                {providerAccounts.length} provider{providerAccounts.length !== 1 ? "s" : ""} configured
              </p>
            </div>
            <button class="btn btn-primary" onclick={openAddForm}>
              <Plus size={14} />
              Add Provider
            </button>
          </div>

          {#if isLoadingProviders}
            <div class="space-y-4">
              <Skeleton class="h-20 w-full" />
              <Skeleton class="h-20 w-full" />
            </div>
          {:else if providerAccounts.length === 0}
            <div class="text-center py-12 border border-dashed border-border">
              <Cpu size={32} class="mx-auto text-zinc-700 mb-4" />
              <p class="text-xs text-zinc-500 uppercase tracking-widest font-bold mb-2">No providers connected</p>
              <p class="text-[10px] text-zinc-600 mb-6">Connect a payment provider to start accepting payments</p>
              <button class="btn btn-secondary mx-auto" onclick={openAddForm}>
                <Plus size={14} />
                Connect Your First Provider
              </button>
            </div>
          {:else}
            <div class="space-y-3">
              {#each providerAccounts as account (account.id)}
                <div class="border border-border bg-bg-secondary/30 p-5 flex items-center justify-between group hover:border-zinc-600 transition-colors">
                  <div class="flex items-center gap-4">
                    <div class="w-10 h-10 bg-bg-card border border-border flex items-center justify-center">
                      <Cpu size={18} class="text-zinc-500" />
                    </div>
                    <div>
                      <div class="flex items-center gap-2 mb-1">
                        <span class="text-sm font-bold text-white">{account.displayName || getProviderLabel(account.providerId)}</span>
                        <ProviderBadge providerId={account.providerId} size="xs" />
                      </div>
                      <div class="flex items-center gap-3 text-[10px] text-zinc-500 uppercase tracking-widest">
                        <span class="flex items-center gap-1">
                          {#if account.environment === "live"}
                            <span class="w-1.5 h-1.5 bg-emerald-500 inline-block"></span>
                          {:else}
                            <span class="w-1.5 h-1.5 bg-amber-500 inline-block"></span>
                          {/if}
                          {account.environment}
                        </span>
                        <span class="text-zinc-700">|</span>
                        <span class="font-mono">
                          {account.credentials?.secretKey === "****" ? "sk_****" : "configured"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      class="p-2 text-zinc-500 hover:text-white hover:bg-white/5 transition-all border border-transparent hover:border-border"
                      onclick={() => openEditForm(account)}
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>
                    {#if deletingId === account.id}
                      <button
                        class="p-2 text-red-400 bg-red-900/20 border border-red-900/30 hover:bg-red-900/30 transition-all"
                        onclick={() => deleteProviderAccount(account.id)}
                        disabled={isDeleting}
                      >
                        {#if isDeleting}
                          <Loader2 size={14} class="animate-spin" />
                        {:else}
                          <Check size={14} />
                        {/if}
                      </button>
                      <button
                        class="p-2 text-zinc-500 hover:text-white border border-transparent hover:border-border transition-all"
                        onclick={() => (deletingId = null)}
                      >
                        <X size={14} />
                      </button>
                    {:else}
                      <button
                        class="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-900/10 transition-all border border-transparent hover:border-red-900/30"
                        onclick={() => (deletingId = account.id)}
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Add / Edit Provider SidePanel -->
        <SidePanel 
          open={showForm} 
          title={formStep === 'webhook' ? "Configure Webhook" : (editingAccountId ? "Update Provider" : "Add Payment Provider")} 
          onclose={closeForm}
          width="max-w-md"
        >
          <div class="p-6 space-y-8">
            {#if formStep === 'configure'}
              <!-- Provider Selection (only for new) -->
              {#if !editingAccountId}
                <div>
                  <div class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">
                    Select Provider
                  </div>
                  <div class="grid grid-cols-1 gap-3">
                    {#each availableProviders as provider}
                      <button
                        class="p-4 border text-left transition-all {formProviderId === provider.id
                          ? 'border-accent bg-accent/5'
                          : 'border-border bg-bg-secondary/30 hover:border-zinc-600'}"
                        onclick={() => {
                          formProviderId = provider.id;
                          formCredentials = {};
                        }}
                      >
                        <div class="flex items-center gap-2 mb-2">
                          <ProviderBadge providerId={provider.id} size="xs" />
                          <span class="text-xs font-bold text-white">{provider.name}</span>
                        </div>
                        <p class="text-[9px] text-zinc-500">{provider.description}</p>
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}

              <!-- Display Name -->
              <div>
                <label for="displayName" class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">
                  Display Name <span class="text-zinc-700 tracking-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  id="displayName"
                  bind:value={formDisplayName}
                  class="input w-full"
                  placeholder="e.g. Paystack Nigeria Live"
                />
              </div>

              <!-- Credential Fields (dynamic based on provider) -->
              {#if selectedProviderConfig}
                {#each selectedProviderConfig.fields as field}
                  <div>
                    <label for={field.key} class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">
                      {field.label}
                      {#if editingAccountId}
                        <span class="text-zinc-700 tracking-normal">(leave blank to keep current)</span>
                      {/if}
                    </label>
                    <div class="input-icon-wrapper">
                      <Lock size={14} class="input-icon-left" />
                      <input
                        type={field.secret && !showSecretFields[field.key] ? "password" : "text"}
                        id={field.key}
                        bind:value={formCredentials[field.key]}
                        placeholder={field.placeholder}
                        class="input input-has-icon-left pr-12 font-mono text-xs w-full"
                      />
                      {#if field.secret}
                        <button
                          type="button"
                          class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
                          onclick={() => (showSecretFields[field.key] = !showSecretFields[field.key])}
                        >
                          {#if showSecretFields[field.key]}
                            <EyeOff size={16} />
                          {:else}
                            <Eye size={16} />
                          {/if}
                        </button>
                      {/if}
                    </div>
                  </div>
                {/each}

                {#if selectedProviderConfig.docsUrl}
                  <p class="text-[10px] text-zinc-500">
                    Get your keys from
                    <a href={selectedProviderConfig.docsUrl} target="_blank" class="text-accent hover:underline font-bold">
                      {selectedProviderConfig.name} Developer Settings
                    </a>
                  </p>
                {/if}
              {/if}
            {:else if formStep === 'webhook' && lastCreatedProviderId}
              <div class="space-y-6">
                <div class="bg-emerald-500/10 border border-emerald-500/20 p-5 flex items-start gap-4">
                  <CheckCircle size={20} class="text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 class="text-xs font-bold text-white uppercase tracking-wider mb-1">Provider Connected!</h4>
                    <p class="text-[10px] text-emerald-400/80 uppercase tracking-widest">Next, configure your webhook.</p>
                  </div>
                </div>

                <div class="space-y-4">
                  <p class="text-xs text-zinc-400 leading-relaxed">
                    Copy this URL and paste it into your <strong>{getProviderLabel(lastCreatedProviderId)}</strong> developer settings. This is required to receive payment notifications.
                  </p>

                  <div>
                    <div class="flex items-center gap-2 mb-3">
                      <div class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                        {getProviderLabel(lastCreatedProviderId)} Webhook URL
                      </div>
                      <ProviderBadge providerId={lastCreatedProviderId} size="xs" />
                    </div>
                    <div class="bg-black border border-border p-4 flex items-center gap-4 group transition-colors hover:border-zinc-500 shadow-inner">
                      <code class="flex-1 font-mono text-[10px] text-zinc-300 break-all select-all">
                        {apiBase}/webhooks/{projectId}/{lastCreatedProviderId}
                      </code>
                      <button
                        class="p-2.5 bg-bg-card border border-border hover:border-accent text-zinc-500 hover:text-accent transition-all shadow-lg shrink-0"
                        onclick={() => copyUrl(`${apiBase}/webhooks/${projectId}/${lastCreatedProviderId}`)}
                        title="Copy to clipboard"
                      >
                        {#if copiedUrl === `${apiBase}/webhooks/${projectId}/${lastCreatedProviderId}`}
                          <Check size={16} class="text-emerald-500" />
                        {:else}
                          <Copy size={16} />
                        {/if}
                      </button>
                    </div>
                  </div>
                </div>

                <div class="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 p-4">
                  <AlertCircle size={16} class="text-amber-500 shrink-0 mt-0.5" />
                  <p class="text-[10px] text-amber-500 uppercase tracking-widest font-bold leading-tight">
                    Critical: Webhooks ensure your subscriptions stay in sync. Do not skip this step.
                  </p>
                </div>
              </div>
            {/if}
          </div>

          <div class="p-6 border-t border-border flex items-center justify-between sticky bottom-0 bg-bg-secondary">
            {#if formStep === 'configure'}
              <button class="btn btn-ghost" onclick={closeForm}>Cancel</button>
              <button
                class="btn btn-primary px-8"
                onclick={saveProviderAccount}
                disabled={isSavingProvider}
              >
                {#if isSavingProvider}
                  <Loader2 size={16} class="animate-spin" />
                  Saving...
                {:else}
                  <Save size={16} />
                  {editingAccountId ? "Update" : "Connect Provider"}
                {/if}
              </button>
            {:else}
              <button class="btn btn-ghost" onclick={closeForm}>Done</button>
              <button class="btn btn-primary px-8" onclick={closeForm}>
                I've Configured It
              </button>
            {/if}
          </div>
        </SidePanel>
      </div>

    <!-- ================================================================= -->
    <!-- WEBHOOKS TAB                                                      -->
    <!-- ================================================================= -->
    {:else if activeTab === "webhook"}
      <div class="bg-bg-card border border-border p-8 shadow-md">
        <div class="flex items-center gap-4 mb-10">
          <div class="w-12 h-12 bg-accent/10 flex items-center justify-center">
            <Webhook size={24} class="text-accent" />
          </div>
          <div>
            <h3 class="text-xs font-bold text-white uppercase tracking-wider">
              Webhook Configuration
            </h3>
          
          </div>
        </div>

        <div class="space-y-8">
          <div class="bg-bg-secondary/30 border border-border p-5">
            <p class="text-xs text-zinc-400 leading-relaxed">
              Register the appropriate webhook URL in each payment provider's dashboard.
              This allows Owostack to track lifecycle events like renewals, cancellations, and payment failures.
            </p>
          </div>

          <!-- Provider-specific webhook URLs -->
          <div class="space-y-4">
            {#each webhookUrls as wh}
              <div>
                <div class="flex items-center gap-2 mb-3">
                  <div class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                    {wh.providerId === "default" ? "Webhook URL" : `${getProviderLabel(wh.providerId)} Webhook`}
                  </div>
                  {#if wh.providerId !== "default"}
                    <ProviderBadge providerId={wh.providerId} size="xs" />
                  {/if}
                </div>
                <div class="bg-black border border-border p-4 flex items-center gap-4 group transition-colors hover:border-zinc-500 shadow-inner">
                  <code class="flex-1 font-mono text-xs text-zinc-300 break-all select-all">
                    {wh.url}
                  </code>
                  <button
                    class="p-2.5 bg-bg-card border border-border hover:border-accent text-zinc-500 hover:text-accent transition-all shadow-lg shrink-0"
                    onclick={() => copyUrl(wh.url)}
                    title="Copy to clipboard"
                  >
                    {#if copiedUrl === wh.url}
                      <Check size={16} class="text-emerald-500" />
                    {:else}
                      <Copy size={16} />
                    {/if}
                  </button>
                </div>
              </div>
            {/each}
          </div>

          <div class="flex items-start gap-4 bg-blue-900/10 border border-blue-900/30 p-5 shadow-sm">
            <AlertCircle size={18} class="flex-shrink-0 text-blue-400 mt-0.5" />
            <div class="space-y-2">
              <h4 class="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Why are webhooks required?</h4>
              <p class="text-xs text-blue-400/80 leading-relaxed">
                Without webhooks, Owostack cannot know when a payment is completed.
                Webhooks ensure your database stays in sync with real-world transactions — renewals, cancellations, and failures are all tracked automatically.
              </p>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .input {
    height: 42px;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 0;
    padding-left: 1rem;
    padding-right: 1rem;
    color: white;
    outline: none;
    transition: border-color 0.15s ease-in-out;
  }

  .input:focus {
    border-color: var(--color-accent);
  }

  .input::placeholder {
    color: #27272a;
  }
</style>
