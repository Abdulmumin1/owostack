<script lang="ts">
  import { ArrowRight, Check } from "phosphor-svelte";

  const points = [
    "Free to start, no card",
    "Three calls: attach, check, track",
    "No webhooks to maintain",
    "Paystack, Stripe, Dodo or Bachs",
  ];
</script>

<section class="on-ink relative overflow-hidden py-28 md:py-40">
  <!-- big faint mark -->
  <div
    class="pointer-events-none absolute -bottom-24 right-[-6%] select-none font-display text-[22vw] leading-none text-on-ink/[0.04]"
    aria-hidden="true"
  >
    owo
  </div>

  <div class="relative mx-auto max-w-6xl px-6">
    <div class="max-w-3xl">
      <h2 class="font-display text-display-xl text-balance text-on-ink">
        Billing is not your product.<br />
        <span class="text-on-ink-faint">Ship the thing that is.</span>
      </h2>

      <div class="mt-10 flex flex-wrap items-center gap-3">
        <a href="https://app.owostack.com" class="btn btn-primary btn-lg">
          Start free
          <ArrowRight size={14} weight="bold" />
        </a>
        <a href="/talk-to-founder" class="btn btn-secondary btn-lg">Talk to the founder</a>
      </div>

      <ul class="mt-12 grid gap-3 sm:grid-cols-2">
        {#each points as point (point)}
          <li class="flex items-center gap-2.5 text-sm text-on-ink-muted">
            <span class="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-contrast">
              <Check size={10} weight="bold" />
            </span>
            {point}
          </li>
        {/each}
      </ul>
    </div>
  </div>
</section>
