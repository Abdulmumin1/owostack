<script lang="ts">
  import { ArrowLeft } from "phosphor-svelte";
  import Logo from "$lib/components/ui/Logo.svelte";
  import Footer from "$lib/components/marketing/Footer.svelte";

  let { children, thumbnail, title } = $props();
</script>

<div class="min-h-screen bg-bg-primary text-text-primary font-sans">
  <!-- Header -->
  <header class="px-6 py-5 border-b border-border/30">
    <div class="max-w-4xl mx-auto flex items-center justify-between">
      <a href="/" class="flex items-center gap-2">
        <Logo size={24} class="text-accent" />
        <span class="text-sm font-bold tracking-tight">Owostack</span>
      </a>
      <a
        href="/blog"
        class="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Blog
      </a>
    </div>
  </header>

  <!-- Blog Post Content -->
  <main class="px-6 py-12">
    <div class="max-w-3xl mx-auto">
      {#if thumbnail}
        <div
          class="mb-5 w-full overflow-hidden bg-bg-secondary"
        >
          <img
            src={thumbnail}
            alt={title || "Blog cover"}
            class="w-full h-auto  object-cover"
          />
        </div>
      {/if}
      <article class="prose prose-lg max-w-none">
        {@render children()}
      </article>
    </div>
  </main>

  <Footer />
</div>

<style>
  :global(.prose) {
    color: var(--color-text-primary);
  }

  :global(.prose h1) {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 2.25rem;
    line-height: 1.2;
    margin-bottom: 1rem;
    color: var(--color-text-primary);
  }

  :global(.prose h2) {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1.5rem;
    line-height: 1.3;
    margin-top: 2rem;
    margin-bottom: 1rem;
    color: var(--color-text-primary);
  }

  :global(.prose h3) {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1.25rem;
    line-height: 1.4;
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
    color: var(--color-text-primary);
  }

  :global(.prose p) {
    margin-bottom: 1rem;
    line-height: 1.7;
    color: var(--color-text-secondary);
  }

  :global(.prose a) {
    color: var(--color-accent-hover);
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color 0.15s ease;
  }

  :global(.prose a:hover) {
    color: var(--color-accent);
  }

  :global(.prose ul, .prose ol) {
    margin-bottom: 1rem;
    padding-left: 1.5rem;
  }

  :global(.prose li) {
    margin-bottom: 0.5rem;
    color: var(--color-text-secondary);
  }

  :global(.prose code) {
    font-family: var(--font-mono);
    background: var(--color-bg-secondary);
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    font-size: 0.875em;
    color: var(--color-accent-hover);
  }

  :global(.prose pre) {
    background: var(--color-bg-secondary);
    padding: 1rem;
    border-radius: 8px;
    overflow-x: auto;
    margin-bottom: 1rem;
  }

  :global(.prose pre code) {
    background: transparent;
    padding: 0;
    color: var(--color-text-primary);
  }

  :global(.prose blockquote) {
    border-left: 3px solid var(--color-accent);
    padding-left: 1rem;
    margin-left: 0;
    margin-bottom: 1rem;
    font-style: italic;
    color: var(--color-text-muted);
  }

  :global(.prose hr) {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 2rem 0;
  }

  :global(.prose img) {
    max-width: 100%;
    height: auto;
    border-radius: 8px;
    margin: 1.5rem 0;
    display: block;
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.1),
      0 2px 4px -1px rgba(0, 0, 0, 0.06);
  }

  :global(.prose img + em) {
    display: block;
    text-align: center;
    font-size: 0.875rem;
    color: var(--color-text-muted);
    margin-top: -1rem;
    margin-bottom: 1.5rem;
  }

  :global(.prose table) {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1rem;
  }

  :global(.prose th, .prose td) {
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    text-align: left;
  }

  :global(.prose th) {
    background: var(--color-bg-secondary);
    font-weight: 600;
  }
</style>
