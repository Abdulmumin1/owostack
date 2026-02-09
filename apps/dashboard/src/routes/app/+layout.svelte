<script lang="ts">
  import {
    LayoutGrid,
    CreditCard,
    Users,
    Activity,
    Webhook,
    Key,
    Settings,
    ChevronDown,
    LogOut,
    Plus,
    Rocket,
    FlaskConical,
    Boxes,
    BarChart3,
    ChartNoAxesColumn,
    Receipt,
    Coins,
    Eye,
    EyeOff,
    Lock,
    Save,
    Loader2,
    Check,
    ArrowRight,
    X,
    Copy,
  } from "lucide-svelte";
  import { page } from "$app/state";
  import {
    useSession,
    organization,
    authClient,
    apiFetch,
  } from "$lib/auth-client";
  import { setActiveEnvironment, setProjectId, loadActiveEnvironment, getApiUrlForEnv } from "$lib/env";
  import Logo from "$lib/components/ui/Logo.svelte";
  import { getProviderConfig } from "$lib/providers";
  import { defaultCurrency } from "$lib/stores/currency";

  let { children } = $props();

  const session = useSession();

  let projects = $state<any[]>([]);
  let showProjectDropdown = $state(false);
  let activeEnvironment = $state<"test" | "live">("test");
  let testConnected = $state(false);
  let liveConnected = $state(false);
  let isSwitching = $state(false);

  // Deploy to Production modal state
  let showDeployModal = $state(false);
  let deployCredentials = $state<Record<string, Record<string, string>>>({});
  let deployShowSecrets = $state<Record<string, boolean>>({});
  let deploySavingProvider = $state<string | null>(null);
  let deployError = $state<string | null>(null);

  // Per-provider status: which test providers exist and which have live counterparts
  let testProviderIds = $state<string[]>([]);
  let liveProviderIds = $state<Set<string>>(new Set());

  // Step completion state
  let step1Done = $derived(liveProviderIds.size > 0);
  let allTestProvidersLive = $derived(
    testProviderIds.length > 0 && testProviderIds.every((id) => liveProviderIds.has(id))
  );
  let step2Done = $state(false);
  let step2Loading = $state(false);
  let step2Result = $state<string | null>(null);
  let step3Done = $state(false);
  let step3Loading = $state(false);
  let generatedApiKey = $state<string | null>(null);
  let apiKeyCopied = $state(false);

  async function openDeployModal() {
    deployCredentials = {};
    deployShowSecrets = {};
    deploySavingProvider = null;
    deployError = null;
    step2Done = false;
    step2Result = null;
    step3Done = false;
    generatedApiKey = null;
    apiKeyCopied = false;
    showDeployModal = true;

    // Load actual provider accounts to determine which test providers need live counterparts
    try {
      const res = await apiFetch(`/api/dashboard/providers/accounts?organizationId=${projectId}`);
      if (res.data?.data) {
        const accounts = res.data.data as any[];
        testProviderIds = [...new Set(accounts.filter((a: any) => a.environment === "test").map((a: any) => a.providerId))];
        liveProviderIds = new Set(accounts.filter((a: any) => a.environment === "live").map((a: any) => a.providerId));
      }
    } catch (e) {
      console.error("Failed to load provider accounts", e);
    }
  }

  function closeDeployModal() {
    showDeployModal = false;
    deployCredentials = {};
    deployError = null;
  }

  async function connectLiveProvider(providerId: string) {
    deploySavingProvider = providerId;
    deployError = null;
    try {
      const config = getProviderConfig(providerId);
      if (!config) throw new Error(`Unknown provider: ${providerId}`);

      const credentials: Record<string, unknown> = {};
      const providerCreds = deployCredentials[providerId] || {};
      for (const field of config.fields) {
        const val = providerCreds[field.key];
        if (val && val.trim().length > 0) {
          credentials[field.key] = val.trim();
        }
      }
      if (Object.keys(credentials).length === 0) {
        throw new Error("Enter at least one credential");
      }

      const res = await apiFetch("/api/dashboard/providers/accounts", {
        method: "POST",
        body: JSON.stringify({
          organizationId: projectId,
          providerId,
          environment: "live",
          credentials,
        }),
      });
      if (res.error) throw new Error(res.error.message);

      // Update per-provider status
      liveProviderIds = new Set([...liveProviderIds, providerId]);
      await loadEnvironmentStatus();
    } catch (e: any) {
      deployError = e.message || "Failed to connect provider";
    } finally {
      deploySavingProvider = null;
    }
  }

  async function copyCatalogToProduction() {
    step2Loading = true;
    deployError = null;
    try {
      // 1. Export from test (current) API
      const testApiUrl = getApiUrlForEnv("test");
      const exportRes = await fetch(
        `${testApiUrl}/api/dashboard/catalog/export?organizationId=${projectId}`,
        { credentials: "include" },
      );
      const exportData = await exportRes.json();
      if (!exportRes.ok || !exportData.success) {
        throw new Error(exportData.error || "Failed to export catalog");
      }

      // 2. Import to live API
      const liveApiUrl = getApiUrlForEnv("live");
      const importRes = await fetch(
        `${liveApiUrl}/api/dashboard/catalog/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            organizationId: projectId,
            catalog: exportData.data,
          }),
        },
      );
      const importData = await importRes.json();
      if (!importRes.ok || !importData.success) {
        throw new Error(importData.error || "Failed to import catalog");
      }

      const r = importData.data;
      const created =
        r.features.created + r.plans.created + r.planFeatures.created +
        r.creditSystems.created + r.creditSystemFeatures.created +
        r.creditPacks.created + r.overageSettings.created;
      const skipped =
        r.features.skipped + r.plans.skipped + r.planFeatures.skipped +
        r.creditSystems.skipped + r.creditSystemFeatures.skipped +
        r.creditPacks.skipped + r.overageSettings.skipped;

      step2Done = true;
      step2Result = created > 0
        ? `Copied ${created} items (${skipped} already existed)`
        : `All ${skipped} items already exist in production`;
    } catch (e: any) {
      deployError = e.message || "Failed to copy catalog";
    } finally {
      step2Loading = false;
    }
  }

  async function generateProductionApiKey() {
    step3Loading = true;
    deployError = null;
    try {
      const liveApiUrl = getApiUrlForEnv("live");
      const res = await fetch(
        `${liveApiUrl}/api/dashboard/keys`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            organizationId: projectId,
            name: "Production Key",
          }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to generate key");
      }

      generatedApiKey = data.data.secretKey;
      step3Done = true;
    } catch (e: any) {
      deployError = e.message || "Failed to generate API key";
    } finally {
      step3Loading = false;
    }
  }

  function copyApiKey() {
    if (generatedApiKey) {
      navigator.clipboard.writeText(generatedApiKey);
      apiKeyCopied = true;
      setTimeout(() => (apiKeyCopied = false), 2000);
    }
  }

  async function goToProduction() {
    isSwitching = true;
    try {
      await setActiveEnvironment("live");
      activeEnvironment = "live";
      closeDeployModal();
    } catch (e) {
      console.error("Failed to switch to production", e);
    } finally {
      isSwitching = false;
    }
  }

  // Fetch user's organizations
  $effect(() => {
    if ($session.data) {
      organization.list().then(({ data }) => {
        if (data) projects = data;
      });
    }
  });

  // Get current project ID from URL
  let projectId = $derived(page.params.projectId);
  let currentProject = $derived(
    projects.find((p) => p.id === projectId) || { name: "Select Project" },
  );

  async function handleLogout() {
    await authClient.signOut();
    window.location.href = "/login";
  }

  // Load environment status when project changes
  $effect(() => {
    if (projectId) {
      setProjectId(projectId);
      loadEnvironmentStatus();
    }
  });

  async function loadEnvironmentStatus() {
    try {
      const [accountsRes, env, currencyRes] = await Promise.all([
        apiFetch(`/api/dashboard/providers/accounts?organizationId=${projectId}`),
        loadActiveEnvironment(),
        apiFetch(`/api/dashboard/config/default-currency?organizationId=${projectId}`),
      ]);

      if (accountsRes.data?.data) {
        const accounts = accountsRes.data.data as any[];
        testConnected = accounts.some((a: any) => a.environment === "test");
        liveConnected = accounts.some((a: any) => a.environment === "live");
      }

      if (currencyRes.data?.data?.defaultCurrency) {
        defaultCurrency.set(currencyRes.data.data.defaultCurrency);
      }

      activeEnvironment = env;
    } catch (e) {
      console.error("Failed to load environment", e);
    }
  }

  async function switchEnvironment(env: "test" | "live") {
    if (env === "live" && !liveConnected) {
      alert("Live mode not configured. Add a live key in Settings first.");
      return;
    }
    if (env === "live" && activeEnvironment === "test") {
      const confirmed = confirm(
        "Switch to Live mode? Real payments will be processed.",
      );
      if (!confirmed) return;
    }

    isSwitching = true;
    try {
      await setActiveEnvironment(env);
      activeEnvironment = env;
    } catch (e) {
      console.error("Failed to switch environment", e);
    } finally {
      isSwitching = false;
    }
  }

  // Grouped navigation like Autumn's structure
  const navGroups = [
    {
      label: "Products",
      items: [
        { href: "/plans", icon: CreditCard, label: "Plans" },
        { href: "/features", icon: Boxes, label: "Features" },
        { href: "/addons", icon: Coins, label: "Add-ons" },
        { href: "/subscriptions", icon: CreditCard, label: "Subscriptions" },
      ],
    },
    {
      label: null, // No label - standalone items
      items: [
        { href: "/customers", icon: Users, label: "Customers" },
        { href: "/transactions", icon: Receipt, label: "Transactions" },
        { href: "/usage", icon: ChartNoAxesColumn, label: "Usage" },
      ],
    },
    {
      label: "Developer",
      items: [
        { href: "/keys", icon: Key, label: "API Keys" },
        { href: "/events", icon: Webhook, label: "Events" },
        { href: "/settings", icon: Settings, label: "Settings" },
      ],
    },
  ];

  function isActive(href: string, exact = false): boolean {
    const currentPath = page.url.pathname;
    if (exact) return currentPath === href;
    return currentPath.startsWith(href);
  }
</script>

<svelte:head>
  <title>Dashboard - Owostack</title>
</svelte:head>

<div class="min-h-screen flex bg-bg-primary text-sm">
  <!-- Sidebar - Minimalist, text-focused -->
  <aside
    class="w-64 fixed h-screen flex flex-col pt-8 pb-4 pl-6 pr-6 bg-bg-secondary border-r border-border"
  >
    <!-- Logo -->
    <div class="mb-10 pl-2">
      <a
        href="/"
        class="flex items-center gap-2 font-bold text-white hover:text-accent transition-colors"
      >
        <Logo size={30} class="text-accent" />
        <span>Owostack</span>
      </a>
    </div>

    <!-- Domain/Project Selector -->
    {#if projectId}
      <div class="mb-8">
        <div
          class="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 pl-2"
        >
          Project
        </div>
        <div class="relative">
          <button
            class="w-full flex items-center justify-between p-3 bg-bg-card border border-border text-left hover:border-zinc-500 transition-colors shadow-sm"
            onclick={() => (showProjectDropdown = !showProjectDropdown)}
          >
            <span class="font-medium truncate">{currentProject.name}</span>
            <ChevronDown size={14} class="text-zinc-500 shrink-0" />
          </button>

          {#if showProjectDropdown}
            <div
              class="absolute top-full left-0 right-0 mt-1 bg-bg-card border border-border shadow-xl z-50"
            >
              {#each projects as project}
                <a
                  href="/app/{project.id}"
                  class="block px-3 py-2 hover:bg-bg-card-hover hover:text-white transition-colors border-l-2 border-transparent hover:border-accent {project.id ===
                  projectId
                    ? 'border-accent bg-bg-card-hover'
                    : ''}"
                  onclick={() => (showProjectDropdown = false)}
                >
                  {project.name}
                </a>
              {/each}
              <button
                class="w-full text-left px-3 py-2 text-zinc-500 hover:text-white hover:bg-bg-card-hover border-t border-border mt-1"
              >
                + New Organization
              </button>
            </div>
          {/if}
        </div>
      </div>

      <!-- Grouped Navigation like Autumn -->
      {#each navGroups as group}
        {#if group.label}
          <div
            class="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 pl-2 mt-6 first:mt-0"
          >
            {group.label}
          </div>
        {/if}
        <nav class="space-y-0.5 mb-2">
          {#each group.items as item}
            {@const href = `/app/${projectId}${item.href}`}
            {@const active = isActive(href)}
            <a
              {href}
              class="flex items-center gap-3 px-3 py-2 transition-all duration-200 border-l-2 border-transparent {active
                ? 'border-accent bg-bg-card text-white'
                : 'text-zinc-400 hover:text-white'}"
            >
              <item.icon size={16} />
              <span>{item.label}</span>
            </a>
          {/each}
        </nav>
      {/each}
    {:else}
      <!-- Dashboard Navigation -->
      <div
        class="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 pl-2"
      >
        Dashboard
      </div>
      <nav class="space-y-1 mb-8">
        <a
          href="/app"
          class="flex items-center gap-3 px-3 py-2 bg-bg-card border-l-2 border-accent text-white"
        >
          <LayoutGrid size={16} />
          <span>Overview</span>
        </a>
        <a
          href="/app/settings"
          class="flex items-center gap-3 px-3 py-2 text-zinc-400 hover:text-white transition-colors"
        >
          <Settings size={16} />
          <span>Settings</span>
        </a>
      </nav>
    {/if}

    <!-- Footer/User -->
    <div class="mt-auto pl-2">
      {#if $session.data}
        <div class="flex items-center gap-2 mb-2 text-xs text-zinc-400">
          <div class="w-2 h-2 bg-green-500"></div>
          <span class="truncate max-w-[140px]">{$session.data.user.email}</span>
        </div>
      {/if}
      <button
        class="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
        onclick={handleLogout}
      >
        <LogOut size={14} />
        <span>Log out</span>
      </button>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="ml-64 flex-1 overflow-auto bg-bg-primary">
    <!-- Environment Banner (like Autumn's "You're in sandbox") -->
    {#if projectId}
      <div
        class="w-full py-2 px-6 flex items-center justify-center gap-4 text-xs font-mono {activeEnvironment ===
        'test'
          ? 'bg-cyan-950/50 border-b border-cyan-800/50'
          : 'bg-red-950/50 border-b border-red-800/50'}"
      >
        {#if activeEnvironment === "test"}
          <span class="text-cyan-400">
            <FlaskConical size={14} class="inline mr-1" />
            You're in <span class="font-bold">sandbox</span>
          </span>
          <button
            onclick={openDeployModal}
            class="flex items-center gap-1 px-3 py-1 bg-accent text-black text-xs font-bold hover:bg-accent-hover transition-colors"
          >
            <Rocket size={12} />
            Deploy to Production
          </button>
        {:else}
          <span class="text-red-400 font-bold">
            <Rocket size={14} class="inline mr-1" />
            LIVE MODE — Real payments
          </span>
          <button
            onclick={() => switchEnvironment("test")}
            disabled={isSwitching}
            class="flex items-center gap-1 px-3 py-1 bg-zinc-700 text-white text-xs font-medium hover:bg-zinc-600 transition-colors disabled:opacity-50"
          >
            <FlaskConical size={12} />
            Switch to Sandbox
          </button>
        {/if}
      </div>
    {/if}
    <div class="p-8 max-w-7xl mx-auto w-full">
      {@render children()}
    </div>
  </main>

  <!-- Deploy to Production Modal -->
  {#if showDeployModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <!-- Backdrop -->
      <div
        class="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onclick={closeDeployModal}
        role="presentation"
      ></div>

      <!-- Modal -->
      <div class="relative bg-bg-secondary border border-border shadow-2xl w-full max-w-lg mx-4">
        <!-- Header -->
        <div class="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 class="text-lg font-bold text-white">Deploy to Production</h2>
            <p class="text-xs text-zinc-500 mt-1">Follow the steps below to go live.</p>
          </div>
          <button
            class="text-zinc-500 hover:text-white transition-colors"
            onclick={closeDeployModal}
          >
            <X size={18} />
          </button>
        </div>

        <!-- Error -->
        {#if deployError}
          <div class="mx-6 mt-4 p-3 bg-red-900/20 border border-red-500/50 text-red-400 text-xs">
            {deployError}
          </div>
        {/if}

        <!-- Steps -->
        <div class="p-6 space-y-6 max-h-[60vh] overflow-y-auto">

          <!-- Step 1: Connect Providers -->
          <div class="flex items-start gap-4">
            <div class="shrink-0 w-7 h-7 flex items-center justify-center text-xs font-bold {allTestProvidersLive ? 'bg-accent text-black' : step1Done ? 'bg-accent/60 text-black' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}">
              {#if allTestProvidersLive}
                <Check size={14} />
              {:else}
                1
              {/if}
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-bold text-white">Connect your provider accounts</h3>
              <p class="text-xs text-zinc-500 mt-0.5">
                Add live credentials for each payment provider you use.
              </p>

              {#if testProviderIds.length === 0}
                <p class="text-xs text-zinc-600 mt-2 italic">No test providers configured yet. Add one in Settings first.</p>
              {/if}

              <div class="mt-3 space-y-4">
                {#each testProviderIds as providerId}
                  {@const config = getProviderConfig(providerId)}
                  {@const isLive = liveProviderIds.has(providerId)}
                  {@const isSaving = deploySavingProvider === providerId}
                  <div class="border border-border bg-bg-card p-3 space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-bold text-white">{config?.name || providerId}</span>
                      {#if isLive}
                        <span class="text-[10px] text-accent font-medium flex items-center gap-1">
                          <Check size={12} /> Live connected
                        </span>
                      {:else}
                        <span class="text-[10px] text-zinc-500">Needs live keys</span>
                      {/if}
                    </div>
                    {#if !isLive && config}
                      {#each config.fields as field}
                        {@const secretKey = `${providerId}.${field.key}`}
                        <div class="relative">
                          <Lock size={12} class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                          <input
                            type={field.secret && !deployShowSecrets[secretKey] ? "password" : "text"}
                            value={deployCredentials[providerId]?.[field.key] || ""}
                            oninput={(e) => {
                              if (!deployCredentials[providerId]) deployCredentials[providerId] = {};
                              deployCredentials[providerId][field.key] = (e.target as HTMLInputElement).value;
                              deployCredentials = deployCredentials;
                            }}
                            placeholder={field.placeholder}
                            class="input pl-9 pr-10 font-mono text-xs w-full"
                          />
                          {#if field.secret}
                            <button
                              type="button"
                              class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
                              onclick={() => { deployShowSecrets[secretKey] = !deployShowSecrets[secretKey]; deployShowSecrets = deployShowSecrets; }}
                            >
                              {#if deployShowSecrets[secretKey]}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
                            </button>
                          {/if}
                        </div>
                      {/each}
                      <button
                        class="btn btn-primary text-xs px-4 py-1.5"
                        onclick={() => connectLiveProvider(providerId)}
                        disabled={isSaving}
                      >
                        {#if isSaving}
                          <Loader2 size={14} class="animate-spin" /> Connecting...
                        {:else}
                          Connect {config.name}
                        {/if}
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>

              {#if step1Done && !allTestProvidersLive}
                <p class="text-[10px] text-yellow-500 mt-2">
                  Some test providers don't have live keys yet. You can still go live, but features using those providers won't work in production.
                </p>
              {/if}
            </div>
          </div>

          <!-- Step 2: Copy Catalog -->
          <div class="flex items-start gap-4">
            <div class="shrink-0 w-7 h-7 flex items-center justify-center text-xs font-bold {step2Done ? 'bg-accent text-black' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}">
              {#if step2Done}
                <Check size={14} />
              {:else}
                2
              {/if}
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-bold text-white">Copy your plans to production</h3>
              <p class="text-xs text-zinc-500 mt-0.5">
                Sync all configured plans, features, and credit packs from sandbox to production.
              </p>
              {#if step2Result}
                <p class="text-xs text-accent mt-1">{step2Result}</p>
              {/if}
            </div>
            <div class="shrink-0">
              {#if step2Done}
                <span class="text-xs text-accent font-medium flex items-center gap-1">
                  <Check size={14} /> Copied
                </span>
              {:else}
                <button
                  class="btn btn-secondary text-xs px-4 py-1.5 whitespace-nowrap"
                  onclick={copyCatalogToProduction}
                  disabled={step2Loading}
                >
                  {#if step2Loading}
                    <Loader2 size={14} class="animate-spin" /> Copying...
                  {:else}
                    Copy Plans
                  {/if}
                </button>
              {/if}
            </div>
          </div>

          <!-- Step 3: Generate API Key -->
          <div class="flex items-start gap-4">
            <div class="shrink-0 w-7 h-7 flex items-center justify-center text-xs font-bold {step3Done ? 'bg-accent text-black' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}">
              {#if step3Done}
                <Check size={14} />
              {:else}
                3
              {/if}
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-bold text-white">Create a production secret key</h3>
              <p class="text-xs text-zinc-500 mt-0.5">
                Generate a live API key for use in your production environment.
              </p>
              {#if generatedApiKey}
                <div class="mt-2 flex items-center gap-2">
                  <code class="text-xs font-mono bg-bg-card border border-border px-2 py-1 text-accent truncate max-w-[260px]">
                    {generatedApiKey}
                  </code>
                  <button
                    class="text-zinc-400 hover:text-white transition-colors shrink-0"
                    onclick={copyApiKey}
                    title="Copy key"
                  >
                    {#if apiKeyCopied}
                      <Check size={14} class="text-accent" />
                    {:else}
                      <Copy size={14} />
                    {/if}
                  </button>
                </div>
                <p class="text-[10px] text-zinc-600 mt-1">Save this key — it won't be shown again.</p>
              {/if}
            </div>
            <div class="shrink-0">
              {#if step3Done}
                <span class="text-xs text-accent font-medium flex items-center gap-1">
                  <Check size={14} /> Generated
                </span>
              {:else}
                <button
                  class="btn btn-secondary text-xs px-4 py-1.5 whitespace-nowrap"
                  onclick={generateProductionApiKey}
                  disabled={step3Loading}
                >
                  {#if step3Loading}
                    <Loader2 size={14} class="animate-spin" /> Generating...
                  {:else}
                    Generate API Key
                  {/if}
                </button>
              {/if}
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="p-6 border-t border-border flex justify-end">
          <button
            class="btn btn-primary px-6 flex items-center gap-2"
            onclick={goToProduction}
            disabled={!step1Done || isSwitching}
          >
            {#if isSwitching}
              <Loader2 size={16} class="animate-spin" /> Switching...
            {:else}
              <ArrowRight size={16} />
              Go to Production
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
