<script lang="ts">
  import {
    Save,
    Eye,
    EyeOff,
    CheckCircle,
    AlertCircle,
    Loader2,
    Link2,
    Copy,
    Check,
    Webhook,
    Settings as SettingsIcon,
    Cpu,
    Lock,
    Key,
    X,
  } from "lucide-svelte";
  import { page } from "$app/state";
  import { organization, apiFetch } from "$lib/auth-client";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  let projectId = $derived(page.params.projectId);
  let projectName = $state("");
  let projectSlug = $state("");
  let activeTab = $state("general");

  // Paystack integration state
  let paystackSecretKey = $state("");
  let paystackPublicKey = $state("");
  let paystackEnvironment = $state<"test" | "live">("test");
  let paystackConnected = $state(false);
  let paystackMaskedKey = $state("");

  let isSaving = $state(false);
  let isSavingPaystack = $state(false);
  let isLoading = $state(true);
  let showSecretKey = $state(false);
  let paystackError = $state<string | null>(null);
  let paystackSuccess = $state(false);
  let copied = $state(false);

  // Use current origin for webhook URL
  let webhookUrl = $derived(
    typeof window !== "undefined"
      ? `${window.location.origin.replace("dashboard.", "api.")}/webhooks/${projectId}`
      : ""
  );

  $effect(() => {
    if (projectId) {
      loadOrganization();
      loadPaystackConfig();
    }
  });

  async function loadOrganization() {
    isLoading = true;
    try {
      const { data } = await organization.list();
      const currentOrg = data?.find((o) => o.id === projectId);
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

  async function loadPaystackConfig() {
    try {
      const res = await apiFetch(
        `/api/dashboard/paystack-config?organizationId=${projectId}`,
      );
      if (res.data?.data) {
        paystackConnected = res.data.data.connected;
        if (res.data.data.connected) {
          paystackEnvironment = res.data.data.environment || "test";
          paystackPublicKey = res.data.data.publicKey || "";
          paystackMaskedKey = res.data.data.secretKeyMasked || "";
        }
      }
    } catch (e) {
      console.error("Failed to load Paystack config", e);
    }
  }

  async function saveSettings() {
    isSaving = true;
    try {
      await organization.update({
        organizationId: projectId,
        data: {
          name: projectName,
          slug: projectSlug,
        },
      });
      await loadOrganization();
    } catch (e) {
      console.error("Failed to update organization", e);
    } finally {
      isSaving = false;
    }
  }

  async function savePaystackConfig() {
    if (!paystackSecretKey) return;

    isSavingPaystack = true;
    paystackError = null;
    paystackSuccess = false;

    try {
      const res = await apiFetch("/api/dashboard/paystack-config", {
        method: "POST",
        body: JSON.stringify({
          organizationId: projectId,
          secretKey: paystackSecretKey,
          publicKey: paystackPublicKey || undefined,
          environment: paystackEnvironment,
        }),
      });

      if (res.error) {
        throw new Error(res.error.message);
      }

      paystackConnected = true;
      paystackMaskedKey = res.data?.data?.secretKeyMasked || "";
      paystackSecretKey = ""; // Clear the input for security
      paystackSuccess = true;
      setTimeout(() => (paystackSuccess = false), 3000);
    } catch (e: any) {
      paystackError = e.message || "Failed to save Paystack configuration";
    } finally {
      isSavingPaystack = false;
    }
  }

  function copyWebhook() {
    navigator.clipboard.writeText(webhookUrl);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<svelte:head>
  <title>Settings - Owostack</title>
</svelte:head>

<div class="max-w-3xl">
  <div class="mb-8">
    <h1 class="text-xl font-bold text-white mb-2 uppercase tracking-wide">Project Settings</h1>
    <p class="text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-bold">
      Configure your project environment
    </p>
  </div>

  <!-- Tabs Navigation -->
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
      onclick={() => (activeTab = "paystack")}
      class="px-6 py-3 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 {activeTab === 'paystack' ? 'border-accent text-white bg-accent/5' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
    >
      <div class="flex items-center gap-2">
        <Cpu size={14} />
        Paystack Integration
      </div>
    </button>
    <button
      onclick={() => (activeTab = "webhook")}
      class="px-6 py-3 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 {activeTab === 'webhook' ? 'border-accent text-white bg-accent/5' : 'border-transparent text-zinc-500 hover:text-zinc-300'}"
    >
      <div class="flex items-center gap-2">
        <Webhook size={14} />
        Webhook
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
    {:else if activeTab === "general"}
      <!-- General Settings -->
      <div class="bg-bg-card border border-border p-8 shadow-md">
        <div class="mb-8">
          <h3 class="text-xs font-bold text-white mb-1 uppercase tracking-wider">
            Basic Information
          </h3>
          <p class="text-[10px] text-zinc-500 uppercase tracking-widest">Update your project identity</p>
        </div>

        <div class="space-y-8">
          <div>
            <label
              for="name"
              class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3"
              >Project Name</label
            >
            <input type="text" id="name" bind:value={projectName} class="input w-full" placeholder="e.g. Acme Inc" />
          </div>

          <div>
            <label
              for="slug"
              class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3"
              >Project Slug</label
            >
            <div class="flex items-center group">
              <span
                class="bg-bg-secondary border border-r-0 border-border px-4 py-2 text-zinc-500 text-xs font-mono h-[42px] flex items-center"
                >owostack.com/</span
              >
              <input
                type="text"
                id="slug"
                bind:value={projectSlug}
                class="input border-l-0 flex-1 h-[42px]"
                placeholder="acme-slug"
              />
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
    {:else if activeTab === "paystack"}
      <!-- Paystack Integration -->
      <div class="bg-bg-card border border-border p-8 shadow-md relative overflow-hidden">
        {#if paystackConnected}
          <div
            class="absolute top-0 right-0 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"
          ></div>
        {/if}

        <div class="flex items-center justify-between mb-10">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 bg-[#00C3F7]/10 flex items-center justify-center rounded">
              <svg viewBox="0 0 24 24" class="w-6 h-6 text-[#00C3F7]" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
            </div>
            <div>
              <h3 class="text-xs font-bold text-white uppercase tracking-wider">
                API Credentials
              </h3>
              <p class="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
                Securely connect to Paystack
              </p>
            </div>
          </div>

          {#if paystackConnected}
            <div class="flex items-center gap-2 text-[10px] text-emerald-500 font-bold uppercase tracking-[0.2em] bg-emerald-500/10 px-3 py-1.5 rounded border border-emerald-500/20">
              <CheckCircle size={12} />
              Connected
            </div>
          {:else}
            <div class="flex items-center gap-2 text-[10px] text-amber-500 font-bold uppercase tracking-[0.2em] bg-amber-500/10 px-3 py-1.5 rounded border border-amber-500/20">
              <AlertCircle size={12} />
              Not Connected
            </div>
          {/if}
        </div>

        {#if paystackError}
          <div class="mb-6 p-4 bg-red-900/20 border border-red-500/50 text-red-400 text-xs shadow-inner">
            <div class="flex items-center gap-2">
              <AlertCircle size={14} />
              {paystackError}
            </div>
          </div>
        {/if}

        {#if paystackSuccess}
          <div class="mb-6 p-4 bg-emerald-900/20 border border-emerald-500/50 text-emerald-400 text-xs shadow-inner">
            <div class="flex items-center gap-2">
              <CheckCircle size={14} />
              Paystack integration saved successfully!
            </div>
          </div>
        {/if}

        <div class="space-y-8">
          <!-- Secret Key -->
          <div>
            <label for="secretKey" class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">
              Secret Key {#if paystackConnected}<span class="text-emerald-500 font-bold tracking-normal ml-1">✓</span>{/if}
            </label>
            <div class="input-icon-wrapper">
              <Lock size={14} class="input-icon-left" />
              <input
                type={showSecretKey ? "text" : "password"}
                id="secretKey"
                bind:value={paystackSecretKey}
                placeholder={paystackConnected ? paystackMaskedKey : "sk_test_xxxxxxxxxxxxxxx"}
                class="input input-has-icon-left pr-12 font-mono text-xs w-full"
              />
              {#if paystackSecretKey || paystackConnected}
                <button
                  type="button"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-white transition-colors"
                  onclick={() => (paystackSecretKey = "")}
                >
                  <X size={14} />
                </button>
              {/if}
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
                onclick={() => (showSecretKey = !showSecretKey)}
              >
                {#if showSecretKey}
                  <EyeOff size={18} />
                {:else}
                  <Eye size={18} />
                {/if}
              </button>
            </div>
            <p class="mt-3 text-[10px] text-zinc-500">
              Get your keys from 
              <a href="https://dashboard.paystack.com/#/settings/developers" target="_blank" class="text-accent hover:underline font-bold">
                Paystack Settings → API Keys
              </a>
            </p>
          </div>

          <div>
            <label for="publicKey" class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Public Key</label>
            <div class="input-icon-wrapper">
              <Key size={14} class="input-icon-left" />
              <input 
                id="publicKey"
                bind:value={paystackPublicKey}
                placeholder="pk_test_xxxxxxxxxxxxxxx"
                class="input input-has-icon-left font-mono text-xs w-full"
              />
            </div>
          </div>

          <!-- Environment -->
          <div>
            <label class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">
              Environment Mode
            </label>
            <div class="flex gap-8">
              <label class="flex items-center gap-3 cursor-pointer group">
                <div class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all {paystackEnvironment === 'test' ? 'border-accent' : 'border-zinc-700 group-hover:border-zinc-500'}">
                  {#if paystackEnvironment === 'test'}
                    <div class="w-2.5 h-2.5 rounded-full bg-accent"></div>
                  {/if}
                </div>
                <input type="radio" name="environment" value="test" bind:group={paystackEnvironment} class="hidden" />
                <span class="text-xs font-bold uppercase tracking-widest {paystackEnvironment === 'test' ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-400'}">Test</span>
              </label>

              <label class="flex items-center gap-3 cursor-pointer group">
                <div class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all {paystackEnvironment === 'live' ? 'border-accent' : 'border-zinc-700 group-hover:border-zinc-500'}">
                  {#if paystackEnvironment === 'live'}
                    <div class="w-2.5 h-2.5 rounded-full bg-accent"></div>
                  {/if}
                </div>
                <input type="radio" name="environment" value="live" bind:group={paystackEnvironment} class="hidden" />
                <span class="text-xs font-bold uppercase tracking-widest {paystackEnvironment === 'live' ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-400'}">Live</span>
              </label>
            </div>
          </div>
        </div>

        <div class="mt-10 pt-6 border-t border-border flex justify-end">
          <button
            class="btn btn-primary px-8"
            onclick={savePaystackConfig}
            disabled={!paystackSecretKey || isSavingPaystack}
          >
            {#if isSavingPaystack}
              <Loader2 size={16} class="animate-spin" />
              Verifying...
            {:else}
              <Link2 size={16} />
              {paystackConnected ? "Update Credentials" : "Connect Paystack"}
            {/if}
          </button>
        </div>
      </div>
    {:else if activeTab === "webhook"}
      <!-- Webhook Display -->
      <div class="bg-bg-card border border-border p-8 shadow-md">
        <div class="flex items-center gap-4 mb-10">
          <div class="w-12 h-12 bg-accent/10 flex items-center justify-center rounded">
            <Webhook size={24} class="text-accent" />
          </div>
          <div>
            <h3 class="text-xs font-bold text-white uppercase tracking-wider">
              Webhook Configuration
            </h3>
            <p class="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
              Receive real-time payment events
            </p>
          </div>
        </div>

        <div class="space-y-8">
          <div class="bg-bg-secondary/30 border border-border p-5 rounded">
            <p class="text-xs text-zinc-400 leading-relaxed">
              Register this URL as your Webhook URL in your 
              <a href="https://dashboard.paystack.com/#/settings/developers" target="_blank" class="text-accent hover:underline font-bold italic">
                Paystack Developer Settings
              </a>. 
              This allows Owostack to track lifecycle events like renewals, cancellations, and failures.
            </p>
          </div>

          <div>
            <label class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Your Endpoint URL</label>
            <div class="bg-black border border-border p-4 flex items-center gap-4 group transition-colors hover:border-zinc-500 shadow-inner">
              <code class="flex-1 font-mono text-xs text-zinc-300 break-all select-all">
                {webhookUrl}
              </code>
              <button 
                class="p-2.5 bg-bg-card border border-border hover:border-accent text-zinc-500 hover:text-accent transition-all rounded shadow-lg"
                onclick={copyWebhook}
                title="Copy to clipboard"
              >
                {#if copied}
                  <Check size={16} class="text-emerald-500" />
                {:else}
                  <Copy size={16} />
                {/if}
              </button>
            </div>
          </div>
          
          <div class="flex items-start gap-4 bg-blue-900/10 border border-blue-900/30 p-5 rounded shadow-sm">
            <AlertCircle size={18} class="flex-shrink-0 text-blue-400 mt-0.5" />
            <div class="space-y-2">
              <h4 class="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Why is this required?</h4>
              <p class="text-xs text-blue-400/80 leading-relaxed">
                Without a webhook, Owostack cannot know when a payment is actually completed on Paystack. 
                Webhooks ensure your database stays in sync with real-world transactions.
              </p>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  /* Ensure consistent height for inputs across modes */
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
    color: #27272a; /* zinc-800 equivalent */
  }
</style>
