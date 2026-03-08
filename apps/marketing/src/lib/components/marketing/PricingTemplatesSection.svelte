<script lang="ts">
  import { ArrowRight, CheckCircle, Copy, Square } from "phosphor-svelte";
  import {
    getPricingTemplates,
    type PricingTemplate,
  } from "$lib/content/pricing-templates";
  import InspiredLogo from "./InspiredLogo.svelte";

  const templates = getPricingTemplates();

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

<section class="overflow-hidden border-y border-border/40 bg-bg-primary py-24 md:py-32">
  <div class="mx-auto max-w-6xl px-6">
    <div class="mb-16">
      <div class="mb-4 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em] text-text-muted">
        <Square size={10} class="fill-accent" />
        Pricing Templates
      </div>
      <h2 class="max-w-2xl text-4xl font-bold tracking-tight text-text-primary md:text-5xl">
        Proven shapes for modern SaaS.
      </h2>
      <p class="mt-4 max-w-xl text-sm leading-relaxed text-text-secondary md:text-base">
        A small, sharp collection of pricing models translated into Owostack. 
      </p>
    </div>
  </div>

  <div class="relative mt-12 overflow-hidden">
    <!-- Marquee -->
    <div class="marquee-container flex gap-6 px-6">
      <div class="marquee-content flex gap-6">
        {#each [...templates, ...templates] as template}
          <article class="card card-elevated card-interactive group flex h-150 w-[320px] shrink-0 flex-col !rounded-lg !p-0">
            <div class="border-b border-border/50 p-6">
              <div class="flex items-center justify-between mb-4">
                <div class="flex  items-center justify-center rounded-sm overflow-hidden border border-border bg-bg-secondary text-text-muted transition-colors group-hover:border-accent/30 group-hover:text-accent">
                  <InspiredLogo name={template.inspiredBy} size={34} />
                </div>
                <div class="rounded-full border border-border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim">
                  {template.category}
                </div>
              </div>
              
              <div class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Inspired by {template.inspiredBy.split("-")[0]}
              </div>
              <h3 class="text-2xl font-bold tracking-tight text-text-primary leading-none">
                {template.shortTitle}
              </h3>
            </div>

            <div class="flex-1 bg-bg-secondary/30 px-6 py-5">
               <div class="mb-5 flex items-center justify-between border-b border-border/40 pb-2">
                 <div class="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Anatomy
                 </div>
                 <div class="text-[10px] font-medium text-text-dim">Postpaid</div>
               </div>
               
               <div class="space-y-4">
                 {#each template.breakdown.slice(0, 3) as item}
                   <div class="flex items-center justify-between gap-2 border-b border-border/30 pb-2 last:border-0">
                     <span class="text-[10px] font-semibold uppercase tracking-wide text-text-dim">{item.label}</span>
                     <span class="text-[11px] font-semibold text-text-primary">{item.value}</span>
                   </div>
                 {/each}
               </div>

                <div class="mt-8">
                  <p class="text-sm leading-relaxed text-text-secondary italic line-clamp-2">
                    "{template.rules[0]}"
                  </p>
               </div>
            </div>

            <div class="border-t border-border/50 bg-bg-card px-6 py-5">
               <p class="text-sm leading-relaxed text-text-secondary line-clamp-2">
                {template.summary}
               </p>

               <div class="mt-6 flex items-center justify-between pt-2">
                 <button 
                  type="button"
                  class="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-text-muted transition-colors hover:text-text-primary"
                  onclick={() => copyTemplate(template)}
                >
                  {#if copiedSlug === template.slug}
                    <CheckCircle size={14} weight="fill" class="text-secondary" />
                    Copied
                  {:else}
                    <Copy size={14} />
                    Copy code
                  {/if}
                </button>

                <a 
                  href={`/pricing-templates/${template.slug}`}
                  class="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-primary transition-colors hover:text-accent"
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
  </div>

  <div class="mx-auto mt-20 flex max-w-6xl justify-center px-6">
    <a href="/pricing-templates" class="btn btn-primary gap-2 px-8 py-3 text-sm">
      Explore all templates
      <ArrowRight size={14} weight="bold" />
    </a>
  </div>
</section>

<style>
  .marquee-container {
    mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
  }

  .marquee-content {
    animation: marquee 60s linear infinite;
  }

  .marquee-content:hover {
    animation-play-state: paused;
  }

  @keyframes marquee {
    0% {
      transform: translateX(0);
    }
    100% {
      transform: translateX(calc(-50% - 12px));
    }
  }
</style>
