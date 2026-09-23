import { defineConfig, defineDocs } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    postprocess: {
      // Exposes `page.data.getText("processed")` so we can serve clean
      // Markdown to LLM/AI agents via /llms.txt, /llms-full.txt and *.md.
      includeProcessedMarkdown: true,
    },
  },
});

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: {
        light: "gruvbox-light-hard",
        dark: "gruvbox-dark-soft",
      },
    },
  },
});
