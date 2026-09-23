<script lang="ts">
  import Header from "$lib/components/marketing/Header.svelte";
  import Footer from "$lib/components/marketing/Footer.svelte";

  const calLink = "https://cal.com/yaqeen/30min";
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ContactPage",
    name: "Talk to Founder",
    description:
      "Book a call with the Owostack founder to discuss your billing architecture.",
    url: "https://owostack.com/talk-to-founder",
    mainEntity: {
      "@type": "Organization",
      name: "Owostack",
      url: "https://owostack.com",
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "Founder",
      },
    },
  }).replace(/</g, "\\u003c");
</script>

<svelte:head>
  <title>Talk to Founder — Owostack</title>
  <meta
    name="description"
    content="Book a call with the Owostack founder to discuss your billing architecture."
  />
  <link rel="canonical" href="https://owostack.com/talk-to-founder" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://owostack.com/talk-to-founder" />
  <meta property="og:title" content="Talk to Founder — Owostack" />
  <meta
    property="og:description"
    content="Book a call with the Owostack founder to discuss your billing architecture."
  />
  <meta property="og:image" content="https://owostack.com/og.jpg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@owostack" />
  <meta name="twitter:url" content="https://owostack.com/talk-to-founder" />
  <meta name="twitter:title" content="Talk to Founder — Owostack" />
  <meta
    name="twitter:description"
    content="Book a call with the Owostack founder to discuss your billing architecture."
  />
  <meta name="twitter:image" content="https://owostack.com/og.jpg" />
  {@html `<script type="application/ld+json">${structuredData}</script>`}
</svelte:head>

<div
  class="min-h-screen bg-bg-primary text-text-primary font-sans flex flex-col"
>
  <Header variant="home" showBorder={false} />

  <main class="flex-grow">
    <section class="px-6 py-16 md:py-24">
      <div class="mx-auto max-w-3xl">
        <div class="mb-12 text-center">
          <p class="eyebrow mb-6 justify-center">Talk to us</p>
          <h1 class="font-display text-display-lg text-balance text-text-primary">
            Let's talk billing.
          </h1>
          <p class="mx-auto mt-5 max-w-md text-sm text-text-secondary md:text-base">
            Book a 30-minute call with our founder to discuss your billing
            architecture, pricing model, or any questions.
          </p>
        </div>

        <div class="overflow-hidden rounded-xl border border-border bg-bg-card shadow-[0_1px_0_var(--color-border-strong)]">
          <div class="dither h-2 w-full" style="--dither-color: var(--color-accent); background-color: var(--color-bg-secondary)" aria-hidden="true"></div>
          <iframe
            src="{calLink}?embed=true&embedType=Inline&hideLandingPageDetails=1&hideEventTypeDetails=1&primaryColor=e8a855"
            title="Book a call with Owostack founder"
            class="block w-full border-none"
            style="min-height: 700px"
            scrolling="yes"
            allowfullscreen
          ></iframe>
        </div>
      </div>
    </section>
  </main>

  <Footer />
</div>
