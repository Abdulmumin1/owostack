<script lang="ts">
  import { onMount } from "svelte";
  import {
    ArrowRight,
    Coins,
    CreditCard,
    GithubLogo,
    Lightning,
    Lock,
    Users,
    Plug,
    DiscordLogo,
    Calendar,
  } from "phosphor-svelte";
  import Logo from "$lib/components/ui/Logo.svelte";
  import InteractiveDemo from "$lib/components/marketing/InteractiveDemo.svelte";
  import PricingTemplatesSection from "$lib/components/marketing/PricingTemplatesSection.svelte";
  import Footer from "$lib/components/marketing/Footer.svelte";
  import Header from "$lib/components/marketing/Header.svelte";
  import TextLoop from "$lib/components/ui/TextLoop.svelte";
  import RocketFlame from "$lib/components/RocketFlame.svelte";

  const phrases: { text: string; icons: (typeof CreditCard)[] }[] = [
    { text: "subscriptions", icons: [CreditCard] },
    { text: "feature gating", icons: [Lock] },
    { text: "usage metering", icons: [Coins] },
    { text: "team seats", icons: [Users] },
    { text: "subscriptions + feature gating", icons: [CreditCard, Lock] },
    { text: "usage metering + team seats", icons: [Coins, Users] },
    {
      text: "subscriptions + metering + overage",
      icons: [CreditCard, Coins, Lightning],
    },
  ];

  let rocketSection: HTMLDivElement;
  let flameOffsetY = 0;
  let flameOpacity = 0.8;
  let textOffsetY = 0;
  let textScale = 1;
  let textOpacity = 0.08;

  onMount(() => {
    if (!rocketSection || typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frameId = 0;

    const clamp = (value: number, min: number, max: number) =>
      Math.min(max, Math.max(min, value));

    const updateParallax = () => {
      frameId = 0;

      if (mediaQuery.matches || !rocketSection) {
        flameOffsetY = 0;
        flameOpacity = 0.8;
        textOffsetY = 0;
        textScale = 1;
        textOpacity = 0.08;
        return;
      }

      const rect = rocketSection.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const sectionCenter = rect.top + rect.height / 2;
      const viewportCenter = viewportHeight / 2;
      const normalized = clamp(
        (sectionCenter - viewportCenter) / (viewportHeight * 0.85),
        -1,
        1,
      );
      const proximity = 1 - Math.abs(normalized);

      flameOffsetY = normalized * -44;
      flameOpacity = 0.7 + proximity * 0.18;
      textOffsetY = normalized * 30;
      textScale = 1 + proximity * 0.08;
      textOpacity = 0.05 + proximity * 0.08;
    };

    const scheduleUpdate = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(updateParallax);
    };

    const handleMotionPreference = () => {
      scheduleUpdate();
    };

    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    mediaQuery.addEventListener("change", handleMotionPreference);
    scheduleUpdate();

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      mediaQuery.removeEventListener("change", handleMotionPreference);
    };
  });
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
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "Owostack",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web",
      "description": "Billing Infrastructure for AI SaaS. Subscriptions, usage-based billing, and feature gating in 3 API calls.",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD"
      }
    }
  </script>
</svelte:head>

<div
  class="min-h-screen bg-bg-primary text-text-primary font-sans selection:bg-accent/30 relative overflow-hidden"
>
  <!-- Abstract Background Art -->
  <div
    class="absolute inset-0 pointer-events-none overflow-hidden flex justify-center"
  >
    <!-- Subtle Grid -->
    <div class="grid-pattern"></div>

    <!-- Flowing Lines -->
    <svg
      class="flow-lines"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="lineGrad1" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="var(--color-accent)" stop-opacity="0" />
          <stop
            offset="50%"
            stop-color="var(--color-accent)"
            stop-opacity="0.3"
          />
          <stop
            offset="100%"
            stop-color="var(--color-accent)"
            stop-opacity="0"
          />
        </linearGradient>
        <linearGradient id="lineGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop
            offset="0%"
            stop-color="var(--color-secondary)"
            stop-opacity="0"
          />
          <stop
            offset="50%"
            stop-color="var(--color-secondary)"
            stop-opacity="0.2"
          />
          <stop
            offset="100%"
            stop-color="var(--color-secondary)"
            stop-opacity="0"
          />
        </linearGradient>
      </defs>
      <path
        class="flow-line flow-line-1"
        d="M-100,200 Q400,150 700,300 T1440,250"
        stroke="url(#lineGrad1)"
        fill="none"
        stroke-width="1"
      />
      <path
        class="flow-line flow-line-2"
        d="M-100,400 Q300,350 600,500 T1440,450"
        stroke="url(#lineGrad2)"
        fill="none"
        stroke-width="1"
      />
      <path
        class="flow-line flow-line-3"
        d="M-100,600 Q350,550 650,700 T1440,650"
        stroke="url(#lineGrad1)"
        fill="none"
        stroke-width="1"
      />
    </svg>

    <!-- Floating Particles -->
    <div class="particle particle-1"></div>
    <div class="particle particle-2"></div>
    <div class="particle particle-3"></div>
    <div class="particle particle-4"></div>
    <div class="particle particle-5"></div>
  </div>

  <Header variant="home" showBorder={false} />

  <!-- Hero -->
  <section class="px-6 pt-28 pb-20 md:pt-40 md:pb-28 relative">
    <div class="max-w-4xl mx-auto">
      <h1
        class="text-4xl md:text-6xl font-bold leading-[1.08] tracking-tight mb-6"
      >
        Three API calls.<br />
        <span class="text-text-secondary"
          >That's your entire billing layer.</span
        >
      </h1>
      <div
        class="text-base md:text-lg text-text-secondary max-w-xl leading-relaxed mb-4"
      >
        <span>Add </span>
        <TextLoop
          items={phrases}
          class="align-bottom text-text-primary font-medium h-[1.6em]"
        >
          {#snippet children(phrase)}
            <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
              {#each phrase.icons as Icon, i (i)}
                <Icon weight="duotone" />
              {/each}
              {phrase.text}
            </span>
          {/snippet}
        </TextLoop>
        <span> to your app.</span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <a href="https://app.owostack.com" class="btn btn-primary"
          >Get Started</a
        >
        <a href="https://docs.owostack.com" class="btn btn-secondary">
          Read the docs
          <ArrowRight
            size={14}
            class="group-hover:translate-x-0.5 transition-transform"
            weight="fill"
          />
        </a>
      </div>
    </div>
  </section>

  <!-- Code -->
  <section class="px-6 pb-28 md:pb-36">
    <div class="max-w-4xl mx-auto">
      <div class="table-container bg-bg-secondary/40">
        <div class="flex items-center px-5 py-3 border-b border-border/40">
          <span class="text-[11px] font-mono text-text-secondary"
            >billing.ts</span
          >
        </div>
        <div
          class="p-6 md:p-8 font-mono text-[13px] md:text-sm leading-[1.8] overflow-x-auto"
        >
          <pre class="text-text-secondary"><span
              class="text-text-secondary italic"
              >// Subscribe a customer to a plan</span
            >
<span class="text-accent font-medium">await</span> owo.<span
              class="text-black dark:text-white">attach</span
            >(&#123;
  customer: <span class="text-amber-400">"user@acme.com"</span>,
  product:  <span class="text-amber-400">"pro"</span>,
&#125;);

<span class="text-text-secondary italic"
              >// Check if they can use a feature</span
            >
<span class="text-accent font-medium">const</span> &#123; allowed &#125; = <span
              class="text-accent font-medium">await</span
            > owo.<span class="text-black dark:text-white">check</span>(&#123;
  customer: <span class="text-amber-400">"user@acme.com"</span>,
  feature:  <span class="text-amber-400">"gpu-inference"</span>,
&#125;);

<span class="text-text-secondary italic">// Record usage</span>
<span class="text-accent font-medium">await</span> owo.<span
              class="text-black dark:text-white">track</span
            >(&#123;
  customer: <span class="text-amber-400">"user@acme.com"</span>,
  feature:  <span class="text-amber-400">"gpu-inference"</span>,
&#125;);</pre>
        </div>
      </div>
    </div>
  </section>

  <!-- Interactive Demo -->
  <!-- Billing Patterns - Interactive Demo -->
  <section
    class="px-6 py-20 md:py-32 relative bg-bg-secondary/30 overflow-hidden"
  >
    <div class="max-w-6xl mx-auto relative z-10">
      <div class="text-center mb-16">
        <h2 class="text-2xl md:text-4xl font-bold text-text-primary mb-4">
          Built for the way AI get billed
        </h2>
        <p class="text-text-secondary max-w-lg mx-auto text-sm">
          Real-time metering, subscription management, and invoicing—all handled
          by one simple SDK.
        </p>
      </div>

      <div class="flex justify-center">
        <InteractiveDemo />
      </div>
    </div>
  </section>

  <PricingTemplatesSection />

  <!-- Provider Agnostic -->
  <section
    class="px-6 py-20 md:py-32 relative overflow-hidden bg-bg-primary border-t border-border/30"
  >
    <div class="max-w-3xl mx-auto text-center relative z-10">
      <div class="flex items-center justify-center gap-3 md:gap-6 mb-10">
        <!-- Owostack -->
        <div
          class="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-bg-secondary/50 border border-border/40 flex items-center justify-center shadow-sm relative group transition-all hover:bg-bg-secondary"
        >
          <Logo
            size={32}
            class="text-accent transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3"
          />
          <div
            class="absolute inset-0 rounded-2xl ring-1 ring-inset ring-accent/10 group-hover:ring-accent/30 transition-all duration-500"
          ></div>
        </div>

        <!-- Connection -->
        <div class="flex items-center gap-1.5 md:gap-2">
          <div
            class="w-1.5 h-1.5 md:w-2.5 md:h-2.5 rounded-full bg-border/40 animate-pulse"
            style="animation-delay: 0ms"
          ></div>
          <div
            class="w-1.5 h-1.5 md:w-2.5 md:h-2.5 rounded-full bg-border/60 animate-pulse"
            style="animation-delay: 150ms"
          ></div>
          <div
            class="w-1.5 h-1.5 md:w-2.5 md:h-2.5 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)] animate-pulse"
            style="animation-delay: 300ms"
          ></div>
        </div>

        <!-- Provider -->
        <div
          class="w-16 h-16 md:w-20 md:h-20 rounded-2xl border-2 border-dashed border-border/60 flex items-center justify-center bg-bg-secondary/10 relative group overflow-hidden cursor-crosshair hover:border-accent/50 hover:bg-accent/5 transition-all duration-500"
        >
          <div
            class="absolute inset-0 flex flex-col items-center justify-center transition-all duration-500 group-hover:-translate-y-full opacity-100 group-hover:opacity-0"
          >
            <Plug size={28} class="text-text-secondary" weight="duotone" />
          </div>
          <div
            class="absolute inset-0 flex flex-col items-center justify-center translate-y-full transition-all duration-500 group-hover:translate-y-0 text-sm font-bold font-mono text-accent opacity-0 group-hover:opacity-100"
          >
            ANY
          </div>
        </div>
      </div>

      <h2
        class="text-3xl md:text-4xl font-bold text-text-primary mb-5 tracking-tight"
      >
        Bring your own provider.
      </h2>
      <p
        class="text-text-secondary max-w-lg mx-auto text-sm md:text-base leading-relaxed mb-10 text-balance"
      >
        Owostack is Provider Agnostic. Bring the provider of your choice.
      </p>

      <div class="flex flex-wrap justify-center items-center gap-3 md:gap-4">
        <div
          class="px-4 py-2 rounded-full border border-border/40 bg-bg-secondary/30 text-xs font-medium flex items-center gap-2 hover:border-[#0BA4DB]/40 transition-colors cursor-default"
        >
          <img
            src="https://cdn.brandfetch.io/paystack.com?c=1iduQCu8CNcitTrpDvi"
            alt="Paystack logo"
            class="w-4 h-4 object-contain"
          />
          Paystack
        </div>
        <div
          class="px-4 py-2 rounded-full border border-border/40 bg-bg-secondary/30 text-xs font-medium flex items-center gap-2 hover:border-[#635BFF]/40 transition-colors cursor-default"
        >
          <img
            src="https://cdn.brandfetch.io/stripe.com?c=1iduQCu8CNcitTrpDvi"
            alt="Stripe logo"
            class="w-4 h-4 object-contain"
          />
          Stripe
        </div>
        <div
          class="px-4 py-2 rounded-full border border-border/40 bg-bg-secondary/30 text-xs font-medium flex items-center gap-2 hover:border-[#1264FF]/40 transition-colors cursor-default"
        >
          <img
            src="https://cdn.brandfetch.io/dodopayments.com?c=1iduQCu8CNcitTrpDvi"
            alt="Dodo Payments logo"
            class="w-4 h-4 rounded-sm object-contain"
          />
          Dodo Payments
        </div>
        <!-- <div
          class="px-4 py-2 rounded-full border border-border/40 bg-bg-secondary/30 text-xs font-medium flex items-center gap-2 hover:border-[#e41d34]/40 transition-colors cursor-default"
        >
          <img
            src="/polar.png"
            alt="Polar logo"
            class="w-4 h-4 object-contain dark:invert"
          />
          Polar
        </div> -->
        <div
          class="px-4 py-2 rounded-full border border-dashed border-border/30 bg-bg-secondary/10 text-xs font-medium flex items-center gap-2 text-text-muted cursor-default"
        >
          <span class="opacity-60">+ More soon...</span>
        </div>
      </div>
    </div>
  </section>

  <!-- Community Section -->
  <section
    class="px-6 py-20 md:py-28 border-t border-border/30 bg-bg-secondary/30"
  >
    <div class="max-w-4xl mx-auto text-center">
      <h2
        class="text-2xl md:text-3xl font-bold tracking-tight text-text-primary mb-4"
      >
        Building something ambitious?
      </h2>
      <p class="text-text-secondary max-w-lg mx-auto text-sm mb-10">
        Join our community of builders or book a call to discuss your billing
        architecture.
      </p>
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
        >
          <Calendar size={16} weight="duotone" />
          Talk to Founder
        </a>
      </div>
    </div>
  </section>

  <div
    bind:this={rocketSection}
    class="w-full h-300 relative z-0 overflow-hidden perspective-distant"
  >
    <div
      class="absolute inset-x-0 bottom-10 md:bottom-14 z-0 pointer-events-none text-center px-6 will-change-transform"
      style={`transform: translate3d(0, ${textOffsetY}px, 0) scale(${textScale}); opacity: ${textOpacity};`}
    >
      <p
        class="text-[2.5rem] leading-none md:text-[5rem] lg:text-[7rem] font-bold tracking-[-0.06em] text-text-primary select-none"
      >
        Behind The Checkout
      </p>
    </div>
    <div
      class="absolute inset-0 will-change-transform"
      style={`transform: translate3d(0, ${flameOffsetY}px, 0); opacity: ${flameOpacity};`}
    >
      <RocketFlame />
    </div>
  </div>

  <Footer />
</div>

<style>
  /* Abstract Background Elements */

  /* Gradient Orbs */
  .orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
    opacity: 0.4;
    animation: float 20s ease-in-out infinite;
  }

  .orb-1 {
    width: 600px;
    height: 600px;
    background: radial-gradient(
      circle,
      var(--color-accent) 0%,
      transparent 70%
    );
    top: -200px;
    right: -100px;
    animation-delay: 0s;
  }

  @keyframes float {
    0%,
    100% {
      transform: translate(0, 0) scale(1);
    }
    33% {
      transform: translate(30px, -30px) scale(1.05);
    }
    66% {
      transform: translate(-20px, 20px) scale(0.95);
    }
  }

  /* Dot Grid Pattern */
  .grid-pattern {
    position: absolute;
    inset: 0;
    background-image: radial-gradient(
      circle,
      var(--color-border) 1px,
      transparent 1px
    );
    background-size: 60px 60px;
    opacity: 0.3;
    mask-image: radial-gradient(
      ellipse 80% 50% at 50% 50%,
      black 40%,
      transparent 100%
    );
    -webkit-mask-image: radial-gradient(
      ellipse 80% 50% at 50% 50%,
      black 40%,
      transparent 100%
    );
  }

  /* Flowing Lines */
  .flow-lines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0.5;
  }

  .flow-line {
    stroke-dasharray: 1000;
    stroke-dashoffset: 1000;
    animation: flow 15s linear infinite;
  }

  .flow-line-1 {
    animation-delay: 0s;
  }

  .flow-line-2 {
    animation-delay: -5s;
  }

  .flow-line-3 {
    animation-delay: -10s;
  }

  @keyframes flow {
    0% {
      stroke-dashoffset: 1000;
      opacity: 0;
    }
    10% {
      opacity: 0.5;
    }
    90% {
      opacity: 0.5;
    }
    100% {
      stroke-dashoffset: -1000;
      opacity: 0;
    }
  }

  /* Floating Particles */
  .particle {
    position: absolute;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--color-accent);
    opacity: 0;
    animation: drift 25s ease-in-out infinite;
  }

  .particle-1 {
    left: 10%;
    top: 20%;
    animation-delay: 0s;
    animation-duration: 30s;
  }

  .particle-2 {
    left: 25%;
    top: 60%;
    animation-delay: -5s;
    animation-duration: 28s;
    background: var(--color-secondary);
  }

  .particle-3 {
    right: 20%;
    top: 30%;
    animation-delay: -10s;
    animation-duration: 32s;
    background: var(--color-tertiary);
  }

  .particle-4 {
    right: 30%;
    top: 70%;
    animation-delay: -15s;
    animation-duration: 26s;
  }

  .particle-5 {
    left: 50%;
    top: 40%;
    animation-delay: -20s;
    animation-duration: 34s;
    background: var(--color-secondary);
  }

  @keyframes drift {
    0%,
    100% {
      transform: translate(0, 0);
      opacity: 0;
    }
    10% {
      opacity: 0.6;
    }
    50% {
      transform: translate(100px, 50px);
      opacity: 0.3;
    }
    90% {
      opacity: 0.6;
    }
  }

  /* Dark mode adjustments */
  :global(.dark) .orb {
    opacity: 0.2;
  }

  :global(.dark) .grid-pattern {
    opacity: 0.15;
  }

  :global(.dark) .flow-lines {
    opacity: 0.3;
  }

  :global(.dark) .particle {
    opacity: 0;
  }

  :global(.dark) .particle-1,
  :global(.dark) .particle-2,
  :global(.dark) .particle-3,
  :global(.dark) .particle-4,
  :global(.dark) .particle-5 {
    animation: drift-dark 25s ease-in-out infinite;
  }

  @keyframes drift-dark {
    0%,
    100% {
      transform: translate(0, 0);
      opacity: 0;
    }
    10% {
      opacity: 0.4;
    }
    50% {
      transform: translate(100px, 50px);
    }
    90% {
      opacity: 0.4;
    }
  }
</style>
