<script lang="ts">
  import {
    Buildings,
    Link,
    ArrowRight,
    CheckCircle,
    CircleNotch,
    Copy,
    Check,
    Key,
    Flask,
  } from "phosphor-svelte";
  import { organization, apiFetch } from "$lib/auth-client";
  import { goto } from "$app/navigation";
  import { fade, fly, slide } from "svelte/transition";
  import Logo from "$lib/components/ui/Logo.svelte";

  // State
  let currentStep = $state(1); // 1: Organization, 2: Sandbox key
  let isCreating = $state(false);
  let error = $state<string | null>(null);

  // Form Data
  let orgName = $state("");
  let orgSlug = $state("");
  let isCheckingSlug = $state(false);
  let slugAvailable = $state<boolean | null>(null);

  // Result
  let sandboxKey = $state<string | null>(null);
  let keyCopied = $state(false);

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
  let slugTimeout: ReturnType<typeof setTimeout>;
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
        } catch {
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

  const steps = [
    { id: 1, title: "Organization", desc: "Workspace details" },
    { id: 2, title: "Sandbox key", desc: "Start building" },
  ];

  let canContinue = $derived(
    !!orgName && orgSlug.length >= 3 && slugAvailable === true,
  );

  /**
   * Sandbox is fully managed by Owostack: no provider credentials are needed
   * to start. We create the organization, mint a sandbox API key and drop the
   * user straight into the dashboard.
   */
  async function finishOnboarding() {
    if (!canContinue) return;

    isCreating = true;
    error = null;

    try {
      const { data: orgData, error: orgError } = await organization.create({
        name: orgName,
        slug: orgSlug,
      });

      if (orgError) throw new Error(orgError.message);
      if (!orgData?.id) throw new Error("Failed to create organization");

      const keyRes = await apiFetch("/api/dashboard/keys", {
        method: "POST",
        body: JSON.stringify({
          organizationId: orgData.id,
          name: "Sandbox key",
          environment: "test",
        }),
      });

      if (keyRes.data?.success && keyRes.data.data?.secretKey) {
        sandboxKey = keyRes.data.data.secretKey;
      } else {
        // The org exists; the key can still be created from Settings.
        sandboxKey = null;
        console.error("Failed to create sandbox key", keyRes.data?.error);
      }

      currentStep = 2;
    } catch (err: unknown) {
      error =
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.";
    } finally {
      isCreating = false;
    }
  }

  async function copyKey() {
    if (!sandboxKey) return;
    await navigator.clipboard.writeText(sandboxKey);
    keyCopied = true;
    setTimeout(() => (keyCopied = false), 2000);
  }
</script>

<svelte:head>
  <title>Welcome to Owostack</title>
</svelte:head>

<main class="min-h-screen bg-bg-primary flex">
  <!-- Left Side: Abstract Graphic and Context -->
  <div
    class="hidden lg:flex w-1/3 bg-bg-secondary border-r border-border p-12 flex-col justify-between relative overflow-hidden"
  >
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
          Name your organization and you're in. The sandbox comes with payment
          providers already wired up, so there's nothing to connect until
          you're ready to go live.
        </p>
      </div>
    </div>

    <div class="relative z-10">
      <div class="p-6 bg-bg-card border border-border rounded-sm space-y-4">
        <div class="space-y-3">
          {#each steps as step (step.id)}
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
        {#each steps as step (step.id)}
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

                <div
                  class="p-4 bg-accent/5 border border-accent/20 rounded-sm flex items-start gap-3"
                >
                  <Flask size={16} weight="duotone" class="text-accent mt-0.5 shrink-0" />
                  <p
                    class="text-[10px] text-text-primary leading-relaxed uppercase tracking-tight opacity-70"
                  >
                    You start in the sandbox. Payments run on Owostack's shared
                    test accounts, so no provider keys are needed. Connect your
                    own provider only when you go live.
                  </p>
                </div>
              </div>
            </div>
          {:else}
            <div in:fly={{ y: 20, duration: 600 }}>
              <div class="text-center mb-8">
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
                  Here's your sandbox API key. Copy it now, it won't be shown
                  again.
                </p>
              </div>

              <div class="space-y-6">
                <div>
                  <span
                    class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-3"
                    >Sandbox API key</span
                  >
                  {#if sandboxKey}
                    <div
                      class="bg-bg-secondary border border-border p-3 flex items-center gap-3"
                    >
                      <Key size={14} weight="duotone" class="text-text-dim shrink-0" />
                      <code
                        class="flex-1 min-w-0 text-[11px] font-mono text-text-primary break-all"
                        >{sandboxKey}</code
                      >
                      <button
                        type="button"
                        class="shrink-0 text-text-dim hover:text-text-primary transition-colors"
                        onclick={copyKey}
                        title="Copy API key"
                        aria-label="Copy API key"
                      >
                        {#if keyCopied}
                          <Check size={14} weight="bold" class="text-success" />
                        {:else}
                          <Copy size={14} weight="fill" />
                        {/if}
                      </button>
                    </div>
                    <p class="mt-2 text-[11px] text-text-dim leading-relaxed">
                      Works against the sandbox API only. Create a live key from
                      Settings when you're ready to charge real cards.
                    </p>
                  {:else}
                    <div
                      class="bg-bg-secondary border border-border p-3 text-[11px] text-text-dim"
                    >
                      We couldn't mint a key just now. You can create one under
                      Settings → API Keys.
                    </div>
                  {/if}
                </div>

                <div>
                  <span
                    class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-3"
                    >Install SDK</span
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
          class="p-6 border-t border-border bg-bg-secondary/50 flex items-center justify-end"
        >
          {#if currentStep === 1}
            <button
              class="btn btn-primary px-8 py-3 text-xs shadow-none hover:shadow-none flex items-center gap-2 group"
              onclick={finishOnboarding}
              disabled={isCreating || !canContinue}
            >
              {#if isCreating}
                <CircleNotch size={14} class="animate-spin" />
                <span>Creating...</span>
              {:else}
                <span>Create organization</span>
                <ArrowRight
                  size={14}
                  weight="bold"
                  class="group-hover:translate-x-1 transition-transform"
                />
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
