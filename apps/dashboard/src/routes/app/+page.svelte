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
  } from "lucide-svelte";
  import { organization, apiFetch } from "$lib/auth-client";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import { goto } from "$app/navigation";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  let orgs = $state<any[]>([]);
  let isLoading = $state(true);
  let showCreateModal = $state(false);

  // Organization fields
  let newOrgName = $state("");
  let newOrgSlug = $state("");

  // Paystack fields (required for onboarding)
  let paystackSecretKey = $state("");
  let paystackPublicKey = $state("");
  let paystackEnvironment = $state<"test" | "live">("test");
  let showSecretKey = $state(false);

  // UI state
  let isCreating = $state(false);
  let createError = $state<string | null>(null);
  let currentStep = $state(1); // 1 = org details, 2 = paystack

  async function loadOrgs() {
    isLoading = true;
    const { data } = await organization.list();
    orgs = data || [];
    isLoading = false;
  }

  $effect(() => {
    loadOrgs();
  });

  function nextStep() {
    if (!newOrgName || !newOrgSlug) return;
    currentStep = 2;
  }

  function prevStep() {
    currentStep = 1;
  }

  async function createOrganization() {
    if (!newOrgName || !newOrgSlug || !paystackSecretKey) return;

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

      // Step 2: Configure Paystack for the new org
      const configRes = await apiFetch("/api/dashboard/paystack-config", {
        method: "POST",
        body: JSON.stringify({
          organizationId: orgData.id,
          secretKey: paystackSecretKey,
          publicKey: paystackPublicKey || undefined,
          environment: paystackEnvironment,
        }),
      });

      if (configRes.error) {
        // Org was created but Paystack failed - still redirect but warn
        console.error("Paystack config failed:", configRes.error);
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
    paystackSecretKey = "";
    paystackPublicKey = "";
    paystackEnvironment = "test";
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
        Create your first organization and connect your Paystack account to get
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
              : 'text-zinc-500'}">Paystack</span
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
        <!-- Step 2: Paystack Integration -->
        <div class="space-y-5">
          <div>
            <label
              for="secretKey"
              class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2"
              >Secret Key <span class="text-red-500">*</span></label
            >
            <div class="input-icon-wrapper">
              <Lock size={14} class="input-icon-left" />
              <input
                type={showSecretKey ? "text" : "password"}
                id="secretKey"
                bind:value={paystackSecretKey}
                placeholder="sk_test_xxxxxxxxxxxxxxx"
                class="input input-has-icon-left pr-10 font-mono text-xs"
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
                onclick={() => (showSecretKey = !showSecretKey)}
              >
                {#if showSecretKey}
                  <EyeOff size={16} />
                {:else}
                  <Eye size={16} />
                {/if}
              </button>
            </div>
            <p class="mt-2 text-[10px] text-zinc-600 uppercase tracking-tight">
              Find this at <a
                href="https://dashboard.paystack.com/#/settings/developers"
                target="_blank"
                class="text-accent hover:underline font-bold"
                >Paystack Dashboard → API Keys</a
              >
            </p>
          </div>

          <div>
            <label
              for="publicKey"
              class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2"
              >Public Key <span class="text-zinc-600 font-normal">(Optional)</span></label
            >
            <div class="input-icon-wrapper">
              <Key size={14} class="input-icon-left" />
              <input
                type="text"
                id="publicKey"
                bind:value={paystackPublicKey}
                placeholder="pk_test_xxxxxxxxxxxxxxx"
                class="input input-has-icon-left font-mono text-xs"
              />
            </div>
          </div>

          <div>
            <label class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">
              Environment
            </label>
            <div class="flex gap-4">
              {#each ['test', 'live'] as env}
                <label class="flex items-center gap-2 cursor-pointer group">
                  <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all {paystackEnvironment === env ? 'border-accent' : 'border-zinc-700 group-hover:border-zinc-500'}">
                    {#if paystackEnvironment === env}
                      <div class="w-2 h-2 rounded-full bg-accent"></div>
                    {/if}
                  </div>
                  <input type="radio" name="env" value={env} bind:group={paystackEnvironment} class="hidden" />
                  <span class="text-[10px] font-bold uppercase tracking-widest {paystackEnvironment === env ? 'text-white' : 'text-zinc-500'}">{env}</span>
                </label>
              {/each}
            </div>
          </div>
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
        <button
          class="px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white transition-colors uppercase tracking-widest"
          onclick={prevStep}
        >
          Back
        </button>
        <button
          class="btn btn-primary px-6"
          onclick={createOrganization}
          disabled={!paystackSecretKey || isCreating}
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
