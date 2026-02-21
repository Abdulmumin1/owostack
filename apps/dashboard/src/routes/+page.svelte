<script lang="ts">
  import {
    ArrowRight,
    Coins,
    CreditCard,
    GithubLogo,
    Lightning,
    Lock,
    Users,
    Cube,
    Code,
    CheckCircle,
  } from "phosphor-svelte";
  import Logo from "$lib/components/ui/Logo.svelte";
  import InteractiveDemo from "$lib/components/marketing/InteractiveDemo.svelte";
  import { onMount, tick } from "svelte";

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

  let currentIndex = 0;
  let visible = true;
  let containerWidth = 0;
  let innerEl: HTMLSpanElement;
  let interval: ReturnType<typeof setInterval>;

  let resolved = $state(false);
  const headaches = [
    { text: "Proration Math", x: 22, y: 22, color: "bg-warning", delay: 0.1 },
    { text: "Webhook Failures", x: 75, y: 20, color: "bg-error", delay: 0.2 },
    { text: "Idempotency Keys", x: 18, y: 75, color: "bg-info", delay: 0.4 },
    { text: "Race Conditions", x: 82, y: 78, color: "bg-error", delay: 0.15 },
    { text: "Dunning Campaigns", x: 86, y: 48, color: "bg-warning", delay: 0.3 },
    { text: "High-throughput Overage", x: 12, y: 48, color: "bg-info", delay: 0.5 },
    { text: "Grandfathered Plans", x: 48, y: 15, color: "bg-secondary", delay: 0.25 },
    { text: "Failed Retries", x: 35, y: 85, color: "bg-error", delay: 0.05 },
    { text: "Cross-region Tax", x: 65, y: 88, color: "bg-warning", delay: 0.35 },
  ];


</script>

<svelte:head>
  <title>Owostack — Billing Infrastructure for AI SaaS</title>
</svelte:head>

<div
  class="min-h-screen bg-bg-primary text-text-primary font-sans selection:bg-accent/30 relative overflow-hidden"
>
  <!-- Abstract Background Art -->
  <div class="absolute inset-0 pointer-events-none overflow-hidden">
    <!-- Gradient Orbs -->
    <div class="orb orb-1"></div>
    <!-- <div class="orb orb-2"></div>
    <div class="orb orb-3"></div> -->

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

  <!-- Header -->
  <header class="px-6 py-5">
    <div class="max-w-4xl mx-auto flex items-center justify-between">
      <a href="/" class="flex items-center gap-2">
        <Logo size={24} class="text-accent" weight="duotone" />
        <span class="text-sm font-bold tracking-tight">Owostack</span>
      </a>
      <nav class="flex items-center gap-6 text-xs text-text-secondary">
        <a
          href="/docs"
          class="hidden sm:inline hover:text-text-primary transition-colors"
          >Docs</a
        >
        <a
          href="https://github.com/Abdulmumin1/owostack"
          class="hidden sm:flex items-center gap-1.5 hover:text-text-primary transition-colors"
        >
          <GithubLogo size={13} weight="duotone" />
          GitHub
        </a>
        <a href="/signup" class="btn btn-primary">get started</a>
      </nav>
    </div>
  </header>

  <!-- Hero -->
  <section class="px-6 pt-28 pb-20 md:pt-40 md:pb-28 relative">
    <div class="max-w-4xl mx-auto">
      <div
        class="text-[11px] font-bold text-text-secondary flex gap-2 uppercase tracking-[0.25em] mb-8"
      >
        <div
          class="w-4 h-4 bg-[#F26522] flex items-center justify-center rounded-xs"
        >
          <span class="text-white text-[10px] font-bold font-sans">Y</span>
        </div>
        Not backed by Y Combinator
      </div>
      <h1
        class="text-4xl md:text-6xl font-bold leading-[1.08] tracking-tight mb-6"
      >
        Three API calls.<br />
        <span class="text-text-secondary"
          >That's your entire billing layer.</span
        >
      </h1>
      <div
        class="text-base md:text-lg text-text-secondary max-w-xl leading-relaxed mb-10"
      >
        <span>Add </span>
        <span
          class="inline-flex overflow-hidden align-bottom transition-[width] duration-300 ease-in-out"
          style="width: {containerWidth}px; height: 1.6em;"
        >
          <span
            bind:this={innerEl}
            class="inline-flex items-center gap-1.5 transition-all duration-300 ease-in-out text-text-primary font-medium whitespace-nowrap"
            class:translate-y-0={visible}
            class:opacity-100={visible}
            class:translate-y-3={!visible}
            class:opacity-0={!visible}
          >
            {#each phrases[currentIndex].icons as Icon}
              <svelte:component this={Icon} weight="duotone" />
            {/each}
            {phrases[currentIndex].text}
          </span>
        </span>
        <span> to your app.</span>
        <br />
        <span>Provider-agnostic.</span>
      </div>
      <div class="flex flex-wrap items-center gap-5">
        <a href="/signup" class="btn btn-primary btn-lg">Get Started</a>
        <a
          href={import.meta.env.VITE_DOCS_URL}
          class="btn btn-secondary btn-lg"
        >
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
<span class="text-accent font-medium">await</span> owo.<span class="text-white"
              >attach</span
            >(&#123;
  customer: <span class="text-amber-400">"user@acme.com"</span>,
  product:  <span class="text-amber-400">"pro"</span>,
&#125;);

<span class="text-text-secondary italic"
              >// Check if they can use a feature</span
            >
<span class="text-accent font-medium">const</span> &#123; allowed &#125; = <span
              class="text-accent font-medium">await</span
            > owo.<span class="text-white">check</span>(&#123;
  customer: <span class="text-amber-400">"user@acme.com"</span>,
  feature:  <span class="text-amber-400">"gpu-inference"</span>,
&#125;);

<span class="text-text-secondary italic">// Record usage</span>
<span class="text-accent font-medium">await</span> owo.<span class="text-white"
              >track</span
            >(&#123;
  customer: <span class="text-amber-400">"user@acme.com"</span>,
  feature:  <span class="text-amber-400">"gpu-inference"</span>,
&#125;);</pre>
        </div>
      </div>
    </div>
  </section>

  <!-- Before / After -->
  <section class="px-6 pb-28 md:pb-36">
    <div class="max-w-4xl mx-auto">
      <p
        class="text-[11px] font-bold text-text-secondary uppercase tracking-[0.25em] mb-6"
      >
        What you're replacing
      </p>
      <div class="grid md:grid-cols-2 gap-px bg-border/30">
        <!-- Before -->
        <div class="bg-bg-primary">
          <div class="px-5 py-3 border-b border-border/30">
            <span class="text-[11px] font-mono text-red-400/70"
              >checkout.ts — without owostack</span
            >
          </div>
          <div
            class="p-6 font-mono text-[11px] md:text-xs leading-[1.9] overflow-x-auto text-text-dim max-h-[600px] overflow-y-auto"
          >
            <pre><span class="text-text-secondary italic"
                >// Subscribe a customer</span
              >
<span class="text-error/60">const</span> txn = <span class="text-error/60"
                >await</span
              > paystack.transaction
  .initialize(&#123;
  email: customer.email,
  amount: plan.price * 100,
  plan: plan.paystackPlanCode,
  metadata: &#123; customerId: customer.id &#125;,
&#125;);

<span class="text-text-secondary italic">// Handle upgrade proration</span>
<span class="text-error/60">const</span> sub = <span class="text-error/60"
                >await</span
              > paystack.subscription.fetch(code);
<span class="text-error/60">const</span
              > remaining = daysUntil(sub.next_payment_date);
<span class="text-error/60">const</span> credit = (sub.amount / 30) * remaining;
<span class="text-error/60">const</span> prorated = newPlan.price - credit;

<span class="text-text-secondary italic">// Gate a feature</span>
<span class="text-error/60">const</span> sub = <span class="text-error/60"
                >await</span
              > db.subscriptions
  .findFirst(&#123;
  where: &#123; 
    customerId, 
    status: <span class="text-warning/50">"active"</span> 
  &#125;
&#125;);
<span class="text-error/60">const</span> plan = <span class="text-error/60"
                >await</span
              > db.plans
  .findFirst(&#123;
  where: &#123; id: sub.planId &#125;,
  include: &#123; features: true &#125;,
&#125;);
<span class="text-error/60">const</span> allowed = plan.features
  .some(
  f => f.slug === <span class="text-warning/50">"gpu-inference"</span>
);

<span class="text-text-secondary italic">// Track usage</span>
<span class="text-error/60">const</span> usage = <span class="text-error/60"
                >await</span
              > db.usageRecords
  .findFirst(&#123;
  where: &#123; customerId, featureId, period &#125;
&#125;);
<span class="text-error/60">if</span> (usage.consumed >= usage.limit) &#123;
  <span class="text-error/60">throw new</span> Error(<span
                class="text-warning/50">"Limit exceeded"</span
              >);
&#125;
<span class="text-error/60">await</span> db.usageRecords.update(&#123;
  where: &#123; id: usage.id &#125;,
  data: &#123; 
    consumed: usage.consumed + 1 
  &#125;,
&#125;);

<span class="text-text-secondary italic"
                >// ─── webhooks.ts ───────────────────────</span
              >

<span class="text-text-secondary italic">// Verify webhook signature</span>
<span class="text-error/60">const</span> hash = crypto
  .createHmac(<span class="text-warning/50">"sha512"</span>, secret)
  .update(JSON.stringify(req.body))
  .digest(<span class="text-warning/50">"hex"</span>);
<span class="text-error/60">if</span> (hash !== req.headers[
  <span class="text-warning/50">"x-paystack-signature"</span>
]) &#123;
  <span class="text-error/60">throw new</span> Error(<span
                class="text-warning/50">"Invalid signature"</span
              >);
&#125;

<span class="text-text-secondary italic">// Route webhook events</span>
<span class="text-error/60">const</span> event = req.body;
<span class="text-error/60">switch</span> (event.event) &#123;
  <span class="text-error/60">case</span> <span class="text-warning/50"
                >"subscription.create"</span
              >:
    <span class="text-error/60">const</span> customer = <span
                class="text-error/60">await</span
              > db.customers
      .upsert(&#123;
      where: &#123; email: event.data.customer.email &#125;,
      create: &#123;
        email: event.data.customer.email,
        paystackCustomerId: event.data.customer.id,
        paystackAuthCode: 
          event.data.authorization
            .authorization_code,
      &#125;,
      update: &#123;
        paystackAuthCode: 
          event.data.authorization
            .authorization_code,
      &#125;,
    &#125;);
    <span class="text-error/60">const</span> plan = <span class="text-error/60"
                >await</span
              > db.plans
      .findFirst(&#123;
      where: &#123; 
        paystackPlanCode: 
          event.data.plan.plan_code 
      &#125;,
    &#125;);
    <span class="text-error/60">await</span> db.subscriptions.create(&#123;
      data: &#123;
        customerId: customer.id,
        planId: plan.id,
        status: <span class="text-warning/50">"active"</span>,
        paystackSubCode: 
          event.data.subscription_code,
        currentPeriodStart: <span class="text-error/60">new</span> Date(),
        currentPeriodEnd: 
          <span class="text-error/60">new</span> Date(
            event.data.next_payment_date
          ),
      &#125;,
    &#125;);
    <span class="text-error/60">break</span>;

  <span class="text-error/60">case</span> <span class="text-warning/50"
                >"subscription.not_renew"</span
              >:
    <span class="text-error/60">await</span> db.subscriptions.update(&#123;
      where: &#123; 
        paystackSubCode: 
          event.data.subscription_code 
      &#125;,
      data: &#123;
        status: <span class="text-warning/50">"pending_cancel"</span>,
        cancelAt: 
          <span class="text-error/60">new</span> Date(
            event.data.next_payment_date
          ),
      &#125;,
    &#125;);
    <span class="text-error/60">break</span>;

  <span class="text-error/60">case</span> <span class="text-warning/50"
                >"charge.success"</span
              >:
    <span class="text-error/60">const</span> meta = event.data.metadata;
    <span class="text-error/60">if</span> (meta?.type === <span
                class="text-warning/50">"credit_purchase"</span
              >) &#123;
      <span class="text-error/60">const</span> credits = parseInt(meta.credits);
      <span class="text-error/60">await</span> db.$executeRaw`
        UPDATE customers
        SET credit_balance = 
          credit_balance + $&#123;credits&#125;
        WHERE id = $&#123;meta.customerId&#125;
      `;
    &#125; <span class="text-error/60">else</span> &#123;
      <span class="text-error/60">await</span> db.payments.create(&#123;
        data: &#123;
          customerId: meta.customerId,
          amount: event.data.amount,
          reference: event.data.reference,
          status: <span class="text-warning/50">"success"</span>,
        &#125;,
      &#125;);
    &#125;
    <span class="text-error/60">break</span>;

  <span class="text-error/60">case</span> <span class="text-warning/50"
                >"invoice.payment_failed"</span
              >:
    <span class="text-error/60">await</span> db.subscriptions.update(&#123;
      where: &#123; 
        paystackSubCode: 
          event.data.subscription_code 
      &#125;,
      data: &#123; status: <span class="text-warning/50">"past_due"</span
              > &#125;,
    &#125;);
    <span class="text-error/60">await</span> sendEmail(&#123;
      to: event.data.customer.email,
      template: <span class="text-warning/50">"payment_failed"</span>,
    &#125;);
    <span class="text-error/60">break</span>;
&#125;

<span class="text-text-secondary italic"
                >// Don't forget to handle: trial expiry, </span>
<span class="text-text-secondary italic"
                >// plan switches, refunds, disputes, </span>
<span class="text-text-secondary italic">// card updates, idempotency, </span>
<span class="text-text-secondary italic">// race conditions...</span></pre>
          </div>
        </div>

        <!-- After -->
        <div class="bg-bg-secondary/40 hidden md:block">
          <div class="px-5 py-3 border-b border-border/30">
            <span class="text-[11px] font-mono text-accent"
              >billing.ts — with owostack</span
            >
          </div>
          <div
            class="p-6 font-mono text-[11px] md:text-xs leading-[1.9] overflow-x-auto"
          >
            <pre><span class="text-text-secondary italic"
                >// Subscribe (or upgrade/downgrade)</span
              >
<span class="text-accent font-medium">await</span> owo.<span class="text-white"
                >attach</span
              >(&#123;
  customer: <span class="text-amber-400">"user@acme.com"</span>,
  product:  <span class="text-amber-400">"pro"</span>,
&#125;);

<span class="text-text-secondary italic">// Gate a feature</span>
<span class="text-accent font-medium">const</span> &#123; allowed &#125; = <span
                class="text-accent font-medium">await</span
              > owo.<span class="text-white">check</span>(&#123;
  customer: <span class="text-amber-400">"user@acme.com"</span>,
  feature:  <span class="text-amber-400">"gpu-inference"</span>,
&#125;);

<span class="text-text-secondary italic"
                >// Track usage (atomic, no race conditions)</span
              >
<span class="text-accent font-medium">await</span> owo.<span class="text-white"
                >track</span
              >(&#123;
  customer: <span class="text-amber-400">"user@acme.com"</span>,
  feature:  <span class="text-amber-400">"gpu-inference"</span>,
&#125;);

<span class="text-text-secondary italic"
                >// ─── webhooks? ─────────────we don't do that here────</span
              >
<span class="text-text-secondary italic">// Signature verification ✓</span>
<span class="text-text-secondary italic">// Subscription lifecycle ✓</span>
<span class="text-text-secondary italic">// Payment reconciliation ✓</span>
<span class="text-text-secondary italic">// Team seats ✓</span>
<span class="text-text-secondary italic"
                >// Credit card (or no) free trials ✓</span
              >
<span class="text-text-secondary italic">// Credit purchases ✓</span>
<span class="text-text-secondary italic">// Add-on plans ✓</span>
<span class="text-text-secondary italic">// Overages ✓</span>
<span class="text-accent italic font-medium">// All handled.</span></pre>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Billing Patterns - Interactive Demo -->
  <section class="px-6 py-20 md:py-32 relative bg-bg-secondary/30 overflow-hidden">
    <div class="max-w-6xl mx-auto relative z-10">
      <div class="text-center mb-16">
        <h2 class="text-2xl md:text-4xl font-bold text-text-primary mb-4">
          Built for the way AI get billed
        </h2>
        <p class="text-text-secondary max-w-lg mx-auto text-sm">
          Real-time metering, subscription management, and invoicing—all handled by one simple SDK.
        </p>
      </div>

      <div class="flex justify-center">
        <InteractiveDemo />
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="px-6 py-8 border-t border-border/30">
    <div
      class="max-w-4xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4"
    >
      <span class="text-xs text-text-secondary"
        >A product of The Thirdpen Company</span
      >
      <div class="flex items-center gap-6 text-xs text-text-secondary">
        <a href="/docs" class="hover:text-text-primary transition-colors"
          >Docs</a
        >
        <a
          href="https://github.com/Abdulmumin1/owostack"
          class="hover:text-text-primary transition-colors">GitHub</a
        >
      </div>
    </div>
  </footer>
</div>

<style>
  /* Shimmer Effects for Provider Names */
  .shimmer-paystack,
  .shimmer-stripe,
  .shimmer-dodo {
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: shimmer 3s ease-in-out infinite;
    font-weight: 600;
  }

  .shimmer-paystack {
    background-image: linear-gradient(
      120deg,
      #00c3f7 0%,
      #ffffff 40%,
      #00c3f7 50%,
      #ffffff 60%,
      #00c3f7 100%
    );
  }

  .shimmer-stripe {
    background-image: linear-gradient(
      120deg,
      #635bff 0%,
      #ffffff 40%,
      #635bff 50%,
      #ffffff 60%,
      #635bff 100%
    );
  }

  .shimmer-dodo {
    background-image: linear-gradient(
      120deg,
      #3af900 0%,
      #ffffff 40%,
      #4dff5c 50%,
      #ffffff 60%,
      #84ff62 100%
    );
  }

  @keyframes shimmer {
    0% {
      background-position: 100% 50%;
    }
    50% {
      background-position: 0% 50%;
    }
    100% {
      background-position: 100% 50%;
    }
  }

  @keyframes flowRight {
    0% {
      transform: translateX(-50px) translateY(-50%);
      opacity: 0;
    }
    20% {
      opacity: 1;
    }
    80% {
      opacity: 1;
    }
    100% {
      transform: translateX(150px) translateY(-50%);
      opacity: 0;
    }
  }

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

  .orb-2 {
    width: 500px;
    height: 500px;
    background: radial-gradient(
      circle,
      var(--color-secondary) 0%,
      transparent 70%
    );
    bottom: 10%;
    left: -150px;
    animation-delay: -7s;
    opacity: 0.3;
  }

  .orb-3 {
    width: 400px;
    height: 400px;
    background: radial-gradient(
      circle,
      var(--color-tertiary) 0%,
      transparent 70%
    );
    top: 40%;
    right: 10%;
    animation-delay: -14s;
    opacity: 0.25;
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

  /* ── Bento Grid: Fading Lines Layout ── */

  .bento-grid {
    display: flex;
    flex-direction: column;
  }

  .bento-row {
    display: flex;
    flex-direction: column;
    position: relative;
  }

  @media (min-width: 768px) {
    .bento-row {
      flex-direction: row;
    }
  }

  /* Bottom border on rows — fades at both ends */
  .bento-row::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 5%;
    right: 5%;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      var(--color-border) 15%,
      var(--color-border) 85%,
      transparent
    );
  }

  .bento-row:last-child::after {
    display: none;
  }

  .bento-cell {
    padding: 2.5rem 2rem;
    position: relative;
  }

  /* Vertical divider between cells — fades at top and bottom */
  @media (min-width: 768px) {
    .bento-cell + .bento-cell::before {
      content: "";
      position: absolute;
      left: 0;
      top: 10%;
      bottom: 10%;
      width: 1px;
      background: linear-gradient(
        180deg,
        transparent,
        var(--color-border) 20%,
        var(--color-border) 80%,
        transparent
      );
    }
  }

  /* Mobile: horizontal divider between stacked cells */
  @media (max-width: 767px) {
    .bento-cell + .bento-cell::before {
      content: "";
      position: absolute;
      top: 0;
      left: 10%;
      right: 10%;
      height: 1px;
      background: linear-gradient(
        90deg,
        transparent,
        var(--color-border) 20%,
        var(--color-border) 80%,
        transparent
      );
    }
  }

  .bento-cell-wide {
    flex: 7;
    min-width: 0;
  }

  .bento-cell-narrow {
    flex: 5;
    min-width: 0;
  }

  .bento-cell-full {
    flex: 1;
    min-width: 0;
  }

  /* Typography */
  .bento-title {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: -0.02em;
  }

  .bento-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    display: block;
  }

  /* Tags */
  .bento-tag {
    font-size: 10px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 4px;
    font-family: var(--font-mono);
    color: var(--color-text-dim);
    border: 1px solid var(--color-border);
    background: transparent;
  }

  /* Badge */
  .bento-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 3px 8px;
    background: var(--color-accent);
    color: white;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* Token Meter */
  .bento-meter {
    height: 44px;
    background: transparent;
    border-radius: 0.5rem;
    padding: 6px;
    border: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .bento-meter-fill {
    flex: 1;
    height: 100%;
    max-width: 70%;
    background: linear-gradient(
      90deg,
      var(--color-secondary),
      var(--color-accent)
    );
    border-radius: 0.35rem;
    position: relative;
    overflow: hidden;
  }

  .bento-meter-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 255, 255, 0.25),
      transparent
    );
    animation: meterShimmer 2.5s infinite;
  }

  @keyframes meterShimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }

  .bento-meter-label {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--color-text-primary);
    padding-right: 6px;
    font-family: var(--font-mono);
  }

  .bento-meter-label span {
    font-size: 9px;
    color: var(--color-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* GPU Bars */
  .bento-bars {
    display: flex;
    align-items: flex-end;
    gap: 5px;
    height: 64px;
    margin: 12px 0;
  }

  .bento-bar {
    flex: 1;
    background: var(--color-border);
    border-radius: 3px 3px 0 0;
    opacity: 0.4;
  }

  .bento-bar-active {
    background: var(--color-accent);
    opacity: 0.7;
    position: relative;
  }

  .bento-bar-indicator {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--color-accent);
    border-radius: 3px 3px 0 0;
  }

  /* Stats */
  .bento-stats {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding-top: 12px;
    margin-top: 4px;
    border-top: 1px solid var(--color-border);
  }

  .bento-stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--color-text-primary);
    font-family: var(--font-mono);
  }

  .bento-stat-accent {
    font-size: 1.1rem;
    color: var(--color-accent);
  }

  .bento-stat-label {
    font-size: 9px;
    color: var(--color-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* Price Card */
  .bento-price-card {
    color: var(--color-text-primary);
    padding: 12px;
    border-radius: 0.5rem;
    border: 1px solid var(--color-border);
    transform: rotate(-2deg);
    position: relative;
  }

  .bento-price-label {
    display: block;
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-dim);
    margin-bottom: 2px;
  }

  .bento-price-value {
    font-size: 1.5rem;
    font-weight: 700;
    font-family: var(--font-mono);
  }

  .bento-price-value span {
    font-size: 0.75rem;
    color: var(--color-text-dim);
  }

  /* Tiers */
  .bento-tier {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text-secondary);
    font-size: 13px;
    transition: border-color 0.2s ease;
    background: transparent;
  }

  .bento-tier:hover {
    border-color: var(--color-text-dim);
  }

  .bento-tier-active {
    background: var(--color-text-primary);
    color: var(--color-bg-primary);
    border-color: var(--color-text-primary);
    font-weight: 600;
  }

  .bento-tier-dot {
    width: 6px;
    height: 6px;
    background: var(--color-accent);
    border-radius: 50%;
  }

  .bento-tier-custom {
    font-size: 9px;
    font-weight: 700;
    border: 1px solid var(--color-border);
    padding: 2px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }

  /* Team Constellation */
  .bento-orbit {
    position: absolute;
    border: 1px dashed var(--color-border);
    border-radius: 50%;
  }

  .bento-orbit-outer {
    width: 200px;
    height: 200px;
    opacity: 0.6;
  }

  .bento-orbit-inner {
    width: 130px;
    height: 130px;
    opacity: 0.4;
  }

  .bento-org-center {
    position: relative;
    width: 48px;
    height: 48px;
    background: var(--color-accent);
    border: 2px solid var(--color-bg-primary);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 0.05em;
    z-index: 20;
  }

  .bento-connection {
    position: absolute;
    width: 60px;
    height: 1px;
    background: linear-gradient(90deg, var(--color-border), transparent);
    transform-origin: left center;
    left: 50%;
  }

  .bento-seat {
    position: absolute;
    width: 32px;
    height: 32px;
    background: var(--color-bg-primary);
    border: 1px solid var(--color-border);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-secondary);
    font-size: 9px;
    font-weight: 700;
  }

  .bento-seat-1 {
    top: 12px;
    right: 50px;
  }
  .bento-seat-2 {
    bottom: 50px;
    right: 24px;
  }
  .bento-seat-3 {
    top: 50%;
    left: 12px;
    transform: translateY(-50%);
    width: 36px;
    height: 36px;
  }
  .bento-seat-4 {
    bottom: 12px;
    left: 60px;
    width: 36px;
    height: 36px;
  }
</style>
