<script lang="ts">
  import Logo from "$lib/components/ui/Logo.svelte";
  import { ArrowRight } from "phosphor-svelte";
  import Header from "$lib/components/marketing/Header.svelte";
  import Footer from "$lib/components/marketing/Footer.svelte";

  interface BlogPost {
    slug: string;
    title: string;
    date: string;
    formattedDate: string;
  }

  // Import all markdown files and extract metadata
  const modules = import.meta.glob("/src/lib/content/blog/*.md", {
    eager: true,
  });

  function formatDate(dateString: string): string {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  const posts = Object.entries(modules)
    .map(([path, module]: [string, any]) => {
      const slug = path
        .replace("/src/lib/content/blog/", "")
        .replace(".md", "");
      return {
        slug,
        title: module.metadata?.title || "Untitled",
        date: module.metadata?.date || "",
        formattedDate: formatDate(module.metadata?.date || ""),
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
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@owostack" />
  <meta name="twitter:url" content="https://owostack.com/blog" />
  <meta name="twitter:title" content="Blog — Owostack" />
  <meta
    name="twitter:description"
    content="Thoughts on billing, subscriptions, and building for AI SaaS."
  />
  <meta name="twitter:image" content="https://owostack.com/og.jpg" />
</svelte:head>

<div class="min-h-screen bg-bg-primary text-text-primary font-sans">
  <Header variant="home" />

  <main class="px-6 py-12 md:py-20 min-h-screen">
    <div class="max-w-4xl mx-auto">
      <div class="mb-12">
        <h1 class="text-3xl md:text-4xl font-bold text-text-primary mb-3">
          Writings
        </h1>
        <p class="text-text-secondary max-w-md">
          Engineering notes and thoughts on building the billing engine for
          modern AI SaaS.
        </p>
      </div>

      {#if posts.length > 0}
        <div class="flex flex-col gap-6">
          {#each posts as post (post.slug)}
            <article
              class="group border-b border-border/30 pb-6 last:border-b-0"
            >
              <a href={`/blog/${post.slug}`} class="block">
                <h2
                  class="text-xl md:text-2xl font-bold tracking-tight text-text-primary group-hover:text-accent transition-colors leading-[1.2] mb-2"
                >
                  {post.title}
                </h2>
                <p class="text-text-muted text-sm font-mono tracking-tight">
                  {post.formattedDate}
                </p>
              </a>
            </article>
          {/each}
        </div>
      {:else}
        <div class="text-center py-24">
          <p class="text-text-dim text-sm uppercase tracking-widest font-bold">
            Journal is empty
          </p>
        </div>
      {/if}
    </div>
  </main>

  <Footer />
</div>
