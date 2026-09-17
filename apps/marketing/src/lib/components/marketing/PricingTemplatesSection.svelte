<script lang="ts">
  import { ArrowRight, ArrowUpRight, Copy, CheckCircle } from "phosphor-svelte";
  import {
    getPricingTemplates,
    type PricingTemplate,
    type PricingTemplateAccent,
  } from "$lib/content/pricing-templates";
  import InspiredLogo from "./InspiredLogo.svelte";

  const featuredSlugs = [
    "openai-codex-rate-window-credits",
    "cursor-credit-tiers",
    "replicate-gpu-pricing",
  ];

  const all = getPricingTemplates();
  const featured = featuredSlugs
    .map((slug) => all.find((t) => t.slug === slug))
    .filter((t): t is PricingTemplate => Boolean(t));

  const railColor: Record<PricingTemplateAccent, string> = {
    amber: "var(--color-accent)",
    teal: "var(--color-secondary)",
    blue: "var(--color-tertiary)",
    rose: "var(--color-error)",
  };

  let copiedSlug = $state<string | null>(null);

  async function copyTemplate(template: PricingTemplate) {
    try {
      await navigator.clipboard.writeText(template.builderSnippet);
      copiedSlug = template.slug;
      setTimeout(() => {
        if (copiedSlug === template.slug) copiedSlug = null;
      }, 1800);
    } catch (error) {
      console.error("Failed to copy pricing template", error);
    }
  }
</script>

<section class="bg-bg-primary py-24 md:py-32">
  <div class="mx-auto max-w-6xl px-6">
    <div class="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div class="max-w-2xl">
        <p class="eyebrow mb-6">Pricing templates</p>
        <h2 class="font-display text-display-lg text-balance text-text-primary">
          Steal pricing from companies you trust.
        </h2>
      </div>
      <a href="/pricing-templates" class="btn btn-secondary btn-lg shrink-0">
        All {all.length} templates
        <ArrowRight size={14} weight="bold" />
      </a>
    </div>

    <div class="mt-14 grid gap-5 md:grid-cols-3">
      {#each featured as template, i (template.slug)}
        <article class="on-ink flex flex-col overflow-hidden rounded-xl">
          <div class="flex items-center justify-between px-6 pt-6">
            <div class="flex items-center gap-2.5">
              <div class="overflow-hidden rounded-md ring-1 ring-ink-line">
                <InspiredLogo logoUrl={template.logoUrl} alt={template.inspiredBy} size={24} />
              </div>
              <span class="font-display text-lg text-on-ink">{template.inspiredBy}</span>
            </div>
            <a
              href={template.pricingUrl}
              target="_blank"
              rel="noreferrer"
              class="text-on-ink-faint transition-colors hover:text-on-ink"
              aria-label={`${template.inspiredBy} pricing page`}
            >
              <ArrowUpRight size={16} weight="bold" />
            </a>
          </div>

          <!-- dither band -->
          <div class="mt-8 h-24 w-full" aria-hidden="true" style={`--c: ${railColor[template.accent]}`}>
            <div class="flex h-full flex-col">
              <div class="dither flex-1" style="--dither-color: var(--c); background-color: var(--color-ink); background-size: 16px 16px; background-position: 4px 4px"></div>
              <div class="dither flex-1" style="--dither-color: var(--c); background-color: var(--color-ink)"></div>
              <div class="flex-[1.4]" style="background: var(--c)"></div>
              <div class="dither flex-1" style="--dither-color: var(--color-ink); background-color: var(--c)"></div>
              <div class="dither flex-1" style="--dither-color: var(--color-ink); background-color: var(--c); background-size: 16px 16px; background-position: 4px 4px"></div>
            </div>
          </div>

          <div class="flex flex-1 flex-col px-6 pb-6 pt-6">
            <span class="font-mono text-2xs uppercase tracking-[0.08em] text-on-ink-faint">
              {template.category}
            </span>
            <h3 class="mt-2 font-display text-title-lg text-on-ink">{template.shortTitle}</h3>

            <ul class="mt-5 divide-y divide-ink-line border-y border-ink-line">
              {#each template.breakdown.slice(0, 3) as item (item.label)}
                <li class="flex items-baseline justify-between gap-3 py-2.5 text-sm">
                  <span class="text-on-ink-muted">{item.label}</span>
                  <span class="text-right font-medium text-on-ink">{item.value}</span>
                </li>
              {/each}
            </ul>

            <div class="mt-auto flex items-center justify-between pt-6">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 text-sm text-on-ink-muted transition-colors hover:text-on-ink"
                onclick={() => copyTemplate(template)}
              >
                {#if copiedSlug === template.slug}
                  <CheckCircle size={14} weight="fill" class="text-secondary" />
                  Copied
                {:else}
                  <Copy size={14} />
                  Copy config
                {/if}
              </button>
              <a
                href={`/pricing-templates/${template.slug}`}
                class="inline-flex items-center gap-1 text-sm font-medium text-on-ink transition-colors hover:text-accent"
              >
                Details
                <ArrowRight size={14} weight="bold" />
              </a>
            </div>
          </div>
        </article>
      {/each}
    </div>
  </div>
</section>
