<script lang="ts">
  import PricingTemplatesSection from "$lib/components/marketing/PricingTemplatesSection.svelte";
  import FounderLetter from "$lib/components/marketing/FounderLetter.svelte";
  import Footer from "$lib/components/marketing/Footer.svelte";
  import Header from "$lib/components/marketing/Header.svelte";
  import HeroVisual from "$lib/components/marketing/HeroVisual.svelte";
  import ProblemSection from "$lib/components/marketing/ProblemSection.svelte";
  import HowItWorks from "$lib/components/marketing/HowItWorks.svelte";
  import FeatureGrid from "$lib/components/marketing/FeatureGrid.svelte";
  import FAQ from "$lib/components/marketing/FAQ.svelte";
  import FinalCTA from "$lib/components/marketing/FinalCTA.svelte";
  import SectionCut from "$lib/components/marketing/SectionCut.svelte";

  const providers = [
    { name: "Paystack", domain: "paystack.com" },
    { name: "Stripe", domain: "stripe.com" },
    { name: "Dodo Payments", domain: "dodopayments.com" },
    { name: "Bachs", domain: "bachs.io", isNew: true },
  ];

  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Owostack",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "Billing Infrastructure for AI SaaS. Subscriptions, usage-based billing, and feature gating in 3 API calls.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  }).replace(/</g, "\\u003c");
</script>

<svelte:head>
  <title>Owostack — Billing Infrastructure for AI SaaS</title>
  <meta
    name="description"
    content="Owostack - Billing Infrastructure for AI SaaS. Subscriptions, usage-based billing, and feature gating in 3 API calls."
  />
  <link rel="canonical" href="https://owostack.com/" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://owostack.com/" />
  <meta
    property="og:title"
    content="Owostack — Billing Infrastructure for AI SaaS"
  />
  <meta
    property="og:description"
    content="Owostack - Billing Infrastructure for AI SaaS. Subscriptions, usage-based billing, and feature gating in 3 API calls."
  />
  <meta property="og:image" content="https://owostack.com/og.jpg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@owostack" />
  <meta name="twitter:url" content="https://owostack.com/" />
  <meta
    name="twitter:title"
    content="Owostack — Billing Infrastructure for AI SaaS"
  />
  <meta
    name="twitter:description"
    content="Owostack - Billing Infrastructure for AI SaaS. Subscriptions, usage-based billing, and feature gating in 3 API calls."
  />
  <meta name="twitter:image" content="https://owostack.com/og.jpg" />
  {@html `<script type="application/ld+json">${structuredData}</script>`}
</svelte:head>

<div class="min-h-screen bg-bg-primary text-text-primary font-sans selection:bg-accent/30">
  <Header variant="home" showBorder={false} />

  <!-- Hero -->
  <section class="relative overflow-hidden px-6 pt-16 md:pt-24">
    <div class="mx-auto max-w-3xl text-center">
      <h1 class="font-display text-display-2xl text-balance text-text-primary">
        Three API calls.<br />That's your billing.
      </h1>

      <p class="mx-auto mt-7 max-w-2xl text-lg text-text-secondary text-pretty md:text-xl">
        Subscriptions, credits, usage metering and feature gating for AI
        products. You call attach, check and track. No webhooks.
      </p>

      <div class="mt-9 flex flex-wrap items-center justify-center gap-3">
        <a href="https://app.owostack.com" class="btn btn-primary btn-lg !px-5 !py-2.5 !text-base">
          Start free
        </a>
        <a href="/talk-to-founder" class="btn btn-secondary btn-lg !px-5 !py-2.5 !text-base">
          <img src="/images/abdul.jpg" alt="Yaqeen, founder of Owostack" class="h-5 w-5 rounded-full object-cover" loading="lazy" />
          Talk to the founder
        </a>
      </div>
    </div>

    <!-- mockup on a pixel sunset -->
    <div class="relative mt-16 md:mt-20">
      <div class="absolute inset-x-0 bottom-0 -mx-6 h-[46%]">
        <SectionCut
          class="absolute inset-x-0 bottom-0"
          height="100%"
          bands={[
            "var(--color-bg-primary)",
            "var(--color-error)",
            "var(--color-accent)",
            "var(--color-secondary)",
            "var(--color-ink)",
          ]}
          coarseTail={false}
        />
      </div>
      <div class="relative mx-auto max-w-5xl">
        <HeroVisual />
      </div>
    </div>
  </section>

  <!-- Providers band -->
  <div class="on-ink px-6 py-7">
    <div class="mx-auto flex max-w-6xl flex-col items-center gap-6 sm:flex-row sm:justify-between">
      <p class="text-sm text-on-ink-faint">Works with the providers you already use</p>
      <ul class="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
        {#each providers as p (p.domain)}
          <li class="flex items-center gap-2 font-display text-2xl text-on-ink">
            {p.name}
            {#if p.isNew}
              <span class="rounded-full bg-accent px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-accent-contrast">new</span>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  </div>

  <ProblemSection />

  <SectionCut
    height="88px"
    bands={[
      "var(--color-bg-primary)",
      "var(--color-secondary)",
      "var(--color-accent)",
      "var(--color-accent-border)",
      "var(--color-ink)",
    ]}
    coarseTail={false}
  />

  <HowItWorks />

  <SectionCut
    height="56px"
    bands={["var(--color-ink)", "var(--color-ink-line)", "var(--color-bg-primary)"]}
  />

  <PricingTemplatesSection />

  <FeatureGrid />

  <FounderLetter />

  <FAQ />

  <SectionCut
    height="88px"
    bands={[
      "var(--color-bg-secondary)",
      "var(--color-accent)",
      "var(--color-accent-border)",
      "var(--color-ink)",
    ]}
    coarseTail={false}
  />

  <FinalCTA />

  <Footer />
</div>
