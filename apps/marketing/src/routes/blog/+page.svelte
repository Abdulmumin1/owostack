<script lang="ts">
  import { ArrowRight } from "phosphor-svelte";
  import Header from "$lib/components/marketing/Header.svelte";
  import Footer from "$lib/components/marketing/Footer.svelte";
  import SectionCut from "$lib/components/marketing/SectionCut.svelte";

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

  <main class="min-h-screen">
    <section class="px-6 pb-14 pt-16 md:pb-20 md:pt-24">
      <div class="mx-auto max-w-4xl">
        <p class="eyebrow mb-6">Writing</p>
        <h1 class="font-display text-display-lg text-balance text-text-primary">
          Notes from building the billing layer.
        </h1>
        <p class="mt-5 max-w-md text-text-secondary">
          Engineering notes and thoughts on building the billing engine for
          modern AI SaaS.
        </p>
      </div>
    </section>

    <SectionCut
      bands={["var(--color-bg-primary)", "var(--color-accent)", "var(--color-ink)"]}
      height="64px"
    />

    <section class="on-ink px-6 py-14 md:py-20">
      <div class="mx-auto max-w-4xl">
        {#if posts.length > 0}
          <div class="flex flex-col">
            {#each posts as post, i (post.slug)}
              <article class="border-t border-ink-line last:border-b">
                <a
                  href={`/blog/${post.slug}`}
                  class="group grid grid-cols-[auto_1fr_auto] items-baseline gap-4 py-6 transition-colors md:gap-8 md:py-7"
                >
                  <span class="font-mono text-2xs text-on-ink-faint">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h2
                    class="font-display text-title-lg leading-tight text-on-ink transition-colors group-hover:text-accent"
                  >
                    {post.title}
                  </h2>
                  <div class="flex items-center gap-3 font-mono text-2xs text-on-ink-faint">
                    <span class="hidden sm:inline">{post.formattedDate}</span>
                    <ArrowRight
                      size={13}
                      weight="bold"
                      class="transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                    />
                  </div>
                </a>
              </article>
            {/each}
          </div>
        {:else}
          <div class="py-16 text-center">
            <p class="eyebrow">Journal is empty</p>
          </div>
        {/if}
      </div>
    </section>

    <SectionCut
      bands={["var(--color-ink)", "var(--color-accent)", "var(--color-bg-primary)"]}
      height="64px"
    />
  </main>

  <Footer />
</div>
