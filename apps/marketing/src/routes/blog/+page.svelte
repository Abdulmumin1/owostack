<script lang="ts">
  import Logo from "$lib/components/ui/Logo.svelte";

  interface BlogPost {
    slug: string;
    title: string;
    excerpt: string;
    date: string;
    readTime: string;
    category: string;
    thumbnail?: string;
  }

  // Import all markdown files and extract metadata
  const modules = import.meta.glob("/src/lib/content/blog/*.md", {
    eager: true,
  });

  const posts = Object.entries(modules)
    .map(([path, module]: [string, any]) => {
      const slug = path
        .replace("/src/lib/content/blog/", "")
        .replace(".md", "");
      return {
        slug,
        title: module.metadata?.title || "Untitled",
        excerpt: module.metadata?.excerpt || "",
        date: module.metadata?.date || "",
        readTime: module.metadata?.readTime || "5 min read",
        category: module.metadata?.category || "General",
        thumbnail: module.metadata?.thumbnail,
      };
    })
    .sort(
      (a: BlogPost, b: BlogPost) =>
        new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
</script>

<svelte:head>
  <title>Blog — Owostack</title>
  <meta
    name="description"
    content="Thoughts on billing, subscriptions, and building for AI SaaS."
  />
</svelte:head>

<div class="h-screen flex bg-bg-primary overflow-hidden">
  <!-- Left Side: Cover Image -->
  <div
    class="hidden lg:flex lg:w-1/2 bg-bg-secondary border-r border-border relative overflow-hidden flex-col justify-between"
  >
    <!-- Image -->
    <div
      class="flex-1 flex flex-col justify-center items-center relative z-10 w-full h-full"
    >
      <img
        src="https://mac-file.yaqeen.me/87C9A6BB-3D4410F0-72E6-46B0-9B54-142A675819EE_1_201_a.jpeg"
        alt="Blog Cover"
        class="w-full h-full object-cover"
      />
    </div>
  </div>

  <!-- Right Side: Content -->
  <div
    class="flex-1 flex flex-col h-screen overflow-y-auto bg-bg-primary relative"
  >
    <!-- Header -->
    <header
      class="px-6 lg:px-12 py-5 border-b border-border/30 sticky top-0 bg-bg-primary/95 backdrop-blur-md z-30"
    >
      <div class="flex items-center justify-between max-w-2xl mx-auto">
        <a href="/" class="flex items-center gap-2">
          <Logo size={24} class="text-accent" />
          <span class="text-sm font-bold tracking-tight">Owostack</span>
        </a>
        <nav class="flex items-center gap-6 text-xs text-text-secondary">
          <!-- <a href="/" class="hover:text-text-primary transition-colors">Home</a> -->
          <a href="/docs" class="hover:text-text-primary transition-colors"
            >Docs</a
          >
          <a
            href="https://app.owostack.com"
            
            class="btn btn-primary"
            >Dashboard</a
          >
        </nav>
      </div>
    </header>

    <main class="flex-1 px-6 lg:px-12 py-10 lg:py-24">
      <div class="max-w-2xl mx-auto">
        <div class="mb-5">
          <h1
            class="text-xl font-bold mb-1 tracking-tight text-text-primary font-display"
          >
            Writings
          </h1>
          <p class="text-text-secondary text-sm">
            Thoughts on billing, subscriptions, and building for AI SaaS.
          </p>
        </div>

        {#if posts.length > 0}
          <div class="flex flex-col gap-0 border-t border-border/20">
            {#each posts as post (post.slug)}
              <article
                class="py-8 border-b border-border/20 group flex flex-col sm:flex-row gap-6 sm:items-center"
              >
                {#if post.thumbnail}
                  <a
                    href={`/blog/${post.slug}`}
                    class="block w-full sm:w-48 shrink-0 overflow-hidden"
                  >
                    <img
                      src={post.thumbnail}
                      alt={post.title}
                      class="w-full h-auto aspect-video object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                      loading="lazy"
                    />
                  </a>
                {/if}
                <div class="flex-1">
                 
                  <h3 class="text-xl lg:text-2xl font-display font-medium mb-3">
                    <a
                      href={`/blog/${post.slug}`}
                      class="text-text-primary group-hover:text-accent transition-colors leading-tight block"
                    >
                      {post.title}
                    </a>
                  </h3>
                
                  <div class="text-xs text-text-muted font-mono">
                    {new Date(post.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                </div>
              </article>
            {/each}
          </div>
        {:else}
          <div
            class="text-center py-20 border border-dashed border-border/50 rounded-2xl"
          >
            <p class="text-text-secondary">
              No blog posts yet. Check back soon!
            </p>
          </div>
        {/if}
      </div>
    </main>

    <!-- Footer -->
    <footer class="px-6 lg:px-12 py-8 mt-auto">
      <div
        class="max-w-2xl mx-auto flex items-center justify-between border-t border-border/20 pt-8"
      >
        <span
          class="text-[10px] text-text-muted font-bold uppercase tracking-widest"
          >© {new Date().getFullYear()} Owostack</span
        >
        <div class="flex gap-4">
          <a
            href="https://github.com/Abdulmumin1/owostack"
            class="text-[10px] text-text-muted font-bold uppercase tracking-widest hover:text-text-primary transition-colors"
            >GitHub</a
          >
        </div>
      </div>
    </footer>
  </div>
</div>
