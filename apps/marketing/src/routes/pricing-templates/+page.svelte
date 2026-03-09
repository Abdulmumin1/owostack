<script lang="ts">
  import { ArrowRight, CheckCircle, Copy, Info, DiscordLogo, Calendar } from "phosphor-svelte";
  import {
    getPricingTemplates,
    type PricingTemplate,
  } from "$lib/content/pricing-templates";
  import Logo from "$lib/components/ui/Logo.svelte";
  import InspiredLogo from "$lib/components/marketing/InspiredLogo.svelte";
  import Footer from "$lib/components/marketing/Footer.svelte";
  import Header from "$lib/components/marketing/Header.svelte";

  const templates = getPricingTemplates();

  const groupedTemplates = [
    {
      label: "Subscription",
      items: templates.filter((t) => t.category.toLowerCase().includes("subscription")),
    },
    {
      label: "Usage-based",
      items: templates.filter((t) => t.category.toLowerCase().includes("usage")),
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
</svelte:head>

<div class="min-h-screen bg-bg-primary text-text-primary">
  <Header variant="page" showBorder={true} />

  <main class="mx-auto max-w-6xl px-6 py-20 md:py-28">
    <!-- Hero Section -->
    <section class="mb-24">
      <h1 class="max-w-3xl text-3xl font-bold leading-[0.9] tracking-tighter md:text-5xl">
        The same pricing models used by Codex, Notion, and Figma.
      </h1>
      <p class="mt-8 max-w-2xl text-base leading-relaxed text-text-secondary md:text-lg">
        These aren't theoretical. These are the exact patterns powering the AI infrastructure
        you use every day—Cursor, Pinecone, Replicate, Clerk. Copy them in one click.
      </p>
    </section>

    <!-- Templates Grid -->
    <div class="space-y-32">
      {#each groupedTemplates as group}
        <section>
          <div class="mb-12 flex items-center gap-4">
            <h2 class="text-[11px] font-bold uppercase tracking-[0.24em] text-text-muted">{group.label}</h2>
            <div class="h-px flex-1 bg-border/40"></div>
          </div>

          <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {#each group.items as template}
              <article class="card card-elevated card-interactive flex flex-col p-8">
                <div class="mb-6 flex items-start justify-between">
                  <div class="flex items-center justify-center rounded-sm overflow-hidden text-text-muted">
                    <InspiredLogo logoUrl={template.logoUrl} alt={template.inspiredBy} size={40} />
                  </div>
                  <div class="rounded-full border border-border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim">
                    {template.category}
                  </div>
                </div>

                <!-- Company attribution with social proof -->
                <div class="mb-3 flex items-center gap-2">
                  <span class="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Used by {template.inspiredBy}
                  </span>
                </div>
                
                <div class="mb-4 flex items-center gap-1.5 text-[10px] text-text-dim">
                  <CheckCircle size={10} class="text-secondary" weight="fill" />
                  <span>{template.socialProof}</span>
                </div>

                <h3 class="mb-4 text-2xl font-bold tracking-tight text-text-primary">
                  {template.title}
                </h3>
                <p class="mb-10 text-sm leading-relaxed text-text-secondary">
                  {template.summary}
                </p>

                <div class="mt-auto space-y-4">
                  <div class="rounded-lg border border-border bg-bg-secondary/30">
                    {#each template.breakdown.slice(0, 2) as item}
                      <div class="grid grid-cols-[0.8fr_1.2fr] gap-3 border-b border-border/40 p-3 last:border-b-0">
                        <div class="text-[10px] font-semibold uppercase tracking-wide text-text-dim">{item.label}</div>
                        <div class="text-xs font-semibold text-text-primary">{item.value}</div>
                      </div>
                    {/each}
                  </div>

                  <div class="flex items-center justify-between pt-2">
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
                </div>
              </article>
            {/each}
          </div>
        </section>
      {/each}
    </div>

    <!-- Custom pricing section -->
    <section class="mt-40 border border-border/40 bg-bg-card p-10 md:p-16">
      <div class="grid gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <div class="mb-4 flex h-10 w-10 items-center justify-center rounded-sm border border-border bg-bg-secondary text-accent">
            <Info size={20} weight="duotone" />
          </div>
          <h2 class="text-3xl font-bold tracking-tight text-text-primary md:text-4xl">
            Custom pricing?
          </h2>
          <p class="mt-4 text-sm leading-relaxed text-text-secondary md:text-base">
            These templates cover 90% of SaaS models. If you're building something truly unique, our SDK handles arbitrary metering and complex entitlement logic without breaking a sweat.
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
  <section class="border-t border-border/40 px-6 py-16">
    <div class="mx-auto max-w-6xl">
      <div class="flex flex-col items-center justify-center gap-6 rounded-lg p-10 md:p-16 text-center">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <DiscordLogo size={24} weight="duotone" />
        </div>
        <div>
          <h3 class="text-xl font-bold text-text-primary">Building something ambitious?</h3>
          <p class="mt-2 max-w-md text-sm text-text-secondary">
            Join our Discord community for support, or book a 30-min call to discuss your specific billing needs.
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

  <Footer />
</div>