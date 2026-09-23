<script lang="ts">
  import { fade, scale, slide } from "svelte/transition";
  import {
    ArrowRight,
    Books,
    BuildingsIcon,
    CaretDown,
    ChartBar,
    Calendar,
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
  import { untrack } from "svelte";
  import {
    useSession,
    organization,
    authClient,
    apiFetch,
  } from "$lib/auth-client";
  import {
    hydrateEnvironment,
    setActiveEnvironment,
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
  const initialActiveEnvironment =
    (page.data.activeEnvironment as "test" | "live" | undefined) ?? "test";
  const initialProjectIdentifier = page.params.projectId;

  const pageActiveEnvironment = $derived(
    (page.data.activeEnvironment as "test" | "live" | undefined) ?? "test",
  );

  let activeEnvironment = $state<"test" | "live">(initialActiveEnvironment);
  let liveConnected = $state(false);
  let isSwitching = $state(false);

  let showDeployModal = $state(false);
  let deployCredentials = $state<Record<string, Record<string, string>>>({});
  let deployError = $state<string | null>(null);
  let deploySavingProvider = $state<string | null>(null);
  let deployShowSecrets = $state<Record<string, boolean>>({});

  // Sandbox providers are managed by Owostack, so the org has no sandbox
  // credentials to mirror. Going live means connecting live credentials for
  // the providers the sandbox catalog actually uses (plan/credit-pack
  // providerId), plus any other enabled provider the user wants.
  let enabledProviderIds = $state<string[]>([]);
  let usedProviderIds = $state<string[]>([]);
  let liveProviderIds = $state<Set<string>>(new Set());
  let showAllDeployProviders = $state(false);
  let deployProvidersLoading = $state(false);

  let deployProviderIds = $derived(
    showAllDeployProviders || usedProviderIds.length === 0
      ? [
          ...usedProviderIds,
          ...enabledProviderIds.filter((id) => !usedProviderIds.includes(id)),
        ]
      : usedProviderIds,
  );
  let hiddenDeployProviderCount = $derived(
    enabledProviderIds.filter((id) => !usedProviderIds.includes(id)).length,
  );

  let step1Done = $derived(liveProviderIds.size > 0);
  let allUsedProvidersLive = $derived(
    step1Done && usedProviderIds.every((id) => liveProviderIds.has(id)),
  );

  let step2Loading = $state(false);
  let step2Done = $state(false);
  let step2Result = $state("");

  let step3Loading = $state(false);
  let step3Done = $state(false);
  let generatedApiKey = $state("");
  let apiKeyCopied = $state(false);

  let theme = $state<"light" | "dark">("light");
  let themeInitialized = $state(false);

  $effect(() => {
    if (!themeInitialized) {
      untrack(() => {
        const initialTheme =
          (page.data.theme as "light" | "dark") ||
          (localStorage.getItem("theme") as "light" | "dark") ||
          "light";
        theme = initialTheme;
        themeInitialized = true;
      });
    }
  });

  // Sync theme to DOM and cookies whenever it changes
  $effect(() => {
    if (themeInitialized) {
      applyTheme();
      localStorage.setItem("theme", theme);
      document.cookie = `theme=${theme}; path=/; max-age=31536000`;
    }
  });

  function toggleTheme() {
    theme = theme === "light" ? "dark" : "light";
  }

  function applyTheme() {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.add("light");
      document.documentElement.classList.remove("dark");
    }
    document.documentElement.setAttribute("data-theme", theme);
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

  async function fetchDashboardForEnv(
    env: "test" | "live",
    path: string,
    options: RequestInit = {},
  ) {
    const res = await fetch(`${getApiUrlForEnv(env)}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      credentials: "include",
    });

    const data = await res.json();

    if (!res.ok || !data?.success) {
      throw new Error(data?.error || "Request failed");
    }

    return data;
  }

  async function openDeployModal() {
    showDeployModal = true;
    deployError = null;
    deployProvidersLoading = true;
    try {
      const [testPlansRes, testAccountsRes, liveAccountsRes, enabledRes] =
        await Promise.all([
          fetchDashboardForEnv(
            "test",
            `/api/dashboard/plans?organizationId=${projectId}`,
          ),
          fetchDashboardForEnv(
            "test",
            `/api/dashboard/providers/accounts?organizationId=${projectId}`,
          ),
          fetchDashboardForEnv(
            "live",
            `/api/dashboard/providers/accounts?organizationId=${projectId}`,
          ),
          fetchDashboardForEnv("live", "/api/dashboard/providers/enabled"),
        ]);

      const testPlans = (testPlansRes.data as any[]) || [];
      const testAccounts = (testAccountsRes.data as any[]) || [];
      const liveAccounts = (liveAccountsRes.data as any[]) || [];

      enabledProviderIds = (enabledRes.data as string[]) || [];
      usedProviderIds = [
        ...new Set<string>([
          ...testPlans.map((p) => p.providerId).filter(Boolean),
          ...testAccounts
            .filter((a) => a.environment === "test")
            .map((a) => a.providerId),
        ]),
      ];
      liveProviderIds = new Set(
        liveAccounts
          .filter((a) => a.environment === "live")
          .map((a) => a.providerId),
      );
      showAllDeployProviders = false;
    } catch (e) {
      console.error("Failed to load provider accounts", e);
      deployError = "Couldn't load your providers. Close and try again.";
    } finally {
      deployProvidersLoading = false;
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

      await fetchDashboardForEnv("live", "/api/dashboard/providers/accounts", {
        method: "POST",
        body: JSON.stringify({
          organizationId: projectId,
          providerId,
          environment: "live",
          credentials,
        }),
      });

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
      window.location.reload();
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

  if (initialProjectIdentifier) {
    hydrateEnvironment(initialActiveEnvironment, initialProjectIdentifier);
  }

  async function handleLogout() {
    await authClient.signOut();
    window.location.href = "/login";
  }

  // Load environment status when project changes
  $effect(() => {
    if (projectId) {
      hydrateEnvironment(pageActiveEnvironment, projectId);
      activeEnvironment = pageActiveEnvironment;
      loadEnvironmentStatus();
    }
  });

  async function loadEnvironmentStatus() {
    try {
      const [liveAccountsRes, env, currencyRes] = await Promise.all([
        fetchDashboardForEnv(
          "live",
          `/api/dashboard/providers/accounts?organizationId=${projectId}`,
        ),
        loadActiveEnvironment(),
        apiFetch(
          `/api/dashboard/config/default-currency?organizationId=${projectId}`,
        ),
      ]);

      if (liveAccountsRes.data) {
        const liveAccounts = liveAccountsRes.data as any[];
        liveConnected = liveAccounts.some((a: any) => a.environment === "live");
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
      alert(
        "Live mode not configured. Connect a live provider via Go to Production first.",
      );
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
      window.location.reload();
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
        },
        {
          href: "/features",
          icon: Cube,
          label: "Features",
        },
        {
          href: "/addons",
          icon: Coins,
          label: "Add-ons",
        },
        {
          href: "/subscriptions",
          icon: CreditCard,
          label: "Subscriptions",
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
        },
        {
          href: "/transactions",
          icon: Receipt,
          label: "Transactions",
        },
        { href: "/usage", icon: ChartBar, label: "Usage" },
      ],
    },
    // {
    //   label: "Developer",
    //   collapsible: false,
    //   items: [
    //     {
    //       href: "/events",
    //       icon: Globe,
    //       label: "Events",
    //       color: "text-warning",
    //     },
    //   ],
    // },
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
  <meta name="theme-color" content={theme === "dark" ? "#131313" : "#fafaf5"} />
</svelte:head>

<div class="min-h-screen flex bg-bg-primary text-sm">
  <!-- Sidebar - Minimalist, text-focused -->
  <aside
    class="w-64 fixed h-screen flex flex-col bg-bg-primary border-r border-border text-[14px]"
  >
    <!-- Logo -->

    <!-- Domain/Project Selector -->
    {#if projectId}
      <div class="shrink-0 px-4 pt-6 pb-4">
        <div class="relative project-dropdown-container">
          <button
            class="w-full flex items-center gap-2 rounded-md border border-border bg-bg-card px-3 py-2 text-left transition-colors hover:border-text-dim"
            onclick={() => (showProjectDropdown = !showProjectDropdown)}
          >
            <BuildingsIcon class="shrink-0 text-text-muted" />
            <span class="flex-1 truncate font-medium text-text-primary"
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

      <div class="flex-1 overflow-y-auto py-2">
      <!-- Grouped Navigation -->
      {#each navGroups as group (group.label ?? group.items[0]?.href)}
        {#if group.label}
          {#if group.collapsible}
            <button
              class="w-full flex items-center gap-2 border-t border-border px-4 py-2.5 text-[14px] font-medium text-text-primary transition-colors hover:bg-bg-secondary cursor-pointer"
              onclick={() => toggleGroup(group.label!)}
            >
              <span class="flex-1 text-left">{group.label}</span>
              <CaretDown
                size={12}
                weight="bold"
                class="shrink-0 text-text-muted transition-transform duration-200 {collapsedGroups[
                  group.label
                ]
                  ? '-rotate-90'
                  : ''}"
              />
            </button>
          {:else}
            <div
              class="mt-6 mb-1 px-4 font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted"
            >
              {group.label}
            </div>
          {/if}
        {/if}

        {#if !group.label || !collapsedGroups[group.label!]}
          <nav class="flex flex-col" transition:slide|local={{ duration: 200 }}>
            {#each group.items as item (item.href)}
              {@const href = `/${projectId}${item.href}`}
              {@const active = isActive(href)}
              <a
                {href}
                class="flex items-center gap-2.5 px-4 py-[7px] text-[14px] leading-snug transition-colors {active
                  ? 'bg-bg-tertiary font-medium text-text-primary'
                  : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary'}"
              >
                <item.icon
                  weight={active ? "fill" : "duotone"}
                  size={15}
                  class="shrink-0"
                />
                <span class="truncate">{item.label}</span>
              </a>
            {/each}
          </nav>
        {/if}
      {/each}
      </div>
    {:else}
      <div class="flex-1 overflow-y-auto py-2">
      <!-- Dashboard Navigation -->
      <div
        class="px-4 pb-1 pt-3 font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted"
      >
        Dashboard
      </div>
      <nav class="flex flex-col">
        <a
          href="/"
          class="flex items-center gap-2.5 px-4 py-[7px] text-[14px] leading-snug transition-colors {page
            .url.pathname === '/'
            ? 'bg-bg-tertiary font-medium text-text-primary'
            : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary'}"
        >
          <SquaresFour
            size={15}
            class="shrink-0"
            weight={page.url.pathname === "/" ? "fill" : "duotone"}
          />
          <span>Overview</span>
        </a>
        <button
          class="flex w-full items-center gap-2.5 px-4 py-[7px] text-[14px] leading-snug transition-colors {showSettingsModal
            ? 'bg-bg-tertiary font-medium text-text-primary'
            : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary'}"
          onclick={() => (showSettingsModal = true)}
        >
          <Gear
            size={15}
            class="shrink-0"
            weight={showSettingsModal ? "fill" : "duotone"}
          />
          <span>Settings</span>
        </button>
      </nav>
      </div>
    {/if}

    <!-- Footer/User Identity -->
    <div class="mt-auto border-t border-border p-3 relative user-dropdown-container">
      <a
        href="https://owostack.com/talk-to-founder"
        target="_blank"
        class="flex items-center gap-2.5 px-2 py-[7px] text-[14px] text-text-secondary transition-colors hover:bg-bg-secondary hover:text-text-primary"
      >
        <Calendar size={16} class="shrink-0" weight="duotone" />
        <span>Book a call</span>
      </a>
      <a
        href="https://docs.owostack.com"
        target="_blank"
        class="flex items-center gap-2.5 px-2 py-[7px] text-[14px] text-text-secondary transition-colors hover:bg-bg-secondary hover:text-text-primary"
      >
        <Books size={16} class="shrink-0" weight="duotone" />
        <span>Docs</span>
      </a>
      <button
        class="flex w-full items-center gap-2.5 px-2 py-[7px] text-[14px] transition-colors {showSettingsModal
          ? 'bg-bg-tertiary font-medium text-text-primary'
          : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary'}"
        onclick={() => (showSettingsModal = true)}
      >
        <Gear
          size={16}
          class="shrink-0"
          weight={showSettingsModal ? "fill" : "duotone"}
        />
        <span>Settings</span>
      </button>

      {#if $session.data}
        <button
          class="mt-1 flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-bg-secondary"
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
            class="shrink-0 text-text-dim transition-transform {showUserDropdown
              ? 'rotate-180'
              : ''}"
            weight="fill"
          />
        </button>

        {#if showUserDropdown}
          <div
            class="absolute bottom-full left-3 right-3 mb-1 bg-bg-card border border-border shadow-2xl py-1 z-50 overflow-hidden"
            transition:slide={{ duration: 150 }}
            onclick={(e) => e.stopPropagation()}
          >
            <button
              class="w-full flex items-center justify-between px-4 py-2.5 text-[10px] font-bold text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors uppercase tracking-widest border-b border-border/50"
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
        class="relative bg-bg-primary rounded-lg overflow-hidden border border-border w-full max-w-lg mx-4"
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
              class="shrink-0 w-7 h-7 flex items-center justify-center text-xs font-bold {allUsedProvidersLive
                ? 'bg-accent text-accent-contrast'
                : step1Done
                  ? 'bg-accent/60 text-accent-contrast'
                  : 'bg-bg-secondary text-text-dim border border-border'}"
            >
              {#if allUsedProvidersLive}
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
                Sandbox ran on Owostack's shared test accounts. Production
                charges real cards, so add your own live credentials for the
                providers your catalog uses.
              </p>

              {#if deployProvidersLoading && deployProviderIds.length === 0}
                <p class="text-xs text-text-dim mt-2 italic">
                  Loading providers...
                </p>
              {/if}

              <div class="mt-3 space-y-4">
                {#each deployProviderIds as providerId (providerId)}
                  {@const config = getProviderConfig(providerId)}
                  {@const isLive = liveProviderIds.has(providerId)}
                  {@const isUsed = usedProviderIds.includes(providerId)}
                  {@const isSaving = deploySavingProvider === providerId}
                  <div class="border border-border bg-bg-card p-3 space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-bold text-text-primary flex items-center gap-2"
                        >{config?.name || providerId}
                        {#if isUsed}
                          <span
                            class="badge badge-default text-[9px]"
                            title="Plans in your sandbox catalog are on this provider"
                            >Used in sandbox</span
                          >
                        {/if}</span
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
                        {@const isWebhookSecret = field.key === "webhookSecret"}
                        <div class="space-y-1">
                          <div class="relative input-icon-wrapper">
                            <Lock
                              size={12}
                              class="input-icon-left text-text-dim"
                              weight="duotone"
                            />
                            <input
                              type={field.secret &&
                              !deployShowSecrets[secretKey]
                                ? "password"
                                : "text"}
                              value={deployCredentials[providerId]?.[
                                field.key
                              ] || ""}
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
                                  />{:else}<Eye
                                    size={14}
                                    weight="duotone"
                                  />{/if}
                              </button>
                            {/if}
                          </div>
                          {#if isWebhookSecret}
                            {@const liveApiUrl = getApiUrlForEnv("live")}
                            {@const webhookUrl = `${liveApiUrl}/webhooks/${projectId}/${providerId}`}
                            <div
                              class="flex items-center gap-2 bg-bg-secondary/50 border border-border px-2 py-1.5"
                            >
                              <Globe
                                size={10}
                                class="text-text-dim shrink-0"
                                weight="duotone"
                              />
                              <code
                                class="flex-1 font-mono text-[10px] text-text-dim truncate"
                                >{webhookUrl}</code
                              >
                              <button
                                type="button"
                                class="text-text-dim hover:text-text-primary transition-colors shrink-0"
                                onclick={() =>
                                  navigator.clipboard.writeText(webhookUrl)}
                                title="Copy webhook URL"
                              >
                                <Copy size={10} weight="fill" />
                              </button>
                            </div>
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

              {#if !showAllDeployProviders && usedProviderIds.length > 0 && hiddenDeployProviderCount > 0}
                <button
                  type="button"
                  class="mt-3 text-[10px] font-bold text-accent hover:text-accent-hover uppercase tracking-widest"
                  onclick={() => (showAllDeployProviders = true)}
                >
                  Connect a different provider ({hiddenDeployProviderCount})
                </button>
              {/if}

              {#if step1Done && !allUsedProvidersLive}
                <p
                  class="text-[10px] text-yellow-600 dark:text-yellow-500 mt-2"
                >
                  Some providers used by your sandbox plans don't have live keys
                  yet. You can still go live, but plans on those providers won't
                  be able to charge in production.
                </p>
              {/if}
            </div>
          </div>

          <!-- Step 2: Copy Catalog -->
          <div class="flex items-start gap-4">
            <div
              class="shrink-0 w-7 h-7 flex items-center justify-center text-xs font-bold {step2Done
                ? 'bg-accent text-accent-contrast'
                : 'bg-bg-secondary text-text-dim border border-border'}"
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
                : 'bg-bg-secondary text-text-dim border border-border'}"
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
