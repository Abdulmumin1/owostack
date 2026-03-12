<script lang="ts">
  import {
    Buildings,
    Link,
    ArrowRight,
    CheckCircle,
    CircleNotch,
    Cpu,
    Lock,
    Eye,
    EyeSlash,
    Plus,
    CaretLeft,
    Rocket,
    Copy,
  } from "phosphor-svelte";
  import { organization, apiFetch } from "$lib/auth-client";
  import { getActiveEnvironment, getApiUrl } from "$lib/env";
  import { SUPPORTED_PROVIDERS } from "$lib/providers";
  import { goto } from "$app/navigation";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";
  import { fade, fly, slide } from "svelte/transition";
  import Logo from "$lib/components/ui/Logo.svelte";

  // State
  let currentStep = $state(1); // 1: Welcome/Details, 2: Provider, 3: Credentials
  let isCreating = $state(false);
  let error = $state<string | null>(null);

  // Form Data
  let orgName = $state("");
  let orgSlug = $state("");
  let isCheckingSlug = $state(false);
  let slugAvailable = $state<boolean | null>(null);
  let selectedProviderId = $state("paystack");
  let providerCredentials = $state<Record<string, string>>({});
  let showSecretFields = $state<Record<string, boolean>>({});
  let enabledProviderIds = $state<string[]>([]);

  // Update slug automatically from name
  $effect(() => {
    if (currentStep === 1 && orgName && !orgSlug) {
      orgSlug = orgName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    }
  });

  // Check slug availability when it changes (debounced)
  let slugTimeout: any;
  $effect(() => {
    if (orgSlug.length >= 3) {
      clearTimeout(slugTimeout);
      isCheckingSlug = true;
      slugTimeout = setTimeout(async () => {
        try {
          const res = await apiFetch(
            `/api/organizations/slug-check/${orgSlug}`,
          );
          slugAvailable = res.data?.available;
        } catch (e) {
          slugAvailable = null;
        } finally {
          isCheckingSlug = false;
        }
      }, 500);
    } else {
      slugAvailable = null;
      isCheckingSlug = false;
    }
  });

  // Derived
  let availableProviders = $derived(
    SUPPORTED_PROVIDERS.filter((p) => enabledProviderIds.includes(p.id)),
  );

  let selectedProviderConfig = $derived(
    SUPPORTED_PROVIDERS.find((p) => p.id === selectedProviderId),
  );

  let hasRequiredCredentials = $derived(() => {
    if (!selectedProviderConfig) return false;
    return selectedProviderConfig.fields.some(
      (f) => !f.optional && providerCredentials[f.key]?.trim(),
    );
  });

  // Steps Configuration
  const steps = [
    { id: 1, title: "Organization", desc: "Workspace details" },
    { id: 2, title: "Provider", desc: "Choose gateway" },
    { id: 3, title: "Connect", desc: "Link account" },
    { id: 4, title: "Done", desc: "Get started" },
  ];

  $effect(() => {
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
    if (currentStep === 1 && (!orgName || !orgSlug)) return;
    if (currentStep < 3) currentStep++;
  }

  function prevStep() {
    if (currentStep > 1) currentStep--;
  }

  // API base URL derived from environment
  let apiBase = $derived(getApiUrl());

  async function finishOnboarding() {
    if (!orgName || !orgSlug) return;

    isCreating = true;
    error = null;

    try {
      // 1. Validate provider credentials before creating the organization
      const credentials: Record<string, unknown> = {};
      if (selectedProviderConfig) {
        for (const field of selectedProviderConfig.fields) {
          const val = providerCredentials[field.key];
          if (val?.trim()) credentials[field.key] = val.trim();
        }
      }

      const validationRes = await apiFetch(
        "/api/dashboard/providers/validate",
        {
          method: "POST",
          body: JSON.stringify({
            providerId: selectedProviderId,
            environment: getActiveEnvironment(),
            credentials,
          }),
        },
      );
      if (validationRes.error) {
        throw new Error(
          validationRes.error.message || "Failed to validate provider",
        );
      }

      // 2. Create Organization
      const { data: orgData, error: orgError } = await organization.create({
        name: orgName,
        slug: orgSlug,
      });

      if (orgError) throw new Error(orgError.message);
      if (!orgData?.id) throw new Error("Failed to create organization");

      // 3. Connect Provider
      const providerRes = await apiFetch("/api/dashboard/providers/accounts", {
        method: "POST",
        body: JSON.stringify({
          organizationId: orgData.id,
          providerId: selectedProviderId,
          environment: getActiveEnvironment(),
          credentials,
        }),
      });
      if (providerRes.error) {
        throw new Error(
          providerRes.error.message || "Failed to connect provider",
        );
      }

      // Success - Transition to step 4
      isCreating = false;
      currentStep = 4;
    } catch (err: any) {
      error = err?.message || "Something went wrong. Please try again.";
      isCreating = false;
    }
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url);
  }

  // Update slug automatically from name
  $effect(() => {
    if (currentStep === 1 && orgName && !orgSlug) {
      orgSlug = orgName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    }
  });
</script>

<svelte:head>
  <title>Welcome to Owostack</title>
</svelte:head>

<main class="min-h-screen bg-bg-primary flex">
  <!-- Left Side: Abstract Graphic and Context -->
  <div
    class="hidden lg:flex w-1/3 bg-bg-secondary border-r border-border p-12 flex-col justify-between relative overflow-hidden"
  >
    <!-- Abstract Background -->
    <div
      class="absolute inset-0 opacity-10 pointer-events-none grayscale brightness-50 contrast-125"
    >
      <img
        src="/images/onboarding-bg.png"
        alt=""
        class="w-full h-full object-cover"
      />
    </div>

    <div class="relative z-10">
      <div class="mb-12">
        <Logo size={40} />
      </div>

      <div class="space-y-4">
        <h2 class="text-2xl font-bold text-text-primary tracking-tight">
          Welcome to the billing layer
        </h2>
        <p class="text-text-secondary text-sm leading-relaxed max-w-xs">
          Let's get your first organization set up. We'll connect your payment
          provider and prepare your workspace in just a few steps.
        </p>
      </div>
    </div>

    <div class="relative z-10">
      <div class="p-6 bg-bg-card border border-border rounded-sm space-y-4">
        <div class="space-y-3">
          {#each steps as step}
            <div class="flex items-center gap-3">
              <div
                class="w-5 h-5 flex items-center justify-center rounded-full border {currentStep >=
                step.id
                  ? 'bg-accent text-accent-contrast border-accent'
                  : 'bg-bg-secondary text-text-dim border-border'} text-[10px] font-bold transition-colors"
              >
                {currentStep > step.id ? "✓" : step.id}
              </div>
              <span
                class="text-xs {currentStep >= step.id
                  ? 'text-text-primary font-bold'
                  : 'text-text-dim'}">{step.title}</span
              >
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>

  <!-- Center Content -->
  <div class="flex-1 flex flex-col items-center justify-center p-6 relative">
    <!-- Mobile Steps Indicator -->
    <div
      class="lg:hidden w-full max-w-md mb-8 flex items-center justify-between"
    >
      <Logo />
      <div class="flex items-center gap-1">
        {#each steps as step}
          <div
            class="w-8 h-1 rounded-full {currentStep >= step.id
              ? 'bg-accent'
              : 'bg-border'} transition-colors"
          ></div>
        {/each}
      </div>
    </div>

    <div class="w-full max-w-md" in:fade={{ duration: 400 }}>
      {#if error}
        <div
          class="mb-6 p-4 bg-error-bg border border-error text-error text-xs uppercase tracking-tight font-bold flex items-center gap-3"
          transition:slide
        >
          <div class="w-1 h-1 bg-error rounded-full animate-pulse"></div>
          {error}
        </div>
      {/if}

      <div
        class="bg-bg-card border border-border rounded-sm overflow-hidden flex flex-col min-h-[480px]"
      >
        <!-- content steps -->
        <div class="flex-1 p-8">
          {#if currentStep === 1}
            <div in:fly={{ x: 20, duration: 400 }}>
              <div class="mb-8">
                <h2 class="text-xl font-bold text-text-primary mb-1">
                  Your Workspace
                </h2>
                <p class="text-text-dim text-xs">
                  Choose a name and slug for your organization.
                </p>
              </div>

              <div class="space-y-6">
                <div>
                  <label
                    for="orgName"
                    class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2"
                    >Organization Name</label
                  >
                  <div class="relative">
                    <Buildings
                      size={16}
                      class="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
                      weight="duotone"
                    />
                    <input
                      type="text"
                      id="orgName"
                      bind:value={orgName}
                      placeholder="e.g. Acme Billing"
                      class="w-full bg-bg-secondary border border-border rounded-sm py-2.5 pl-10 pr-4 text-sm font-bold focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label
                    for="orgSlug"
                    class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2"
                    >Workspace Slug</label
                  >
                  <div class="relative">
                    <Link
                      size={16}
                      class="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
                      weight="duotone"
                    />
                    <input
                      type="text"
                      id="orgSlug"
                      bind:value={orgSlug}
                      placeholder="acme-billing"
                      class="w-full bg-bg-secondary border {slugAvailable ===
                      false
                        ? 'border-error'
                        : slugAvailable === true
                          ? 'border-success'
                          : 'border-border'} rounded-sm py-2.5 pl-10 pr-10 text-sm font-mono focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
                    />
                    <div
                      class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center"
                    >
                      {#if isCheckingSlug}
                        <CircleNotch
                          size={14}
                          class="animate-spin text-text-dim"
                        />
                      {:else if slugAvailable === true}
                        <CheckCircle
                          size={14}
                          weight="fill"
                          class="text-success"
                        />
                      {:else if slugAvailable === false}
                        <div
                          class="w-1.5 h-1.5 bg-error rounded-full animate-pulse"
                        ></div>
                      {/if}
                    </div>
                  </div>
                  {#if slugAvailable === false}
                    <p
                      class="mt-2 text-[10px] text-error font-bold uppercase tracking-tight"
                    >
                      Slug is already taken
                    </p>
                  {:else}
                    <p class="mt-2 text-[10px] text-text-dim italic">
                      This will be your workspace identifier in URLs.
                    </p>
                  {/if}
                </div>
              </div>
            </div>
          {:else if currentStep === 2}
            <div in:fly={{ x: 20, duration: 400 }}>
              <div class="mb-8 text-center lg:text-left">
                <h2 class="text-xl font-bold text-text-primary mb-1">
                  Payment Gateway
                </h2>
                <p class="text-text-dim text-xs">
                  Select your primary payment processor.
                </p>
              </div>

              <div
                class="space-y-3 max-h-100 overflow-y-auto pr-2 custom-scrollbar"
              >
                {#each availableProviders as provider}
                  <button
                    class="w-full p-4 border rounded-sm text-left flex items-center justify-between group transition-all {selectedProviderId ===
                    provider.id
                      ? 'border-accent bg-accent/5'
                      : 'border-border bg-bg-secondary hover:border-border-strong'}"
                    onclick={() => (selectedProviderId = provider.id)}
                  >
                    <div class="flex items-center gap-4">
                      <div
                        class="w-12 h-12 flex items-center justify-center bg-bg-card border border-border rounded-sm group-hover:scale-105 transition-transform overflow-hidden p-1.5"
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
                      <div>
                        <p
                          class="text-xs font-bold text-text-primary uppercase tracking-tight"
                        >
                          {provider.name}
                        </p>
                        <p class="text-[10px] text-text-dim leading-tight">
                          {provider.description}
                        </p>
                      </div>
                    </div>
                    {#if selectedProviderId === provider.id}
                      <CheckCircle
                        size={20}
                        weight="fill"
                        class="text-accent"
                      />
                    {/if}
                  </button>
                {/each}
              </div>
            </div>
          {:else if currentStep === 3}
            <div in:fly={{ x: 20, duration: 400 }}>
              <div class="mb-8 flex items-end justify-between">
                <div>
                  <h2 class="text-xl font-bold text-text-primary mb-1">
                    Connect {selectedProviderConfig?.name}
                  </h2>
                  <p class="text-text-dim text-xs">
                    {#if selectedProviderId === "polar"}
                      Keys are under Organization settings → Access Tokens.
                    {:else if selectedProviderId === "dodopayments"}
                      Find your keys in the Developer → API Keys section.
                    {:else if selectedProviderId === "paystack"}
                      Keys are in Settings → API Keys & Webhooks.
                    {:else}
                      Add your API keys to sync plans and customers.
                    {/if}
                  </p>
                </div>
                {#if selectedProviderConfig?.docsUrl}
                  <a
                    href={selectedProviderConfig.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-[10px] font-bold text-accent hover:text-accent-hover uppercase tracking-widest flex items-center gap-1.5 transition-colors pb-1 group"
                  >
                    Get keys
                    <ArrowRight
                      size={10}
                      weight="bold"
                      class="group-hover:translate-x-0.5 transition-transform"
                    />
                  </a>
                {/if}
              </div>

              <div class="space-y-6">
                {#if selectedProviderConfig}
                  {#each selectedProviderConfig.fields as field}
                    {@const isWebhookSecret = field.key === "webhookSecret"}
                    <div>
                      <label
                        for={field.key}
                        class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2"
                      >
                        {field.label}
                        {#if !field.optional}<span class="text-error ml-1"
                            >*</span
                          >{/if}
                      </label>
                      <div class="relative">
                        <Lock
                          size={16}
                          class="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
                          weight="duotone"
                        />
                        <input
                          type={field.secret && !showSecretFields[field.key]
                            ? "password"
                            : "text"}
                          id={field.key}
                          bind:value={providerCredentials[field.key]}
                          placeholder={field.placeholder}
                          class="w-full bg-bg-secondary border border-border rounded-sm py-2.5 pl-10 pr-12 text-xs font-mono focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
                        />
                        {#if field.secret}
                          <button
                            type="button"
                            class="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-primary transition-colors"
                            onclick={() =>
                              (showSecretFields[field.key] =
                                !showSecretFields[field.key])}
                          >
                            {#if showSecretFields[field.key]}
                              <EyeSlash size={16} weight="duotone" />
                            {:else}
                              <Eye size={16} weight="duotone" />
                            {/if}
                          </button>
                        {/if}
                      </div>
                      {#if isWebhookSecret}
                        {@const webhookUrl = `${apiBase}/webhooks/${orgSlug || "your-org"}/${selectedProviderId}`}
                        <div
                          class="mt-2 bg-info-bg/50 border border-info/30 p-2.5 flex items-start gap-2"
                        >
                          <div class="flex-1 min-w-0">
                            <p
                              class="text-[10px] font-bold text-info uppercase tracking-widest mb-1"
                            >
                              Webhook URL
                            </p>
                            <code
                              class="font-mono text-[10px] text-info break-all"
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
                  {/each}
                {/if}

                <div class="p-4 bg-accent/5 border border-accent/20 rounded-sm">
                  <p
                    class="text-[10px] text-text-primary leading-relaxed uppercase tracking-tight opacity-70"
                  >
                    Keys are encrypted at rest and never stored in plain text.
                    You can change these later in settings.
                  </p>
                </div>
              </div>
            </div>
          {:else if currentStep === 4}
            <div in:fly={{ y: 20, duration: 600 }}>
              <div class="text-center mb-10">
                <div
                  class="w-16 h-16 bg-success/10 text-success rounded-full flex items-center justify-center mx-auto mb-6"
                >
                  <CheckCircle size={32} weight="fill" />
                </div>
                <h2
                  class="text-2xl font-bold text-text-primary mb-2 tracking-tight"
                >
                  You're all set!
                </h2>
                <p class="text-text-dim text-sm">
                  Your organization is ready. Here's how to start.
                </p>
              </div>

              <div class="space-y-6">
                <div>
                  <label
                    class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-3"
                    >Use CLI</label
                  >
                  <div
                    class="bg-bg-secondary border border-border overflow-hidden"
                  >
                    <div
                      class="bg-bg-tertiary px-3 py-1.5 flex items-center justify-between border-b border-border"
                    >
                      <span
                        class="text-[9px] font-bold text-text-dim uppercase tracking-wider"
                        >Terminal</span
                      >
                    </div>
                    <pre
                      class="p-4 text-[11px] font-mono text-text-secondary leading-relaxed overflow-x-auto"><code
                        >npx owosk init</code
                      ></pre>
                  </div>
                  <p class="mt-2 text-[11px] text-text-dim leading-relaxed">
                    Initialize `owo.config.ts` directly from your dashboard
                    setup.
                  </p>
                </div>

                <div>
                  <label
                    class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-3"
                    >Install SDK</label
                  >
                  <div
                    class="bg-bg-secondary border border-border p-3 flex items-center justify-between group"
                  >
                    <code class="text-xs font-mono text-text-primary"
                      >npm install owostack</code
                    >
                    <CheckCircle
                      size={14}
                      class="text-success opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </div>
                </div>
              </div>
            </div>
          {/if}
        </div>

        <!-- Sticky Footer -->
        <div
          class="p-6 border-t border-border bg-bg-secondary/50 flex items-center justify-between"
        >
          {#if currentStep > 1 && currentStep < 4}
            <button
              class="flex items-center gap-2 text-xs font-bold text-text-dim hover:text-text-primary transition-colors uppercase tracking-widest"
              onclick={prevStep}
              disabled={isCreating}
            >
              <CaretLeft size={16} weight="bold" />
              Back
            </button>
          {:else}
            <div></div>
            <!-- Spacer -->
          {/if}

          {#if currentStep < 3}
            <button
              class="btn btn-primary px-8 py-3 text-xs shadow-none hover:shadow-none flex items-center gap-2 group"
              onclick={nextStep}
              disabled={(currentStep === 1 &&
                (orgSlug.length < 3 || slugAvailable !== true)) ||
                (currentStep === 1 && !orgName)}
            >
              <span>Continue</span>
              <ArrowRight
                size={14}
                weight="bold"
                class="group-hover:translate-x-1 transition-transform"
              />
            </button>
          {:else if currentStep === 3}
            <button
              class="btn btn-primary px-8 py-3 text-xs shadow-none hover:shadow-none flex items-center gap-2 group"
              onclick={finishOnboarding}
              disabled={isCreating || !hasRequiredCredentials()}
            >
              {#if isCreating}
                <CircleNotch size={14} class="animate-spin" />
                <span>Creating...</span>
              {:else}
                <CheckCircle size={14} weight="fill" />
                <span>Complete Setup</span>
              {/if}
            </button>
          {:else}
            <button
              class="btn btn-primary px-8 py-3 text-xs shadow-none hover:shadow-none flex items-center justify-between w-full group"
              onclick={() => goto(`/${orgSlug}/plans`)}
            >
              <span>Go to Dashboard</span>
              <ArrowRight
                size={14}
                weight="bold"
                class="group-hover:translate-x-1 transition-transform"
              />
            </button>
          {/if}
        </div>
      </div>

      <div class="mt-8 text-center">
        <p
          class="text-[10px] text-text-dim uppercase tracking-[.2em] font-bold"
        >
          Step {currentStep} of {steps.length}
        </p>
      </div>
    </div>
  </div>
</main>

<style>
  .custom-scrollbar::-webkit-scrollbar {
    width: 4px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    /* @apply bg-border rounded-full; */
  }
</style>
