<script lang="ts">
  import Header from "$lib/components/marketing/Header.svelte";
  import Footer from "$lib/components/marketing/Footer.svelte";

  const calLink = "https://cal.com/yaqeen/30min";
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
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "ContactPage",
      "name": "Talk to Founder",
      "description": "Book a call with the Owostack founder to discuss your billing architecture.",
      "url": "https://owostack.com/talk-to-founder",
      "mainEntity": {
        "@type": "Organization",
        "name": "Owostack",
        "url": "https://owostack.com",
        "contactPoint": {
          "@type": "ContactPoint",
          "contactType": "Founder"
        }
      }
    }
  </script>
</svelte:head>

<div
  class="min-h-screen bg-bg-primary text-text-primary font-sans flex flex-col"
>
  <Header variant="home" showBorder={false} />

  <main class="flex-grow">
    <section class="px-6 py-16 md:py-24">
      <div class=" mx-auto">
        <div class="text-center mb-10">
          <h1 class="text-2xl md:text-3xl font-bold text-text-primary mb-3">
            Let's talk billing
          </h1>
          <p class="text-text-secondary text-sm md:text-base max-w-md mx-auto">
            Book a 30-minute call with our founder to discuss your billing
            architecture, pricing model, or any questions.
          </p>
        </div>

        <div
          class="bg-bg-secondary rounded-xl border border-border overflow-hidden min-h-[700px] w-full"
        >
          <iframe
            src="{calLink}?embed=true&embedType=Inline&hideLandingPageDetails=1&hideEventTypeDetails=1&primaryColor=3b82f6"
            title="Book a call with Owostack founder"
            class="w-full min-h-[700px] border-none block"
            scrolling="yes"
            allowfullscreen
          ></iframe>
        </div>
      </div>
    </section>
  </main>

  <Footer />
</div>
