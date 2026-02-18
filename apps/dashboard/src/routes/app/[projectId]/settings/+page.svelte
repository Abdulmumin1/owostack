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
    Settings,
    Cpu,
    Lock,
    Plus,
    Trash2,
    Pencil,
    X,
    Receipt,
    Users,
    Key,
    LogOut,
    Shield
  } from "lucide-svelte";
  import { page } from "$app/state";
  import { organization, apiFetch, authClient, useSession } from "$lib/auth-client";
  import { getActiveEnvironment } from "$lib/env";
  import { SUPPORTED_PROVIDERS } from "$lib/providers";
  import { defaultCurrency } from "$lib/stores/currency";
  import { COMMON_CURRENCIES } from "$lib/utils/currency";
  import { fade } from "svelte/transition";
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
  // State
  // =========================================================================

  let projectId = $derived(page.params.projectId);
  let activeTab = $state("general");
  
  // Organization Data
  let projectName = $state("");
  let projectSlug = $state("");
  let orgCurrency = $state("USD");
  let isLoading = $state(true);
  let isSaving = $state(false);
  let successMessage = $state<string | null>(null);

  // Team
  let members = $state<any[]>([]);
  let inviteEmail = $state("");
  let inviteRole = $state("member");
  let isInviting = $state(false);

  // API Keys
  let apiKeys = $state<any[]>([]);
  let showKeyModal = $state(false);
  let newKeyName = $state("");
  let generatedKey = $state("");
  let isCreatingKey = $state(false);

  // Providers
  let providerAccounts = $state<ProviderAccount[]>([]);
  let enabledProviderIds = $state<string[]>([]);
  let isLoadingProviders = $state(true);
  
  // Provider Form
  let showForm = $state(false);
  let editingAccountId = $state<string | null>(null);
  let formProviderId = $state("paystack");
  let formDisplayName = $state("");
  let formCredentials = $state<Record<string, string>>({});
  let showSecretFields = $state<Record<string, boolean>>({});
  let isSavingProvider = $state(false);
  let formStep = $state<"configure" | "webhook">("configure");
  let lastCreatedProviderId = $state<string | null>(null);
  let providerError = $state<string | null>(null);
  let providerSuccess = $state<string | null>(null);
  let deletingId = $state<string | null>(null);
  let isDeleting = $state(false);

  // Overage
  let overageBillingInterval = $state("end_of_period");
  let overageThresholdAmount = $state<number | null>(null);
  let overageAutoCollect = $state(false);
  let overageGracePeriodHours = $state(0);
  let isSavingOverage = $state(false);

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

  let availableProviders = $derived(
    SUPPORTED_PROVIDERS.filter((p) => enabledProviderIds.includes(p.id))
  );

  let selectedProviderConfig = $derived(
    availableProviders.find((p) => p.id === formProviderId) ||
    SUPPORTED_PROVIDERS.find((p) => p.id === formProviderId)
  );

  const tabs = [
    { id: "general", label: "General", icon: Settings, description: "Organization details & currency" },
    { id: "keys", label: "API Keys", icon: Key, description: "Manage access tokens" },
    { id: "providers", label: "Payment Providers", icon: Cpu, description: "Connect gateways" },
    { id: "webhook", label: "Webhooks", icon: Webhook, description: "Event notifications" },
    { id: "overage", label: "Overage Billing", icon: Receipt, description: "Usage limits & billing" },
    { id: "team", label: "Team Members", icon: Users, description: "Manage access & roles" },
  ];

  // =========================================================================
  // Loaders
  // =========================================================================

  $effect(() => {
    if (projectId) {
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
        // Better auth usually returns array, handle if it's nested
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
      enabledProviderIds = ["paystack", "dodopayments"];
    }
  }

  async function loadOverageSettings() {
    const res = await apiFetch(`/api/dashboard/overage-settings?organizationId=${projectId}`);
    if (res.data?.data) {
      overageBillingInterval = res.data.data.billingInterval || "end_of_period";
      overageThresholdAmount = res.data.data.thresholdAmount;
      overageAutoCollect = !!res.data.data.autoCollect;
      overageGracePeriodHours = res.data.data.gracePeriodHours || 0;
    }
  }

  // =========================================================================
  // Actions
  // =========================================================================

  async function saveGeneralSettings() {
    isSaving = true;
    try {
      // Save Org Name/Slug
      await organization.update({
        organizationId: projectId,
        data: { name: projectName, slug: projectSlug },
      });
      
      // Save Currency
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

  async function inviteMember() {
    if (!inviteEmail) return;
    isInviting = true;
    try {
        await authClient.organization.inviteMember({
            email: inviteEmail,
            role: inviteRole as "member" | "admin" | "owner",
            organizationId: projectId
        });
        showSuccess("Invitation sent");
        inviteEmail = "";
    } catch (e) {
        console.error("Failed to invite", e);
    } finally {
        isInviting = false;
    }
  }

  async function createApiKey() {
    if (!newKeyName) return;
    isCreatingKey = true;
    try {
      const res = await apiFetch("/api/dashboard/keys", {
        method: "POST",
        body: JSON.stringify({
          organizationId: projectId,
          name: newKeyName
        })
      });
      
      if (res.data?.success) {
        generatedKey = res.data.data.secretKey;
        await loadApiKeys();
        newKeyName = "";
      }
    } catch (e) {
      console.error("Failed to create key", e);
    } finally {
      isCreatingKey = false;
    }
  }

  async function deleteApiKey(id: string) {
    console.log("Deleting key:", id);
    if (!confirm("Are you sure you want to revoke this API key?")) return;
    
    try {
      const res = await apiFetch(`/api/dashboard/keys/${id}?organizationId=${projectId}`, {
        method: "DELETE"
      });
      console.log("Delete response:", res);
      if (res.data?.success) {
        await loadApiKeys();
      } else {
        alert("Failed to delete key: " + (res.data?.error || "Unknown error"));
      }
    } catch (e: any) {
      console.error("Failed to delete key", e);
      alert("Error: " + e.message);
    }
  }

  // Provider & Overage actions maintained from original logic...
  // (Simplified for brevity, assuming they call the APIs correctly)
  // Re-implementing critical ones:

  async function saveProviderAccount() {
    isSavingProvider = true;
    providerError = null;
    try {
      const credentials: Record<string, unknown> = {};
      const providerConfig = SUPPORTED_PROVIDERS.find((p) => p.id === formProviderId);
      if (providerConfig) {
        for (const field of providerConfig.fields) {
          const val = formCredentials[field.key];
          if (val && val.trim().length > 0) credentials[field.key] = val.trim();
        }
      }

      if (editingAccountId) {
        await apiFetch(`/api/dashboard/providers/accounts/${editingAccountId}`, {
          method: "PATCH",
          body: JSON.stringify({
            organizationId: projectId,
            displayName: formDisplayName || undefined,
            credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
          }),
        });
      } else {
        if (Object.keys(credentials).length === 0) throw new Error("Credentials required");
        await apiFetch("/api/dashboard/providers/accounts", {
          method: "POST",
          body: JSON.stringify({
            organizationId: projectId,
            providerId: formProviderId,
            environment: getActiveEnvironment(),
            displayName: formDisplayName || undefined,
            credentials,
          }),
        });
        lastCreatedProviderId = formProviderId;
        formStep = "webhook";
      }
      await loadProviderAccounts();
      if (formStep !== "webhook") closeForm();
    } catch (e: any) {
      providerError = e.message;
    } finally {
      isSavingProvider = false;
    }
  }

  async function deleteProviderAccount(id: string) {
    isDeleting = true;
    try {
      await apiFetch(`/api/dashboard/providers/accounts/${id}?organizationId=${projectId}`, { method: "DELETE" });
      await loadProviderAccounts();
      deletingId = null;
    } catch (e) { console.error(e); } finally { isDeleting = false; }
  }

  async function saveOverageSettings() {
    isSavingOverage = true;
    try {
      await apiFetch(`/api/dashboard/overage-settings`, {
        method: "PUT",
        body: JSON.stringify({
          organizationId: projectId,
          billingInterval: overageBillingInterval,
          thresholdAmount: overageBillingInterval === "threshold" ? overageThresholdAmount : null,
          autoCollect: overageAutoCollect,
          gracePeriodHours: overageGracePeriodHours,
        }),
      });
      showSuccess("Overage settings saved");
    } catch (e) { console.error(e); } finally { isSavingOverage = false; }
  }

  // Helpers
  function showSuccess(msg: string) {
    successMessage = msg;
    setTimeout(() => successMessage = null, 3000);
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url);
    copiedUrl = url;
    setTimeout(() => (copiedUrl = null), 2000);
  }

  function getProviderLabel(id: string): string {
    return SUPPORTED_PROVIDERS.find((p) => p.id === id)?.name || id;
  }

  function formatDate(date: string | number) {
    return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  // Form helpers
  function openAddForm() {
    editingAccountId = null;
    formProviderId = availableProviders[0]?.id || "paystack";
    formDisplayName = "";
    formCredentials = {};
    showForm = true;
    formStep = "configure";
  }

  function openEditForm(account: ProviderAccount) {
    editingAccountId = account.id;
    formProviderId = account.providerId;
    formDisplayName = account.displayName || "";
    formCredentials = {};
    showForm = true;
  }

  function closeForm() { showForm = false; }
</script>

<svelte:head>
  <title>Settings - Owostack</title>
</svelte:head>

<div class="max-w-6xl mx-auto">
  <div class="mb-8">
    <div class="flex items-center gap-3 mb-2">
      <h1 class="text-2xl font-bold text-text-primary">Project Settings</h1>
      <span class="text-[10px] px-2 py-0.5 border {getActiveEnvironment() === 'live' ? 'border-emerald-500/50 text-emerald-500 bg-emerald-500/5' : 'border-amber-500/50 text-amber-500 bg-amber-500/5'} uppercase tracking-widest font-bold rounded">
        {getActiveEnvironment()} Mode
      </span>
    </div>
    <p class="text-text-dim text-sm">Configure your project preferences, team, and integrations</p>
  </div>

  <!-- Horizontal Tabs -->
  <div class="flex items-center border-b border-border mb-8 overflow-x-auto">
    {#each tabs as tab}
      <button
        onclick={() => (activeTab = tab.id)}
        class="flex items-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-widest transition-all border-b-2 whitespace-nowrap {activeTab === tab.id
          ? 'border-accent text-text-primary bg-accent/5'
          : 'border-transparent text-text-dim hover:text-text-secondary hover:border-text-dim'}"
      >
        <svelte:component this={tab.icon} size={14} />
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Main Content -->
  <div class="bg-bg-card border border-border rounded-xl shadow-sm overflow-hidden min-h-[600px]">
    {#if isLoading}
          <div class="flex items-center justify-center h-full min-h-[400px]">
            <Loader2 size={32} class="animate-spin text-text-dim" />
          </div>
        {:else}
          <!-- GENERAL TAB -->
          {#if activeTab === "general"}
            <div class="p-8" in:fade={{ duration: 200 }}>
              <h2 class="text-lg font-bold text-text-primary mb-6">General Settings</h2>
              
              <div class="space-y-8">
                <div>
                  <label class="block text-xs font-bold text-text-dim uppercase tracking-widest mb-2">Project Name</label>
                  <input type="text" bind:value={projectName} class="input w-full" placeholder="e.g. Acme Inc" />
                </div>

                <div>
                  <label class="block text-xs font-bold text-text-dim uppercase tracking-widest mb-2">Project Slug</label>
                  <div class="flex items-center">
                    <span class="bg-bg-secondary border border-r-0 border-border px-4 py-2 text-text-dim text-xs font-mono h-[42px] flex items-center rounded-l">owostack.com/</span>
                    <input type="text" bind:value={projectSlug} class="input border-l-0 flex-1 rounded-l-none" placeholder="acme-slug" />
                  </div>
                </div>

                <div>
                  <label class="block text-xs font-bold text-text-dim uppercase tracking-widest mb-2">Default Currency</label>
                  <select bind:value={orgCurrency} class="input w-full">
                    {#each COMMON_CURRENCIES as c}
                      <option value={c.code}>{c.symbol} {c.code} — {c.name}</option>
                    {/each}
                  </select>
                  <p class="text-xs text-text-dim/60 mt-2">Used as default for new plans and credit packs.</p>
                </div>

                <div class="pt-6 border-t border-border flex items-center justify-between">
                  <button class="btn btn-primary" onclick={saveGeneralSettings} disabled={isSaving}>
                    {#if isSaving} <Loader2 size={16} class="animate-spin" /> {:else} Save Changes {/if}
                  </button>
                  {#if successMessage}
                    <span class="text-sm text-emerald-600 dark:text-emerald-500 flex items-center gap-1" in:fade>
                      <Check size={14} /> {successMessage}
                    </span>
                  {/if}
                </div>
              </div>
            </div>
          {/if}

          <!-- TEAM TAB -->
          {#if activeTab === "team"}
            <div class="p-8" in:fade={{ duration: 200 }}>
              <div class="flex items-center justify-between mb-6">
                <h2 class="text-lg font-bold text-text-primary">Team Members</h2>
                <div class="text-xs text-text-dim">{members.length} members</div>
              </div>

              <div class="mb-8 bg-bg-secondary/50 border border-border rounded-lg p-4">
                <h3 class="text-sm font-bold text-text-primary mb-4">Invite New Member</h3>
                <div class="flex gap-4">
                  <input 
                    type="email" 
                    placeholder="colleague@example.com"
                    bind:value={inviteEmail}
                    class="flex-[2] input min-w-0"
                  />
                  <select bind:value={inviteRole} class="flex-1 input min-w-[140px]">
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                  <button 
                    class="btn btn-secondary whitespace-nowrap px-6"
                    disabled={!inviteEmail || isInviting}
                    onclick={inviteMember}
                  >
                    {#if isInviting} <Loader2 size={16} class="animate-spin" /> {:else} Send Invite {/if}
                  </button>
                </div>
              </div>

              <div class="border border-border rounded-lg overflow-hidden">
                <table class="w-full text-left">
                  <thead class="bg-black/5 dark:bg-white/5 border-b border-border">
                    <tr>
                      <th class="px-6 py-3 text-xs font-bold text-text-dim uppercase tracking-wider">User</th>
                      <th class="px-6 py-3 text-xs font-bold text-text-dim uppercase tracking-wider">Role</th>
                      <th class="px-6 py-3 text-xs font-bold text-text-dim uppercase tracking-wider">Joined</th>
                      <th class="px-6 py-3"></th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-border/50">
                    {#each members as member}
                      <tr>
                        <td class="px-6 py-4">
                          <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent font-bold text-xs uppercase">
                              {(member.user.name || member.user.email)[0]}
                            </div>
                            <div>
                              <div class="text-sm font-bold text-text-primary">{member.user.name || 'Unknown'}</div>
                              <div class="text-xs text-text-dim">{member.user.email}</div>
                            </div>
                          </div>
                        </td>
                        <td class="px-6 py-4">
                          <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-black/5 dark:bg-white/5 text-text-secondary border border-border capitalize">
                            {member.role}
                          </span>
                        </td>
                        <td class="px-6 py-4 text-xs text-text-dim">
                          {formatDate(member.createdAt)}
                        </td>
                        <td class="px-6 py-4 text-right">
                          <button class="text-text-dim hover:text-red-500 transition-colors opacity-50 cursor-not-allowed" title="Not implemented">
                            Remove
                          </button>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}

          <!-- API KEYS TAB -->
          {#if activeTab === "keys"}
            <div class="p-8" in:fade={{ duration: 200 }}>
              <div class="flex items-center justify-between mb-6">
                <div>
                  <h2 class="text-lg font-bold text-text-primary">API Keys</h2>
                  <p class="text-xs text-text-dim mt-1">Manage access tokens for the API</p>
                </div>
                <button class="btn btn-primary" onclick={() => showKeyModal = true}>Create New Key</button>
              </div>

              {#if generatedKey}
                <div class="mb-8 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
                  <div class="flex items-start gap-3">
                    <CheckCircle size={20} class="text-emerald-600 dark:text-emerald-500 mt-1" />
                    <div class="flex-1">
                      <h4 class="text-sm font-bold text-text-primary mb-1">Key Generated Successfully</h4>
                      <p class="text-xs text-text-dim mb-3">Copy your key now. You won't see it again.</p>
                      <div class="flex items-center gap-2 bg-black/5 dark:bg-black/30 border border-border rounded px-3 py-2">
                        <code class="text-sm font-mono text-emerald-600 dark:text-emerald-400 flex-1">{generatedKey}</code>
                        <button class="text-text-dim hover:text-text-primary dark:hover:text-text-primary dark:hover:text-text-primary" onclick={() => copyUrl(generatedKey)}>
                          <Copy size={16} />
                        </button>
                      </div>
                    </div>
                    <button class="text-text-dim hover:text-text-primary dark:hover:text-text-primary dark:hover:text-text-primary" onclick={() => generatedKey = ""}><X size={16} /></button>
                  </div>
                </div>
              {/if}

              {#if showKeyModal}
                <div class="mb-8 bg-bg-secondary border border-border rounded-lg p-6">
                  <h3 class="text-sm font-bold text-text-primary mb-4">Create New API Key</h3>
                  <div class="flex gap-4">
                    <input type="text" placeholder="Key Name" bind:value={newKeyName} class="flex-1 input" />
                    <button class="btn btn-secondary" onclick={() => { showKeyModal = false; newKeyName = ""; }}>Cancel</button>
                    <button class="btn btn-primary" disabled={!newKeyName || isCreatingKey} onclick={createApiKey}>
                      {#if isCreatingKey} <Loader2 size={16} class="animate-spin" /> {:else} Create {/if}
                    </button>
                  </div>
                </div>
              {/if}

              <div class="space-y-4">
                {#each apiKeys as key}
                  <div class="flex items-center justify-between p-4 bg-bg-secondary border border-border rounded-lg group hover:border-text-dim transition-colors">
                    <div class="flex items-center gap-4">
                      <div class="bg-accent/10 p-2 rounded text-accent"><Key size={18} /></div>
                      <div>
                        <div class="flex items-center gap-2 mb-1">
                          <h3 class="text-sm font-bold text-text-primary">{key.name}</h3>
                          <span class="text-[10px] px-1.5 py-0.5 border {getActiveEnvironment() === 'live' ? 'border-emerald-500/50 text-emerald-600 dark:text-emerald-500' : 'border-amber-500/50 text-amber-600 dark:text-amber-500'} uppercase tracking-wider font-bold rounded">
                            {getActiveEnvironment()}
                          </span>
                        </div>
                        <div class="text-xs font-mono text-text-dim">
                          {key.prefix}•••••••• • Created {formatDate(key.createdAt)}
                        </div>
                      </div>
                    </div>
                    
                    <div class="flex items-center gap-6">
                      <div class="text-right hidden md:block">
                        <div class="text-[10px] text-text-primary font-bold uppercase tracking-wider">Last used</div>
                        <div class="text-[10px] text-text-dim uppercase tracking-widest mt-0.5">
                          {key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never'}
                        </div>
                      </div>

                      <div class="flex items-center gap-3">
                          <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 border border-emerald-500/20">Active</span>
                          <button 
                            class="p-2 text-text-dim hover:text-red-500 hover:bg-red-500/10 transition-all rounded"
                            onclick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              deleteApiKey(key.id);
                            }}
                            title="Revoke Key"
                          >
                            <Trash2 size={16} />
                          </button>
                      </div>
                    </div>
                  </div>
                {/each}
                {#if apiKeys.length === 0}
                  <div class="text-center py-12 border border-dashed border-border rounded-lg">
                    <Key size={24} class="text-text-dim/20 mx-auto mb-3" />
                    <p class="text-text-dim text-sm">No API keys generated yet</p>
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          <!-- PROVIDERS TAB -->
          {#if activeTab === "providers"}
            <div class="p-8" in:fade={{ duration: 200 }}>
              <div class="flex items-center justify-between mb-6">
                <div>
                  <h2 class="text-lg font-bold text-text-primary">Payment Providers</h2>
                  <p class="text-xs text-text-dim mt-1">Connect payment gateways to process transactions</p>
                </div>
                <button class="btn btn-primary" onclick={openAddForm}><Plus size={14} /> Add Provider</button>
              </div>

              {#if providerError}
                <div class="p-4 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs mb-6 flex items-center gap-2">
                  <AlertCircle size={14} /> {providerError}
                </div>
              {/if}

              {#if providerAccounts.length === 0}
                <div class="text-center py-12 border border-dashed border-border rounded-lg">
                  <Cpu size={32} class="mx-auto text-text-dim/20 mb-4" />
                  <p class="text-text-dim text-sm mb-4">No providers connected yet</p>
                  <button class="btn btn-secondary" onclick={openAddForm}>Connect First Provider</button>
                </div>
              {:else}
                <div class="space-y-3">
                  {#each providerAccounts as account}
                    <div class="border border-border bg-bg-secondary/30 p-5 flex items-center justify-between rounded-lg group hover:border-text-dim transition-colors">
                      <div class="flex items-center gap-4">
                        <div class="w-10 h-10 bg-bg-card border border-border flex items-center justify-center rounded">
                          <Cpu size={18} class="text-text-dim" />
                        </div>
                        <div>
                          <div class="flex items-center gap-2 mb-1">
                            <span class="text-sm font-bold text-text-primary">{account.displayName || getProviderLabel(account.providerId)}</span>
                            <ProviderBadge providerId={account.providerId} size="xs" />
                          </div>
                          <div class="flex items-center gap-3 text-[10px] text-text-dim uppercase tracking-widest">
                            <span class="flex items-center gap-1">
                              <span class="w-1.5 h-1.5 {account.environment === 'live' ? 'bg-emerald-500' : 'bg-amber-500'} inline-block rounded-full"></span>
                              {account.environment}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button class="p-2 text-text-dim hover:text-text-primary dark:hover:text-text-primary dark:hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5 rounded border border-transparent hover:border-border" onclick={() => openEditForm(account)}>
                          <Pencil size={14} />
                        </button>
                        {#if deletingId === account.id}
                          <button class="p-2 text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded" onclick={() => deleteProviderAccount(account.id)} disabled={isDeleting}>
                            <Check size={14} />
                          </button>
                          <button class="p-2 text-text-dim hover:text-text-primary dark:hover:text-text-primary dark:hover:text-text-primary" onclick={() => deletingId = null}><X size={14} /></button>
                        {:else}
                          <button class="p-2 text-text-dim hover:text-red-600 hover:bg-red-500/10 rounded border border-transparent hover:border-red-500/20" onclick={() => deletingId = account.id}>
                            <Trash2 size={14} />
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          <!-- WEBHOOKS TAB -->
          {#if activeTab === "webhook"}
            <div class="p-8" in:fade={{ duration: 200 }}>
              <h2 class="text-lg font-bold text-text-primary mb-6">Webhook Configuration</h2>
              
              <div class="space-y-6">
                <div class="bg-blue-500/10 border border-blue-500/20 p-5 rounded-lg flex gap-4">
                  <AlertCircle size={18} class="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 class="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-1">Required Configuration</h4>
                    <p class="text-xs text-blue-600/80 dark:text-blue-400/80 leading-relaxed">
                      You must register these webhook URLs in your payment provider dashboards to track payments and subscription updates.
                    </p>
                  </div>
                </div>

                <div class="space-y-4">
                  {#each webhookUrls as wh}
                    <div>
                      <div class="flex items-center gap-2 mb-2">
                        <span class="text-[10px] font-bold text-text-dim uppercase tracking-widest">
                          {wh.providerId === "default" ? "Default URL" : `${getProviderLabel(wh.providerId)} URL`}
                        </span>
                        {#if wh.providerId !== "default"} <ProviderBadge providerId={wh.providerId} size="xs" /> {/if}
                      </div>
                      <div class="bg-[var(--color-bg-code)] border border-border p-3 rounded flex items-center gap-4">
                        <code class="flex-1 font-mono text-xs text-[var(--color-text-code)] break-all">{wh.url}</code>
                        <button class="text-text-dim hover:text-text-primary dark:hover:text-text-primary dark:hover:text-text-primary" onclick={() => copyUrl(wh.url)}>
                          {#if copiedUrl === wh.url} <Check size={16} class="text-emerald-500" /> {:else} <Copy size={16} /> {/if}
                        </button>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          {/if}

          <!-- OVERAGE TAB -->
          {#if activeTab === "overage"}
            <div class="p-8" in:fade={{ duration: 200 }}>
              <h2 class="text-lg font-bold text-text-primary mb-6">Overage Billing</h2>
              
              <div class="space-y-8">
                <div>
                  <label class="block text-xs font-bold text-text-dim uppercase tracking-widest mb-3">Billing Interval</label>
                  <div class="grid grid-cols-2 gap-3">
                    {#each [
                      { value: "end_of_period", label: "End of Period", desc: "Bill when subscription renews" },
                      { value: "monthly", label: "Monthly", desc: "Bill on the 1st of month" },
                      { value: "threshold", label: "Threshold", desc: "Bill when limit reached" },
                    ] as option}
                      <button
                        onclick={() => (overageBillingInterval = option.value)}
                        class="p-4 border rounded text-left transition-all {overageBillingInterval === option.value ? 'border-accent bg-accent/5' : 'border-border hover:border-text-dim'}"
                      >
                        <div class="text-[10px] font-bold uppercase tracking-widest mb-1 {overageBillingInterval === option.value ? 'text-accent' : 'text-text-dim'}">{option.label}</div>
                        <div class="text-[9px] text-text-dim/60">{option.desc}</div>
                      </button>
                    {/each}
                  </div>
                </div>

                {#if overageBillingInterval === "threshold"}
                  <div>
                    <label class="block text-xs font-bold text-text-dim uppercase tracking-widest mb-2">Threshold Amount (Minor Units)</label>
                    <input type="number" bind:value={overageThresholdAmount} placeholder="e.g. 50000" class="input w-full" />
                  </div>
                {/if}

                <div>
                  <label class="block text-xs font-bold text-text-dim uppercase tracking-widest mb-3">Collection Method</label>
                  <div class="flex gap-3">
                    <button onclick={() => overageAutoCollect = false} class="flex-1 p-3 border rounded text-[10px] font-bold uppercase tracking-widest {!overageAutoCollect ? 'border-accent bg-accent/5 text-accent' : 'border-border text-text-dim'}">Manual Invoice</button>
                    <button onclick={() => overageAutoCollect = true} class="flex-1 p-3 border rounded text-[10px] font-bold uppercase tracking-widest {overageAutoCollect ? 'border-accent bg-accent/5 text-accent' : 'border-border text-text-dim'}">Auto-Charge Card</button>
                  </div>
                </div>

                <div class="pt-6 border-t border-border flex justify-end">
                  <button class="btn btn-primary" onclick={saveOverageSettings} disabled={isSavingOverage}>
                    {#if isSavingOverage} <Loader2 size={16} class="animate-spin" /> {:else} Save Settings {/if}
                  </button>
                </div>
              </div>
            </div>
          {/if}
        {/if}
      </div>
    </div>

  <!-- Add/Edit Provider Modal -->
  <SidePanel 
    open={showForm} 
    title={formStep === 'webhook' ? "Configure Webhook" : (editingAccountId ? "Update Provider" : "Add Payment Provider")} 
    onclose={closeForm}
    width="max-w-md"
  >
    <div class="p-6 space-y-8">
      {#if formStep === 'configure'}
        {#if !editingAccountId}
          <div>
            <div class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-4">Select Provider</div>
            <div class="grid grid-cols-1 gap-3">
              {#each availableProviders as provider}
                <button
                  class="p-4 border rounded text-left transition-all {formProviderId === provider.id ? 'border-accent bg-accent/5' : 'border-border hover:border-text-dim'}"
                  onclick={() => { formProviderId = provider.id; formCredentials = {}; }}
                >
                  <div class="flex items-center gap-2 mb-2">
                    <ProviderBadge providerId={provider.id} size="xs" />
                    <span class="text-xs font-bold text-text-primary">{provider.name}</span>
                  </div>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <div>
          <label for="displayName" class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-3">Display Name</label>
          <input type="text" id="displayName" bind:value={formDisplayName} class="input w-full" placeholder="e.g. Paystack Live" />
        </div>

        {#if selectedProviderConfig}
          {#each selectedProviderConfig.fields as field}
            <div>
              <label for={field.key} class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-3">{field.label}</label>
              <div class="relative input-icon-wrapper">
                <Lock size={12} class="input-icon-left text-text-dim" />
                <input
                  type={field.secret && !showSecretFields[field.key] ? "password" : "text"}
                  id={field.key}
                  bind:value={formCredentials[field.key]}
                  placeholder={field.placeholder}
                  class="input input-has-icon-left w-full pr-10 font-mono text-xs"
                />
                <button type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-primary dark:hover:text-text-primary dark:hover:text-text-primary" onclick={() => showSecretFields[field.key] = !showSecretFields[field.key]}>
                  {#if showSecretFields[field.key]} <EyeOff size={14} /> {:else} <Eye size={14} /> {/if}
                </button>
              </div>
            </div>
          {/each}
        {/if}
      {:else if formStep === 'webhook' && lastCreatedProviderId}
        <div class="space-y-4">
          <div class="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded text-emerald-600 dark:text-emerald-400 text-xs flex gap-2">
            <CheckCircle size={16} /> Provider connected successfully!
          </div>
          <p class="text-xs text-text-dim">Add this webhook URL to your provider settings:</p>
          <div class="bg-[var(--color-bg-code)] p-3 rounded border border-border flex gap-2">
            <code class="flex-1 font-mono text-xs text-[var(--color-text-code)] break-all">{apiBase}/webhooks/{projectId}/{lastCreatedProviderId}</code>
            <button class="text-text-dim hover:text-text-primary dark:hover:text-text-primary dark:hover:text-text-primary" onclick={() => copyUrl(`${apiBase}/webhooks/${projectId}/${lastCreatedProviderId}`)}><Copy size={14} /></button>
          </div>
        </div>
      {/if}
    </div>
    <div class="p-6 border-t border-border flex justify-end gap-3 sticky bottom-0 bg-bg-card">
      {#if formStep === 'configure'}
        <button class="btn btn-secondary" onclick={closeForm}>Cancel</button>
        <button class="btn btn-primary" onclick={saveProviderAccount} disabled={isSavingProvider}>
          {#if isSavingProvider} <Loader2 size={14} class="animate-spin" /> {:else} Save Provider {/if}
        </button>
      {:else}
        <button class="btn btn-primary" onclick={closeForm}>Done</button>
      {/if}
    </div>
  </SidePanel>

<!-- </div> Removed extra closing div since I removed the flex wrapper -->

<style>
  .input {
    height: 42px;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    padding-left: 1rem;
    padding-right: 1rem;
    color: var(--color-text-primary);
    outline: none;
    font-size: 0.875rem;
    transition: border-color 0.15s;
  }

  /* Preserve icon spacing for credential fields in this scoped style block */
  .input.input-has-icon-left {
    padding-left: 2.5rem;
  }

  .input.pr-10 {
    padding-right: 2.5rem;
  }

  .input:focus {
    border-color: var(--color-accent);
  }
</style>
