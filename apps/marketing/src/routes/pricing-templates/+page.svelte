<script lang="ts">
  import {
    ArrowRight,
    CheckCircle,
    Copy,
    Info,
    DiscordLogo,
    Calendar,
  } from "phosphor-svelte";
  import {
    getPricingTemplates,
    type PricingTemplate,
  } from "$lib/content/pricing-templates";
  import Logo from "$lib/components/ui/Logo.svelte";
  import InspiredLogo from "$lib/components/marketing/InspiredLogo.svelte";
  import Footer from "$lib/components/marketing/Footer.svelte";
  import Header from "$lib/components/marketing/Header.svelte";
  import SectionCut from "$lib/components/marketing/SectionCut.svelte";

  const templates = getPricingTemplates();

  const groupedTemplates = [
    {
      label: "Subscription",
      items: templates.filter((t) =>
        t.category.toLowerCase().includes("subscription"),
      ),
    },
    {
      label: "Usage-based",
      items: templates.filter((t) =>
        t.category.toLowerCase().includes("usage"),
      ),
    },
    {
      label: "Hybrid & Others",
      items: templates.filter(
        (t) =>
          !t.category.toLowerCase().includes("subscription") &&
          !t.category.toLowerCase().includes("usage"),
      ),
    },
  ];

  let copiedSlug = $state<string | null>(null);

  async function copyTemplate(template: PricingTemplate) {
    try {
      await navigator.clipboard.writeText(template.builderSnippet);
      copiedSlug = template.slug;
      setTimeout(() => {
        if (copiedSlug === template.slug) copiedSlug = null;
      }, 1800);
    } catch (error) {
      console.error("Failed to copy pricing template", error);
    }
  }
</script>

<svelte:head>
  <title>Pricing Templates | Owostack</title>
  <meta
    name="description"
    content="Battle-tested pricing models from OpenAI Codex, Clerk, Pinecone, and other companies developers trust. Copy-paste ready for your AI SaaS."
  />
  <link rel="canonical" href="https://owostack.com/pricing-templates" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://owostack.com/pricing-templates" />
  <meta property="og:title" content="Pricing Templates | Owostack" />
  <meta
    property="og:description"
    content="Battle-tested pricing models from OpenAI Codex, Clerk, Pinecone, and other companies developers trust. Copy-paste ready for your AI SaaS."
  />
  <meta property="og:image" content="https://owostack.com/og.jpg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@owostack" />
  <meta name="twitter:url" content="https://owostack.com/pricing-templates" />
  <meta name="twitter:title" content="Pricing Templates | Owostack" />
  <meta
    name="twitter:description"
    content="Battle-tested pricing models from OpenAI Codex, Clerk, Pinecone, and other companies developers trust. Copy-paste ready for your AI SaaS."
  />
  <meta name="twitter:image" content="https://owostack.com/og.jpg" />
</svelte:head>

<div class="min-h-screen bg-bg-primary text-text-primary">
  <Header variant="page" showBorder={true} />

  <main class="mx-auto max-w-6xl px-6 py-20 md:py-28">
    <!-- Hero Section -->
    <section class="mb-24">
      <p class="eyebrow mb-6">Pricing templates</p>
      <h1 class="font-display text-display-lg max-w-3xl text-balance text-text-primary">
        The same pricing models used by Codex, Notion, and Figma.
      </h1>
      <p class="mt-6 max-w-2xl text-base leading-relaxed text-text-secondary md:text-lg">
        These aren't theoretical. These are the exact patterns powering the AI
        infrastructure you use every day—Cursor, Pinecone, Replicate, Clerk.
        Copy them in one click.
      </p>
    </section>

    <!-- Templates Grid -->
    <div class="space-y-24">
      {#each groupedTemplates as group (group.label)}
        <section>
          <div class="mb-10 flex items-center gap-4">
            <h2 class="font-mono text-2xs uppercase tracking-[0.2em] text-text-muted">
              {group.label}
            </h2>
            <div class="dither h-1.5 flex-1" style="--dither-color: var(--color-border); background-color: transparent" aria-hidden="true"></div>
          </div>

          <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {#each group.items as template (template.slug)}
              <article
                class="group flex flex-col border border-border/40 bg-bg-card transition-colors hover:border-accent/60"
              >
                <!-- Body -->
                <div class="flex flex-1 flex-col border-b border-border/40 p-6 md:p-7">
                  <div class="mb-5 flex items-start justify-between gap-3">
                    <div class="overflow-hidden rounded-md ring-1 ring-border/60">
                      <InspiredLogo
                        logoUrl={template.logoUrl}
                        alt={template.inspiredBy}
                        size={28}
                      />
                    </div>
                    <span class="font-mono text-2xs uppercase tracking-[0.08em] text-text-dim">
                      {template.category}
                    </span>
                  </div>

                  <h3 class="font-display text-title leading-tight text-text-primary">
                    {template.title}
                  </h3>

                  <p class="mt-3 text-sm leading-relaxed text-text-secondary">
                    {template.summary}
                  </p>

                  <div class="mt-auto pt-6">
                    <span class="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      Used by {template.inspiredBy}
                    </span>
                    <div class="mt-1 flex items-center gap-1.5 text-[10px] text-text-dim">
                      <CheckCircle size={10} class="text-secondary" weight="fill" />
                      <span>{template.socialProof}</span>
                    </div>
                  </div>
                </div>

                <!-- Breakdown -->
                <div class="flex flex-col font-mono text-xs">
                  {#each template.breakdown.slice(0, 3) as item, i (item.label)}
                    <div
                      class="flex items-center justify-between border-b border-border/40 px-6 py-3 last:border-b-0"
                    >
                      <span class="text-text-muted">{item.label}</span>
                      <span class="font-medium text-text-primary">{item.value}</span>
                    </div>
                  {/each}
                </div>

                <!-- Actions -->
                <div class="flex items-center justify-between border-t border-border/40 px-6 py-4">
                  <button
                    type="button"
                    class="inline-flex items-center gap-2 text-xs font-semibold text-text-muted transition-colors hover:text-text-primary"
                    onclick={() => copyTemplate(template)}
                  >
                    {#if copiedSlug === template.slug}
                      <CheckCircle size={14} weight="fill" class="text-secondary" />
                      Copied
                    {:else}
                      <Copy size={14} />
                      Copy code
                    {/if}
                  </button>

                  <a
                    href={`/pricing-templates/${template.slug}`}
                    class="inline-flex items-center gap-1.5 text-xs font-semibold text-text-primary transition-colors hover:text-accent"
                  >
                    View pattern
                    <ArrowRight size={14} weight="bold" />
                  </a>
                </div>
              </article>
            {/each}
          </div>
        </section>
      {/each}
    </div>

    <!-- Custom pricing section -->
    <section class="on-ink ink-card mt-32 p-10 md:p-14">
      <div class="grid gap-10 lg:grid-cols-2 lg:items-center">
        <div>
          <p class="eyebrow on-ink mb-5 !text-on-ink-faint">Custom pricing</p>
          <h2 class="font-display text-display-md text-on-ink">
            Building something truly unique?
          </h2>
          <p class="mt-4 max-w-md text-sm leading-relaxed text-on-ink-muted md:text-base">
            These templates cover 90% of SaaS models. Our SDK handles arbitrary
            metering and complex entitlement logic without breaking a sweat.
          </p>
        </div>
        <div class="flex lg:justify-end">
          <a href="https://docs.owostack.com" class="btn btn-primary px-8 py-3">
            Read the SDK Docs
          </a>
        </div>
      </div>
    </section>
  </main>

  <!-- CTA Section -->
  <SectionCut
    bands={["var(--color-bg-primary)", "var(--color-accent)", "var(--color-ink)"]}
    height="64px"
  />
  <section class="on-ink px-6 py-20">
    <div class="mx-auto max-w-6xl">
      <div class="flex flex-col items-center justify-center gap-6 text-center">
        <div class="flex h-12 w-12 items-center justify-center rounded-full border border-ink-line bg-ink-raised text-accent">
          <DiscordLogo size={24} weight="duotone" />
        </div>
        <div>
          <h3 class="font-display text-title-lg text-on-ink">
            Building something ambitious?
          </h3>
          <p class="mt-2 max-w-md text-sm text-on-ink-muted">
            Join our Discord community for support, or book a 30-min call to
            discuss your specific billing needs.
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
            href="/talk-to-founder"
            class="btn btn-primary gap-2"
            rel="noopener noreferrer"
          >
            <Calendar size={16} weight="duotone" />
            Talk to Founder
          </a>
        </div>
      </div>
    </div>
  </section>
  <SectionCut
    bands={["var(--color-ink)", "var(--color-accent)", "var(--color-bg-primary)"]}
    height="64px"
  />

  <Footer />
</div>
