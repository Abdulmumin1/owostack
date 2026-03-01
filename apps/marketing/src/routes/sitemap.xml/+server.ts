import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async () => {
  const posts = import.meta.glob("/src/lib/content/blog/*.md", { eager: true });
  const postSlugs = Object.keys(posts).map((path) =>
    path.replace("/src/lib/content/blog/", "").replace(".md", ""),
  );

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
</urlset>`.trim();

  return new Response(sitemap, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
};
