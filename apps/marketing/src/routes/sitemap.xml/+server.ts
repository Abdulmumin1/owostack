import type { RequestHandler } from "./$types";
import { pricingTemplates } from "$lib/content/pricing-templates";

export const GET: RequestHandler = async () => {
  const posts = import.meta.glob("/src/lib/content/blog/*.md", { eager: true });
  const postSlugs = Object.keys(posts).map((path) =>
    path.replace("/src/lib/content/blog/", "").replace(".md", ""),
  );

  const templateSlugs = pricingTemplates.map((t) => t.slug);

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://owostack.com/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://owostack.com/blog</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  ${postSlugs
    .map(
      (slug) => `
  <url>
    <loc>https://owostack.com/blog/${slug}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`,
    )
    .join("")}
  <url>
    <loc>https://owostack.com/pricing-templates</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  ${templateSlugs
    .map(
      (slug) => `
  <url>
    <loc>https://owostack.com/pricing-templates/${slug}</loc>
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
