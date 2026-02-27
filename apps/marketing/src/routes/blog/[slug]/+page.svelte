<script lang="ts">
  import type { ComponentType } from "svelte";

  interface BlogMetadata {
    title?: string;
    excerpt?: string;
    date?: string;
    readTime?: string;
    category?: string;
  }

  interface BlogModule {
    default: ComponentType;
    metadata?: BlogMetadata;
  }

  let { data } = $props<{ 
    data: { 
      metadata: BlogMetadata; 
      slug: string 
    } 
  }>();

  // Load the component dynamically
  let Component = $state<ComponentType | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  $effect(() => {
    const loadComponent = async () => {
      try {
        loading = true;
        error = null;
        
        // Dynamic import of the markdown file
        const module = await import(`$lib/content/blog/${data.slug}.md`) as BlogModule;
        Component = module.default;
      } catch (err) {
        console.error("Failed to load blog post:", err);
        error = "Failed to load blog post";
      } finally {
        loading = false;
      }
    };

    loadComponent();
  });
</script>

<svelte:head>
  <title>{data.metadata?.title || "Blog"} — Owostack</title>
  <meta name="description" content={data.metadata?.excerpt || ""} />
</svelte:head>

{#if loading}
  <div class="min-h-screen bg-bg-primary flex items-center justify-center">
    <div class="text-text-secondary">Loading...</div>
  </div>
{:else if error}
  <div class="min-h-screen bg-bg-primary flex items-center justify-center">
    <div class="text-error">{error}</div>
  </div>
{:else if Component}
  <Component />
{/if}
