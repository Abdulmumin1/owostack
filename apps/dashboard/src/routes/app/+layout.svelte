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
  } from "lucide-svelte";
  import { page } from "$app/state";
  import {
    useSession,
    organization,
    authClient,
    apiFetch,
  } from "$lib/auth-client";
  import { setActiveEnvironment } from "$lib/env";
  import Logo from "$lib/components/ui/Logo.svelte";

  let { children } = $props();

  const session = useSession();

  let projects = $state<any[]>([]);
  let showProjectDropdown = $state(false);
  let activeEnvironment = $state<"test" | "live">("test");
  let testConnected = $state(false);
  let liveConnected = $state(false);
  let isSwitching = $state(false);

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
      loadEnvironmentStatus();
    }
  });

  async function loadEnvironmentStatus() {
    try {
      const res = await apiFetch(
        `/api/dashboard/paystack-config?organizationId=${projectId}`,
      );
      if (res.data?.data) {
        activeEnvironment = res.data.data.activeEnvironment || "test";
        setActiveEnvironment(activeEnvironment);
        testConnected = res.data.data.testConnected || false;
        liveConnected = res.data.data.liveConnected || false;
      }
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
      await apiFetch("/api/dashboard/switch-environment", {
        method: "POST",
        body: JSON.stringify({ organizationId: projectId, environment: env }),
      });
      activeEnvironment = env;
      setActiveEnvironment(env);
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
            <ChevronDown size={14} class="text-zinc-500 flex-shrink-0" />
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
          {#if liveConnected}
            <button
              onclick={() => switchEnvironment("live")}
              disabled={isSwitching}
              class="flex items-center gap-1 px-3 py-1 bg-accent text-black text-xs font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              <Rocket size={12} />
              Deploy to Production →
            </button>
          {:else}
            <span class="text-zinc-500">
              Add live keys in Settings to deploy
            </span>
          {/if}
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
</div>
