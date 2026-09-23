import { createFileRoute } from "@tanstack/react-router";
import { decodeMarkdownUrl, renderPageMarkdown } from "@/lib/llms";
import { source } from "@/lib/source";

export const Route = createFileRoute("/{$}.md")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slugs = decodeMarkdownUrl(params._splat?.split("/") ?? []);
        const page = source.getPage(slugs);
        if (!page) {
          return new Response("Not Found", { status: 404 });
        }

        return new Response(await renderPageMarkdown(page), {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
          },
        });
      },
    },
  },
});
