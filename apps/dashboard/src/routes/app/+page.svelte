<script lang="ts">
  import {
    ArrowRight,
    Building2,
    Plus,
    X,
    Eye,
    EyeOff,
    Loader2,
    CheckCircle,
    Link2,
    Lock,
    Key,
    Cpu,
  } from "lucide-svelte";
  import { organization, apiFetch } from "$lib/auth-client";
  import { getActiveEnvironment } from "$lib/env";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";
  import { goto } from "$app/navigation";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  const SUPPORTED_PROVIDERS = [
    {
      id: "paystack",
      name: "Paystack",
      description: "Accept payments across Africa",
      docsUrl: "https://dashboard.paystack.com/#/settings/developers",
      fields: [
        { key: "secretKey", label: "Secret Key", placeholder: "sk_test_xxxxxxxxxxxxxxx", secret: true },
        { key: "publicKey", label: "Public Key", placeholder: "pk_test_xxxxxxxxxxxxxxx", secret: false, optional: true },
      ],
    },
    {
      id: "stripe",
      name: "Stripe",
      description: "Global payment infrastructure",
      docsUrl: "https://dashboard.stripe.com/apikeys",
      fields: [
        { key: "secretKey", label: "Secret Key", placeholder: "sk_test_xxxxxxxxxxxxxxx", secret: true },
        { key: "publishableKey", label: "Publishable Key", placeholder: "pk_test_xxxxxxxxxxxxxxx", secret: false, optional: true },
      ],
    },
    {
      id: "dodopayments",
      name: "Dodo Payments",
      description: "Simple payment processing",
      docsUrl: "https://dodopayments.com/docs",
      fields: [
        { key: "secretKey", label: "API Key", placeholder: "dodo_sk_xxxxxxxxxxxxxxx", secret: true },
      ],
    },
  ];

  let orgs = $state<any[]>([]);
  let isLoading = $state(true);
  let showCreateModal = $state(false);

  // Organization fields
  let newOrgName = $state("");
  let newOrgSlug = $state("");

  // Provider fields
  let selectedProviderId = $state("paystack");
  let providerCredentials = $state<Record<string, string>>({});
  let showSecretFields = $state<Record<string, boolean>>({});
  let enabledProviderIds = $state<string[]>([]);

  let availableProviders = $derived(
    SUPPORTED_PROVIDERS.filter((p) => enabledProviderIds.includes(p.id))
  );

  // UI state
  let isCreating = $state(false);
  let createError = $state<string | null>(null);
  let currentStep = $state(1); // 1 = org details, 2 = provider

  let selectedProviderConfig = $derived(
    availableProviders.find((p) => p.id === selectedProviderId) ||
    SUPPORTED_PROVIDERS.find((p) => p.id === selectedProviderId)
  );

  let hasRequiredCredentials = $derived(() => {
    const config = availableProviders.find((p) => p.id === selectedProviderId);
    if (!config) return false;
    return config.fields.some(
      (f) => !f.optional && providerCredentials[f.key]?.trim()
    );
  });

  async function loadOrgs() {
    isLoading = true;
    const { data } = await organization.list();
    orgs = data || [];
    isLoading = false;
  }

  $effect(() => {
    loadOrgs();
    loadEnabledProviders();
  });

  async function loadEnabledProviders() {
    try {
      const res = await apiFetch(`/api/dashboard/providers/enabled`);
      if (res.data?.data) {
        enabledProviderIds = res.data.data;
        if (enabledProviderIds.length > 0) {
          selectedProviderId = enabledProviderIds[0];
        }
      }
    } catch (e) {
      enabledProviderIds = ["paystack"];
    }
  }

  function nextStep() {
    if (!newOrgName || !newOrgSlug) return;
    currentStep = 2;
  }

  function prevStep() {
    currentStep = 1;
  }

  async function createOrganization(skipProvider = false) {
    if (!newOrgName || !newOrgSlug) return;
    if (!skipProvider && !hasRequiredCredentials()) return;

    isCreating = true;
    createError = null;

    try {
      // Step 1: Create the organization
      const { data: orgData, error: orgError } = await organization.create({
        name: newOrgName,
        slug: newOrgSlug,
      });

      if (orgError) throw new Error(orgError.message);
      if (!orgData?.id) throw new Error("Failed to create organization");

      // Step 2: Connect provider (if not skipped)
      if (!skipProvider) {
        const credentials: Record<string, unknown> = {};
        const config = SUPPORTED_PROVIDERS.find((p) => p.id === selectedProviderId);
        if (config) {
          for (const field of config.fields) {
            const val = providerCredentials[field.key];
            if (val && val.trim().length > 0) {
              credentials[field.key] = val.trim();
            }
          }
        }

        const configRes = await apiFetch("/api/dashboard/providers/accounts", {
          method: "POST",
          body: JSON.stringify({
            organizationId: orgData.id,
            providerId: selectedProviderId,
            environment: getActiveEnvironment(),
            credentials,
          }),
        });

        if (configRes.error) {
          console.error("Provider config failed:", configRes.error);
        }
      }

      // Success - redirect to the new org
      closeModal();
      goto(`/app/${orgData.id}`);
    } catch (err: any) {
      createError = err?.message || "Failed to create organization";
    } finally {
      isCreating = false;
    }
  }

  function closeModal() {
    showCreateModal = false;
    newOrgName = "";
    newOrgSlug = "";
    selectedProviderId = availableProviders[0]?.id || "paystack";
    providerCredentials = {};
    showSecretFields = {};
    currentStep = 1;
    createError = null;
  }
</script>

<svelte:head>
  <title>Organizations - Owostack</title>
</svelte:head>

<div class="max-w-4xl">
  <!-- Header -->
  <div class="mb-10 flex items-center justify-between">
    <div>
      <h1 class="text-xl font-bold text-white mb-2">Organizations</h1>
      <p class="text-zinc-500 text-xs uppercase tracking-widest font-semibold">
        Manage your teams and projects
      </p>
    </div>

    {#if orgs.length > 0}
      <button class="btn btn-primary" onclick={() => (showCreateModal = true)}>
        <Plus size={16} />
        New Organization
      </button>
    {/if}
  </div>

  {#if isLoading}
    <div class="space-y-3">
      {#each Array(3) as _}
        <div class="bg-bg-card border border-border p-5 shadow-sm">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
              <Skeleton class="w-10 h-10 rounded" />
              <div class="space-y-2">
                <Skeleton class="h-4 w-32" />
                <Skeleton class="h-3 w-24" />
              </div>
            </div>
            <div class="flex items-center gap-4">
              <Skeleton class="h-3 w-32" />
              <Skeleton class="w-8 h-8" />
            </div>
          </div>
        </div>
      {/each}
    </div>
  {:else if orgs.length > 0}
    <!-- Organizations List -->
    <div class="space-y-3">
      {#each orgs as org (org.id)}
        <a
          href="/app/{org.id}"
          class="group block bg-bg-card border border-border hover:border-zinc-500 transition-all p-5 shadow-sm"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
              <div
                class="w-10 h-10 flex items-center justify-center bg-black/50 text-zinc-400"
              >
                <Building2 size={18} />
              </div>
              <div>
                <h3 class="font-bold text-white text-sm mb-0.5">
                  {org.name}
                </h3>
                <p class="text-zinc-500 text-xs font-mono">{org.slug}</p>
              </div>
            </div>

            <div class="flex items-center gap-4">
              <span class="text-xs text-zinc-600">
                Created {new Date(org.createdAt).toLocaleDateString()}
              </span>
              <div
                class="w-8 h-8 flex items-center justify-center border border-border group-hover:border-zinc-500 group-hover:text-white text-zinc-500 transition-colors"
              >
                <ArrowRight size={14} />
              </div>
            </div>
          </div>
        </a>
      {/each}
    </div>
  {:else}
    <!-- Empty State -->
    <div
      class="border border-border border-dashed p-12 flex flex-col items-center justify-center text-center"
    >
      <div class="w-12 h-12 bg-white/5 flex items-center justify-center mb-4">
        <Building2 size={24} class="text-zinc-500" />
      </div>
      <h3 class="text-white font-bold mb-2">No organizations yet</h3>
      <p class="text-zinc-500 text-sm mb-6 max-w-xs">
        Create your first organization and connect a payment provider to get
        started.
      </p>

      <button class="btn btn-primary" onclick={() => (showCreateModal = true)}>
        <Plus size={16} />
        Create Organization
      </button>
    </div>
  {/if}
</div>

<!-- Create Organization SidePanel -->
<SidePanel open={showCreateModal} title="Create Organization" onclose={closeModal} width="max-w-md">
  <div class="text-sm">
    <div class="p-5 space-y-6">
      <!-- Step Indicator -->
      <div class="flex items-center gap-4 mb-2">
        <div class="flex items-center gap-2">
          <div
            class="w-6 h-6 flex items-center justify-center text-[10px] font-bold {currentStep >= 1
              ? 'bg-accent text-black'
              : 'bg-bg-secondary text-zinc-500'}"
          >
            {currentStep > 1 ? "✓" : "1"}
          </div>
          <span
            class="text-[10px] font-bold uppercase tracking-widest {currentStep >= 1
              ? 'text-white'
              : 'text-zinc-500'}">Details</span
          >
        </div>
        <div class="flex-1 h-px bg-border"></div>
        <div class="flex items-center gap-2">
          <div
            class="w-6 h-6 flex items-center justify-center text-[10px] font-bold {currentStep >= 2
              ? 'bg-accent text-black'
              : 'bg-bg-secondary text-zinc-500'}"
          >
            2
          </div>
          <span
            class="text-[10px] font-bold uppercase tracking-widest {currentStep >= 2
              ? 'text-white'
              : 'text-zinc-500'}">Provider</span
          >
        </div>
      </div>

      {#if createError}
        <div class="mb-4 p-3 bg-red-900/20 border border-red-500/50 text-red-400 text-xs uppercase tracking-tight">
          {createError}
        </div>
      {/if}

      {#if currentStep === 1}
        <!-- Step 1: Organization Details -->
        <div class="space-y-5">
          <div>
            <label
              for="orgName"
              class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2"
              >Organization Name</label
            >
            <div class="input-icon-wrapper">
              <Building2 size={14} class="input-icon-left" />
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
              class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2"
              >Slug</label
            >
            <div class="input-icon-wrapper">
              <Link2 size={14} class="input-icon-left" />
              <input
                type="text"
                id="orgSlug"
                bind:value={newOrgSlug}
                placeholder="e.g. acme-corp"
                class="input input-has-icon-left font-bold"
              />
            </div>
          </div>
        </div>
      {:else}
        <!-- Step 2: Connect Payment Provider -->
        <div class="space-y-5">
          <!-- Provider Selection -->
          <div>
            <label class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">
              Select Provider
            </label>
            <div class="space-y-2">
              {#each availableProviders as provider}
                <button
                  class="w-full p-3 border text-left transition-all flex items-center gap-3 {selectedProviderId === provider.id
                    ? 'border-accent bg-accent/5'
                    : 'border-border bg-bg-secondary/30 hover:border-zinc-600'}"
                  onclick={() => {
                    selectedProviderId = provider.id;
                    providerCredentials = {};
                  }}
                >
                  <Cpu size={16} class="text-zinc-500 shrink-0" />
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-bold text-white">{provider.name}</span>
                      <ProviderBadge providerId={provider.id} size="xs" />
                    </div>
                    <p class="text-[9px] text-zinc-500 mt-0.5">{provider.description}</p>
                  </div>
                </button>
              {/each}
            </div>
          </div>

          <!-- Dynamic Credential Fields -->
          {#if selectedProviderConfig}
            {#each selectedProviderConfig.fields as field}
              <div>
                <label
                  for={field.key}
                  class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2"
                  >{field.label} {#if field.optional}<span class="text-zinc-600 font-normal">(Optional)</span>{:else}<span class="text-red-500">*</span>{/if}</label
                >
                <div class="input-icon-wrapper">
                  <Lock size={14} class="input-icon-left" />
                  <input
                    type={field.secret && !showSecretFields[field.key] ? "password" : "text"}
                    id={field.key}
                    bind:value={providerCredentials[field.key]}
                    placeholder={field.placeholder}
                    class="input input-has-icon-left pr-10 font-mono text-xs"
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
              <p class="text-[10px] text-zinc-600 uppercase tracking-tight">
                Find your keys at <a
                  href={selectedProviderConfig.docsUrl}
                  target="_blank"
                  class="text-accent hover:underline font-bold"
                  >{selectedProviderConfig.name} Developer Settings</a
                >
              </p>
            {/if}
          {/if}
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div class="p-5 border-t border-border flex items-center justify-between sticky bottom-0 bg-bg-card">
      {#if currentStep === 1}
        <button
          class="px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white transition-colors uppercase tracking-widest"
          onclick={closeModal}
        >
          Cancel
        </button>
        <button
          class="btn btn-primary px-6"
          onclick={nextStep}
          disabled={!newOrgName || !newOrgSlug}
        >
          Continue
          <ArrowRight size={14} />
        </button>
      {:else}
        <div class="flex items-center gap-2">
          <button
            class="px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white transition-colors uppercase tracking-widest"
            onclick={prevStep}
          >
            Back
          </button>
          <button
            class="px-4 py-2 text-xs font-bold text-zinc-600 hover:text-zinc-400 transition-colors uppercase tracking-widest"
            onclick={() => createOrganization(true)}
            disabled={isCreating}
          >
            Skip
          </button>
        </div>
        <button
          class="btn btn-primary px-6"
          onclick={() => createOrganization(false)}
          disabled={!hasRequiredCredentials() || isCreating}
        >
          {#if isCreating}
            <Loader2 size={14} class="animate-spin" />
            Creating...
          {:else}
            <CheckCircle size={14} />
            Create & Connect
          {/if}
        </button>
      {/if}
    </div>
  </div>
</SidePanel>
