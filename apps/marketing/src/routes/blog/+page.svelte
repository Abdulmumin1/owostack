<script lang="ts">
  import Logo from "$lib/components/ui/Logo.svelte";
  import { Rocket, ArrowRight } from "phosphor-svelte";

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
  <!-- Left Side: Abstract Graphic and Context -->
  <div
    class="hidden lg:flex w-1/3 bg-bg-secondary border-r border-border p-12 flex-col justify-between relative overflow-hidden"
  >
    <!-- Abstract Background -->
    <div
      class="absolute inset-0 opacity-10 pointer-events-none grayscale brightness-50 contrast-125"
    >
      <img
        src="https://mac-file.yaqeen.me/3F36AAD9-image.png"
        alt=""
        class="w-full h-full object-cover"
      />
    </div>

    <div class="relative z-10">
      <div class="mb-12">
        <a href="/">
          <Logo size={32} />
        </a>
      </div>

      <div class="space-y-4">
        <h2 class="text-2xl font-bold text-text-primary tracking-tight">
          Writings
        </h2>
        <p class="text-text-secondary text-sm leading-relaxed max-w-xs">
          Engineering notes and thoughts on building the billing layer for
          modern AI SaaS.
        </p>
      </div>
    </div>

    <div class="relative z-10 text-text-muted">@ wwo</div>
  </div>

  <!-- Right Side: Content -->
  <div
    class="flex-1 flex flex-col h-screen overflow-y-auto bg-bg-primary relative"
  >
    <!-- Header -->
    <header
      class="px-6 lg:px-12 py-5 border-b border-border/30 sticky top-0 bg-bg-primary/95 backdrop-blur-md z-30"
    >
      <div class="flex items-center justify-between max-w-3xl mx-auto">
        <div class="lg:hidden">
          <a href="/" class="flex items-center gap-2">
            <Logo size={24} class="text-accent" />
            <span class="text-sm font-bold tracking-tight">Owostack</span>
          </a>
        </div>
        <div class="hidden lg:block"></div>
        <!-- Spacer -->
        <nav class="flex items-center gap-6 text-xs text-text-secondary">
          <a
            href="/docs"
            class="hover:text-text-primary transition-colors font-bold uppercase tracking-widest text-[10px]"
            >Docs</a
          >
          <a
            href="https://app.owostack.com"
            class="btn btn-primary text-[10px] uppercase tracking-widest py-2 px-4"
            >Dashboard</a
          >
        </nav>
      </div>
    </header>

    <main class="flex-1 p-1">
      <div class="max-w-4xl mx-auto">
        {#if posts.length > 0}
          <div class="flex flex-col gap-0 border-t border-border/20">
            {#each posts as post (post.slug)}
              <article class="py-12 border-b border-border/20 group">
                <div class="flex flex-col sm:flex-row gap-10 items-start">
                  <div class="flex-1 pt-1">
                    <h3
                      class="text-2xl lg:text-3xl font-bold mb-5 tracking-tight"
                    >
                      <a
                        href={`/blog/${post.slug}`}
                        class="text-text-primary group-hover:text-accent transition-colors leading-[1.15] block"
                      >
                        {post.title}
                      </a>
                    </h3>
                  </div>
                </div>
              </article>
            {/each}
          </div>
        {:else}
          <div
            class="text-center py-24 border border-dashed border-border/30 rounded-sm bg-bg-secondary/30"
          >
            <p
              class="text-text-dim text-xs uppercase tracking-widest font-bold"
            >
              Journal is empty
            </p>
            <p class="text-[10px] text-text-dim mt-2 italic">
              Check back soon for new articles.
            </p>
          </div>
        {/if}
      </div>
    </main>
  </div>
</div>
