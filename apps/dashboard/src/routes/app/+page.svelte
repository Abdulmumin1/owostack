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
  } from "lucide-svelte";
  import { organization, apiFetch } from "$lib/auth-client";
  import { goto } from "$app/navigation";

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
    <div class="text-zinc-500 flex items-center gap-2">
      <Loader2 size={16} class="animate-spin" />
      <span>Loading organizations...</span>
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

<!-- Create Modal (Multi-step) -->
{#if showCreateModal}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
  >
    <div
      class="w-full max-w-lg bg-bg-card border border-border p-6 shadow-2xl relative"
    >
      <button
        class="absolute top-4 right-4 text-zinc-500 hover:text-white"
        onclick={closeModal}
      >
        <X size={18} />
      </button>

      <!-- Step Indicator -->
      <div class="flex items-center gap-4 mb-6">
        <div class="flex items-center gap-2">
          <div
            class="w-6 h-6 flex items-center justify-center text-xs font-bold {currentStep >=
            1
              ? 'bg-accent text-black'
              : 'bg-bg-secondary text-zinc-500'}"
          >
            {currentStep > 1 ? "✓" : "1"}
          </div>
          <span
            class="text-xs font-bold uppercase tracking-wider {currentStep >= 1
              ? 'text-white'
              : 'text-zinc-500'}">Details</span
          >
        </div>
        <div class="flex-1 h-px bg-border"></div>
        <div class="flex items-center gap-2">
          <div
            class="w-6 h-6 flex items-center justify-center text-xs font-bold {currentStep >=
            2
              ? 'bg-accent text-black'
              : 'bg-bg-secondary text-zinc-500'}"
          >
            2
          </div>
          <span
            class="text-xs font-bold uppercase tracking-wider {currentStep >= 2
              ? 'text-white'
              : 'text-zinc-500'}">Paystack</span
          >
        </div>
      </div>

      {#if createError}
        <div
          class="mb-4 p-3 bg-red-900/20 border border-red-500/50 text-red-400 text-sm"
        >
          {createError}
        </div>
      {/if}

      {#if currentStep === 1}
        <!-- Step 1: Organization Details -->
        <h2 class="text-lg font-bold text-white mb-1">Create Organization</h2>
        <p class="text-zinc-400 text-xs mb-6">
          Set up your organization details.
        </p>

        <div class="space-y-4 mb-6">
          <div>
            <label
              for="orgName"
              class="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2"
              >Organization Name</label
            >
            <input
              type="text"
              id="orgName"
              bind:value={newOrgName}
              placeholder="e.g. Acme Corp"
              class="input"
            />
          </div>

          <div>
            <label
              for="orgSlug"
              class="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2"
              >Slug</label
            >
            <input
              type="text"
              id="orgSlug"
              bind:value={newOrgSlug}
              placeholder="e.g. acme-corp"
              class="input"
            />
          </div>
        </div>

        <div class="flex items-center justify-end gap-3">
          <button
            class="btn btn-ghost text-xs uppercase tracking-wider font-bold"
            onclick={closeModal}
          >
            Cancel
          </button>
          <button
            class="btn btn-primary"
            onclick={nextStep}
            disabled={!newOrgName || !newOrgSlug}
          >
            Continue
            <ArrowRight size={14} />
          </button>
        </div>
      {:else}
        <!-- Step 2: Paystack Integration -->
        <h2 class="text-lg font-bold text-white mb-1">Connect Paystack</h2>
        <p class="text-zinc-400 text-xs mb-6">
          Link your Paystack account to process payments.
        </p>

        <div class="space-y-4 mb-6">
          <div>
            <label
              for="secretKey"
              class="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2"
              >Secret Key <span class="text-red-500">*</span></label
            >
            <div class="relative">
              <input
                type={showSecretKey ? "text" : "password"}
                id="secretKey"
                bind:value={paystackSecretKey}
                placeholder="sk_test_xxxxxxxxxxxxxxx"
                class="input pr-10 font-mono"
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                onclick={() => (showSecretKey = !showSecretKey)}
              >
                {#if showSecretKey}
                  <EyeOff size={16} />
                {:else}
                  <Eye size={16} />
                {/if}
              </button>
            </div>
            <p class="mt-1.5 text-[10px] text-zinc-600">
              Find this at <a
                href="https://dashboard.paystack.com/#/settings/developers"
                target="_blank"
                class="text-accent hover:underline"
                >Paystack Dashboard → API Keys</a
              >
            </p>
          </div>

          <div>
            <label
              for="publicKey"
              class="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2"
              >Public Key <span class="text-zinc-600">(Optional)</span></label
            >
            <input
              type="text"
              id="publicKey"
              bind:value={paystackPublicKey}
              placeholder="pk_test_xxxxxxxxxxxxxxx"
              class="input font-mono"
            />
          </div>

          <div>
            <label
              class="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2"
            >
              Environment
            </label>
            <div class="flex gap-4">
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="env"
                  value="test"
                  bind:group={paystackEnvironment}
                  class="accent-accent w-4 h-4"
                />
                <span
                  class="text-sm {paystackEnvironment === 'test'
                    ? 'text-white'
                    : 'text-zinc-500'}">Test</span
                >
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="env"
                  value="live"
                  bind:group={paystackEnvironment}
                  class="accent-accent w-4 h-4"
                />
                <span
                  class="text-sm {paystackEnvironment === 'live'
                    ? 'text-white'
                    : 'text-zinc-500'}">Live</span
                >
              </label>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <button
            class="btn btn-ghost text-xs uppercase tracking-wider font-bold"
            onclick={prevStep}
          >
            Back
          </button>
          <button
            class="btn btn-primary"
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
        </div>
      {/if}
    </div>
  </div>
{/if}
