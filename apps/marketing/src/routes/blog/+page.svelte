<script lang="ts">
  import Logo from "$lib/components/ui/Logo.svelte";

  interface BlogPost {
    slug: string;
    title: string;
    excerpt: string;
    date: string;
    readTime: string;
    category: string;
  }

  // Import all markdown files and extract metadata
  const modules = import.meta.glob("/src/lib/content/blog/*.md", { eager: true });
  
  const posts = Object.entries(modules)
    .map(([path, module]: [string, any]) => {
      const slug = path.replace("/src/lib/content/blog/", "").replace(".md", "");
      return {
        slug,
        title: module.metadata?.title || "Untitled",
        excerpt: module.metadata?.excerpt || "",
        date: module.metadata?.date || "",
        readTime: module.metadata?.readTime || "5 min read",
        category: module.metadata?.category || "General",
      };
    })
    .sort((a: BlogPost, b: BlogPost) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
</script>

<svelte:head>
  <title>Blog — Owostack</title>
  <meta name="description" content="Thoughts on billing, subscriptions, and building for AI SaaS." />
</svelte:head>

<div class="min-h-screen bg-bg-primary text-text-primary font-sans flex flex-col">
  <!-- Standard Header -->
  <header class="px-6 py-5 border-b border-border/30">
    <div class="max-w-4xl mx-auto flex items-center justify-between">
      <a href="/" class="flex items-center gap-2">
        <Logo size={24} class="text-accent" />
        <span class="text-sm font-bold tracking-tight">Owostack</span>
      </a>
      <nav class="flex items-center gap-6 text-xs text-text-secondary">
        <a href="/" class="hover:text-text-primary transition-colors">Home</a>
        <a href="/docs" class="hover:text-text-primary transition-colors">Docs</a>
        <a href="https://github.com/Abdulmumin1/owostack" class="hover:text-text-primary transition-colors">GitHub</a>
      </nav>
    </div>
  </header>

  <!-- Blog Posts List (Simple Layout) -->
  <main class="flex-1 px-6 pt-16 pb-20">
    <div class="max-w-3xl mx-auto">
      
      {#if posts.length > 0}       

        <!-- All Posts Section -->
        <section>
          <div class="text-[11px] font-bold text-text-muted uppercase tracking-[0.25em] mb-6 border-b border-border/40 pb-4">
            Writings
          </div>
          
          <div class="flex flex-col gap-0">
            {#each posts as post (post.slug)}
              <article class="py-6 border-b border-border/20 group">
                <h3 class="text-lg font-display font-medium mb-2">
                  <a href={`/blog/${post.slug}`} class="text-text-primary group-hover:text-accent transition-colors">
                    {post.title}
                  </a>
                </h3>
                <div class="text-xs text-text-secondary">
                  {new Date(post.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
              </article>
            {/each}
          </div>
        </section>
      {:else}
        <div class="text-center py-20">
          <p class="text-text-secondary">No blog posts yet. Check back soon!</p>
        </div>
      {/if}
    </div>
  </main>

  <!-- Standard Footer -->
  <footer class="px-6 py-8 border-t border-border/30">
    <div class="max-w-4xl mx-auto text-center">
      <span class="text-xs text-text-secondary"
        >© {new Date().getFullYear()} Owostack. A product of The Thirdpen Company.</span
      >
    </div>
  </footer>
</div>
