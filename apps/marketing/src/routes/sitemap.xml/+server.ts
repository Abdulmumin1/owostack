import type { RequestHandler } from "./$types";
import {
  pricingTemplates,
  PRICING_TEMPLATES_LAST_VERIFIED_AT,
} from "$lib/content/pricing-templates";

interface BlogPost {
  metadata?: {
    date?: string;
  };
}

export const GET: RequestHandler = async () => {
  const posts = import.meta.glob<BlogPost>("/src/lib/content/blog/*.md", {
    eager: true,
  });

  const postEntries = Object.entries(posts).map(([path, module]) => ({
    slug: path.replace("/src/lib/content/blog/", "").replace(".md", ""),
    lastmod: module.metadata?.date,
  }));

  const templateSlugs = pricingTemplates.map((t) => t.slug);
  const today = new Date().toISOString().split("T")[0];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://owostack.com/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://owostack.com/blog</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  ${postEntries
    .map(
      (entry) => `
  <url>
    <loc>https://owostack.com/blog/${entry.slug}</loc>${
      entry.lastmod
        ? `
    <lastmod>${entry.lastmod}</lastmod>`
        : ""
    }
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`,
    )
    .join("")}
  <url>
    <loc>https://owostack.com/pricing-templates</loc>
    <lastmod>${PRICING_TEMPLATES_LAST_VERIFIED_AT}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  ${templateSlugs
    .map(
      (slug) => `
  <url>
    <loc>https://owostack.com/pricing-templates/${slug}</loc>
    <lastmod>${PRICING_TEMPLATES_LAST_VERIFIED_AT}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`,
    )
    .join("")}
</urlset>`.trim();

  return new Response(sitemap, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
};
