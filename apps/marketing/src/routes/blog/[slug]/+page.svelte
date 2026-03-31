<script lang="ts">
  import type { ComponentType } from "svelte";

  let { data } = $props<{
    data: {
      metadata: {
        title?: string;
        excerpt?: string;
        date?: string;
      };
      slug: string;
      Component: ComponentType;
    };
  }>();

  const { Component } = data;

  // Dynamic OG generator using Cloudinary
  function getOgImage(title?: string) {
    if (!title) return "https://owostack.com/og.jpg";
    const cloudName = "dtrqaqezs";
    const baseImageId = "og-plain_xvn4jj";
    const encodedTitle = encodeURIComponent(encodeURIComponent(title));
    const overlay = `l_text:Arial_48_bold:${encodedTitle},c_fit,w_480,co_rgb:ececec/fl_layer_apply,g_west,x_70,y_0`;
    return `https://res.cloudinary.com/${cloudName}/image/upload/f_jpg,q_70,w_1200,h_630,c_fill/${overlay}/${baseImageId}.png`;
  }

  let ogImage = $derived(getOgImage(data.metadata?.title));
</script>

<svelte:head>
  <title>{data.metadata?.title || "Blog"} — Owostack</title>
  <meta name="description" content={data.metadata?.excerpt || ""} />
  <link rel="canonical" href={`https://owostack.com/blog/${data.slug}`} />
  <meta property="og:type" content="article" />
  <meta property="og:url" content={`https://owostack.com/blog/${data.slug}`} />
  <meta
    property="og:title"
    content={`${data.metadata?.title || "Blog"} — Owostack`}
  />
  <meta property="og:description" content={data.metadata?.excerpt || ""} />
  <meta property="og:image" content={ogImage} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="article:published_time" content={data.metadata?.date} />
  <meta property="article:author" content="Owostack Team" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@owostack" />
  <meta name="twitter:creator" content="@owostack" />
  <meta name="twitter:url" content={`https://owostack.com/blog/${data.slug}`} />
  <meta
    name="twitter:title"
    content={`${data.metadata?.title || "Blog"} — Owostack`}
  />
  <meta name="twitter:description" content={data.metadata?.excerpt || ""} />
  <meta name="twitter:image" content={ogImage} />
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": "{data.metadata?.title || 'Blog'}",
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
