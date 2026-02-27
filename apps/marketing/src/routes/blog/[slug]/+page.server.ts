import { error } from "@sveltejs/kit";

interface BlogMetadata {
  title?: string;
  excerpt?: string;
  date?: string;
  readTime?: string;
  category?: string;
}

interface BlogModule {
  metadata?: BlogMetadata;
}

// Import all markdown files for metadata only
const modules: Record<string, BlogModule> = import.meta.glob(
  "/src/lib/content/blog/*.md",
  {
    eager: true,
  },
);

export async function load({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const path = `/src/lib/content/blog/${slug}.md`;

  const module = modules[path];

  if (!module) {
    error(404, "Blog post not found");
  }

  // Only return serializable data (metadata and slug)
  // The component will be loaded client-side
  return {
    metadata: module.metadata || {},
    slug,
  };
}
