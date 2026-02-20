<script lang="ts">
  import { ArrowRight, Coins, CreditCard, GithubLogo, Lightning, Lock, Users } from "phosphor-svelte";
  import Logo from "$lib/components/ui/Logo.svelte";
  import { onMount, tick } from "svelte";

  const phrases: { text: string; icons: typeof CreditCard[] }[] = [
    { text: "subscriptions", icons: [CreditCard] },
    { text: "feature gating", icons: [Lock] },
    { text: "usage metering", icons: [Coins] },
    { text: "team seats", icons: [Users] },
    { text: "subscriptions + feature gating", icons: [CreditCard, Lock] },
    { text: "usage metering + team seats", icons: [Coins, Users] },
    { text: "subscriptions + metering + overage", icons: [CreditCard, Coins, Lightning] },
  ];

  let currentIndex = 0;
  let visible = true;
  let containerWidth = 0;
  let innerEl: HTMLSpanElement;
  let interval: ReturnType<typeof setInterval>;

  async function measureCurrent() {
    await tick();
    requestAnimationFrame(() => {
      if (innerEl) containerWidth = innerEl.scrollWidth;
    });
  }

  onMount(() => {
    measureCurrent();
    interval = setInterval(async () => {
      visible = false;
      const nextIndex = (currentIndex + 1) % phrases.length;
      setTimeout(async () => {
        currentIndex = nextIndex;
        await measureCurrent();
        visible = true;
      }, 400);
    }, 2400);
    return () => clearInterval(interval);
  });
</script>

<svelte:head>
  <title>Owostack — Billing Infrastructure for AI SaaS</title>
</svelte:head>

<div class="min-h-screen bg-bg-primary text-text-primary font-sans selection:bg-accent/30">

  <!-- Header -->
  <header class="px-6 py-5">
    <div class="max-w-4xl mx-auto flex items-center justify-between">
      <a href="/" class="flex items-center gap-2">
        <Logo size={24} class="text-accent"  weight="duotone" />
        <span class="text-sm font-bold tracking-tight">Owostack</span>
      </a>
      <nav class="flex items-center gap-6 text-xs text-text-secondary">
        <a href="/docs" class="hidden sm:inline hover:text-text-primary transition-colors">Docs</a>
        <a href="https://github.com/Abdulmumin1/owostack" class="hidden sm:flex items-center gap-1.5 hover:text-text-primary transition-colors">
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
      <div class="text-[11px] font-bold text-text-secondary flex gap-2 uppercase tracking-[0.25em] mb-8">
        <div class="w-4 h-4 bg-[#F26522] flex items-center justify-center rounded-xs"><span class="text-white text-[10px] font-bold font-sans">Y</span></div>
Not backed by Y Combinator</div>
      <h1 class="text-4xl md:text-6xl font-bold leading-[1.08] tracking-tight mb-6">
        Three API calls.<br />
        <span class="text-text-secondary">That's your entire billing layer.</span>
      </h1>
      <div class="text-base md:text-lg text-text-secondary max-w-xl leading-relaxed mb-10">
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
        <a href="/docs" class="btn btn-secondary btn-lg">
          Read the docs
          <ArrowRight size={14} class="group-hover:translate-x-0.5 transition-transform" weight="fill" />
        </a>
      </div>
    </div>
  </section>

  <!-- Code -->
  <section class="px-6 pb-28 md:pb-36">
    <div class="max-w-4xl mx-auto">
      <div class="table-container bg-bg-secondary/40">
        <div class="flex items-center px-5 py-3 border-b border-border/40">
          <span class="text-[11px] font-mono text-text-secondary">billing.ts</span>
        </div>
        <div class="p-6 md:p-8 font-mono text-[13px] md:text-sm leading-[1.8] overflow-x-auto">
          <pre class="text-text-secondary"><span class="text-text-secondary italic">// Subscribe a customer to a plan</span>
<span class="text-accent font-medium">await</span> owo.<span class="text-white">attach</span>(&#123;
  customer: <span class="text-amber-400">"user@acme.com"</span>,
  product:  <span class="text-amber-400">"pro"</span>,
&#125;);

<span class="text-text-secondary italic">// Check if they can use a feature</span>
<span class="text-accent font-medium">const</span> &#123; allowed &#125; = <span class="text-accent font-medium">await</span> owo.<span class="text-white">check</span>(&#123;
  customer: <span class="text-amber-400">"user@acme.com"</span>,
  feature:  <span class="text-amber-400">"gpu-inference"</span>,
&#125;);

<span class="text-text-secondary italic">// Record usage</span>
<span class="text-accent font-medium">await</span> owo.<span class="text-white">track</span>(&#123;
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
      <p class="text-[11px] font-bold text-text-secondary uppercase tracking-[0.25em] mb-6">What you're replacing</p>
      <div class="grid md:grid-cols-2 gap-px bg-border/30">

        <!-- Before -->
        <div class="bg-bg-primary">
          <div class="px-5 py-3 border-b border-border/30">
            <span class="text-[11px] font-mono text-red-400/70">checkout.ts — without owostack</span>
          </div>
          <div class="p-6 font-mono text-[11px] md:text-xs leading-[1.9] overflow-x-auto text-text-dim max-h-[600px] overflow-y-auto">
<pre><span class="text-text-secondary italic">// Subscribe a customer</span>
<span class="text-error/60">const</span> txn = <span class="text-error/60">await</span> paystack.transaction
  .initialize(&#123;
  email: customer.email,
  amount: plan.price * 100,
  plan: plan.paystackPlanCode,
  metadata: &#123; customerId: customer.id &#125;,
&#125;);

<span class="text-text-secondary italic">// Handle upgrade proration</span>
<span class="text-error/60">const</span> sub = <span class="text-error/60">await</span> paystack.subscription.fetch(code);
<span class="text-error/60">const</span> remaining = daysUntil(sub.next_payment_date);
<span class="text-error/60">const</span> credit = (sub.amount / 30) * remaining;
<span class="text-error/60">const</span> prorated = newPlan.price - credit;

<span class="text-text-secondary italic">// Gate a feature</span>
<span class="text-error/60">const</span> sub = <span class="text-error/60">await</span> db.subscriptions
  .findFirst(&#123;
  where: &#123; 
    customerId, 
    status: <span class="text-warning/50">"active"</span> 
  &#125;
&#125;);
<span class="text-error/60">const</span> plan = <span class="text-error/60">await</span> db.plans
  .findFirst(&#123;
  where: &#123; id: sub.planId &#125;,
  include: &#123; features: true &#125;,
&#125;);
<span class="text-error/60">const</span> allowed = plan.features
  .some(
  f => f.slug === <span class="text-warning/50">"gpu-inference"</span>
);

<span class="text-text-secondary italic">// Track usage</span>
<span class="text-error/60">const</span> usage = <span class="text-error/60">await</span> db.usageRecords
  .findFirst(&#123;
  where: &#123; customerId, featureId, period &#125;
&#125;);
<span class="text-error/60">if</span> (usage.consumed >= usage.limit) &#123;
  <span class="text-error/60">throw new</span> Error(<span class="text-warning/50">"Limit exceeded"</span>);
&#125;
<span class="text-error/60">await</span> db.usageRecords.update(&#123;
  where: &#123; id: usage.id &#125;,
  data: &#123; 
    consumed: usage.consumed + 1 
  &#125;,
&#125;);

<span class="text-text-secondary italic">// ─── webhooks.ts ───────────────────────</span>

<span class="text-text-secondary italic">// Verify webhook signature</span>
<span class="text-error/60">const</span> hash = crypto
  .createHmac(<span class="text-warning/50">"sha512"</span>, secret)
  .update(JSON.stringify(req.body))
  .digest(<span class="text-warning/50">"hex"</span>);
<span class="text-error/60">if</span> (hash !== req.headers[
  <span class="text-warning/50">"x-paystack-signature"</span>
]) &#123;
  <span class="text-error/60">throw new</span> Error(<span class="text-warning/50">"Invalid signature"</span>);
&#125;

<span class="text-text-secondary italic">// Route webhook events</span>
<span class="text-error/60">const</span> event = req.body;
<span class="text-error/60">switch</span> (event.event) &#123;
  <span class="text-error/60">case</span> <span class="text-warning/50">"subscription.create"</span>:
    <span class="text-error/60">const</span> customer = <span class="text-error/60">await</span> db.customers
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
    <span class="text-error/60">const</span> plan = <span class="text-error/60">await</span> db.plans
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

  <span class="text-error/60">case</span> <span class="text-warning/50">"subscription.not_renew"</span>:
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

  <span class="text-error/60">case</span> <span class="text-warning/50">"charge.success"</span>:
    <span class="text-error/60">const</span> meta = event.data.metadata;
    <span class="text-error/60">if</span> (meta?.type === <span class="text-warning/50">"credit_purchase"</span>) &#123;
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

  <span class="text-error/60">case</span> <span class="text-warning/50">"invoice.payment_failed"</span>:
    <span class="text-error/60">await</span> db.subscriptions.update(&#123;
      where: &#123; 
        paystackSubCode: 
          event.data.subscription_code 
      &#125;,
      data: &#123; status: <span class="text-warning/50">"past_due"</span> &#125;,
    &#125;);
    <span class="text-error/60">await</span> sendEmail(&#123;
      to: event.data.customer.email,
      template: <span class="text-warning/50">"payment_failed"</span>,
    &#125;);
    <span class="text-error/60">break</span>;
&#125;

<span class="text-text-secondary italic">// Don't forget to handle: trial expiry, </span>
<span class="text-text-secondary italic">// plan switches, refunds, disputes, </span>
<span class="text-text-secondary italic">// card updates, idempotency, </span>
<span class="text-text-secondary italic">// race conditions...</span></pre>
          </div>
        </div>

        <!-- After -->
        <div class="bg-bg-secondary/40 hidden md:block">
          <div class="px-5 py-3 border-b border-border/30">
            <span class="text-[11px] font-mono text-accent">billing.ts — with owostack</span>
          </div>
          <div class="p-6 font-mono text-[11px] md:text-xs leading-[1.9] overflow-x-auto">
<pre><span class="text-text-secondary italic">// Subscribe (or upgrade/downgrade)</span>
<span class="text-accent font-medium">await</span> owo.<span class="text-white">attach</span>(&#123;
  customer: <span class="text-amber-400">"user@acme.com"</span>,
  product:  <span class="text-amber-400">"pro"</span>,
&#125;);

<span class="text-text-secondary italic">// Gate a feature</span>
<span class="text-accent font-medium">const</span> &#123; allowed &#125; = <span class="text-accent font-medium">await</span> owo.<span class="text-white">check</span>(&#123;
  customer: <span class="text-amber-400">"user@acme.com"</span>,
  feature:  <span class="text-amber-400">"gpu-inference"</span>,
&#125;);

<span class="text-text-secondary italic">// Track usage (atomic, no race conditions)</span>
<span class="text-accent font-medium">await</span> owo.<span class="text-white">track</span>(&#123;
  customer: <span class="text-amber-400">"user@acme.com"</span>,
  feature:  <span class="text-amber-400">"gpu-inference"</span>,
&#125;);

<span class="text-text-secondary italic">// ─── webhooks? ─────────────we don't do that here────</span>
<span class="text-text-secondary italic">// Signature verification ✓</span>
<span class="text-text-secondary italic">// Subscription lifecycle ✓</span>
<span class="text-text-secondary italic">// Payment reconciliation ✓</span>
<span class="text-text-secondary italic">// Team seats ✓</span>
<span class="text-text-secondary italic">// Credit card (or no) free trials ✓</span>
<span class="text-text-secondary italic">// Credit purchases ✓</span>
<span class="text-text-secondary italic">// Add-on plans ✓</span>
<span class="text-text-secondary italic">// Overages ✓</span>
<span class="text-accent italic font-medium">// All handled.</span></pre>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- Value props — single row, text only -->
  <section class="px-6 pb-28 md:pb-36">
    <div class="max-w-4xl mx-auto grid sm:grid-cols-3 gap-12 md:gap-16">
      <div>
        <h3 class="text-sm font-bold text-text-primary mb-3">Provider-agnostic</h3>
        <p class="text-sm text-text-secondary leading-relaxed">
          Write billing logic once. Use Multiple providers <span class="shimmer-paystack">Paystack</span>, <span class="shimmer-stripe">Stripe</span>, <span class="shimmer-dodo">Dodo</span>, or any other for different regions.
        </p>
      </div>
      <div>
        <h3 class="text-sm font-bold text-text-primary mb-3">Real-time metering</h3>
        <p class="text-sm text-text-secondary leading-relaxed">
          Track usage with atomic precision via <span class="text-white font-medium">Durable Objects</span>. Credits, quotas, and overage — zero race conditions.
        </p>
      </div>
      <div>
        <h3 class="text-sm font-bold text-text-primary mb-3">Feature gating</h3>
        <p class="text-sm text-text-secondary leading-relaxed">
          Entitlement-based access control. Ask if the customer <em>has the feature</em>, not what plan they're on.
        </p>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="px-6 py-8 border-t border-border/30">
    <div class="max-w-4xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
      <span class="text-xs text-text-secondary">A product of The Thirdpen Company</span>
      <div class="flex items-center gap-6 text-xs text-text-secondary">
        <a href="/docs" class="hover:text-text-primary transition-colors">Docs</a>
        <a href="https://github.com/Abdulmumin1/owostack" class="hover:text-text-primary transition-colors">GitHub</a>
      </div>
    </div>
  </footer>
</div>

<style>
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
    background-image: linear-gradient(120deg, #00C3F7 0%, #ffffff 40%, #00C3F7 50%, #ffffff 60%, #00C3F7 100%);
  }

  .shimmer-stripe {
    background-image: linear-gradient(120deg, #635BFF 0%, #ffffff 40%, #635BFF 50%, #ffffff 60%, #635BFF 100%);
  }

  .shimmer-dodo {
    background-image: linear-gradient(120deg, #3af900 0%, #ffffff 40%, #4dff5c 50%, #ffffff 60%, #84ff62 100%);
  }

  @keyframes shimmer {
    0% { background-position: 100% 50%; }
    50% { background-position: 0% 50%; }
    100% { background-position: 100% 50%; }
  }
</style>