<script lang="ts">
  // How it works: three calls, one line each, on an ink band.
  const OB = "{";
  const CB = "}";

  const steps = [
    {
      n: "01",
      title: "Define",
      text: "Plans live in one config file. Sync and they're live.",
      file: "owo.config.ts",
    },
    {
      n: "02",
      title: "Attach",
      text: "One call returns a checkout URL. Upgrades use the same call.",
      file: "checkout.ts",
    },
    {
      n: "03",
      title: "Check & track",
      text: "Gate the request, do the work, record the cost.",
      file: "inference.ts",
    },
  ];
</script>

<section class="on-ink relative overflow-hidden py-24 md:py-32">
  <div class="mx-auto max-w-6xl px-6">
    <div class="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div class="max-w-3xl">
        <p class="eyebrow mb-6">How it works</p>
        <h2 class="font-display text-display-lg text-balance text-on-ink">
          Stop rebuilding billing. Call it.
        </h2>
      </div>
      <p class="max-w-xs text-sm leading-relaxed text-on-ink-muted md:text-right">
        Three calls. That's the whole surface area you need to learn.
      </p>
    </div>

    <!-- dithered rail with three stops -->
    <div class="relative mt-16 md:mt-20" aria-hidden="true">
      <div class="dither h-2 w-full" style="--dither-color: var(--color-ink-line)"></div>
      <div class="absolute inset-x-0 top-1/2 hidden -translate-y-1/2 grid-cols-3 lg:grid">
        {#each steps as step (step.n)}
          <div class="flex">
            <span class="h-3 w-3 rounded-full bg-accent ring-4 ring-ink"></span>
          </div>
        {/each}
      </div>
    </div>

    <ol class="mt-10 grid gap-12 lg:grid-cols-3 lg:gap-8">
      {#each steps as step, i (step.n)}
        <li class="flex flex-col">
          <div class="flex items-baseline justify-between">
            <span class="font-display text-display-md leading-none text-on-ink-faint/60">{step.n}</span>
            <span class="font-mono text-2xs text-on-ink-faint">{step.file}</span>
          </div>

          <div class="mt-6 rounded-md border border-ink-line bg-ink-deep px-4 py-3.5 font-mono text-[13px] leading-relaxed text-on-ink-muted">
            {#if i === 0}
              <span class="text-accent">plan</span>(<span class="text-amber-300">"pro"</span>, {OB} price: <span class="text-on-ink">29</span>, credits: <span class="text-on-ink">1000</span> {CB})
            {:else if i === 1}
              <span class="text-accent">await</span> owo.<span class="text-on-ink">attach</span>(user, <span class="text-amber-300">"pro"</span>)
            {:else}
              <span class="text-accent">await</span> owo.<span class="text-on-ink">check</span>(user, <span class="text-amber-300">"gpu"</span>)
              <span class="ml-2 inline-flex items-center gap-1.5 rounded-full border border-secondary/40 px-2 py-0.5 text-2xs text-secondary">
                <span class="h-1.5 w-1.5 rounded-full bg-secondary"></span>allowed
              </span>
            {/if}
          </div>

          <h3 class="mt-6 font-display text-title-lg text-on-ink">{step.title}</h3>
          <p class="mt-2 max-w-xs text-sm leading-relaxed text-on-ink-muted text-pretty">{step.text}</p>
        </li>
      {/each}
    </ol>
  </div>
</section>
