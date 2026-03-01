<script lang="ts">
  import type { ComponentType } from "svelte";

  let { data } = $props<{ 
    data: { 
      metadata: {
        title?: string;
        excerpt?: string;
        date?: string;
        thumbnail?: string;
      };
      slug: string;
      Component: ComponentType;
    } 
  }>();

  const { Component } = data;
</script>

<svelte:head>
  <title>{data.metadata?.title || "Blog"} — Owostack</title>
  <meta name="description" content={data.metadata?.excerpt || ""} />
  <link rel="canonical" href={`https://owostack.com/blog/${data.slug}`} />
  <meta property="og:type" content="article" />
  <meta property="og:url" content={`https://owostack.com/blog/${data.slug}`} />
  <meta property="og:title" content={`${data.metadata?.title || "Blog"} — Owostack`} />
  <meta property="og:description" content={data.metadata?.excerpt || ""} />
  <meta property="og:image" content={data.metadata?.thumbnail ? `https://owostack.com${data.metadata.thumbnail}` : "https://owostack.com/logo.svg"} />
  <meta property="article:published_time" content={data.metadata?.date} />
  <meta property="article:author" content="Owostack Team" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content={`https://owostack.com/blog/${data.slug}`} />
  <meta name="twitter:title" content={`${data.metadata?.title || "Blog"} — Owostack`} />
  <meta name="twitter:description" content={data.metadata?.excerpt || ""} />
  <meta name="twitter:image" content={data.metadata?.thumbnail ? `https://owostack.com${data.metadata.thumbnail}` : "https://owostack.com/logo.svg"} />
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": "{data.metadata?.title || "Blog"}",
      "description": "{data.metadata?.excerpt || ""}",
      "datePublished": "{data.metadata?.date}",
      "author": {
        "@type": "Organization",
        "name": "Owostack"
      },
      "publisher": {
        "@type": "Organization",
        "name": "Owostack",
        "logo": {
          "@type": "ImageObject",
          "url": "https://owostack.com/logo.svg"
        }
      }
    }
  </script>
</svelte:head>

<Component />
