import { source } from "@/lib/source";
import {
  openApiUrl,
  renderPageMarkdown,
  siteUrl,
  type LLMPage,
} from "@/lib/llms-utils";

export { decodeMarkdownUrl, renderPageMarkdown } from "@/lib/llms-utils";

/**
 * Minimal shape of a Fumadocs page-tree node that we need to build the
 * llms.txt index. Kept local so we don't depend on internal Fumadocs types.
 */
type TreeNode = {
  type: "page" | "folder" | "separator";
  name?: unknown;
  description?: unknown;
  url?: string;
  children?: TreeNode[];
  index?: TreeNode;
};

function asText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Collect every page URL by walking the page tree in sidebar order. */
function collectPageUrls(nodes: TreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === "separator") continue;
    if (node.type === "folder") {
      if (node.index?.url) out.push(node.index.url);
      collectPageUrls(node.children ?? [], out);
    } else if (node.url) {
      out.push(node.url);
    }
  }
  return out;
}

/** Build the `/llms.txt` index, grouped by the docs sidebar sections. */
export function renderLLMIndex(): string {
  const tree = source.getPageTree() as unknown as TreeNode;
  const lines: string[] = [
    "# Owostack Docs",
    "",
    "> Billing infrastructure for AI SaaS. Subscriptions, usage metering, entitlements, credits, and seat-based products. 3 API calls, zero webhooks.",
    "",
    `Every page is also available as Markdown by appending \`.md\` to its URL, or all at once at ${siteUrl}/llms-full.txt. The raw OpenAPI specification is at ${openApiUrl}`,
    "",
  ];

  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      if (node.type === "separator") continue;

      if (node.type === "folder") {
        const name = asText(node.name);
        if (name) {
          lines.push(`${"#".repeat(Math.min(depth + 2, 6))} ${name}`, "");
        }

        const index = node.index;
        if (index?.url && asText(index.name)) {
          const description = asText(index.description);
          lines.push(
            `- [${asText(index.name)}](${siteUrl}${index.url})${description ? `: ${description}` : ""}`,
          );
        }

        walk(node.children ?? [], depth + 1);
        lines.push("");
      } else if (node.type === "page" && node.url && asText(node.name)) {
        const description = asText(node.description);
        lines.push(
          `- [${asText(node.name)}](${siteUrl}${node.url})${description ? `: ${description}` : ""}`,
        );
      }
    }
  };

  walk(tree.children ?? [], 0);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Concatenate every docs page into a single Markdown document. */
export async function renderLLMFull(): Promise<string> {
  const tree = source.getPageTree() as unknown as TreeNode;
  const urls = collectPageUrls(tree.children ?? []);

  const pageByUrl = new Map(source.getPages().map((page) => [page.url, page]));
  const pages = urls
    .map((url) => pageByUrl.get(url))
    .filter((page): page is NonNullable<typeof page> => Boolean(page));

  const rendered = await Promise.all(
    pages.map((page) => renderPageMarkdown(page as unknown as LLMPage)),
  );

  return rendered.join("\n\n---\n\n");
}
