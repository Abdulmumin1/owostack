<script lang="ts">
  import { fade, scale, slide } from "svelte/transition";
  import {
    ArrowRight,
    Books,
    BuildingsIcon,
    CaretDown,
    ChartBar,
    Check,
    CircleNotch,
    Coins,
    Copy,
    Cpu,
    CreditCard,
    Cube,
    Eye,
    EyeSlash,
    Flask,
    FloppyDisk,
    Gear,
    Globe,
    Key,
    ListIcon,
    Lock,
    Moon,
    Plus,
    Pulse,
    Receipt,
    Rocket,
    SignOut,
    SquaresFour,
    Sun,
    UserListIcon,
    Users,
    UsersIcon,
    X,
  } from "phosphor-svelte";
  import { page } from "$app/state";
  import {
    useSession,
    organization,
    authClient,
    apiFetch,
  } from "$lib/auth-client";
  import {
    setActiveEnvironment,
    setProjectId,
    loadActiveEnvironment,
    getApiUrlForEnv,
  } from "$lib/env";
  import Logo from "$lib/components/ui/Logo.svelte";
  import { getProviderConfig } from "$lib/providers";
  import { defaultCurrency } from "$lib/stores/currency";
  import Avatar from "$components/ui/Avatar.svelte";
  import CreateOrganizationModal from "$lib/components/dashboard/CreateOrganizationModal.svelte";
  import SettingsModal from "$lib/components/settings/SettingsModal.svelte";

  let { children } = $props();

  const session = useSession();

  // Auth is now handled server-side in hooks.server.ts
  // No client-side redirect needed here

  let projects = $state<any[]>([]);
  let showProjectDropdown = $state(false);
  let showUserDropdown = $state(false);
  let collapsedGroups = $state<Record<string, boolean>>({
    Settings: true, // Collapsed by default
  });

  let showSettingsModal = $state(false);
  let showCreateOrgModal = $state(false);
  let settingsActiveTab = $state("general");

  let activeEnvironment = $state<"test" | "live">("test");
  let testConnected = $state(false);
  let liveConnected = $state(false);
  let isSwitching = $state(false);

  let showDeployModal = $state(false);
  let deployCredentials = $state<Record<string, Record<string, string>>>({});
  let deployError = $state<string | null>(null);
  let deploySavingProvider = $state<string | null>(null);
  let deployShowSecrets = $state<Record<string, boolean>>({});

  let testProviderIds = $state<string[]>([]);
  let liveProviderIds = $state<Set<string>>(new Set());

  let step1Done = $derived(
    testProviderIds.length > 0 &&
      testProviderIds.every((id) => liveProviderIds.has(id)),
  );
  let allTestProvidersLive = $derived(step1Done && testProviderIds.length > 0);

  let step2Loading = $state(false);
  let step2Done = $state(false);
  let step2Result = $state("");

  let step3Loading = $state(false);
  let step3Done = $state(false);
  let generatedApiKey = $state("");
  let apiKeyCopied = $state(false);

  let theme = $state<"light" | "dark">("dark");

  $effect(() => {
    const savedTheme = localStorage.getItem("theme") as "light" | "dark" | null;
    if (savedTheme) {
      theme = savedTheme;
    } else {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    applyTheme();
  });

  function toggleTheme() {
    theme = theme === "light" ? "dark" : "light";
    localStorage.setItem("theme", theme);
    applyTheme();
  }

  function applyTheme() {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.add("light");
      document.documentElement.classList.remove("dark");
    }
  }

  function toggleGroup(label: string) {
    collapsedGroups[label] = !collapsedGroups[label];
  }

  function toggleUserDropdown() {
    showUserDropdown = !showUserDropdown;
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest(".project-dropdown-container")) {
      showProjectDropdown = false;
    }
    if (!target.closest(".user-dropdown-container")) {
      showUserDropdown = false;
    }
  }

  async function openDeployModal() {
    showDeployModal = true;
    deployError = null;
    try {
      const res = await apiFetch(
        `/api/dashboard/providers/accounts?organizationId=${projectId}`,
      );
      if (res.data?.data) {
        const accounts = res.data.data as any[];
        testProviderIds = [
          ...new Set(
            accounts
              .filter((a) => a.environment === "test")
              .map((a) => a.providerId),
          ),
        ];
        liveProviderIds = new Set(
          accounts
            .filter((a) => a.environment === "live")
            .map((a) => a.providerId),
        );
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
        r.features.created +
        r.plans.created +
        r.planFeatures.created +
        r.creditSystems.created +
        r.creditSystemFeatures.created +
        r.creditPacks.created +
        r.overageSettings.created;
      const skipped =
        r.features.skipped +
        r.plans.skipped +
        r.planFeatures.skipped +
        r.creditSystems.skipped +
        r.creditSystemFeatures.skipped +
        r.creditPacks.skipped +
        r.overageSettings.skipped;

      step2Done = true;
      step2Result =
        created > 0
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
      const res = await fetch(`${liveApiUrl}/api/dashboard/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          organizationId: projectId,
          name: "Production Key",
        }),
      });
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

  // Get current project identifier from URL (can be ID or slug)
  let projectIdentifier = $derived(page.params.projectId);
  let currentProject = $derived(
    projects.find(
      (p) => p.id === projectIdentifier || p.slug === projectIdentifier,
    ) || { name: "Select Project", slug: "" },
  );

  // Use slug for navigation if available, otherwise fall back to ID
  let projectId = $derived(
    currentProject?.slug || currentProject?.id || projectIdentifier,
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
        apiFetch(
          `/api/dashboard/providers/accounts?organizationId=${projectId}`,
        ),
        loadActiveEnvironment(),
        apiFetch(
          `/api/dashboard/config/default-currency?organizationId=${projectId}`,
        ),
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
      alert("Live mode not configured. Add a live key in Gear first.");
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
      collapsible: true,
      items: [
        {
          href: "/plans",
          icon: ListIcon,
          label: "Plans",
          color: "text-info",
        },
        {
          href: "/features",
          icon: Cube,
          label: "Features",
          color: "text-tertiary",
        },
        {
          href: "/addons",
          icon: Coins,
          label: "Add-ons",
          color: "text-warning",
        },
        {
          href: "/subscriptions",
          icon: CreditCard,
          label: "Subscriptions",
          color: "text-success",
        },
      ],
    },
    {
      label: null, // No label - standalone items
      items: [
        {
          href: "/customers",
          icon: UsersIcon,
          label: "Customers",
          color: "text-tertiary",
        },
        {
          href: "/transactions",
          icon: Receipt,
          label: "Transactions",
          color: "text-error",
        },
        { href: "/usage", icon: ChartBar, label: "Usage", color: "text-info" },
      ],
    },
    {
      label: "Developer",
      collapsible: false,
      items: [
        {
          href: "/events",
          icon: Globe,
          label: "Events",
          color: "text-warning",
        },
      ],
    },
  ];

  function isActive(href: string, exact = false): boolean {
    const currentPath = page.url.pathname;
    if (exact) return currentPath === href;
    return currentPath.startsWith(href);
  }
</script>

<svelte:window onclick={handleClickOutside} />

<svelte:head>
  <title>Dashboard - Owostack</title>
</svelte:head>

<div class="min-h-screen flex bg-bg-primary text-sm">
  <!-- Sidebar - Minimalist, text-focused -->
  <aside
    class="w-64 fixed h-screen flex flex-col pt-8 pb-4 pl-6 pr-6 bg-bg-secondary border-r border-border"
  >
    <!-- Logo -->

    <!-- Domain/Project Selector -->
    {#if projectId}
      <div class="mb-3">
        <div class="relative project-dropdown-container">
          <button
            class="w-full flex items-center justify-between p-1 px-2 border rounded border-border text-left hover:border-text-dim transition-colors"
            onclick={() => (showProjectDropdown = !showProjectDropdown)}
          >
            <BuildingsIcon />
            <span class="font-medium truncate text-text-primary"
              >{currentProject.name}</span
            >
            <CaretDown size={14} class="text-text-dim shrink-0" />
          </button>

          {#if showProjectDropdown}
            <div
              class="absolute top-full left-0 right-0 mt-1 bg-bg-card border border-border rounded z-50"
              onclick={(e) => e.stopPropagation()}
            >
              {#each projects as project}
                <a
                  href="/{project.slug || project.id}/plans"
                  class="block px-3 py-1 text-xs text-text-secondary hover:bg-bg-card-hover hover:text-text-primary transition-colors border-l-2 border-transparent hover:border-accent {project.id ===
                    projectIdentifier || project.slug === projectIdentifier
                    ? 'border-accent bg-bg-card-hover text-text-primary'
                    : ''}"
                  onclick={() => (showProjectDropdown = false)}
                >
                  {project.name}
                </a>
              {/each}
              <button
                class="w-full text-left px-3 py-2 text-text-dim hover:text-text-primary hover:bg-bg-card-hover border-t border-border mt-1"
                onclick={() => {
                  showCreateOrgModal = true;
                  showProjectDropdown = false;
                }}
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
          {#if group.collapsible}
            <button
              class="w-full flex items-center justify-between text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2 pl-2 pr-2 mt-6 first:mt-0 hover:text-text-secondary transition-colors cursor-pointer group"
              onclick={() => toggleGroup(group.label!)}
            >
              <span>{group.label}</span>
              <CaretDown
                size={12}
                class="transition-transform duration-200 {collapsedGroups[
                  group.label
                ]
                  ? '-rotate-90'
                  : ''} text-text-dim group-hover:text-text-secondary"
              />
            </button>
          {:else}
            <div
              class="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2 pl-2 mt-6 first:mt-0"
            >
              {group.label}
            </div>
          {/if}
        {/if}

        {#if !group.label || !collapsedGroups[group.label!]}
          <nav
            class="space-y-0.5 mb-2"
            transition:slide|local={{ duration: 200 }}
          >
            {#each group.items as item}
              {@const href = `/${projectId}${item.href}`}
              {@const active = isActive(href)}
              <a
                {href}
                class="flex items-center gap-3 px-3 transition-all duration-200 rounded-lg {active
                  ? 'bg-bg-card text-text-primary font-base text-sm'
                  : 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-primary'} py-1 text-sm"
              >
                <item.icon
                  weight={active ? "fill" : "duotone"}
                  size={15}
                  class={item.color}
                />
                <span>{item.label}</span>
              </a>
            {/each}
          </nav>
        {/if}
      {/each}
    {:else}
      <!-- Dashboard Navigation -->
      <div
        class="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-3 pl-2"
      >
        Dashboard
      </div>
      <nav class="space-y-1 mb-8">
        <a
          href="/"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 {page
            .url.pathname === '/'
            ? 'bg-bg-card text-text-primary shadow-sm ring-1 ring-black/5 dark:ring-white/10 font-medium'
            : 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5'}"
        >
          <SquaresFour
            size={18}
            class="text-blue-500"
            weight={page.url.pathname === "/" ? "fill" : "regular"}
          />
          <span>Overview</span>
        </a>
        <button
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 {showSettingsModal
            ? 'bg-bg-card text-text-primary shadow-sm ring-1 ring-black/5 dark:ring-white/10 font-medium'
            : 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5'}"
          onclick={() => (showSettingsModal = true)}
        >
          <Gear
            size={18}
            class="text-zinc-500"
            weight={showSettingsModal ? "fill" : "regular"}
          />
          <span>Settings</span>
        </button>
      </nav>
    {/if}

    <!-- Footer/User Identity -->
    <div class="mt-auto pt-4 relative user-dropdown-container">
      <!-- Settings Button -->

      <a
        href="https://docs.owostack.com"
        target="_blank"
        class="w-full flex items-center gap-3 px-3 mb-3 rounded-lg transition-all duration-200 text-text-secondary"
      >
        <Books size={16} class="text-zinc-500" weight="duotone" />
        <span>Docs</span>
      </a>
      <button
        class="w-full flex items-center gap-3 px-3 py-1 mb-3 rounded-lg transition-all duration-200 {showSettingsModal
          ? 'bg-bg-card text-text-primary shadow-sm border border-border/50 font-medium'
          : 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-primary'}"
        onclick={() => (showSettingsModal = true)}
      >
        <Gear
          size={16}
          class="text-zinc-500"
          weight={showSettingsModal ? "fill" : "duotone"}
        />
        <span>Settings</span>
      </button>

      {#if $session.data}
        <button
          class="w-full flex items-center gap-3 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors p-1 rounded group"
          onclick={toggleUserDropdown}
        >
          <!-- Sharp Identity Square -->
          <div class="relative shrink-0">
            <Avatar name={$session.data.user.name} style="micah" size={14} />
          </div>

          <!-- User Details -->
          <div class="flex-1 min-w-0">
            <div class="text-xs font-bold text-text-primary truncate mb-0.5">
              {$session.data.user.name || "Account"}
            </div>
          </div>
          <CaretDown
            size={14}
            class="text-text-dim group-hover:text-text-secondary transition-transform {showUserDropdown
              ? 'rotate-180'
              : ''}"
            weight="fill"
          />
        </button>

        {#if showUserDropdown}
          <div
            class="absolute bottom-full left-4 right-4 mb-2 bg-bg-card border border-border shadow-2xl py-1 z-50 overflow-hidden"
            transition:slide={{ duration: 150 }}
            onclick={(e) => e.stopPropagation()}
          >
            <button
              class="w-full flex items-center justify-between px-4 py-2.5 text-[10px] font-bold text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors uppercase tracking-widest border-b border-border/50"
              onclick={toggleTheme}
            >
              <span>Theme: {theme}</span>
              {#if theme === "light"}
                <Moon size={12} weight="duotone" />
              {:else}
                <Sun size={12} weight="duotone" />
              {/if}
            </button>
            <button
              class="w-full flex items-center justify-between px-4 py-2.5 text-[10px] font-bold text-text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors uppercase tracking-widest"
              onclick={handleLogout}
            >
              <span>Sign out</span>
              <SignOut size={12} weight="duotone" />
            </button>
          </div>
        {/if}
      {/if}
    </div>
  </aside>

  <!-- Main Content -->
  <main class="ml-64 flex-1 overflow-auto bg-bg-primary">
    <!-- Environment Banner (like Autumn's "You're in sandbox") -->
    {#if projectId}
      <div
        class="w-full py-2 px-6 flex items-center justify-between gap-4 text-xs font-mono {activeEnvironment ===
        'test'
          ? 'bg-info-bg border-b border-info/20'
          : 'bg-transparent border-b border-transparent'}"
      >
        {#if activeEnvironment === "test"}
          <span class="text-info">
            <Flask size={14} class="inline mr-1" weight="duotone" />
            You're in <span class="font-bold">sandbox</span>
          </span>
          <button
            onclick={openDeployModal}
            class="flex items-center gap-1 px-3 py-1 bg-bg-secondary text-text-secondary text-xs font-bold hover:bg-bg-card-hover transition-colors"
          >
            <Rocket size={12} weight="duotone" />
            Go to Production
          </button>
        {:else}
          <!-- <span class="text-red-400 font-bold">
            <Rocket   size={14} class="inline mr-1"  weight="duotone" />
            LIVE MODE — Real payments
          </span> -->
          <span></span>
          <button
            onclick={() => switchEnvironment("test")}
            disabled={isSwitching}
            class="flex items-center self-end gap-1 px-3 py-1 bg-bg-tertiary text-text-primary text-xs font-medium hover:bg-bg-secondary transition-colors disabled:opacity-50 border border-border"
          >
            <Flask size={12} weight="duotone" />
            Go to Sandbox
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
        class="absolute inset-0 bg-bg-primary/80 backdrop-blur-sm"
        onclick={closeDeployModal}
        role="presentation"
        transition:fade={{ duration: 150 }}
      ></div>

      <!-- Modal -->
      <div
        class="relative bg-bg-primary rounded-xl overflow-hidden border border-border shadow-2xl w-full max-w-lg mx-4"
        transition:scale={{ duration: 150 }}
      >
        <!-- Header -->
        <div
          class="flex bg-bg-secondary items-center justify-between p-6 border-b border-border"
        >
          <div>
            <h2 class="text-lg font-bold text-text-primary">
              Deploy to Production
            </h2>
            <p class="text-xs text-text-dim mt-1">
              Follow the steps below to go live.
            </p>
          </div>
          <button
            class="text-text-dim hover:text-text-primary transition-colors"
            onclick={closeDeployModal}
          >
            <X size={18} weight="fill" />
          </button>
        </div>

        <!-- Error -->
        {#if deployError}
          <div
            class="mx-6 mt-4 p-3 bg-error-bg border border-error text-error text-xs uppercase tracking-tight"
          >
            {deployError}
          </div>
        {/if}

        <!-- Steps -->
        <div class="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
          <!-- Step 1: Connect Providers -->
          <div class="flex items-start gap-4">
            <div
              class="shrink-0 w-7 h-7 flex items-center justify-center text-xs font-bold {allTestProvidersLive
                ? 'bg-accent text-accent-contrast'
                : step1Done
                  ? 'bg-accent/60 text-accent-contrast'
                  : 'bg-accent-contrast text-text-dim border border-border'}"
            >
              {#if allTestProvidersLive}
                <Check size={14} weight="fill" />
              {:else}
                1
              {/if}
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-bold text-text-primary">
                Connect your provider accounts
              </h3>
              <p class="text-xs text-text-dim mt-0.5">
                Add live credentials for each payment provider you use.
              </p>

              {#if testProviderIds.length === 0}
                <p class="text-xs text-text-dim mt-2 italic">
                  No test providers configured yet. Add one in Gear first.
                </p>
              {/if}

              <div class="mt-3 space-y-4">
                {#each testProviderIds as providerId}
                  {@const config = getProviderConfig(providerId)}
                  {@const isLive = liveProviderIds.has(providerId)}
                  {@const isSaving = deploySavingProvider === providerId}
                  <div class="border border-border bg-bg-card p-3 space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-bold text-text-primary"
                        >{config?.name || providerId}</span
                      >
                      {#if isLive}
                        <span
                          class="text-[10px] text-accent font-medium flex items-center gap-1"
                        >
                          <Check size={12} weight="fill" /> Live connected
                        </span>
                      {:else}
                        <span class="text-[10px] text-text-dim"
                          >Needs live keys</span
                        >
                      {/if}
                    </div>
                    {#if !isLive && config}
                      {#each config.fields as field}
                        {@const secretKey = `${providerId}.${field.key}`}
                        <div class="relative input-icon-wrapper">
                          <Lock
                            size={12}
                            class="input-icon-left text-text-dim"
                            weight="duotone"
                          />
                          <input
                            type={field.secret && !deployShowSecrets[secretKey]
                              ? "password"
                              : "text"}
                            value={deployCredentials[providerId]?.[field.key] ||
                              ""}
                            oninput={(e) => {
                              if (!deployCredentials[providerId])
                                deployCredentials[providerId] = {};
                              deployCredentials[providerId][field.key] = (
                                e.target as HTMLInputElement
                              ).value;
                              deployCredentials = deployCredentials;
                            }}
                            placeholder={field.placeholder}
                            class="input input-has-icon-left pr-10 font-mono text-xs w-full"
                          />
                          {#if field.secret}
                            <button
                              type="button"
                              class="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-primary transition-colors"
                              onclick={() => {
                                deployShowSecrets[secretKey] =
                                  !deployShowSecrets[secretKey];
                                deployShowSecrets = deployShowSecrets;
                              }}
                            >
                              {#if deployShowSecrets[secretKey]}<EyeSlash
                                  size={14}
                                  weight="duotone"
                                />{:else}<Eye size={14} weight="duotone" />{/if}
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
                          <CircleNotch
                            size={14}
                            class="animate-spin"
                            weight="duotone"
                          /> Connecting...
                        {:else}
                          Connect {config.name}
                        {/if}
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>

              {#if step1Done && !allTestProvidersLive}
                <p
                  class="text-[10px] text-yellow-600 dark:text-yellow-500 mt-2"
                >
                  Some test providers don't have live keys yet. You can still go
                  live, but features using those providers won't work in
                  production.
                </p>
              {/if}
            </div>
          </div>

          <!-- Step 2: Copy Catalog -->
          <div class="flex items-start gap-4">
            <div
              class="shrink-0 w-7 h-7 flex items-center justify-center text-xs font-bold {step2Done
                ? 'bg-accent text-accent-contrast'
                : 'bg-accent-contrast text-text-dim border border-border'}"
            >
              {#if step2Done}
                <Check size={14} weight="fill" />
              {:else}
                2
              {/if}
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-bold text-text-primary">
                Copy your plans to production
              </h3>
              <p class="text-xs text-text-dim mt-0.5">
                Sync all configured plans, features, and credit packs from
                sandbox to production.
              </p>
              {#if step2Result}
                <p class="text-xs text-accent mt-1">{step2Result}</p>
              {/if}
            </div>
            <div class="shrink-0">
              {#if step2Done}
                <span
                  class="text-xs text-accent font-medium flex items-center gap-1"
                >
                  <Check size={14} weight="fill" /> Copied
                </span>
              {:else}
                <button
                  class="btn btn-secondary text-xs px-4 py-1.5 whitespace-nowrap"
                  onclick={copyCatalogToProduction}
                  disabled={step2Loading}
                >
                  {#if step2Loading}
                    <CircleNotch
                      size={14}
                      class="animate-spin"
                      weight="duotone"
                    /> Copying...
                  {:else}
                    Copy Plans
                  {/if}
                </button>
              {/if}
            </div>
          </div>

          <!-- Step 3: Generate API Key -->
          <div class="flex items-start gap-4">
            <div
              class="shrink-0 w-7 h-7 flex items-center justify-center text-xs font-bold {step3Done
                ? 'bg-accent text-accent-contrast'
                : 'bg-accent-contrast text-text-dim border border-border'}"
            >
              {#if step3Done}
                <Check size={14} weight="fill" />
              {:else}
                3
              {/if}
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-bold text-text-primary">
                Create a production secret key
              </h3>
              <p class="text-xs text-text-dim mt-0.5">
                Generate a live API key for use in your production environment.
              </p>
              {#if generatedApiKey}
                <div class="mt-2 flex items-center gap-2">
                  <code
                    class="text-xs font-mono bg-bg-card border border-border px-2 py-1 text-accent truncate max-w-[260px]"
                  >
                    {generatedApiKey}
                  </code>
                  <button
                    class="text-text-dim hover:text-text-primary transition-colors shrink-0"
                    onclick={copyApiKey}
                    title="Copy key"
                  >
                    {#if apiKeyCopied}
                      <Check size={14} class="text-accent" weight="fill" />
                    {:else}
                      <Copy size={14} weight="fill" />
                    {/if}
                  </button>
                </div>
                <p class="text-[10px] text-text-dim mt-1">
                  FloppyDisk this key — it won't be shown again.
                </p>
              {/if}
            </div>
            <div class="shrink-0">
              {#if step3Done}
                <span
                  class="text-xs text-accent font-medium flex items-center gap-1"
                >
                  <Check size={14} weight="fill" /> Generated
                </span>
              {:else}
                <button
                  class="btn btn-secondary text-xs px-4 py-1.5 whitespace-nowrap"
                  onclick={generateProductionApiKey}
                  disabled={step3Loading}
                >
                  {#if step3Loading}
                    <CircleNotch
                      size={14}
                      class="animate-spin"
                      weight="duotone"
                    /> Generating...
                  {:else}
                    Generate API Key
                  {/if}
                </button>
              {/if}
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div
          class="p-6 border-t bg-bg-secondary border-border flex justify-end"
        >
          <button
            class="btn btn-primary px-6 flex items-center gap-2"
            onclick={goToProduction}
            disabled={!step1Done || isSwitching}
          >
            {#if isSwitching}
              <CircleNotch size={16} class="animate-spin" weight="duotone" /> Switching...
            {:else}
              <ArrowRight size={16} weight="fill" />
              Go to Production
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<CreateOrganizationModal bind:open={showCreateOrgModal} />

<SettingsModal
  {projectId}
  bind:open={showSettingsModal}
  bind:activeTab={settingsActiveTab}
/>
