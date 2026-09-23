<script lang="ts">
  // FAQ — native <details> for accessibility, numbered like a spec.
  const faqs = [
    {
      q: "Do I really not need webhooks?",
      a: "No. attach(), check() and track() read from Owostack, which already holds the customer's plan, balance and usage. Provider webhooks land on our side.",
    },
    {
      q: "Which payment providers are supported?",
      a: "Paystack, Stripe, Dodo Payments and Bachs. Pick one per organisation or region; your code stays the same.",
    },
    {
      q: "What happens when a customer runs out of credits?",
      a: "check() returns allowed: false, or, if the feature has overage, usage keeps flowing and we bill the difference. Add-on packs can top up mid-cycle.",
    },
    {
      q: "Can I mix subscriptions with usage-based billing?",
      a: "Yes, on one plan: recurring price, metered limits, boolean features, seats and overage together.",
    },
    {
      q: "How fast is check()?",
      a: "~175 ms average from a Cloudflare Worker. Built to sit in your request path.",
    },
    {
      q: "Is it open source? Can I self-host?",
      a: "Yes. Apache-2.0, built on Cloudflare Workers, Durable Objects, Workflows and D1. Runs on the free Workers plan.",
    },
    {
      q: "Is there a free tier?",
      a: "Yes. Free to start, no card.",
    },
    {
      q: "What if I want to leave?",
      a: "Plans live in a config file in your repo, data is exportable, code is open source.",
    },
  ];
</script>

<section class="relative bg-bg-secondary py-24 md:py-32">
  <div class="mx-auto max-w-6xl px-6">
    <div class="grid gap-12 lg:grid-cols-12 lg:gap-16">
      <div class="lg:col-span-4">
        <p class="eyebrow mb-6">Questions</p>
        <h2 class="font-display text-display-md text-balance text-text-primary">
          The things people ask before they switch.
        </h2>
        <p class="mt-5 text-base leading-relaxed text-text-secondary text-pretty">
          Something we missed?
          <a href="/talk-to-founder" class="link">Talk to the founder</a>, a human
          answers.
        </p>
      </div>

      <div class="lg:col-span-8">
        <div class="divide-y divide-border/70 border-y border-border/70">
          {#each faqs as faq, i (faq.q)}
            <details class="group">
              <summary
                class="flex cursor-pointer list-none items-start gap-5 py-5 text-left [&::-webkit-details-marker]:hidden"
              >
                <span class="mt-0.5 font-mono text-2xs text-text-dim">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span class="flex-1 font-display text-title text-text-primary">
                  {faq.q}
                </span>
                <span
                  class="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-text-muted transition-transform group-open:rotate-45"
                  aria-hidden="true"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                </span>
              </summary>
              <div class="pb-6 pl-10 pr-10 text-base leading-relaxed text-text-secondary text-pretty">
                {faq.a}
              </div>
            </details>
          {/each}
        </div>
      </div>
    </div>
  </div>
</section>
