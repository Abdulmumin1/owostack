<script lang="ts">
  import Logo from "$lib/components/ui/Logo.svelte";
  import { Rocket, ArrowRight } from "phosphor-svelte";

  interface BlogPost {
    slug: string;
    title: string;
    date: string;
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
        date: module.metadata?.date || "",
        draft: !!module.metadata?.draft,
      };
    })
    .filter((post) => !post.draft)
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
  <link rel="canonical" href="https://owostack.com/blog" />
  <meta property="og:type" content="blog" />
  <meta property="og:url" content="https://owostack.com/blog" />
  <meta property="og:title" content="Blog — Owostack" />
  <meta
    property="og:description"
    content="Thoughts on billing, subscriptions, and building for AI SaaS."
  />
  <meta property="og:image" content="https://owostack.com/og.jpg" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="https://owostack.com/blog" />
  <meta name="twitter:title" content="Blog — Owostack" />
  <meta
    name="twitter:description"
    content="Thoughts on billing, subscriptions, and building for AI SaaS."
  />
  <meta name="twitter:image" content="https://owostack.com/og.jpg" />
</svelte:head>

<div class="h-screen flex bg-bg-primary overflow-hidden">
  <!-- Left Side: Abstract Graphic and Context -->
  <div
    class="hidden lg:flex w-100 xl:w-150 shrink-0 bg-bg-secondary p-12 flex-col justify-between relative overflow-hidden border-r border-border/40"
  >
    <!-- Abstract Background -->
    <div class="absolute inset-0 pointer-events-none opacity-[0.8]">
      <img
        src="https://mac-file.yaqeen.me/9987E2C7-Generated%20Image%20March%2024%2C%202026%20-%206_24PM.jpg"
        alt="Abstract engineering background pattern"
        class="w-full h-full object-cover mix-blend-multiply opacity-30"
      />
    </div>

    <div class="relative z-10">
      <div class="mb-16">
        <a
          href="/"
          class="text-text-primary hover:text-accent transition-colors"
        >
          <Logo size={24} class="text-current" />
        </a>
      </div>

      <div class="space-y-4">
        <h2
          class="text-[28px] font-bold text-text-primary tracking-tight font-display"
        >
          Writings
        </h2>
        <p class="text-text-secondary text-[15px] leading-[1.6] max-w-[280px]">
          Engineering notes and thoughts on building the billing engine for
          modern AI SaaS.
        </p>
      </div>
    </div>
    <div class="relative z-10 text-text-muted text-xs"></div>
  </div>

  <!-- Right Side: Content -->
  <div
    class="flex-1 flex flex-col h-screen overflow-y-auto bg-bg-primary relative"
  >
    <!-- Header -->
    <header
      class="px-8 lg:px-16 py-8 sticky top-0 bg-bg-primary/90 backdrop-blur-sm border-b border-border/30 z-30"
    >
      <div class="flex items-center justify-between w-full">
        <div class="lg:hidden">
          <a href="/" class="flex items-center gap-2">
            <Logo size={24} class="text-accent" />
            <span class="text-sm font-bold tracking-tight text-text-primary"
              >Owostack</span
            >
          </a>
        </div>
        <div class="hidden lg:block"></div>
        <!-- Spacer -->
        <nav class="flex items-center gap-6">
          <a
            href="/docs"
            class="text-[11px] text-text-secondary hover:text-text-primary transition-colors"
            >Docs</a
          >
          <a href="https://app.owostack.com" class="btn btn-primary"
            >Dashboard</a
          >
        </nav>
      </div>
    </header>

    <main class="flex-1 px-8 lg:px-16">
      <div class="max-w-4xl">
        {#if posts.length > 0}
          <div class="flex flex-col gap-6">
            {#each posts as post (post.slug)}
              <article class="group">
                <a href={`/blog/${post.slug}`} class="block">
                  <h3
                    class="text-[20px] lg:text-[28px] font-bold tracking-tight font-display text-text-primary group-hover:text-accent transition-colors leading-[1.1] mb-1"
                  >
                    {post.title}
                  </h3>
                  <p
                    class="text-text-muted text-[15px] font-mono tracking-tight"
                  >
                    {post.date}
                  </p>
                </a>
              </article>
            {/each}
          </div>
        {:else}
          <div class="text-center py-24">
            <p
              class="text-text-dim text-xs uppercase tracking-widest font-bold"
            >
              Journal is empty
            </p>
          </div>
        {/if}
      </div>
    </main>
  </div>
</div>
