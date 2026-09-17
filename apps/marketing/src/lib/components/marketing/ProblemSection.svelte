<script lang="ts">
  const changes = [
    "added a new model tier",
    "changed what a credit costs",
    "launched team plans",
    "gave someone a top-up",
    "moved to weekly resets",
    "added overage on Pro",
    "switched provider for one region",
    "made a feature Pro-only",
    "refunded a double charge",
    "shipped a free trial",
  ];

  // Pixel bars: what a hand-rolled billing codebase looks like over time.
  const bars = [22, 30, 41, 34, 48, 56, 45, 62, 74, 66, 75, 88, 71, 93, 100];
</script>

<section class="relative overflow-hidden bg-bg-secondary/40 pt-24 md:pt-32">
  <div class="mx-auto max-w-6xl px-6">
    <div class="grid items-end gap-12 lg:grid-cols-12">
      <div class="lg:col-span-7">
        <p class="eyebrow mb-6">Sound familiar?</p>
        <h2 class="font-display text-display-lg text-balance text-text-primary">
          This week you shipped a feature.<br />
          <span class="text-text-muted">Your billing code didn't notice.</span>
        </h2>
      </div>

      <!-- bar chart: lines of billing glue over time -->
      <div class="lg:col-span-5">
        <div class="flex h-40 items-end gap-1.5" aria-hidden="true">
          {#each bars as h, i (i)}
            <div class="relative flex-1 bg-border-strong" style={`height: ${h}%`}>
              <div class="dither absolute inset-x-0 bottom-0 h-[40%]" style="--dither-color: var(--color-bg-secondary)"></div>
            </div>
          {/each}
        </div>
        <div class="mt-3 flex justify-between font-mono text-2xs uppercase tracking-[0.08em] text-text-dim">
          <span>lines of billing glue</span>
          <span>month 15</span>
        </div>
      </div>
    </div>
  </div>

  <div class="ticker-mask relative mt-16 border-y border-border/70 bg-bg-primary py-5 md:mt-20">
    <div class="ticker-track flex w-max gap-12 whitespace-nowrap" style="--ticker-duration: 55s">
      {#each [...changes, ...changes] as change, i (i)}
        <span class="flex items-center gap-12 font-display text-2xl text-text-primary md:text-3xl">
          <span><span class="text-text-dim">you&nbsp;</span>{change}.</span>
          <span class="dither h-3 w-3 shrink-0" aria-hidden="true"></span>
        </span>
      {/each}
    </div>
  </div>
</section>
