<script lang="ts">
  import Footer from "$lib/components/marketing/Footer.svelte";
  import Header from "$lib/components/marketing/Header.svelte";

  let { children, thumbnail, title, author } = $props();
</script>

<div class="min-h-screen bg-bg-primary text-text-primary font-sans">
  <Header variant="page" showBorder={true} />

  <!-- Blog Post Content -->
  <main class="px-6 py-16 md:py-24">
    <div class="mx-auto max-w-3xl">
      <div class="mb-12">
        <p class="eyebrow mb-6">Writing</p>
        <h1 class="font-display text-display-lg text-balance text-text-primary">
          {title || "Blog"}
        </h1>
        {#if author}
          <p class="mt-5 font-mono text-2xs uppercase tracking-[0.08em] text-text-muted">
            by {author}
          </p>
        {/if}
      </div>
      {#if thumbnail}
        <div class="mb-10 w-full overflow-hidden border border-border/40 bg-bg-secondary">
          <img
            src={thumbnail}
            alt={title || "Blog cover"}
            class="h-auto w-full object-cover"
            loading="lazy"
          />
        </div>
      {/if}
      <article class="prose max-w-none">
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
    font-stretch: 88%;
    font-weight: 600;
    font-size: 2.25rem;
    line-height: 1.15;
    letter-spacing: -0.02em;
    margin-bottom: 1rem;
    color: var(--color-text-primary);
  }

  :global(.prose h2) {
    font-family: var(--font-display);
    font-stretch: 88%;
    font-weight: 600;
    font-size: 1.5rem;
    line-height: 1.25;
    letter-spacing: -0.02em;
    margin-top: 2.5rem;
    margin-bottom: 1rem;
    color: var(--color-text-primary);
  }

  :global(.prose h3) {
    font-family: var(--font-display);
    font-stretch: 88%;
    font-weight: 600;
    font-size: 1.25rem;
    line-height: 1.35;
    letter-spacing: -0.01em;
    margin-top: 2rem;
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

  :global(.prose ul),
  :global(.prose ol) {
    margin-top: 1.5rem;
    margin-bottom: 1.5rem;
    padding-left: 0;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  :global(.prose ul) {
    list-style-type: none;
  }

  :global(.prose ol) {
    list-style-type: none;
    counter-reset: prose-counter;
  }

  :global(.prose li) {
    position: relative;
    margin-bottom: 0;
    color: var(--color-text-secondary);
    line-height: 1.7;
    padding-left: 1.75rem;
  }

  :global(.prose ul li::before) {
    content: "->";
    position: absolute;
    left: 0;
    top: 0;
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-weight: 500;
  }

  :global(.prose ol li::before) {
    counter-increment: prose-counter;
    content: counter(prose-counter) ".";
    position: absolute;
    left: 0;
    top: 0;
    font-weight: 600;
    color: var(--color-text-muted);
    font-size: 0.9em;
  }

  :global(.prose li strong) {
    color: var(--color-text-primary);
    font-weight: 600;
  }

  :global(.prose li p) {
    margin-top: 0.5rem;
    margin-bottom: 0;
  }

  :global(.prose code) {
    font-family: var(--font-mono);
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    font-size: 0.875em;
    color: var(--color-text-primary);
  }

  :global(.prose pre) {
    background: var(--color-ink);
    padding: 1.25rem;
    border-radius: 8px;
    overflow-x: auto;
    margin-bottom: 1.5rem;
  }

  :global(.prose pre code) {
    background: transparent;
    border: none;
    padding: 0;
    color: var(--color-on-ink);
    font-size: 0.8125rem;
    line-height: 1.7;
  }

  :global(.prose blockquote) {
    border-left: 3px solid var(--color-accent);
    padding-left: 1.25rem;
    margin-left: 0;
    margin-bottom: 1rem;
    color: var(--color-text-primary);
  }

  :global(.prose hr) {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 2rem 0;
  }

  :global(.prose img) {
    border-radius: 8px;
    margin: 1.5rem 0;
    display: block;
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
