<script lang="ts">
  import Footer from "$lib/components/marketing/Footer.svelte";
  import Header from "$lib/components/marketing/Header.svelte";

  let { children, thumbnail, title, author } = $props();
</script>

<div class="min-h-screen bg-bg-primary text-text-primary font-sans">
  <Header variant="page" showBorder={true} />

  <!-- Blog Post Content -->
  <main class="px-6 py-12">
    <div class="max-w-3xl mx-auto">
      <div class="flex gap-5 flex-col mb-9">
        <h1 class="text-4xl">{title || "Blog"}</h1>
        <p class="italic text-text-muted">by {author}</p>
      </div>
      {#if thumbnail}
        <div
          class="mb-5 w-full overflow-hidden bg-bg-secondary"
        >
          <img
            src={thumbnail}
            alt={title || "Blog cover"}
            class="w-full h-auto object-cover"
            loading="lazy"
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

  :global(.prose ul), :global(.prose ol) {
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
