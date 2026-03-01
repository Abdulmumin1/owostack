import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params }) => {
  try {
    const slug = params.slug;
    const post = await import(`../../../lib/content/blog/${slug}.md`);

    return {
      Component: post.default,
      metadata: post.metadata,
      slug,
    };
  } catch (e) {
    console.error(e);
    error(404, "Blog post not found");
  }
};
