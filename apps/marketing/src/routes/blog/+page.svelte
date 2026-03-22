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
  <meta property="og:image" content="https://owostack.com/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="https://owostack.com/blog" />
  <meta name="twitter:title" content="Blog — Owostack" />
  <meta
    name="twitter:description"
    content="Thoughts on billing, subscriptions, and building for AI SaaS."
  />
  <meta name="twitter:image" content="https://owostack.com/og.png" />
</svelte:head>

<div class="h-screen flex bg-bg-primary overflow-hidden">
  <!-- Left Side: Abstract Graphic and Context -->
  <div
    class="hidden lg:flex w-[400px] xl:w-[480px] shrink-0 bg-[#E8E6E1] p-12 flex-col justify-between relative overflow-hidden"
  >
    <!-- Abstract Background -->
    <div
      class="absolute inset-0 pointer-events-none opacity-[0.8]"
    >
      <img
        src="https://mac-file.yaqeen.me/3F36AAD9-image.png"
        alt="Abstract engineering background pattern"
        class="w-full h-full object-cover mix-blend-multiply opacity-30"
      />
    </div>

    <div class="relative z-10">
      <div class="mb-16">
        <a href="/" class="text-text-primary hover:text-accent transition-colors">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.5 4C12.5 4 11 5 11 7C11 9 13.5 10 13.5 12C13.5 14 11 15 11 17C11 19 12.5 20 12.5 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M7 8L4 12L7 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M17 8L20 12L17 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </a>
      </div>

      <div class="space-y-4">
        <h2 class="text-[28px] font-bold text-[#222] tracking-tight font-display">
          Writings
        </h2>
        <p class="text-[#555] text-[15px] leading-[1.6] max-w-[280px]">
          Engineering notes and thoughts on building the billing layer for modern AI SaaS.
        </p>
      </div>
    </div>
    <div class="relative z-10 text-text-muted text-xs"></div>
  </div>

  <!-- Right Side: Content -->
  <div
    class="flex-1 flex flex-col h-screen overflow-y-auto bg-[#FAFAFA] relative"
  >
    <!-- Header -->
    <header
      class="px-8 lg:px-16 py-8 sticky top-0 bg-[#FAFAFA] z-30"
    >
      <div class="flex items-center justify-between w-full">
        <div class="lg:hidden">
          <a href="/" class="flex items-center gap-2">
            <Logo size={24} class="text-accent" />
            <span class="text-sm font-bold tracking-tight">Owostack</span>
          </a>
        </div>
        <div class="hidden lg:block"></div>
        <!-- Spacer -->
        <nav class="flex items-center gap-6">
          <a
            href="/docs"
            class=" text-[11px]"
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

    <main class="flex-1 px-8 lg:px-16">
      <div class="max-w-4xl mt-12 lg:mt-24">
        {#if posts.length > 0}
          <div class="flex flex-col gap-12">
            {#each posts as post (post.slug)}
              <article class="group">
                <a href={`/blog/${post.slug}`} class="block">
                  <h3 class="text-[28px] lg:text-[32px] font-bold tracking-tight font-display text-[#111] group-hover:text-[#e8a855] transition-colors leading-[1.2] mb-1">
                    {post.title}
                  </h3>
                  <p class="text-[#888] text-[15px] font-mono tracking-tight">{post.date}</p>
                </a>
              </article>
            {/each}
          </div>
        {:else}
          <div class="text-center py-24">
            <p class="text-text-dim text-xs uppercase tracking-widest font-bold">
              Journal is empty
            </p>
          </div>
        {/if}
      </div>
    </main>
  </div>
</div>
