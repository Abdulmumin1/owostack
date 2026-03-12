<script lang="ts">
  import {
    CircleNotch,
    Gear,
    Key,
    Cpu,
    Globe,
    Receipt,
    Users,
    User,
    X,
  } from "phosphor-svelte";
  import { organization, apiFetch, authClient } from "$lib/auth-client";
  import { getActiveEnvironment, getApiUrl } from "$lib/env";
  import { SUPPORTED_PROVIDERS } from "$lib/providers";
  import { fade, scale } from "svelte/transition";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import GeneralTab from "./GeneralTab.svelte";
  import AccountTab from "./AccountTab.svelte";
  import KeysTab from "./KeysTab.svelte";
  import TeamTab from "./TeamTab.svelte";
  import ProvidersTab from "./ProvidersTab.svelte";
  import WebhooksTab from "./WebhooksTab.svelte";
  import OverageTab from "./OverageTab.svelte";
  import ProviderForm from "./ProviderForm.svelte";
  import type {
    ProviderAccount,
    ApiKey,
    TeamMember,
    WebhookUrl,
  } from "./types";

  let {
    projectId,
    open = $bindable(false),
    activeTab = $bindable("general"),
    onClose,
  } = $props<{
    projectId: string;
    open?: boolean;
    activeTab?: string;
    onClose?: () => void;
  }>();

  // =========================================================================
  // Tab Configuration
  // =========================================================================
  const tabs = [
    {
      id: "general",
      label: "General",
      icon: Gear,
      description: "",
      color: "text-zinc-500",
    },
    {
      id: "account",
      label: "Account Settings",
      icon: User,
      description: "Personal profile",
      color: "text-zinc-500",
    },
    {
      id: "keys",
      label: "API Keys",
      icon: Key,
      description: "Manage access tokens",
      color: "text-amber-500",
    },
    {
      id: "providers",
      label: "Payment Providers",
      icon: Cpu,
      description: "Connect gateways",
      color: "text-emerald-500",
    },
    {
      id: "webhook",
      label: "Webhooks",
      icon: Globe,
      description: "Event notifications",
      color: "text-blue-500",
    },
    {
      id: "overage",
      label: "Overage Billing",
      icon: Receipt,
      description: "Usage limits & billing",
      color: "text-rose-500",
    },
    {
      id: "team",
      label: "Team Members",
      icon: Users,
      description: "Manage access & roles",
      color: "text-indigo-500",
    },
  ];

  // =========================================================================
  // State
  // =========================================================================
  let isLoading = $state(true);

  // Data State
  let projectName = $state("");
  let projectSlug = $state("");
  let organizationId = $state("");
  let orgCurrency = $state("USD");
  let members = $state<TeamMember[]>([]);
  let apiKeys = $state<ApiKey[]>([]);
  let providerAccounts = $state<ProviderAccount[]>([]);
  let enabledProviderIds = $state<string[]>([]);
  let overageSettings = $state({
    billingInterval: "end_of_period",
    thresholdAmount: null as number | null,
    autoCollect: false,
    gracePeriodHours: 0,
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
      : [{ providerId: "default", url: `${apiBase}/webhooks/${projectId}` }],
  );

  // =========================================================================
  // Loaders
  // =========================================================================
  $effect(() => {
    if (open && projectId) {
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
        loadOverageSettings(),
      ]);
    } catch (e) {
      console.error("Failed to load settings data", e);
    } finally {
      isLoading = false;
    }
  }

  async function loadOrganization() {
    console.log(
      "[SettingsModal] Loading organization for projectId:",
      projectId,
    );
    const { data, error } = await organization.list();

    if (error) {
      console.error("[SettingsModal] Failed to list organizations:", error);
      return;
    }

    console.log("[SettingsModal] Got organizations:", data?.length || 0, data);
    const currentOrg = data?.find((o: any) => o.slug === projectId);

    if (currentOrg) {
      console.log(
        "[SettingsModal] Found matching org:",
        currentOrg.id,
        currentOrg.name,
      );
      projectName = currentOrg.name;
      projectSlug = currentOrg.slug;
      organizationId = currentOrg.id;
    } else {
      console.error(
        "[SettingsModal] No organization found with slug:",
        projectId,
      );
    }
  }

  async function loadDefaultCurrency() {
    const res = await apiFetch(
      `/api/dashboard/config/default-currency?organizationId=${projectId}`,
    );
    if (res.data?.data?.defaultCurrency) {
      orgCurrency = res.data.data.defaultCurrency;
    }
  }

  async function loadTeam() {
    const res = await authClient.organization.listMembers();
    if (res.data) {
      members = Array.isArray(res.data)
        ? res.data
        : (res.data as any).members || [];
    }
  }

  async function loadApiKeys() {
    const res = await apiFetch(
      `/api/dashboard/keys?organizationId=${projectId}`,
    );
    if (res.data?.success) {
      apiKeys = res.data.data;
    }
  }

  async function loadProviderAccounts() {
    const res = await apiFetch(
      `/api/dashboard/providers/accounts?organizationId=${projectId}`,
    );
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
    const res = await apiFetch(
      `/api/dashboard/overage-settings?organizationId=${projectId}`,
    );
    if (res.data?.data) {
      overageSettings = {
        billingInterval: res.data.data.billingInterval || "end_of_period",
        thresholdAmount: res.data.data.thresholdAmount,
        autoCollect: !!res.data.data.autoCollect,
        gracePeriodHours: res.data.data.gracePeriodHours || 0,
      };
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================
  function formatDate(date: string | number) {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
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

  function handleClose() {
    open = false;
    if (onClose) onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open && !showProviderForm) {
      e.preventDefault();
      handleClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
    in:fade={{ duration: 100 }}
    out:fade={{ duration: 100 }}
  >
    <!-- Backdrop -->
    <button
      class="absolute inset-0 bg-bg-primary/50 backdrop-blur-sm cursor-default w-full h-full border-none p-0"
      onclick={handleClose}
      aria-label="Close Settings"
    ></button>

    <!-- Modal Container -->
    <div
      class="relative bg-bg-primary border border-border rounded-xl shadow-lg flex w-full max-w-5xl h-[85vh] overflow-hidden"
      onclick={(e) => e.stopPropagation()}
      transition:scale={{ duration: 150, start: 0.95 }}
    >
      <!-- Sidebar -->
      <div
        class="w-64 bg-bg-secondary border-r border-border flex flex-col pt-6 pb-6"
      >
        <div class="flex flex-col mb-4">
          <div class="flex items-center justify-between px-6 mb-6">
            <h2
              class="text-sm font-bold text-text-primary uppercase tracking-widest"
            >
              Settings
            </h2>
            <button
              class="text-text-dim hover:text-text-primary p-1 bg-bg-card rounded-md border border-border"
              onclick={handleClose}
            >
              <X size={14} weight="bold" />
            </button>
          </div>
        </div>

        <nav class="flex-1 space-y-1 px-3 overflow-y-auto">
          {#each tabs as tab}
            <button
              class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-200 {activeTab ===
              tab.id
                ? 'bg-bg-card text-text-primary  border border-border/50'
                : 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-primary border border-transparent'}"
              onclick={() => (activeTab = tab.id)}
            >
              <tab.icon
                size={16}
                weight={activeTab === tab.id ? "fill" : "duotone"}
                class={tab.color}
              />
              <div class="flex flex-col">
                <span
                  class="text-[13px] font-medium leading-none mb-1 {activeTab ===
                  tab.id
                    ? 'text-text-primary font-bold'
                    : ''}">{tab.label}</span
                >
                <span
                  class="text-[9px] text-text-dim uppercase tracking-widest leading-none"
                  >{tab.description}</span
                >
              </div>
            </button>
          {/each}
        </nav>
      </div>

      <!-- Main Content Area -->
      <div class="flex-1 overflow-auto bg-bg-primary relative flex flex-col">
        {#if isLoading}
          <div class="flex items-center justify-center h-full">
            <div class="flex flex-col items-center gap-2">
              <CircleNotch size={32} class="animate-spin text-text-dim" />
              <span
                class="text-xs font-bold text-text-dim uppercase tracking-widest"
                >Loading...</span
              >
            </div>
          </div>
        {:else}
          <div class="flex-1 relative">
            {#if activeTab === "general"}
              <div
                class="p-8 sm:p-10 max-w-3xl mx-auto w-full absolute inset-0 overflow-auto"
                in:fade={{ duration: 150 }}
              >
                <div class="mb-8">
                  <h2 class="text-xl font-bold text-text-primary mb-1">
                    General Settings
                  </h2>
                  <p
                    class="text-xs font-bold text-text-dim uppercase tracking-widest"
                  >
                    Organization & identity
                  </p>
                </div>
                <GeneralTab
                  {projectId}
                  initialName={projectName}
                  initialSlug={projectSlug}
                  initialCurrency={orgCurrency}
                />
              </div>
            {/if}

            {#if activeTab === "account"}
              <div
                class="p-8 sm:p-10 max-w-3xl mx-auto w-full absolute inset-0 overflow-auto"
                in:fade={{ duration: 150 }}
              >
                <div class="mb-8">
                  <h2 class="text-xl font-bold text-text-primary mb-1">
                    Account Settings
                  </h2>
                  <p
                    class="text-xs font-bold text-text-dim uppercase tracking-widest"
                  >
                    Personal profile settings
                  </p>
                </div>
                <AccountTab />
              </div>
            {/if}

            {#if activeTab === "keys"}
              <div
                class="p-8 sm:p-10 max-w-4xl mx-auto w-full absolute inset-0 overflow-auto"
                in:fade={{ duration: 150 }}
              >
                <div class="mb-8">
                  <h2 class="text-xl font-bold text-text-primary mb-1">
                    API Keys
                  </h2>
                  <p
                    class="text-xs font-bold text-text-dim uppercase tracking-widest"
                  >
                    Manage access tokens
                  </p>
                </div>
                <KeysTab {projectId} {apiKeys} {formatDate} />
              </div>
            {/if}

            {#if activeTab === "team"}
              <div
                class="p-8 sm:p-10 max-w-4xl mx-auto w-full absolute inset-0 overflow-auto"
                in:fade={{ duration: 150 }}
              >
                <div class="mb-8">
                  <h2 class="text-xl font-bold text-text-primary mb-1">
                    Team Members
                  </h2>
                  <p
                    class="text-xs font-bold text-text-dim uppercase tracking-widest"
                  >
                    Manage organization access
                  </p>
                </div>
                <TeamTab {projectId} {organizationId} {members} {formatDate} />
              </div>
            {/if}

            {#if activeTab === "providers"}
              <div
                class="p-8 sm:p-10 max-w-4xl mx-auto w-full absolute inset-0 overflow-auto"
                in:fade={{ duration: 150 }}
              >
                <div class="mb-8 flex items-center justify-between">
                  <div>
                    <h2 class="text-xl font-bold text-text-primary mb-1">
                      Payment Providers
                    </h2>
                    <p
                      class="text-xs font-bold text-text-dim uppercase tracking-widest"
                    >
                      Connect payment gateways
                    </p>
                  </div>
                  <span
                    class="text-[10px] px-2 py-0.5 border {getActiveEnvironment() ===
                    'live'
                      ? 'border-success text-success bg-success-bg'
                      : 'border-warning text-warning bg-warning-bg'} uppercase tracking-widest font-bold rounded-sm"
                  >
                    {getActiveEnvironment()} Mode
                  </span>
                </div>
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
              <div
                class="p-8 sm:p-10 max-w-4xl mx-auto w-full absolute inset-0 overflow-auto"
                in:fade={{ duration: 150 }}
              >
                <div class="mb-8">
                  <h2 class="text-xl font-bold text-text-primary mb-1">
                    Webhooks
                  </h2>
                  <p
                    class="text-xs font-bold text-text-dim uppercase tracking-widest"
                  >
                    Real-time event notifications
                  </p>
                </div>
                <WebhooksTab {webhookUrls} />
              </div>
            {/if}

            {#if activeTab === "overage"}
              <div
                class="p-8 sm:p-10 max-w-3xl mx-auto w-full absolute inset-0 overflow-auto"
                in:fade={{ duration: 150 }}
              >
                <div class="mb-8">
                  <h2 class="text-xl font-bold text-text-primary mb-1">
                    Overage Billing Settings
                  </h2>
                  <p
                    class="text-xs font-bold text-text-dim uppercase tracking-widest"
                  >
                    Configure usage limits and collections
                  </p>
                </div>
                <OverageTab {projectId} initialSettings={overageSettings} />
              </div>
            {/if}
          </div>
        {/if}
      </div>
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
{/if}
