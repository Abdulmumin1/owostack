<script lang="ts">
  import { GithubLogo, DiscordLogo } from "phosphor-svelte";
  import Logo from "$lib/components/ui/Logo.svelte";

  interface Props {
    variant?: "home" | "page";
    showBorder?: boolean;
  }

  let { variant = "page", showBorder = true }: Props = $props();

  const headerClasses = $derived(
    `px-6 py-5 `
  );

  const containerClasses = $derived(
    `mx-auto flex items-center justify-between max-w-4xl`
  );
</script>

<header class={headerClasses}>
  <div class={containerClasses}>
    <a href="/" class="flex items-center gap-2">
      <Logo size={variant === "home" ? 24 : 20} class="text-accent" />
      <span class="text-sm font-bold tracking-tight">Owostack</span>
    </a>
    
    <nav class="flex items-center gap-6 text-xs text-text-secondary">
      {#if variant === "home"}
        <a
          href="/blog"
          class="hidden transition-colors hover:text-text-primary sm:inline"
          >Blog</a
        >
        <a
          href="https://docs.owostack.com"
          class="hidden transition-colors hover:text-text-primary sm:inline"
          >Docs</a
        >
        <a
          href="/pricing-templates"
          class="hidden transition-colors hover:text-text-primary sm:inline"
          >Templates</a
        >
        <a
          href={import.meta.env.VITE_GITHUB_URL}
          class="hidden items-center gap-1.5 transition-colors hover:text-text-primary sm:flex"
        >
          <GithubLogo size={13} weight="duotone" />
          GitHub
        </a>
        <a
          href="https://discord.gg/jQ3TyEn6WR"
          class="hidden items-center gap-1.5 transition-colors hover:text-text-primary sm:flex"
          target="_blank"
          rel="noopener noreferrer"
        >
          <DiscordLogo size={13} weight="duotone" />
          Discord
        </a>
      {:else}
        <a href="/" class="text-text-muted transition-colors hover:text-text-primary">Home</a>
      {/if}
      <a href="https://app.owostack.com" class="btn btn-primary">Dashboard</a>
    </nav>
  </div>
</header>