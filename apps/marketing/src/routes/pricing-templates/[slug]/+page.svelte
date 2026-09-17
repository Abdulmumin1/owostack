<script lang="ts">
  import {
    ArrowUpRight,
    CheckCircle,
    Copy,
    DiscordLogo,
    Calendar,
  } from "phosphor-svelte";
  import Logo from "$lib/components/ui/Logo.svelte";
  import InspiredLogo from "$lib/components/marketing/InspiredLogo.svelte";
  import Footer from "$lib/components/marketing/Footer.svelte";
  import Header from "$lib/components/marketing/Header.svelte";
  import SectionCut from "$lib/components/marketing/SectionCut.svelte";
  import { PRICING_TEMPLATES_LAST_VERIFIED_AT } from "$lib/content/pricing-templates";
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

  // Dynamic OG generator using Cloudinary
  function getOgImage(title?: string, description?: string) {
    if (!title) return "https://owostack.com/og.jpg";
    const cloudName = "dtrqaqezs";
    const baseImageId = "og-plain_xvn4jj";
    const encodedTitle = encodeURIComponent(
      encodeURIComponent(title + " Pricing Template"),
    );
    // Use west gravity to center block vertically on the left side
    let overlay = `l_text:Arial_48_bold:${encodedTitle},c_fit,w_480,co_rgb:ececec/fl_layer_apply,g_west,x_70,y_-40`;

    if (description) {
      const shortDesc =
        description.length > 120
          ? description.substring(0, 117) + "..."
          : description;
      const encodedDesc = encodeURIComponent(encodeURIComponent(shortDesc));
      // Stack title and description centered on the left panel
      overlay = `l_text:Arial_48_bold:${encodedTitle},c_fit,w_480,co_rgb:ececec/fl_layer_apply,g_west,x_70,y_-45/l_text:Arial_32:${encodedDesc},c_fit,w_480,co_rgb:b3b3b3/fl_layer_apply,g_west,x_70,y_110`;
    }

    return `https://res.cloudinary.com/${cloudName}/image/upload/f_jpg,q_70,w_1200,h_630,c_fill/${overlay}/${baseImageId}.png`;
  }

  let ogImage = $derived(getOgImage(template.title, template.summary));
  let structuredData = $derived.by(() =>
    JSON.stringify({
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: `${template.title} Template`,
      description: template.summary,
      image: ogImage,
      author: {
        "@type": "Organization",
        name: "Owostack",
      },
      publisher: {
        "@type": "Organization",
        name: "Owostack",
        logo: {
          "@type": "ImageObject",
          url: "https://owostack.com/logo.svg",
        },
      },
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": `https://owostack.com/pricing-templates/${template.slug}`,
      },
    }).replace(/</g, "\\u003c"),
  );
</script>

<svelte:head>
  <title>{template.title} Template | Owostack</title>
  <meta name="description" content={template.summary} />
  <link
    rel="canonical"
    href={`https://owostack.com/pricing-templates/${template.slug}`}
  />
  <meta property="og:type" content="article" />
  <meta property="og:title" content={`${template.title} Template | Owostack`} />
  <meta property="og:description" content={template.summary} />
  <meta property="og:image" content={ogImage} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@owostack" />
  <meta
    name="twitter:title"
    content={`${template.title} Template | Owostack`}
  />
  <meta name="twitter:description" content={template.summary} />
  <meta name="twitter:image" content={ogImage} />
  {@html `<script type="application/ld+json">${structuredData}</script>`}
</svelte:head>

<div class="min-h-screen bg-bg-primary text-text-primary">
  <Header variant="page" showBorder={true} />
  <main class="mx-auto max-w-5xl px-6 py-16 md:py-20">
    <!-- Hero -->
    <div class="mb-16">
      <a
        href="/pricing-templates"
        class="eyebrow mb-10 hover:text-text-primary"
      >
        All patterns
      </a>

      <!-- Company attribution -->
      <div class="mb-6 flex items-center gap-3">
        <div class="overflow-hidden rounded-md ring-1 ring-border/60">
          <InspiredLogo
            logoUrl={template.logoUrl}
            alt={template.inspiredBy}
            size={38}
          />
        </div>
        <div>
          <div class="font-mono text-2xs uppercase tracking-[0.08em] text-text-muted">
            Snapshot from {template.inspiredBy}
          </div>
          <div class="mt-0.5 flex items-center gap-1.5 font-mono text-2xs text-text-dim">
            <CheckCircle size={10} class="text-secondary" weight="fill" />
            <span>Verified on {PRICING_TEMPLATES_LAST_VERIFIED_AT}</span>
          </div>
        </div>
      </div>

      <h1 class="font-display text-display-lg mb-4 text-balance text-text-primary">
        {template.title}
      </h1>
      <p class="max-w-2xl text-lg text-text-secondary">
        {template.headline}
      </p>
      <div class="mt-6">
        <a
          href={template.pricingUrl}
          target="_blank"
          rel="noreferrer"
          class="inline-flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.08em] text-text-muted transition-colors hover:text-accent"
        >
          View {template.inspiredBy} pricing
          <ArrowUpRight size={14} weight="bold" />
        </a>
      </div>
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
          <div class="on-ink overflow-hidden rounded-lg">
            <div class="flex items-center justify-between border-b border-ink-line px-4 py-2.5">
              <span class="font-mono text-2xs uppercase tracking-[0.08em] text-on-ink-faint">
                Implementation
              </span>
              <button
                type="button"
                class="inline-flex items-center gap-2 font-mono text-2xs text-on-ink-muted transition-colors hover:text-on-ink"
                onclick={copySnippet}
              >
                {#if copied}
                  <CheckCircle size={14} weight="fill" class="text-secondary" />
                  Copied
                {:else}
                  <Copy size={14} />
                  Copy
                {/if}
              </button>
            </div>
            <div class="bg-ink-deep p-6">
              <p class="mb-4 font-mono text-2xs leading-relaxed text-on-ink-faint">
                This snippet is the closest Owostack implementation of the live
                pricing shape above. It is not a literal copy of the vendor's
                internal billing system.
              </p>
              <pre class="overflow-x-auto font-mono text-[13px] leading-relaxed text-on-ink"><code
                  >{template.builderSnippet}</code
                ></pre>
            </div>
          </div>
        </section>

        <!-- Rules -->
        <section>
          <h3 class="eyebrow mb-5">Rules</h3>
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
            <h4 class="eyebrow mb-4">Pricing</h4>
            <div class="rounded-lg border border-border/60 bg-bg-card font-mono text-xs">
              {#each template.breakdown as item}
                <div
                  class="flex justify-between border-b border-border/40 px-4 py-2.5 last:border-b-0"
                >
                  <span class="text-text-muted">{item.label}</span>
                  <span class="font-medium text-text-primary"
                    >{item.value}</span
                  >
                </div>
              {/each}
            </div>
          </div>

          <div>
            <h4 class="eyebrow mb-4">Source</h4>
            <a
              href={template.pricingUrl}
              target="_blank"
              rel="noreferrer"
              class="block rounded-md border border-border/60 bg-bg-card px-4 py-3 text-sm text-text-secondary transition-colors hover:border-accent/60 hover:text-text-primary"
            >
              <div class="flex items-center justify-between gap-3">
                <span>{template.inspiredBy} pricing page</span>
                <ArrowUpRight
                  size={14}
                  weight="bold"
                  class="shrink-0 text-text-muted"
                />
              </div>
            </a>
          </div>

          <!-- Highlights -->
          <div>
            <h4 class="eyebrow mb-4">Benefits</h4>
            <div class="space-y-2">
              {#each template.highlights as item}
                <div class="flex gap-2 text-xs text-text-secondary">
                  <CheckCircle
                    size={14}
                    weight="bold"
                    class="mt-0.5 shrink-0 text-secondary"
                  />
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
  <SectionCut
    bands={["var(--color-bg-primary)", "var(--color-accent)", "var(--color-ink)"]}
    height="64px"
  />
  <section class="on-ink px-6 py-20">
    <div class="mx-auto max-w-5xl">
      <div class="flex flex-col items-center justify-center gap-6 text-center">
        <div class="flex h-12 w-12 items-center justify-center rounded-full border border-ink-line bg-ink-raised text-accent">
          <DiscordLogo size={24} weight="duotone" />
        </div>
        <div>
          <h3 class="font-display text-title-lg text-on-ink">
            Ready to implement this pattern?
          </h3>
          <p class="mt-2 max-w-md text-sm text-on-ink-muted">
            Join our Discord for implementation help, or book a call to discuss
            how {template.inspiredBy}'s pricing model fits your product.
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
  <SectionCut
    bands={["var(--color-ink)", "var(--color-accent)", "var(--color-bg-primary)"]}
    height="64px"
  />

  <Footer />
</div>
