<script lang="ts">
  import {
    ArrowLeft,
    ArrowRight,
    CheckCircle,
    Copy,
    Square,
    Terminal,
    DiscordLogo,
    Calendar,
  } from "phosphor-svelte";
  import Logo from "$lib/components/ui/Logo.svelte";
  import InspiredLogo from "$lib/components/marketing/InspiredLogo.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const template = $derived(data.template);

  let copied = $state(false);

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(template.builderSnippet);
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 1800);
    } catch (error) {
      console.error("Failed to copy pricing template snippet", error);
    }
  }
</script>

<svelte:head>
  <title>{template.title} Template | Owostack</title>
  <meta name="description" content={template.summary} />
</svelte:head>

<div class="min-h-screen bg-bg-primary text-text-primary">
  <header class="border-b border-border/40 px-6 py-5">
    <div class="mx-auto flex max-w-6xl items-center justify-between">
      <a href="/" class="flex items-center gap-2">
        <Logo size={20} class="text-accent" />
        <span class="text-sm font-bold tracking-tight">Owostack</span>
      </a>
      <div class="flex items-center gap-6">
        <a href="/pricing-templates" class="text-xs text-text-muted hover:text-text-primary">Templates</a>
        <a href="https://app.owostack.com" class="btn btn-secondary">Dashboard</a>
      </div>
    </div>
  </header>

  <main class="mx-auto max-w-5xl px-6 py-12">
    <!-- Hero -->
    <div class="mb-16">
      <a
        href="/pricing-templates"
        class="mb-8 inline-flex items-center gap-2 text-xs text-text-muted hover:text-text-primary"
      >
        <ArrowLeft size={12} />
        Templates
      </a>

      <h1 class="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
        {template.title}
      </h1>
      <p class="text-lg text-text-secondary">
        {template.headline}
      </p>
    </div>

    <!-- Content -->
    <div class="grid gap-12 lg:grid-cols-[1fr_280px]">
      <div class="space-y-12">
        <!-- Overview -->
        <section>
          <p class="mb-4 text-xl font-medium text-text-primary">
            {template.description}
          </p>
          <p class="text-base leading-relaxed text-text-secondary">
            {template.whyItWorks}
          </p>
        </section>

        <!-- Code -->
        <section>
          <div class="card overflow-hidden !p-0">
            <div class="flex items-center justify-between border-b border-border/40 px-4 py-2">
              <span class="text-[10px] font-bold uppercase tracking-wider text-text-dim">Implementation</span>
              <button 
                type="button" 
                class="btn btn-ghost btn-sm gap-2" 
                onclick={copySnippet}
              >
                {#if copied}
                  <CheckCircle size={14} weight="fill" />
                  Copied
                {:else}
                  <Copy size={14} />
                  Copy
                {/if}
              </button>
            </div>
            <div class="bg-bg-secondary/50 p-6">
              <pre class="overflow-x-auto text-[13px] leading-relaxed"><code>{template.builderSnippet}</code></pre>
            </div>
          </div>
        </section>

        <!-- Rules -->
        <section>
          <h3 class="mb-4 text-xs font-bold uppercase tracking-wider text-text-dim">Rules</h3>
          <div class="space-y-3">
            {#each template.rules as rule}
              <p class="text-sm leading-relaxed text-text-secondary">{rule}</p>
            {/each}
          </div>
        </section>
      </div>

      <!-- Sidebar -->
      <aside class="space-y-8">
        <div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-1">
          <!-- Breakdown -->
          <div>
            <h4 class="mb-3 text-[10px] font-bold uppercase tracking-wider text-text-dim">Pricing</h4>
            <div class="rounded border border-border/60 bg-bg-card">
              {#each template.breakdown as item}
                <div class="flex justify-between border-b border-border/40 px-4 py-2.5 text-xs last:border-b-0">
                  <span class="text-text-dim">{item.label}</span>
                  <span class="font-semibold text-text-primary">{item.value}</span>
                </div>
              {/each}
            </div>
          </div>

          <!-- Highlights -->
          <div>
            <h4 class="mb-3 text-[10px] font-bold uppercase tracking-wider text-text-dim">Benefits</h4>
            <div class="space-y-2">
              {#each template.highlights as item}
                <div class="flex gap-2 text-xs text-text-secondary">
                  <CheckCircle size={14} weight="bold" class="mt-0.5 shrink-0 text-secondary" />
                  {item}
                </div>
              {/each}
            </div>
          </div>
        </div>
      </aside>
    </div>
  </main>

  <!-- CTA Section -->
  <section class="border-t border-border/40 px-6 py-16">
    <div class="mx-auto max-w-5xl">
      <div class="flex flex-col items-center justify-center gap-6 rounded-lg  p-10 md:p-14 text-center">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <DiscordLogo size={24} weight="duotone" />
        </div>
        <div>
          <h3 class="text-xl font-bold tracking-tight text-text-primary md:text-2xl">
            Questions about this template?
          </h3>
          <p class="mt-2 max-w-md text-sm text-text-secondary">
            Get help from the community on Discord, or book a call to discuss adapting this for your product.
          </p>
        </div>
        <div class="flex flex-wrap justify-center gap-3">
          <a
            href="https://discord.gg/jQ3TyEn6WR"
            class="btn btn-secondary gap-2"
            target="_blank"
            rel="noopener noreferrer"
          >
            <DiscordLogo size={16} weight="duotone" />
            Join Discord
          </a>
          <a
            href="https://cal.com/yaqeen/30min"
            class="btn btn-primary gap-2"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Calendar size={16} weight="duotone" />
            Talk to Founder
          </a>
        </div>
      </div>
    </div>
  </section>

  <footer class="border-t border-border/40 px-6 py-12">
    <div class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
      <div class="flex items-center gap-2">
        <Logo size={16} class="text-accent/60" />
        <span class="text-xs text-text-dim">© 2026 Owostack</span>
      </div>
      <div class="flex items-center gap-8">
        <a href="/pricing-templates" class="text-xs text-text-muted hover:text-text-primary">Library</a>
        <a href="https://github.com/owostack" class="text-xs text-text-muted hover:text-text-primary">GitHub</a>
        <a href="https://discord.gg/jQ3TyEn6WR" class="text-xs text-text-muted hover:text-text-primary" target="_blank" rel="noopener noreferrer">Discord</a>
        <a href="https://cal.com/yaqeen/30min" class="text-xs text-text-muted hover:text-text-primary" target="_blank" rel="noopener noreferrer">Contact</a>
      </div>
    </div>
  </footer>
</div>
