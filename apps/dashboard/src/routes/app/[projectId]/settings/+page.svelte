<script lang="ts">
  import { CircleNotch, Gear, Key, Cpu, Globe, Receipt, Users } from "phosphor-svelte";
  import { page } from "$app/state";
  import { organization, apiFetch, authClient } from "$lib/auth-client";
  import { getActiveEnvironment, getApiUrl } from "$lib/env";
  import { SUPPORTED_PROVIDERS } from "$lib/providers";
  import { fade } from "svelte/transition";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import GeneralTab from "./components/GeneralTab.svelte";
  import KeysTab from "./components/KeysTab.svelte";
  import TeamTab from "./components/TeamTab.svelte";
  import ProvidersTab from "./components/ProvidersTab.svelte";
  import WebhooksTab from "./components/WebhooksTab.svelte";
  import OverageTab from "./components/OverageTab.svelte";
  import ProviderForm from "./components/ProviderForm.svelte";
  import type { ProviderAccount, ApiKey, TeamMember, WebhookUrl } from "./components/types";

  // =========================================================================
  // Tab Configuration
  // =========================================================================
  const tabs = [
    { id: "general", label: "General", icon: Gear, description: "Organization details & currency", color: "text-zinc-500" },
    { id: "keys", label: "API Keys", icon: Key, description: "Manage access tokens", color: "text-amber-500" },
    { id: "providers", label: "Payment Providers", icon: Cpu, description: "Connect gateways", color: "text-emerald-500" },
    { id: "webhook", label: "Webhooks", icon: Globe, description: "Event notifications", color: "text-blue-500" },
    { id: "overage", label: "Overage Billing", icon: Receipt, description: "Usage limits & billing", color: "text-rose-500" },
    { id: "team", label: "Team Members", icon: Users, description: "Manage access & roles", color: "text-indigo-500" },
  ];

  // =========================================================================
  // State
  // =========================================================================
  let pageParams = $derived(page.params);
  let projectId = $derived(pageParams.projectId ?? "");
  let activeTab = $state("general");
  let isLoading = $state(true);

  // Data State
  let projectName = $state("");
  let projectSlug = $state("");
  let orgCurrency = $state("USD");
  let members = $state<TeamMember[]>([]);
  let apiKeys = $state<ApiKey[]>([]);
  let providerAccounts = $state<ProviderAccount[]>([]);
  let enabledProviderIds = $state<string[]>([]);
  let overageSettings = $state({
    billingInterval: "end_of_period",
    thresholdAmount: null as number | null,
    autoCollect: false,
    gracePeriodHours: 0
  });

  // Provider Form State
  let showProviderForm = $state(false);
  let editingProviderAccount = $state<ProviderAccount | null>(null);

  // Derived
  let apiBase = $derived(getApiUrl());

  let webhookUrls = $derived(
    providerAccounts.length > 0
      ? [...new Set(providerAccounts.map((a) => a.providerId))].map((pid) => ({
          providerId: pid,
          url: `${apiBase}/webhooks/${projectId}/${pid}`,
        }))
      : [{ providerId: "default", url: `${apiBase}/webhooks/${projectId}` }]
  );

  // =========================================================================
  // Loaders
  // =========================================================================
  $effect(() => {
    const currentId = pageParams.projectId;
    if (currentId) {
      loadAllData();
    }
  });

  async function loadAllData() {
    isLoading = true;
    try {
      await Promise.all([
        loadOrganization(),
        loadDefaultCurrency(),
        loadTeam(),
        loadApiKeys(),
        loadProviderAccounts(),
        loadEnabledProviders(),
        loadOverageSettings()
      ]);
    } catch (e) {
      console.error("Failed to load settings data", e);
    } finally {
      isLoading = false;
    }
  }

  async function loadOrganization() {
    const { data } = await organization.list();
    const currentOrg = data?.find((o: any) => o.id === projectId);
    if (currentOrg) {
      projectName = currentOrg.name;
      projectSlug = currentOrg.slug;
    }
  }

  async function loadDefaultCurrency() {
    const res = await apiFetch(`/api/dashboard/config/default-currency?organizationId=${projectId}`);
    if (res.data?.data?.defaultCurrency) {
      orgCurrency = res.data.data.defaultCurrency;
    }
  }

  async function loadTeam() {
    const res = await authClient.organization.listMembers();
    if (res.data) {
      members = Array.isArray(res.data) ? res.data : (res.data as any).members || [];
    }
  }

  async function loadApiKeys() {
    const res = await apiFetch(`/api/dashboard/keys?organizationId=${projectId}`);
    if (res.data?.success) {
      apiKeys = res.data.data;
    }
  }

  async function loadProviderAccounts() {
    const res = await apiFetch(`/api/dashboard/providers/accounts?organizationId=${projectId}`);
    if (res.data?.data) {
      providerAccounts = res.data.data;
    }
  }

  async function loadEnabledProviders() {
    try {
      const res = await apiFetch(`/api/dashboard/providers/enabled`);
      if (res.data?.data) enabledProviderIds = res.data.data;
    } catch (e) {
      enabledProviderIds = SUPPORTED_PROVIDERS.map((p) => p.id);
    }
  }

  async function loadOverageSettings() {
    const res = await apiFetch(`/api/dashboard/overage-settings?organizationId=${projectId}`);
    if (res.data?.data) {
      overageSettings = {
        billingInterval: res.data.data.billingInterval || "end_of_period",
        thresholdAmount: res.data.data.thresholdAmount,
        autoCollect: !!res.data.data.autoCollect,
        gracePeriodHours: res.data.data.gracePeriodHours || 0
      };
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================
  function formatDate(date: string | number) {
    return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function openAddProvider() {
    editingProviderAccount = null;
    showProviderForm = true;
  }

  function openEditProvider(account: ProviderAccount) {
    editingProviderAccount = account;
    showProviderForm = true;
  }

  function closeProviderForm() {
    showProviderForm = false;
    editingProviderAccount = null;
  }

  function handleProviderSaved() {
    loadProviderAccounts();
  }
</script>

<svelte:head>
  <title>Settings - Owostack</title>
</svelte:head>

<div class="max-w-6xl mx-auto">
  <div class="mb-8">
    <div class="flex items-center gap-3 mb-2">
      <h1 class="text-2xl font-bold text-text-primary">Project Settings</h1>
      <span class="text-[10px] px-2 py-0.5 border {getActiveEnvironment() === 'live' ? 'border-success text-success bg-success-bg' : 'border-warning text-warning bg-warning-bg'} uppercase tracking-widest font-bold rounded-sm">
        {getActiveEnvironment()} Mode
      </span>
    </div>
    <p class="text-text-dim text-sm">Configure your project preferences, team, and integrations</p>
  </div>

  <!-- Horizontal Tabs -->
  <div class="flex items-center border-b border-border mb-8 overflow-x-auto">
    {#each tabs as tab (tab.id)}
      <button
        onclick={() => (activeTab = tab.id)}
        class="flex items-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-widest transition-all border-b-2 whitespace-nowrap {activeTab === tab.id
          ? 'border-accent text-text-primary bg-accent/5'
          : 'border-transparent text-text-dim hover:text-text-secondary hover:border-text-dim'}"
      >
        <tab.icon weight={activeTab === tab.id ? 'fill' : 'duotone'} class={activeTab === tab.id ? 'text-accent' : tab.color} />
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Main Content -->
  <div class="bg-bg-card border border-border rounded-lg overflow-hidden min-h-[600px]">
    {#if isLoading}
      <div class="flex items-center justify-center h-full min-h-[400px]">
        <CircleNotch size={32} class="animate-spin text-text-dim" />
      </div>
    {:else}
      {#if activeTab === "general"}
        <div class="p-8" in:fade={{ duration: 200 }}>
          <h2 class="text-lg font-bold text-text-primary mb-6">General</h2>
          <GeneralTab 
            {projectId} 
            initialName={projectName}
            initialSlug={projectSlug}
            initialCurrency={orgCurrency}
          />
        </div>
      {/if}

      {#if activeTab === "keys"}
        <div class="p-8" in:fade={{ duration: 200 }}>
          <KeysTab {projectId} {apiKeys} {formatDate} />
        </div>
      {/if}

      {#if activeTab === "team"}
        <div class="p-8" in:fade={{ duration: 200 }}>
          <TeamTab {projectId} {members} {formatDate} />
        </div>
      {/if}

      {#if activeTab === "providers"}
        <div class="p-8" in:fade={{ duration: 200 }}>
          <ProvidersTab 
            {projectId} 
            accounts={providerAccounts}
            {enabledProviderIds}
            onEdit={openEditProvider}
            onAdd={openAddProvider}
          />
        </div>
      {/if}

      {#if activeTab === "webhook"}
        <div class="p-8" in:fade={{ duration: 200 }}>
          <WebhooksTab {webhookUrls} />
        </div>
      {/if}

      {#if activeTab === "overage"}
        <div class="p-8" in:fade={{ duration: 200 }}>
          <OverageTab {projectId} initialSettings={overageSettings} />
        </div>
      {/if}
    {/if}
  </div>
</div>

<ProviderForm
  open={showProviderForm}
  {projectId}
  editingAccount={editingProviderAccount}
  availableProviderIds={enabledProviderIds}
  onClose={closeProviderForm}
  onSaved={handleProviderSaved}
/>
